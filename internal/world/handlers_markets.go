package world

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/markethours"
)

// ── CoinGecko ────────────────────────────────────────────────────────────────

var allowedCurrencies = []string{"usd", "eur", "gbp", "jpy", "cny", "btc", "eth"}

// handleCoingecko proxies CoinGecko simple/price (or coins/markets). The body is
// returned verbatim — the frontend consumes the CoinGecko shape directly.
// Ported from api/coingecko.js.
func (s *Server) handleCoingecko(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	ids := validateCoinIDs(q.Get("ids"))
	vs := "usd"
	if c := lower(trimSpace(q.Get("vs_currencies"))); oneOf(c, allowedCurrencies...) {
		vs = c
	}
	inc := "true"
	if v := q.Get("include_24hr_change"); v == "true" || v == "false" {
		inc = v
	}
	var upstream string
	if q.Get("endpoint") == "markets" {
		upstream = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=" + vs +
			"&ids=" + ids + "&order=market_cap_desc&sparkline=true&price_change_percentage=24h"
	} else {
		upstream = "https://api.coingecko.com/api/v3/simple/price?ids=" + ids +
			"&vs_currencies=" + vs + "&include_24hr_change=" + inc
	}
	key := "coingecko:" + ids + ":" + vs + ":" + inc + ":" + q.Get("endpoint")
	s.passthrough(w, key, upstream, "application/json",
		"public, max-age=120, s-maxage=120, stale-while-revalidate=60",
		map[string]string{"Accept": "application/json"},
		2*time.Minute, 5*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusOK, "Failed to fetch data")
		})
}

func validateCoinIDs(raw string) string {
	if raw == "" {
		return "bitcoin,ethereum,solana"
	}
	var out []string
	for _, id := range splitComma(raw) {
		id = lower(trimSpace(id))
		if id == "" || len(id) > 50 || !isCoinID(id) {
			continue
		}
		out = append(out, id)
		if len(out) >= 20 {
			break
		}
	}
	if len(out) == 0 {
		return "bitcoin,ethereum,solana"
	}
	return joinComma(out)
}

func isCoinID(s string) bool {
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// ── Polymarket ───────────────────────────────────────────────────────────────

var allowedPMOrder = []string{"volume", "liquidity", "startDate", "endDate", "spread"}

// handlePolymarket proxies the Polymarket Gamma API. Verbatim passthrough;
// degrades to an empty array (Cloudflare frequently blocks server TLS).
// Ported from api/polymarket.js.
func (s *Server) handlePolymarket(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	endpoint := q.Get("endpoint")
	if endpoint == "" {
		endpoint = "markets"
	}
	closed := boolParam(q.Get("closed"), "false")
	order := "volume"
	if oneOf(q.Get("order"), allowedPMOrder...) {
		order = q.Get("order")
	}
	ascending := boolParam(q.Get("ascending"), "false")
	limit := clampInt(q.Get("limit"), 50, 1, 100)

	params := "closed=" + closed + "&order=" + order + "&ascending=" + ascending + "&limit=" + itoa(limit)
	path := "/markets"
	if endpoint == "events" {
		path = "/events"
		if tag := sanitizeSlug(q.Get("tag")); tag != "" {
			params += "&tag_slug=" + tag
		}
	}
	upstream := "https://gamma-api.polymarket.com" + path + "?" + params
	key := "polymarket:" + endpoint + ":" + params
	s.passthrough(w, key, upstream, "application/json",
		"public, max-age=120, s-maxage=120, stale-while-revalidate=60",
		map[string]string{"Accept": "application/json"},
		2*time.Minute, 5*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeBytes(w, http.StatusOK, "application/json",
				"public, max-age=300, s-maxage=300, stale-while-revalidate=60", []byte("[]"))
		})
}

func boolParam(v, def string) string {
	if v == "true" || v == "false" {
		return v
	}
	return def
}

func sanitizeSlug(v string) string {
	var b strings.Builder
	for _, c := range v {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' {
			b.WriteRune(c)
		}
		if b.Len() >= 100 {
			break
		}
	}
	return b.String()
}

// ── Yahoo Finance (single symbol passthrough) ────────────────────────────────

