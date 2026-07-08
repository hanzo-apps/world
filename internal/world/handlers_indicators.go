package world

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// handlers_indicators.go — /v1/world/indicators.
//
// The trader dashboard: the classic risk suite in one call, every field sourced
// from a free/no-key upstream (Yahoo charts, alternative.me, CoinGecko global,
// exchange funding) and degrading to null per-field when a source is down, never
// 5xx. Two composites (equity fear/greed, risk-on/off) are computed here with
// their formulas shipped inline in the payload so a consumer can audit the number.

// ── symbol universe ──────────────────────────────────────────────────────────

type namedSym struct{ symbol, name string }

var (
	momentumIndices = []namedSym{
		{"SPY", "S&P 500"}, {"QQQ", "Nasdaq 100"}, {"IWM", "Russell 2000"}, {"DIA", "Dow 30"},
	}
	// The 11 SPDR sector ETFs — the advance/decline breadth proxy.
	sectorETFs = []namedSym{
		{"XLK", "Technology"}, {"XLF", "Financials"}, {"XLE", "Energy"}, {"XLV", "Health Care"},
		{"XLI", "Industrials"}, {"XLU", "Utilities"}, {"XLY", "Consumer Disc."}, {"XLP", "Consumer Staples"},
		{"XLB", "Materials"}, {"XLRE", "Real Estate"}, {"XLC", "Communications"},
	}
)

// handleIndicators returns the full trader-desk suite. Cached ~2 min. Yahoo is
// hit for ~28 symbols under a bounded pool; alternative.me / CoinGecko / exchange
// funding fill the crypto + fear-greed corners. Any single source failing leaves
// its field null and the composites recompute over what survived.
func (s *Server) handleIndicators(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "indicators:v1",
		"public, max-age=120, s-maxage=120, stale-while-revalidate=300",
		2*time.Minute, 15*time.Minute,
		func(ctx context.Context) (any, error) { return s.computeIndicators(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", indicatorsFallback())
		})
}

