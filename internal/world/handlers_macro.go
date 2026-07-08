package world

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"
)

// pricePoint pairs an aligned close and volume for VWAP.
type pricePoint struct{ price, volume float64 }

func (yc *yahooChart) alignedPV() []pricePoint {
	if yc == nil || len(yc.Chart.Result) == 0 || len(yc.Chart.Result[0].Indicators.Quote) == 0 {
		return nil
	}
	c := yc.Chart.Result[0].Indicators.Quote[0].Close
	v := yc.Chart.Result[0].Indicators.Quote[0].Volume
	var out []pricePoint
	for i := 0; i < len(c) && i < len(v); i++ {
		if c[i] != nil && v[i] != nil {
			out = append(out, pricePoint{*c[i], *v[i]})
		}
	}
	return out
}

// handleMacroSignals computes a 7-signal crypto-macro dashboard + BUY/CASH
// verdict from Yahoo charts, the Fear & Greed index, and mempool hashrate.
// Ported from api/macro-signals.js.
func (s *Server) handleMacroSignals(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "macro-signals:v1",
		"public, s-maxage=300, stale-while-revalidate=600", 5*time.Minute, 15*time.Minute,
		func(ctx context.Context) (any, error) { return s.computeMacroSignals(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", macroFallback())
		})
}

func (s *Server) computeMacroSignals(ctx context.Context) (any, error) {
	var jpy, btc, qqq, xlp *yahooChart
	var fng struct {
		Data []struct {
			Value          string `json:"value"`
			Classification string `json:"value_classification"`
			Timestamp      string `json:"timestamp"`
		} `json:"data"`
	}
	var hash struct {
		Hashrates []struct {
			AvgHashrate float64 `json:"avgHashrate"`
		} `json:"hashrates"`
	}
	runParallel(
		func() { jpy, _ = s.yahooChart(ctx, "JPY=X", "range=1y&interval=1d") },
		func() { btc, _ = s.yahooChart(ctx, "BTC-USD", "range=1y&interval=1d") },
		func() { qqq, _ = s.yahooChart(ctx, "QQQ", "range=1y&interval=1d") },
		func() { xlp, _ = s.yahooChart(ctx, "XLP", "range=1y&interval=1d") },
		func() { _ = s.getJSON(ctx, "https://api.alternative.me/fng/?limit=30&format=json", nil, &fng) },
		func() { _ = s.getJSON(ctx, "https://mempool.space/v1/world/v1/mining/hashrate/1m", nil, &hash) },
	)
	jpyP, btcP, qqqP, xlpP := jpy.closes(), btc.closes(), qqq.closes(), xlp.closes()
	btcPV := btc.alignedPV()

	jpyRoc30 := rateOfChange(jpyP, 30)
	liquidity := "UNKNOWN"
	if jpyRoc30 != nil {
		if *jpyRoc30 < -2 {
			liquidity = "SQUEEZE"
		} else {
			liquidity = "NORMAL"
		}
	}

	btcRet5, qqqRet5 := rateOfChange(btcP, 5), rateOfChange(qqqP, 5)
	flow := "UNKNOWN"
	if btcRet5 != nil && qqqRet5 != nil {
		if math.Abs(*btcRet5-*qqqRet5) > 5 {
			flow = "PASSIVE GAP"
		} else {
			flow = "ALIGNED"
		}
	}

	qqqRoc20, xlpRoc20 := rateOfChange(qqqP, 20), rateOfChange(xlpP, 20)
	regime := "UNKNOWN"
	if qqqRoc20 != nil && xlpRoc20 != nil {
		if *qqqRoc20 > *xlpRoc20 {
			regime = "RISK-ON"
		} else {
			regime = "DEFENSIVE"
		}
	}

	btcSma50, btcSma200 := sma(btcP, 50), sma(btcP, 200)
	var btcCur *float64
	if len(btcP) > 0 {
		v := btcP[len(btcP)-1]
		btcCur = &v
	}
	var btcVwap *float64
	if len(btcPV) >= 30 {
		last := btcPV[len(btcPV)-30:]
		var sumPV, sumV float64
		for _, p := range last {
			sumPV += p.price * p.volume
			sumV += p.volume
		}
		if sumV > 0 {
			v := math.Round(sumPV / sumV)
			btcVwap = &v
		}
	}
	trend := "UNKNOWN"
	var mayer *float64
	if btcCur != nil && btcSma50 != nil {
		aboveSma := *btcCur > *btcSma50*1.02
		belowSma := *btcCur < *btcSma50*0.98
		aboveVwap := 0 // 0=unknown,1=true,-1=false
		if btcVwap != nil {
			if *btcCur > *btcVwap {
				aboveVwap = 1
			} else {
				aboveVwap = -1
			}
		}
		switch {
		case aboveSma && aboveVwap != -1:
			trend = "BULLISH"
		case belowSma && aboveVwap != 1:
			trend = "BEARISH"
		default:
			trend = "NEUTRAL"
		}
	}
	if btcCur != nil && btcSma200 != nil && *btcSma200 != 0 {
		m := round2s(*btcCur / *btcSma200)
		mayer = &m
	}

	hashStatus := "UNKNOWN"
	var hashChange *float64
	if len(hash.Hashrates) >= 2 {
		recent := hash.Hashrates[len(hash.Hashrates)-1].AvgHashrate
		older := hash.Hashrates[0].AvgHashrate
		if recent != 0 && older > 0 {
			hc := round1((recent - older) / older * 100)
			hashChange = &hc
			switch {
			case hc > 3:
				hashStatus = "GROWING"
			case hc < -3:
				hashStatus = "DECLINING"
			default:
				hashStatus = "STABLE"
			}
		}
	}

	mining := "UNKNOWN"
	if btcCur != nil && hashChange != nil {
		switch {
		case *btcCur > 60000:
			mining = "PROFITABLE"
		case *btcCur > 40000:
			mining = "TIGHT"
		default:
			mining = "SQUEEZE"
		}
	}

	var fgValue *int
	fgLabel := "UNKNOWN"
	fgHistory := []map[string]any{}
	if len(fng.Data) > 0 {
		if v, err := parseIntSafe(fng.Data[0].Value); err == nil {
			fgValue = &v
		}
		if fng.Data[0].Classification != "" {
			fgLabel = fng.Data[0].Classification
		}
		n := len(fng.Data)
		if n > 30 {
			n = 30
		}
		for i := n - 1; i >= 0; i-- {
			d := fng.Data[i]
			val, _ := parseIntSafe(d.Value)
			ts, _ := parseIntSafe(d.Timestamp)
			fgHistory = append(fgHistory, map[string]any{
				"value": val, "date": time.Unix(int64(ts), 0).UTC().Format("2006-01-02"),
			})
		}
	}

	// verdict
	type sig struct {
		status  string
		bullish bool
	}
	sigs := []sig{
		{liquidity, liquidity == "NORMAL"},
		{flow, flow == "ALIGNED"},
		{regime, regime == "RISK-ON"},
		{trend, trend == "BULLISH"},
		{hashStatus, hashStatus == "GROWING"},
		{mining, mining == "PROFITABLE"},
		{fgLabel, fgValue != nil && *fgValue > 50},
	}
	bullish, total := 0, 0
	for _, s := range sigs {
		if s.status != "UNKNOWN" {
			total++
			if s.bullish {
				bullish++
			}
		}
	}
	verdict := "UNKNOWN"
	if total > 0 {
		if float64(bullish)/float64(total) >= 0.57 {
			verdict = "BUY"
		} else {
			verdict = "CASH"
		}
	}

	return map[string]any{
		"timestamp": nowISO(), "verdict": verdict, "bullishCount": bullish, "totalCount": total,
		"signals": map[string]any{
			"liquidity":     map[string]any{"status": liquidity, "value": ptr2(jpyRoc30), "sparkline": tailN(jpyP, 30)},
			"flowStructure": map[string]any{"status": flow, "btcReturn5": ptr2(btcRet5), "qqqReturn5": ptr2(qqqRet5)},
			"macroRegime":   map[string]any{"status": regime, "qqqRoc20": ptr2(qqqRoc20), "xlpRoc20": ptr2(xlpRoc20)},
			"technicalTrend": map[string]any{"status": trend, "btcPrice": ptrf(btcCur),
				"sma50": ptr0(btcSma50), "sma200": ptr0(btcSma200), "vwap30d": ptrf(btcVwap),
				"mayerMultiple": ptrf(mayer), "sparkline": tailN(btcP, 30)},
			"hashRate":  map[string]any{"status": hashStatus, "change30d": ptrf(hashChange)},
			"miningCost": map[string]any{"status": mining},
			"fearGreed": map[string]any{"status": fgLabel, "value": ptri(fgValue), "history": fgHistory},
		},
		"meta": map[string]any{"qqqSparkline": tailN(qqqP, 30)},
	}, nil
}