// handleYahooFinance proxies Yahoo's chart endpoint verbatim for one symbol.
// Ported from api/yahoo-finance.js.
func (s *Server) handleYahooFinance(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	sym := validateSymbol(r.URL.Query().Get("symbol"))
	if sym == "" {
		writeError(w, http.StatusBadRequest, "Invalid or missing symbol parameter")
		return
	}
	upstream := "https://query1.finance.yahoo.com/v8/finance/chart/" + urlQueryEscape(sym)
	s.passthrough(w, "yahoo:"+sym, upstream, "application/json",
		"public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		map[string]string{"User-Agent": browserUA},
		60*time.Second, 5*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusOK, "Failed to fetch data")
		})
}

func validateSymbol(sym string) string {
	sym = upper(trimSpace(sym))
	if sym == "" || len(sym) > 20 {
		return ""
	}
	for _, c := range sym {
		if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '^' || c == '=' || c == '-') {
			return ""
		}
	}
	return sym
}

// ── Yahoo Finance (batched symbols) ──────────────────────────────────────────

const (
	yahooBatchMaxSymbols = 60
	yahooBatchParallel   = 12
	yahooBatchFetchTO    = 8 * time.Second // one slow symbol must not hold the batch hostage
)

// handleYahooBatch resolves many Yahoo chart symbols in ONE request. The client
// (FX / commodities / yields / market-index panels) otherwise fires one GET per
// symbol — ~80 round trips per refresh cycle. This collapses each panel's list to
// a single call. Per-symbol chart bodies share the exact "yahoo:<sym>" cache key
// with the single-symbol passthrough, so either path warms the other. Never-5xx:
// an unresolved symbol carries error:"unavailable"; the endpoint always answers 200.
func (s *Server) handleYahooBatch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	symbols := validateYahooSymbols(r.URL.Query().Get("symbols"))
	if len(symbols) == 0 {
		writeError(w, http.StatusBadRequest, "Invalid or missing symbols parameter")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	type yahooBatchResult struct {
		Symbol string          `json:"symbol"`
		Chart  json.RawMessage `json:"chart,omitempty"`
		Error  string          `json:"error,omitempty"`
	}
	results := make([]yahooBatchResult, len(symbols))
	sem := make(chan struct{}, yahooBatchParallel)
	var wg sync.WaitGroup
	for i, sym := range symbols {
		i, sym := i, sym
		results[i].Symbol = sym
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if body, ok := s.yahooChartBytes(ctx, sym); ok {
				results[i].Chart = json.RawMessage(body)
			} else {
				results[i].Error = "unavailable"
			}
		}()
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		map[string]any{"results": results})
}

// yahooChartBytes returns the raw Yahoo chart body for one symbol, sharing the
// single-symbol passthrough's "yahoo:<sym>" cache key + TTL and its stale-fallback
// on failure. A blank 200 is a failure (never cached — it would poison good data).
func (s *Server) yahooChartBytes(ctx context.Context, sym string) ([]byte, bool) {
	key := "yahoo:" + sym
	if v, ok := s.cache.Get(key); ok {
		return v.([]byte), true
	}
	fctx, cancel := context.WithTimeout(ctx, yahooBatchFetchTO)
	defer cancel()
	body, status, err := s.get(fctx,
		"https://query1.finance.yahoo.com/v8/finance/chart/"+urlQueryEscape(sym),
		map[string]string{"User-Agent": browserUA})
	if err != nil || status < 200 || status >= 300 || isBlankBody(body) {
		if v, ok := s.cache.GetStale(key); ok {
			return v.([]byte), true
		}
		return nil, false
	}
	s.cache.Set(key, body, 60*time.Second, 5*time.Minute)
	return body, true
}

// validateYahooSymbols parses a comma list, validating + de-duplicating each so a
// panel that repeats a symbol (or two panels sharing one) costs a single fetch.
func validateYahooSymbols(raw string) []string {
	if raw == "" {
		return nil
	}
	var out []string
	seen := make(map[string]bool)
	for _, s := range splitComma(raw) {
		sym := validateSymbol(s)
		if sym == "" || seen[sym] {
			continue
		}
		seen[sym] = true
		out = append(out, sym)
		if len(out) >= yahooBatchMaxSymbols {
			break
		}
	}
	return out
}