func (s *Server) computeIndicators(ctx context.Context) (any, error) {
	// One batched Yahoo pull for the whole dashboard: 1y for VIX (percentile),
	// 1mo daily for everything else (enough for 1d/5d/1m returns + a sparkline).
	reqs := map[string]string{
		"^VIX": "range=1y&interval=1d", "^VVIX": "range=1mo&interval=1d", "^MOVE": "range=1mo&interval=1d",
		"^IRX": "range=1mo&interval=1d", "2YY=F": "range=1mo&interval=1d", "^FVX": "range=1mo&interval=1d",
		"^TNX": "range=1mo&interval=1d", "^TYX": "range=1mo&interval=1d",
		"DX-Y.NYB": "range=1mo&interval=1d", "GC=F": "range=1mo&interval=1d",
		"CL=F": "range=1mo&interval=1d", "HG=F": "range=1mo&interval=1d", "BTC-USD": "range=1mo&interval=1d",
	}
	for _, n := range momentumIndices {
		reqs[n.symbol] = "range=1mo&interval=1d"
	}
	for _, n := range sectorETFs {
		reqs[n.symbol] = "range=1mo&interval=1d"
	}
	closes := s.batchCloses(ctx, reqs, 8)

	// Side sources, in parallel with each other (Yahoo already done above).
	var fng struct {
		Data []struct {
			Value          string `json:"value"`
			Classification string `json:"value_classification"`
		} `json:"data"`
	}
	var global struct {
		Data struct {
			MarketCapPct    map[string]float64 `json:"market_cap_percentage"`
			MCapChange24hPct float64           `json:"market_cap_change_percentage_24h_usd"`
		} `json:"data"`
	}
	var fundingRate *float64
	var fundingSrc string
	runParallel(
		func() { _ = s.getJSON(ctx, "https://api.alternative.me/fng/?limit=1&format=json", nil, &fng) },
		func() { _ = s.getJSON(ctx, "https://api.coingecko.com/api/v3/global", map[string]string{"Accept": "application/json"}, &global) },
		func() { fundingRate, fundingSrc = s.btcFundingRate(ctx) },
	)

	// ── volatility ──
	vixQ := quoteOf(closes["^VIX"])
	var vixPct *float64
	if s := closes["^VIX"]; len(s) > 1 {
		p := percentileRank(s[len(s)-1], s)
		vixPct = &p
	}
	move, moveNote := moveIndex(closes)
	volatility := map[string]any{
		"vix":  withExtra(vixQ, "percentile1y", ptr2(vixPct)),
		"vvix": quoteOf(closes["^VVIX"]),
		"move": move,
		"note": moveNote,
	}

	// ── yield curve ──
	yield := func(sym string) *float64 { return lastOf(closes[sym]) }
	m3, y2, y5, y10, y30 := yield("^IRX"), yield("2YY=F"), yield("^FVX"), yield("^TNX"), yield("^TYX")
	yieldCurve := map[string]any{
		"threeMonth": ptr3(m3), "twoYear": ptr3(y2), "fiveYear": ptr3(y5),
		"tenYear": ptr3(y10), "thirtyYear": ptr3(y30),
		"spread2s10s": spreadBps(y10, y2), "spread3m10y": spreadBps(y10, m3), "spread5s30s": spreadBps(y30, y5),
		"inverted": y10 != nil && y2 != nil && *y10 < *y2,
		"note":     "spreads in basis points; 2Y = CBOT 2-Year Yield future (2YY=F); inversion flag on 2s10s",
	}

	// ── momentum + breadth ──
	indices := make([]map[string]any, 0, len(momentumIndices))
	for _, n := range momentumIndices {
		if q := quoteOf(closes[n.symbol]); q != nil {
			indices = append(indices, withNameSym(q, n))
		}
	}
	sectors := make([]map[string]any, 0, len(sectorETFs))
	adv, dec := 0, 0
	for _, n := range sectorETFs {
		q := quoteOf(closes[n.symbol])
		if q == nil {
			continue
		}
		sectors = append(sectors, withNameSym(q, n))
		if r1d, ok := q["r1d"].(float64); ok {
			if r1d >= 0 {
				adv++
			} else {
				dec++
			}
		}
	}
	sort.SliceStable(sectors, func(i, j int) bool { return asFloat(sectors[i]["r1d"]) > asFloat(sectors[j]["r1d"]) })
	var advDec *float64
	if adv+dec > 0 {
		v := float64(adv) / float64(adv+dec)
		advDec = &v
	}
	momentum := map[string]any{"indices": indices}
	breadth := map[string]any{
		"advancers": adv, "decliners": dec, "advanceDeclineRatio": ptr2(advDec),
		"sectors": sectors, "note": "advance/decline across the 11 SPDR sector ETFs, 1-day",
	}

	// ── crypto ──
	btcQ := quoteOf(closes["BTC-USD"])
	var btcDom, mcapChg *float64
	if global.Data.MarketCapPct != nil {
		if v, ok := global.Data.MarketCapPct["btc"]; ok {
			btcDom = &v
		}
	}
	if global.Data.MCapChange24hPct != 0 {
		mcapChg = &global.Data.MCapChange24hPct
	}
	var fundingAnnual *float64
	if fundingRate != nil {
		v := *fundingRate * 3 * 365 * 100 // 8h funding → 3/day, %/yr
		fundingAnnual = &v
	}
	crypto := map[string]any{
		"btc":            btcQ,
		"btcDominance":   ptr2(btcDom),
		"mcapChange24h":  ptr2(mcapChg),
		"fundingRate":    ptrPct(fundingRate),
		"fundingAnnualized": ptr2(fundingAnnual),
		"fundingSource":  fundingSrc,
		"note":           "BTC-USDT perp funding; positive = longs pay shorts (leveraged-long bias)",
	}

	// ── fx + commodities ──
	fx := map[string]any{"dxy": withNameSym(quoteOf(closes["DX-Y.NYB"]), namedSym{"DX-Y.NYB", "US Dollar Index"})}
	gold := quoteOf(closes["GC=F"])
	oil := quoteOf(closes["CL=F"])
	copper := quoteOf(closes["HG=F"])
	commodities := map[string]any{
		"gold":   withNameSym(gold, namedSym{"GC=F", "Gold"}),
		"oil":    withNameSym(oil, namedSym{"CL=F", "WTI Crude"}),
		"copper": withNameSym(copper, namedSym{"HG=F", "Copper"}),
	}

	// ── composites ──
	equityFG := computeEquityFearGreed(vixPct, advDec, closes["SPY"])
	fearGreed := map[string]any{
		"crypto": cryptoFearGreed(fng),
		"equity": equityFG,
	}
	riskOnOff := computeRiskOnOff(lastOf(closes["^VIX"]), closes["SPY"], advDec, closes["HG=F"], closes["GC=F"], closes["BTC-USD"])

	sources := map[string]any{
		"yahoo":       boolState(len(closes) > 0),
		"alternative": boolState(len(fng.Data) > 0),
		"coingecko":   boolState(btcDom != nil),
		"funding":     fundingSrc,
	}

	return map[string]any{
		"timestamp":   nowISO(),
		"volatility":  volatility,
		"yieldCurve":  yieldCurve,
		"fearGreed":   fearGreed,
		"momentum":    momentum,
		"breadth":     breadth,
		"crypto":      crypto,
		"fx":          fx,
		"commodities": commodities,
		"riskOnOff":   riskOnOff,
		"sources":     sources,
	}, nil
}