func macroFallback() map[string]any {
	return map[string]any{
		"timestamp": nowISO(), "verdict": "UNKNOWN", "bullishCount": 0, "totalCount": 0,
		"signals": map[string]any{
			"liquidity":      map[string]any{"status": "UNKNOWN", "value": nil, "sparkline": []any{}},
			"flowStructure":  map[string]any{"status": "UNKNOWN", "btcReturn5": nil, "qqqReturn5": nil},
			"macroRegime":    map[string]any{"status": "UNKNOWN", "qqqRoc20": nil, "xlpRoc20": nil},
			"technicalTrend": map[string]any{"status": "UNKNOWN", "btcPrice": nil, "sma50": nil, "sma200": nil, "vwap30d": nil, "mayerMultiple": nil, "sparkline": []any{}},
			"hashRate":       map[string]any{"status": "UNKNOWN", "change30d": nil},
			"miningCost":     map[string]any{"status": "UNKNOWN"},
			"fearGreed":      map[string]any{"status": "UNKNOWN", "value": nil, "history": []any{}},
		},
		"meta": map[string]any{"qqqSparkline": []any{}}, "unavailable": true,
	}
}

// ── numeric helpers ──────────────────────────────────────────────────────────

func rateOfChange(prices []float64, days int) *float64 {
	if len(prices) < days+1 {
		return nil
	}
	recent := prices[len(prices)-1]
	past := prices[len(prices)-1-days]
	if past == 0 {
		return nil
	}
	v := (recent - past) / past * 100
	return &v
}

func sma(prices []float64, period int) *float64 {
	if len(prices) < period {
		return nil
	}
	slice := prices[len(prices)-period:]
	var s float64
	for _, v := range slice {
		s += v
	}
	v := s / float64(period)
	return &v
}

func tailN(a []float64, n int) []float64 {
	if len(a) <= n {
		return a
	}
	return a[len(a)-n:]
}

func ptr2(p *float64) any {
	if p == nil {
		return nil
	}
	return round2s(*p)
}
func ptr0(p *float64) any {
	if p == nil {
		return nil
	}
	return math.Round(*p)
}
func ptrf(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
func ptri(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func parseIntSafe(s string) (int, error) { return strconv.Atoi(trimSpace(s)) }

// runParallel runs fns concurrently and waits for all (panic-safe).
func runParallel(fns ...func()) {
	done := make(chan struct{}, len(fns))
	for _, fn := range fns {
		go func(fn func()) { defer func() { _ = recover(); done <- struct{}{} }(); fn() }(fn)
	}
	for range fns {
		<-done
	}
}