// ── Finnhub (parallel quotes) ────────────────────────────────────────────────

// handleFinnhub returns per-symbol quotes. Ported from api/finnhub.js.
func (s *Server) handleFinnhub(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	key := env("FINNHUB_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
			map[string]any{"quotes": []any{}, "skipped": true, "reason": "FINNHUB_API_KEY not configured"})
		return
	}
	symbols := validateSymbols(r.URL.Query().Get("symbols"))
	if len(symbols) == 0 {
		writeError(w, http.StatusBadRequest, "Invalid or missing symbols parameter")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	quotes := make([]map[string]any, len(symbols))
	var wg sync.WaitGroup
	for i, sym := range symbols {
		wg.Add(1)
		go func(i int, sym string) {
			defer wg.Done()
			quotes[i] = s.finnhubQuote(ctx, sym, key)
		}(i, sym)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, "public, max-age=30, s-maxage=30, stale-while-revalidate=15",
		map[string]any{"quotes": quotes})
}

func (s *Server) finnhubQuote(ctx context.Context, sym, key string) map[string]any {
	var d struct {
		C, D, Dp, H, L, O, Pc float64
		T                     int64
	}
	if err := s.getJSON(ctx, "https://finnhub.io/api/v1/quote?symbol="+urlQueryEscape(sym)+"&token="+key, nil, &d); err != nil {
		return map[string]any{"symbol": sym, "error": err.Error()}
	}
	if d.C == 0 && d.H == 0 && d.L == 0 {
		return map[string]any{"symbol": sym, "error": "No data available"}
	}
	return map[string]any{
		"symbol": sym, "price": d.C, "change": d.D, "changePercent": d.Dp,
		"high": d.H, "low": d.L, "open": d.O, "previousClose": d.Pc, "timestamp": d.T,
	}
}

func validateSymbols(raw string) []string {
	if raw == "" {
		return nil
	}
	var out []string
	for _, s := range splitComma(raw) {
		s = upper(trimSpace(s))
		if s == "" || len(s) > 10 {
			continue
		}
		ok := true
		for _, c := range s {
			if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '^') {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, s)
		}
		if len(out) >= 20 {
			break
		}
	}
	return out
}

// ── Yahoo chart helper (shared by stock-index, etf-flows, macro-signals) ─────

type yahooChart struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency string `json:"currency"`
			} `json:"meta"`
			Indicators struct {
				Quote []struct {
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
	} `json:"chart"`
}

func (s *Server) yahooChart(ctx context.Context, symbol, rangeInterval string) (*yahooChart, error) {
	var yc yahooChart
	url := "https://query1.finance.yahoo.com/v8/finance/chart/" + urlQueryEscape(symbol) + "?" + rangeInterval
	if err := s.getJSON(ctx, url, map[string]string{"User-Agent": browserUA}, &yc); err != nil {
		return nil, err
	}
	return &yc, nil
}

// closes returns the non-null close prices of the first result series.
func (yc *yahooChart) closes() []float64 {
	if yc == nil || len(yc.Chart.Result) == 0 || len(yc.Chart.Result[0].Indicators.Quote) == 0 {
		return nil
	}
	return compact(yc.Chart.Result[0].Indicators.Quote[0].Close)
}

func (yc *yahooChart) volumes() []float64 {
	if yc == nil || len(yc.Chart.Result) == 0 || len(yc.Chart.Result[0].Indicators.Quote) == 0 {
		return nil
	}
	return compact(yc.Chart.Result[0].Indicators.Quote[0].Volume)
}

func compact(in []*float64) []float64 {
	out := make([]float64, 0, len(in))
	for _, v := range in {
		if v != nil {
			out = append(out, *v)
		}
	}
	return out
}

// roundSig rounds v to 7 significant digits — the wire precision for emitted
// sparkline closes. Yahoo returns float32-widened closes (17.209999084472656
// for 17.21); serializing that noise verbatim ~doubles the sparkline payload
// for a curve the renderer draws identically. Significant digits, not fixed
// decimals, so a sub-1.0 FX rate keeps its precision. Non-finite values pass
// through unchanged. Applied only where close ARRAYS ship (see sparkline);
// price/change scalars are derived from the raw closes and stay exact.
func roundSig(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return v
	}
	f, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'g', 7, 64), 64)
	return f
}