// ── composites (formulas shipped in payload) ─────────────────────────────────

// computeEquityFearGreed blends VIX percentile (inverted), sector breadth, and
// SPY 1-month momentum into a 0-100 greed score. Higher = greedier. Weights and
// component scores are returned so the number is auditable.
func computeEquityFearGreed(vixPct, advDec *float64, spy []float64) map[string]any {
	var parts []float64
	comp := map[string]any{}
	if vixPct != nil {
		v := 100 - *vixPct // low VIX percentile → greed
		parts = append(parts, v)
		comp["vixScore"] = round2s(v)
	} else {
		comp["vixScore"] = nil
	}
	if advDec != nil {
		v := *advDec * 100
		parts = append(parts, v)
		comp["breadthScore"] = round2s(v)
	} else {
		comp["breadthScore"] = nil
	}
	if r := rateOfChange(spy, minInt(len(spy)-1, 21)); r != nil {
		v := clampF(50+*r*5, 0, 100) // +1% 1m ≈ +5 pts
		parts = append(parts, v)
		comp["momentumScore"] = round2s(v)
	} else {
		comp["momentumScore"] = nil
	}
	var value *int
	if len(parts) > 0 {
		// Documented weighting collapses to a simple mean when a part is missing.
		sum := 0.0
		for _, p := range parts {
			sum += p
		}
		v := int(math.Round(sum / float64(len(parts))))
		value = &v
	}
	return map[string]any{
		"value":      ptri(value),
		"label":      fearGreedLabel(value),
		"components": comp,
		"formula":    "0.4·(100−VIX_pct_1y) + 0.3·(adv/(adv+dec)·100) + 0.3·clamp(50+SPY_1m%·5,0,100); equal-weight mean over available components",
	}
}

// computeRiskOnOff is a -100..+100 composite (+ = risk-on) = 100 × mean of the
// available normalized components. Each component is clamped to [-1,+1].
func computeRiskOnOff(vix *float64, spy []float64, advDec *float64, copper, gold, btc []float64) map[string]any {
	comp := map[string]any{}
	var parts []float64
	add := func(name string, v *float64) {
		if v == nil {
			comp[name] = nil
			return
		}
		c := clampF(*v, -1, 1)
		comp[name] = round2s(c)
		parts = append(parts, c)
	}
	// volatility: VIX 18 neutral, lower = risk-on.
	if vix != nil {
		v := (18 - *vix) / 18
		add("volatility", &v)
	} else {
		add("volatility", nil)
	}
	// equity momentum: ±5% over 5d = full swing.
	if r := rateOfChange(spy, 5); r != nil {
		v := *r / 5
		add("equityMomentum", &v)
	} else {
		add("equityMomentum", nil)
	}
	// breadth: adv/dec ratio centered at 0.5.
	if advDec != nil {
		v := (*advDec - 0.5) * 2
		add("breadth", &v)
	} else {
		add("breadth", nil)
	}
	// cyclical: copper outperforming gold over 1m = risk-on.
	if cr, gr := rateOfChange(copper, minInt(len(copper)-1, 21)), rateOfChange(gold, minInt(len(gold)-1, 21)); cr != nil && gr != nil {
		v := (*cr - *gr) / 10
		add("copperGold", &v)
	} else {
		add("copperGold", nil)
	}
	// crypto risk appetite: BTC 5d.
	if r := rateOfChange(btc, 5); r != nil {
		v := *r / 10
		add("crypto", &v)
	} else {
		add("crypto", nil)
	}
	var score *float64
	if len(parts) > 0 {
		sum := 0.0
		for _, p := range parts {
			sum += p
		}
		v := math.Round(100 * sum / float64(len(parts)))
		score = &v
	}
	return map[string]any{
		"score":      ptrf(score),
		"label":      riskLabel(score),
		"components": comp,
		"formula":    "100 × mean(clamp[-1,1] of: (18−VIX)/18, SPY_5d%/5, (adv/dec−0.5)·2, (copper_1m%−gold_1m%)/10, BTC_5d%/10)",
	}
}

func cryptoFearGreed(fng struct {
	Data []struct {
		Value          string `json:"value"`
		Classification string `json:"value_classification"`
	} `json:"data"`
}) map[string]any {
	if len(fng.Data) == 0 {
		return map[string]any{"value": nil, "label": "Unknown", "source": "alternative.me"}
	}
	v, err := strconv.Atoi(trimSpace(fng.Data[0].Value))
	if err != nil {
		return map[string]any{"value": nil, "label": "Unknown", "source": "alternative.me"}
	}
	return map[string]any{"value": v, "label": fng.Data[0].Classification, "source": "alternative.me"}
}

// ── funding rate (Binance primary, OKX fallback — both free/no-key) ──────────

// btcFundingRate returns the BTC perpetual funding rate as a decimal (e.g.
// 0.0001 = 1bp) and the source that answered. Binance is tried first (task
// canonical); OKX is the fallback because Binance/Bybit geo-block many DC IPs.
func (s *Server) btcFundingRate(ctx context.Context) (*float64, string) {
	var binance struct {
		LastFundingRate string `json:"lastFundingRate"`
	}
	if err := s.getJSON(ctx, "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", nil, &binance); err == nil {
		if f, err := strconv.ParseFloat(trimSpace(binance.LastFundingRate), 64); err == nil {
			return &f, "binance"
		}
	}
	var okx struct {
		Data []struct {
			FundingRate string `json:"fundingRate"`
		} `json:"data"`
	}
	if err := s.getJSON(ctx, "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USD-SWAP", nil, &okx); err == nil && len(okx.Data) > 0 {
		if f, err := strconv.ParseFloat(trimSpace(okx.Data[0].FundingRate), 64); err == nil {
			return &f, "okx"
		}
	}
	return nil, "unavailable"
}

// ── quote + batch helpers ────────────────────────────────────────────────────

// batchCloses fetches daily closes for many symbols under a bounded worker pool
// (Yahoo tolerates modest concurrency; conc caps it). Failed symbols are absent.
func (s *Server) batchCloses(ctx context.Context, reqs map[string]string, conc int) map[string][]float64 {
	out := make(map[string][]float64, len(reqs))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, conc)
	for sym, ri := range reqs {
		wg.Add(1)
		sem <- struct{}{}
		go func(sym, ri string) {
			defer wg.Done()
			defer func() { <-sem }()
			yc, err := s.yahooChart(ctx, sym, ri)
			if err != nil {
				return
			}
			c := yc.closes()
			if len(c) == 0 {
				return
			}
			mu.Lock()
			out[sym] = c
			mu.Unlock()
		}(sym, ri)
	}
	wg.Wait()
	return out
}

// quoteOf turns a close series into a {price,change,r1d,r5d,r1m,sparkline} tile.
// Returns nil when the series is too short (caller renders it as unavailable).
func quoteOf(closes []float64) map[string]any {
	if len(closes) < 2 {
		return nil
	}
	last := closes[len(closes)-1]
	prev := closes[len(closes)-2]
	return map[string]any{
		"price":     round2s(last),
		"change":    round2s(last - prev),
		"r1d":       round2s(pctChange(last, prev)),
		"r5d":       ptr2(rateOfChange(closes, 5)),
		"r1m":       ptr2(rateOfChange(closes, minInt(len(closes)-1, 21))),
		"sparkline": tailN(closes, 30),
	}
}

func withNameSym(q map[string]any, n namedSym) map[string]any {
	if q == nil {
		return map[string]any{"symbol": n.symbol, "name": n.name, "available": false}
	}
	q["symbol"] = n.symbol
	q["name"] = n.name
	return q
}

func withExtra(q map[string]any, key string, val any) map[string]any {
	if q == nil {
		return map[string]any{"available": false, key: val}
	}
	q[key] = val
	return q
}