// ── Stock index (country → weekly % change) ──────────────────────────────────

type indexInfo struct{ symbol, name string }

var countryIndex = map[string]indexInfo{
	"US": {"^GSPC", "S&P 500"}, "GB": {"^FTSE", "FTSE 100"}, "DE": {"^GDAXI", "DAX"},
	"FR": {"^FCHI", "CAC 40"}, "JP": {"^N225", "Nikkei 225"}, "CN": {"000001.SS", "SSE Composite"},
	"HK": {"^HSI", "Hang Seng"}, "IN": {"^BSESN", "BSE Sensex"}, "KR": {"^KS11", "KOSPI"},
	"TW": {"^TWII", "TAIEX"}, "AU": {"^AXJO", "ASX 200"}, "BR": {"^BVSP", "Bovespa"},
	"CA": {"^GSPTSE", "TSX Composite"}, "MX": {"^MXX", "IPC Mexico"}, "AR": {"^MERV", "MERVAL"},
	"RU": {"IMOEX.ME", "MOEX"}, "ZA": {"^J203.JO", "JSE All Share"}, "SA": {"^TASI.SR", "Tadawul"},
	"AE": {"DFMGI.AE", "DFM General"}, "IL": {"^TA125.TA", "TA-125"}, "TR": {"XU100.IS", "BIST 100"},
	"PL": {"^WIG20", "WIG 20"}, "NL": {"^AEX", "AEX"}, "CH": {"^SSMI", "SMI"}, "ES": {"^IBEX", "IBEX 35"},
	"IT": {"FTSEMIB.MI", "FTSE MIB"}, "SE": {"^OMX", "OMX Stockholm 30"}, "NO": {"^OSEAX", "Oslo All Share"},
	"SG": {"^STI", "STI"}, "TH": {"^SET.BK", "SET"}, "MY": {"^KLSE", "KLCI"}, "ID": {"^JKSE", "Jakarta Composite"},
	"PH": {"PSEI.PS", "PSEi"}, "NZ": {"^NZ50", "NZX 50"}, "EG": {"^EGX30.CA", "EGX 30"}, "CL": {"^IPSA", "IPSA"},
	"PE": {"^SPBLPGPT", "S&P Lima"}, "AT": {"^ATX", "ATX"}, "BE": {"^BFX", "BEL 20"}, "FI": {"^OMXH25", "OMX Helsinki 25"},
	"DK": {"^OMXC25", "OMX Copenhagen 25"}, "IE": {"^ISEQ", "ISEQ Overall"}, "PT": {"^PSI20", "PSI 20"},
	"CZ": {"^PX", "PX Prague"}, "HU": {"^BUX", "BUX"},
}

// handleStockIndex returns weekly % change for a country's primary index.
// Ported from api/stock-index.js.
func (s *Server) handleStockIndex(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	cc := "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600"
	code := upper(trimSpace(r.URL.Query().Get("code")))
	if code == "" {
		writeError(w, http.StatusBadRequest, "code parameter required")
		return
	}
	idx, ok := countryIndex[code]
	if !ok {
		writeJSON(w, http.StatusOK, cc, map[string]any{"error": "No stock index for country", "code": code, "available": false})
		return
	}
	s.cachedJSON(w, "stock-index:"+code, cc, time.Hour, time.Hour,
		func(ctx context.Context) (any, error) {
			yc, err := s.yahooChart(ctx, idx.symbol, "range=1mo&interval=1d")
			if err != nil {
				return nil, err
			}
			all := yc.closes()
			if len(all) < 2 {
				return map[string]any{"error": "Insufficient data", "available": false}, nil
			}
			closes := all
			if len(closes) > 6 {
				closes = closes[len(closes)-6:]
			}
			latest, oldest := closes[len(closes)-1], closes[0]
			week := (latest - oldest) / oldest * 100
			cur := "USD"
			if len(yc.Chart.Result) > 0 && yc.Chart.Result[0].Meta.Currency != "" {
				cur = yc.Chart.Result[0].Meta.Currency
			}
			return map[string]any{
				"available": true, "code": code, "symbol": idx.symbol, "indexName": idx.name,
				"price": round2s(latest), "weekChangePercent": round2s(week),
				"currency": cur, "fetchedAt": nowISO(),
				// Additive metadata: the US market phase at fetch time. Never
				// touches price fields; consumers can label a snapshot's session.
				"marketSession": markethours.CurrentSession(time.Now()).String(),
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, cc, map[string]any{"error": "Upstream error", "available": false})
		})
}

// ── Stablecoins ──────────────────────────────────────────────────────────────

var defaultStableCoins = "tether,usd-coin,dai,first-digital-usd,ethena-usde"

// handleStablecoins summarizes stablecoin peg health from CoinGecko markets.
// Ported from api/stablecoin-markets.js.
func (s *Server) handleStablecoins(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	coins := defaultStableCoins
	if raw := r.URL.Query().Get("coins"); raw != "" {
		var ok []string
		for _, c := range splitComma(raw) {
			if isCoinID(c) {
				ok = append(ok, c)
			}
		}
		if len(ok) > 0 {
			coins = joinComma(ok)
		}
	}
	s.cachedJSON(w, "stablecoins:"+coins,
		"public, s-maxage=120, stale-while-revalidate=300", 2*time.Minute, 10*time.Minute,
		func(ctx context.Context) (any, error) {
			var data []map[string]any
			url := "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" + coins +
				"&order=market_cap_desc&sparkline=false&price_change_percentage=7d"
			if err := s.getJSON(ctx, url, map[string]string{"Accept": "application/json"}, &data); err != nil {
				return nil, err
			}
			var coinsOut []map[string]any
			var totalMC, totalVol float64
			depegged := 0
			for _, c := range data {
				price := asFloat(mapGet(c, "current_price"))
				dev := math.Abs(price - 1.0)
				peg := "DEPEGGED"
				switch {
				case dev <= 0.005:
					peg = "ON PEG"
				case dev <= 0.01:
					peg = "SLIGHT DEPEG"
				}
				if peg == "DEPEGGED" {
					depegged++
				}
				mc := asFloat(mapGet(c, "market_cap"))
				vol := asFloat(mapGet(c, "total_volume"))
				totalMC += mc
				totalVol += vol
				coinsOut = append(coinsOut, map[string]any{
					"id": asString(mapGet(c, "id")), "symbol": upper(asString(mapGet(c, "symbol"))),
					"name": asString(mapGet(c, "name")), "price": price,
					"deviation": round3s(dev * 100), "pegStatus": peg,
					"marketCap": mc, "volume24h": vol,
					"change24h": asFloat(mapGet(c, "price_change_percentage_24h")),
					"change7d":  asFloat(mapGet(c, "price_change_percentage_7d_in_currency")),
					"image":     mapGet(c, "image"),
				})
			}
			health := "HEALTHY"
			if depegged == 1 {
				health = "CAUTION"
			} else if depegged >= 2 {
				health = "WARNING"
			}
			return map[string]any{
				"timestamp": nowISO(),
				"summary": map[string]any{
					"totalMarketCap": totalMC, "totalVolume24h": totalVol,
					"coinCount": len(coinsOut), "depeggedCount": depegged, "healthStatus": health,
				},
				"stablecoins": coinsOut,
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"timestamp": nowISO(),
				"summary": map[string]any{"totalMarketCap": 0, "totalVolume24h": 0,
					"coinCount": 0, "depeggedCount": 0, "healthStatus": "UNAVAILABLE"},
				"stablecoins": []any{}, "unavailable": true,
			})
		})
}

// ── ETF flows ────────────────────────────────────────────────────────────────

type etfInfo struct{ ticker, issuer string }

var btcETFs = []etfInfo{
	{"IBIT", "BlackRock"}, {"FBTC", "Fidelity"}, {"ARKB", "ARK/21Shares"}, {"BITB", "Bitwise"},
	{"GBTC", "Grayscale"}, {"HODL", "VanEck"}, {"BRRR", "Valkyrie"}, {"EZBC", "Franklin"},
	{"BTCO", "Invesco"}, {"BTCW", "WisdomTree"},
}