// moveIndex prefers the real ^MOVE index; if absent it proxies bond volatility
// from the 20-day annualized realized vol of the 10-year yield (^TNX).
func moveIndex(closes map[string][]float64) (map[string]any, string) {
	if q := quoteOf(closes["^MOVE"]); q != nil {
		q["source"] = "^MOVE"
		return q, "ICE BofA MOVE index (bond-market implied vol)"
	}
	tnx := closes["^TNX"]
	if len(tnx) >= 6 {
		var rets []float64
		for i := 1; i < len(tnx); i++ {
			if tnx[i-1] != 0 {
				rets = append(rets, (tnx[i]-tnx[i-1])/tnx[i-1])
			}
		}
		if v := stdev(rets); v > 0 {
			proxy := round2s(v * math.Sqrt(252) * 100)
			return map[string]any{"price": proxy, "source": "proxy:^TNX-rv20", "available": true}, "MOVE unavailable — proxy = 20d annualized realized vol of 10Y yield"
		}
	}
	return map[string]any{"available": false, "source": "proxy:^TNX-rv20"}, "MOVE + proxy unavailable"
}

// ── small numeric helpers ────────────────────────────────────────────────────

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func pctChange(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return (a - b) / b * 100
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// percentileRank returns the % of series strictly below v (0-100).
func percentileRank(v float64, series []float64) float64 {
	if len(series) == 0 {
		return 0
	}
	below := 0
	for _, x := range series {
		if x < v {
			below++
		}
	}
	return round2s(float64(below) / float64(len(series)) * 100)
}

func stdev(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	var mean float64
	for _, x := range xs {
		mean += x
	}
	mean /= float64(len(xs))
	var sq float64
	for _, x := range xs {
		d := x - mean
		sq += d * d
	}
	return math.Sqrt(sq / float64(len(xs)-1))
}

func lastOf(xs []float64) *float64 {
	if len(xs) == 0 {
		return nil
	}
	v := xs[len(xs)-1]
	return &v
}

// spreadBps returns (long−short) in basis points, or nil if either leg is nil.
func spreadBps(long, short *float64) any {
	if long == nil || short == nil {
		return nil
	}
	return round1((*long - *short) * 100)
}

// ptrPct rounds a decimal rate to 4 dp (funding rates are tiny), nil-safe.
func ptrPct(p *float64) any {
	if p == nil {
		return nil
	}
	return round4s(*p)
}

func round4s(f float64) float64 { return math.Round(f*10000) / 10000 }

// ptr3 rounds a nil-safe float to 3 dp (yields).
func ptr3(p *float64) any {
	if p == nil {
		return nil
	}
	return round3s(*p)
}

func boolState(ok bool) string {
	if ok {
		return "ok"
	}
	return "degraded"
}

func fearGreedLabel(v *int) string {
	if v == nil {
		return "Unknown"
	}
	switch {
	case *v >= 75:
		return "Extreme greed"
	case *v >= 55:
		return "Greed"
	case *v > 45:
		return "Neutral"
	case *v >= 25:
		return "Fear"
	default:
		return "Extreme fear"
	}
}

func riskLabel(v *float64) string {
	if v == nil {
		return "Unknown"
	}
	switch {
	case *v >= 20:
		return "Risk-on"
	case *v <= -20:
		return "Risk-off"
	default:
		return "Neutral"
	}
}

func indicatorsFallback() map[string]any {
	return map[string]any{
		"timestamp":   nowISO(),
		"volatility":  map[string]any{"vix": nil, "vvix": nil, "move": map[string]any{"available": false}},
		"yieldCurve":  map[string]any{"inverted": false},
		"fearGreed":   map[string]any{"crypto": map[string]any{"value": nil, "label": "Unknown"}, "equity": map[string]any{"value": nil, "label": "Unknown"}},
		"momentum":    map[string]any{"indices": []any{}},
		"breadth":     map[string]any{"advancers": 0, "decliners": 0, "sectors": []any{}},
		"crypto":      map[string]any{"btc": nil, "btcDominance": nil},
		"fx":          map[string]any{"dxy": nil},
		"commodities": map[string]any{"gold": nil, "oil": nil, "copper": nil},
		"riskOnOff":   map[string]any{"score": nil, "label": "Unknown"},
		"sources":     map[string]any{"yahoo": "degraded"},
		"unavailable": true,
	}
}