// handleETFFlows estimates spot-BTC-ETF flow direction from Yahoo 5d charts.
// Ported from api/etf-flows.js.
func (s *Server) handleETFFlows(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "etf-flows:v1",
		"public, s-maxage=900, stale-while-revalidate=1800", 15*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) {
			type parsed struct {
				m  map[string]any
				ok bool
			}
			results := make([]parsed, len(btcETFs))
			var wg sync.WaitGroup
			for i, e := range btcETFs {
				wg.Add(1)
				go func(i int, e etfInfo) {
					defer wg.Done()
					yc, err := s.yahooChart(ctx, e.ticker, "range=5d&interval=1d")
					if err != nil {
						return
					}
					if m, ok := parseETF(yc, e); ok {
						results[i] = parsed{m, true}
					}
				}(i, e)
			}
			wg.Wait()
			var etfs []map[string]any
			var totalVol, totalFlow float64
			inflow, outflow := 0, 0
			for _, p := range results {
				if !p.ok {
					continue
				}
				etfs = append(etfs, p.m)
				totalVol += asFloat(p.m["volume"])
				totalFlow += asFloat(p.m["estFlow"])
				switch p.m["direction"] {
				case "inflow":
					inflow++
				case "outflow":
					outflow++
				}
			}
			sort.SliceStable(etfs, func(i, j int) bool { return asFloat(etfs[i]["volume"]) > asFloat(etfs[j]["volume"]) })
			net := "NEUTRAL"
			if totalFlow > 0 {
				net = "NET INFLOW"
			} else if totalFlow < 0 {
				net = "NET OUTFLOW"
			}
			return map[string]any{
				"timestamp": nowISO(),
				"summary": map[string]any{
					"etfCount": len(etfs), "totalVolume": totalVol, "totalEstFlow": totalFlow,
					"netDirection": net, "inflowCount": inflow, "outflowCount": outflow,
				},
				"etfs": etfs,
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"timestamp": nowISO(),
				"summary": map[string]any{"etfCount": 0, "totalVolume": 0, "totalEstFlow": 0,
					"netDirection": "UNAVAILABLE", "inflowCount": 0, "outflowCount": 0},
				"etfs": []any{}, "unavailable": true,
			})
		})
}

func parseETF(yc *yahooChart, e etfInfo) (map[string]any, bool) {
	closes := yc.closes()
	vols := yc.volumes()
	if len(closes) < 2 {
		return nil, false
	}
	latest := closes[len(closes)-1]
	prev := closes[len(closes)-2]
	priceChange := 0.0
	if prev != 0 {
		priceChange = (latest - prev) / prev * 100
	}
	var latestVol, avgVol float64
	if len(vols) > 0 {
		latestVol = vols[len(vols)-1]
	}
	if len(vols) > 1 {
		var sum float64
		for _, v := range vols[:len(vols)-1] {
			sum += v
		}
		avgVol = sum / float64(len(vols)-1)
	} else {
		avgVol = latestVol
	}
	volRatio := 1.0
	if avgVol > 0 {
		volRatio = latestVol / avgVol
	}
	dir := "neutral"
	if priceChange > 0.1 {
		dir = "inflow"
	} else if priceChange < -0.1 {
		dir = "outflow"
	}
	sign := 1.0
	if priceChange <= 0 {
		sign = -1.0
	}
	estFlow := latestVol * latest * sign * 0.1
	return map[string]any{
		"ticker": e.ticker, "issuer": e.issuer,
		"price": round2s(latest), "priceChange": round2s(priceChange),
		"volume": latestVol, "avgVolume": math.Round(avgVol),
		"volumeRatio": round2s(volRatio), "direction": dir, "estFlow": math.Round(estFlow),
	}, true
}

// ── helpers ──────────────────────────────────────────────────────────────────

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

// round2s rounds to 2 decimals, returning 0 for a non-finite input so a stray
// NaN/Inf can never reach json.Marshal (a marshal error after cachedJSON has
// already cached the value would stick a 500 for the whole cache window).
func round2s(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return math.Round(f*100) / 100
}
func round3s(f float64) float64 { return math.Round(f*1000) / 1000 }
