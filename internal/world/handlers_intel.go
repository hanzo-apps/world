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

// ── Risk scores (CII + strategic risk from ACLED) ────────────────────────────

type tier1 struct{ code, name string }

var tier1Countries = []tier1{
	{"US", "United States"}, {"RU", "Russia"}, {"CN", "China"}, {"UA", "Ukraine"}, {"IR", "Iran"},
	{"IL", "Israel"}, {"TW", "Taiwan"}, {"KP", "North Korea"}, {"SA", "Saudi Arabia"}, {"TR", "Turkey"},
	{"PL", "Poland"}, {"DE", "Germany"}, {"FR", "France"}, {"GB", "United Kingdom"}, {"IN", "India"},
	{"PK", "Pakistan"}, {"SY", "Syria"}, {"YE", "Yemen"}, {"MM", "Myanmar"}, {"VE", "Venezuela"},
}

var baselineRisk = map[string]float64{
	"US": 5, "RU": 35, "CN": 25, "UA": 50, "IR": 40, "IL": 45, "TW": 30, "KP": 45, "SA": 20, "TR": 25,
	"PL": 10, "DE": 5, "FR": 10, "GB": 5, "IN": 20, "PK": 35, "SY": 50, "YE": 50, "MM": 45, "VE": 40,
}

var eventMultiplier = map[string]float64{
	"US": 0.3, "RU": 2.0, "CN": 2.5, "UA": 0.8, "IR": 2.0, "IL": 0.7, "TW": 1.5, "KP": 3.0, "SA": 2.0, "TR": 1.2,
	"PL": 0.8, "DE": 0.5, "FR": 0.6, "GB": 0.5, "IN": 0.8, "PK": 1.5, "SY": 0.7, "YE": 0.7, "MM": 1.8, "VE": 1.8,
}

var countryKeywords = map[string][]string{
	"US": {"united states", "usa", "america", "washington", "biden", "trump", "pentagon"},
	"RU": {"russia", "moscow", "kremlin", "putin"}, "CN": {"china", "beijing", "xi jinping", "prc"},
	"UA": {"ukraine", "kyiv", "zelensky", "donbas"}, "IR": {"iran", "tehran", "khamenei", "irgc"},
	"IL": {"israel", "tel aviv", "netanyahu", "idf", "gaza"}, "TW": {"taiwan", "taipei"},
	"KP": {"north korea", "pyongyang", "kim jong"}, "SA": {"saudi arabia", "riyadh"},
	"TR": {"turkey", "ankara", "erdogan"}, "PL": {"poland", "warsaw"}, "DE": {"germany", "berlin"},
	"FR": {"france", "paris", "macron"}, "GB": {"britain", "uk", "london"}, "IN": {"india", "delhi", "modi"},
	"PK": {"pakistan", "islamabad"}, "SY": {"syria", "damascus"}, "YE": {"yemen", "sanaa", "houthi"},
	"MM": {"myanmar", "burma"}, "VE": {"venezuela", "caracas", "maduro"},
}

func scoreLevel(score float64) string {
	switch {
	case score >= 70:
		return "critical"
	case score >= 55:
		return "high"
	case score >= 40:
		return "elevated"
	case score >= 25:
		return "normal"
	}
	return "low"
}

func normalizeCountry(text string) string {
	l := lower(text)
	for _, c := range tier1Countries { // deterministic order
		for _, kw := range countryKeywords[c.code] {
			if contains(l, kw) {
				return c.code
			}
		}
	}
	return ""
}

// handleRiskScores computes CII + strategic risk from ACLED protests/riots.
// Ported from api/risk-scores.js. Without ACLED_ACCESS_TOKEN it returns the
// baseline assessment (a 200, as in the original).
func (s *Server) handleRiskScores(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	token := env("ACLED_ACCESS_TOKEN")
	if token == "" {
		writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60", baselineRiskResult(
			"ACLED token not configured - showing baseline risk assessments"))
		return
	}
	s.cachedJSON(w, "risk:scores:v2", "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		10*time.Minute, time.Hour,
		func(ctx context.Context) (any, error) {
			protests, err := s.fetchACLEDProtests(ctx, token)
			if err != nil {
				return nil, err
			}
			cii := computeCII(protests)
			return map[string]any{
				"cii": cii, "strategicRisk": computeStrategic(cii),
				"protestCount": len(protests), "computedAt": nowISO(), "cached": false,
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
				baselineRiskResult("ACLED unavailable - showing baseline risk assessments"))
		})
}

func baselineRiskResult(msg string) map[string]any {
	cii := computeCII(nil)
	return map[string]any{
		"cii": cii, "strategicRisk": computeStrategic(cii),
		"protestCount": 0, "computedAt": nowISO(), "baseline": true, "error": msg,
	}
}

func (s *Server) fetchACLEDProtests(ctx context.Context, token string) ([]map[string]any, error) {
	u := "https://acleddata.com/v1/world/acled/read?_format=json&event_type=Protests&event_type=Riots&event_date=" +
		daysAgoUTC(7) + "|" + todayUTC() + "&event_date_where=BETWEEN&limit=500"
	var raw struct {
		Data []map[string]any `json:"data"`
	}
	if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json", "Authorization": "Bearer " + token}, &raw); err != nil {
		return nil, err
	}
	return raw.Data, nil
}

func computeCII(protests []map[string]any) []map[string]any {
	type ev struct{ protests, riots float64 }
	counts := map[string]*ev{}
	for _, e := range protests {
		code := normalizeCountry(asString(mapGet(e, "country")))
		if code == "" {
			continue
		}
		c := counts[code]
		if c == nil {
			c = &ev{}
			counts[code] = c
		}
		if asString(mapGet(e, "event_type")) == "Riots" {
			c.riots++
		} else {
			c.protests++
		}
	}
	now := nowISO()
	scores := make([]map[string]any, 0, len(tier1Countries))
	for _, t := range tier1Countries {
		e := counts[t.code]
		if e == nil {
			e = &ev{}
		}
		baseline := baselineRisk[t.code]
		mult := eventMultiplier[t.code]
		if mult == 0 {
			mult = 1
		}
		unrest := math.Min(100, math.Round((e.protests+e.riots*2)*mult*2))
		security := math.Min(100, baseline+e.riots*mult*5)
		information := math.Min(100, (e.protests+e.riots)*mult*3)
		composite := math.Min(100, math.Round(baseline+(unrest*0.4+security*0.35+information*0.25)*0.5))
		scores = append(scores, map[string]any{
			"code": t.code, "name": t.name, "score": composite, "level": scoreLevel(composite),
			"trend": "stable", "change24h": 0,
			"components":  map[string]any{"unrest": unrest, "security": security, "information": information},
			"lastUpdated": now,
		})
	}
	sort.SliceStable(scores, func(i, j int) bool { return asFloat(scores[i]["score"]) > asFloat(scores[j]["score"]) })
	return scores
}

func computeStrategic(cii []map[string]any) map[string]any {
	top := cii
	if len(top) > 5 {
		top = top[:5]
	}
	var weightedSum, totalWeight float64
	contributors := make([]map[string]any, 0, len(top))
	for i, sScore := range top {
		w := 1 - float64(i)*0.15
		weightedSum += asFloat(sScore["score"]) * w
		totalWeight += w
		contributors = append(contributors, map[string]any{
			"country": sScore["name"], "code": sScore["code"], "score": sScore["score"], "level": sScore["level"],
		})
	}
	ciiComponent := 0.0
	if totalWeight > 0 {
		ciiComponent = weightedSum / totalWeight
	}
	overall := math.Round(ciiComponent*0.7 + 15)
	return map[string]any{
		"score": math.Min(100, overall), "level": scoreLevel(overall), "trend": "stable",
		"lastUpdated": nowISO(), "contributors": contributors,
	}
}

// ── Theater posture (military aircraft by theater) ───────────────────────────

type theater struct {
	id, name, shortName, target      string
	north, south, east, west         float64
	elevated, critical               int
	minTankers, minAwacs, minFighters int
}

var postureTheaters = []theater{
	{"iran-theater", "Iran Theater", "IRAN", "Iran", 42, 20, 65, 30, 8, 20, 2, 1, 5},
	{"taiwan-theater", "Taiwan Strait", "TAIWAN", "Taiwan", 30, 18, 130, 115, 6, 15, 1, 1, 4},
	{"baltic-theater", "Baltic Theater", "BALTIC", "", 65, 52, 32, 10, 5, 12, 1, 1, 3},
	{"blacksea-theater", "Black Sea", "BLACK SEA", "", 48, 40, 42, 26, 4, 10, 1, 1, 3},
	{"korea-theater", "Korean Peninsula", "KOREA", "North Korea", 43, 33, 132, 124, 5, 12, 1, 1, 3},
	{"south-china-sea", "South China Sea", "SCS", "", 25, 5, 121, 105, 6, 15, 1, 1, 4},
	{"east-med-theater", "Eastern Mediterranean", "E.MED", "", 37, 33, 37, 25, 4, 10, 1, 1, 3},
	{"israel-gaza-theater", "Israel/Gaza", "GAZA", "Gaza", 33, 29, 36, 33, 3, 8, 1, 1, 3},
	{"yemen-redsea-theater", "Yemen/Red Sea", "RED SEA", "Yemen", 22, 11, 54, 32, 4, 10, 1, 1, 3},
}

var militaryPrefixes = []string{
	"RCH", "REACH", "MOOSE", "EVAC", "DUKE", "HAVOC", "KNIFE", "VIPER", "SHELL", "TEXACO", "ARCO", "ESSO",
	"SENTRY", "AWACS", "MAGIC", "DISCO", "COBRA", "RAPTOR", "TALON", "REAPER", "ARMY", "NAVY", "USAF", "USMC",
	"NATO", "GAF", "RRF", "RAF", "FAF", "IAF", "RNLAF", "RSAF", "IRIAF", "TAF", "SAM", "CNV", "PAT",
}

// handleTheaterPosture aggregates military aircraft into theater postures.
// Ported from api/theater-posture.js. Military detection is by callsign prefix;
// when the live feed (OpenSky) is unavailable it degrades to zeroed postures.
func (s *Server) handleTheaterPosture(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "theater-posture:v4", "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
		5*time.Minute, 24*time.Hour,
		func(ctx context.Context) (any, error) {
			flights := s.fetchMilitaryFlights(ctx)
			postures := make([]map[string]any, 0, len(postureTheaters))
			total := 0
			for _, th := range postureTheaters {
				p, n := buildPosture(th, flights)
				postures = append(postures, p)
				total += n
			}
			return map[string]any{
				"postures": postures, "totalFlights": total, "timestamp": nowISO(),
				"cached": false, "source": "opensky",
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"postures": zeroPostures(), "totalFlights": 0, "timestamp": nowISO(), "cached": false, "source": "opensky",
			})
		})
}

type milFlight struct {
	lat, lon float64
	category string
	operator string
}

func (s *Server) fetchMilitaryFlights(ctx context.Context) []milFlight {
	var resp struct {
		States [][]any `json:"states"`
	}
	if err := s.getJSON(ctx, "https://opensky-network.org/v1/world/states/all",
		map[string]string{"User-Agent": browserUA}, &resp); err != nil {
		return nil
	}
	var out []milFlight
	for _, st := range resp.States {
		if len(st) < 7 {
			continue
		}
		callsign := trimSpace(asString(st[1]))
		cat := militaryCategory(callsign)
		if cat == "" {
			continue
		}
		lon, lat := toFloat(st[5]), toFloat(st[6])
		if lat == 0 && lon == 0 {
			continue
		}
		out = append(out, milFlight{lat, lon, cat, asString(st[2])})
	}
	return out
}

// militaryCategory returns the aircraft category for a military callsign, or ""
// if the callsign is not recognized as military.
func militaryCategory(callsign string) string {
	if callsign == "" {
		return ""
	}
	cs := upper(callsign)
	matched := false
	for _, p := range militaryPrefixes {
		if hasPrefix(cs, p) {
			matched = true
			break
		}
	}
	if !matched {
		return ""
	}
	switch {
	case hasPrefixAny(cs, "SHELL", "TEXACO", "ARCO", "ESSO"):
		return "tankers"
	case hasPrefixAny(cs, "SENTRY", "AWACS", "MAGIC", "DISCO"):
		return "awacs"
	case hasPrefixAny(cs, "RCH", "REACH", "MOOSE", "SAM", "CNV", "PAT"):
		return "transport"
	case hasPrefixAny(cs, "DUKE", "HAVOC", "KNIFE", "VIPER", "COBRA", "RAPTOR", "TALON"):
		return "fighters"
	case hasPrefixAny(cs, "REAPER"):
		return "drones"
	}
	return "unknown"
}

func hasPrefixAny(s string, prefixes ...string) bool {
	for _, p := range prefixes {
		if hasPrefix(s, p) {
			return true
		}
	}
	return false
}

func buildPosture(th theater, flights []milFlight) (map[string]any, int) {
	cats := map[string]int{}
	operators := map[string]int{}
	total := 0
	for _, f := range flights {
		if f.lat <= th.south || f.lat >= th.north || f.lon <= th.west || f.lon >= th.east {
			continue
		}
		cats[f.category]++
		if f.operator != "" {
			operators[f.operator]++
		}
		total++
	}
	level := "normal"
	if total >= th.critical {
		level = "critical"
	} else if total >= th.elevated {
		level = "elevated"
	}
	strike := cats["tankers"] >= th.minTankers && cats["awacs"] >= th.minAwacs && cats["fighters"] >= th.minFighters
	byOp := map[string]any{}
	for k, v := range operators {
		byOp[k] = v
	}
	var target any
	if th.target != "" {
		target = th.target
	}
	p := map[string]any{
		"theaterId": th.id, "theaterName": th.name, "shortName": th.shortName, "targetNation": target,
		"fighters": cats["fighters"], "tankers": cats["tankers"], "awacs": cats["awacs"],
		"reconnaissance": cats["reconnaissance"], "transport": cats["transport"], "bombers": cats["bombers"],
		"drones": cats["drones"], "unknown": cats["unknown"], "totalAircraft": total,
		"destroyers": 0, "frigates": 0, "carriers": 0, "submarines": 0, "patrol": 0, "auxiliaryVessels": 0, "totalVessels": 0,
		"byOperator": byOp, "postureLevel": level, "strikeCapable": strike, "trend": "stable", "changePercent": 0,
		"summary":  postureSummary(th, total, level),
		"headline": th.name + ": " + upper(level[:1]) + level[1:],
		"centerLat": (th.north + th.south) / 2, "centerLon": (th.east + th.west) / 2,
		"bounds": map[string]any{"north": th.north, "south": th.south, "east": th.east, "west": th.west},
	}
	return p, total
}

func postureSummary(th theater, total int, level string) string {
	if total == 0 {
		return "No significant military air activity detected in " + th.name + "."
	}
	return itoa(total) + " military aircraft tracked in " + th.name + " (" + level + ")."
}

func zeroPostures() []map[string]any {
	out := make([]map[string]any, 0, len(postureTheaters))
	for _, th := range postureTheaters {
		p, _ := buildPosture(th, nil)
		out = append(out, p)
	}
	return out
}

// ── Temporal baseline (in-memory Welford anomaly detector) ───────────────────

var validBaselineTypes = map[string]bool{
	"military_flights": true, "vessels": true, "protests": true, "news": true, "ais_gaps": true, "satellite_fires": true,
}

type welford struct {
	count      float64
	mean, m2   float64
}

type baselineStore struct {
	mu sync.Mutex
	m  map[string]*welford
}

var baselines = &baselineStore{m: map[string]*welford{}}

func baselineKey(typ, region string) string {
	now := time.Now().UTC()
	return "baseline:" + typ + ":" + region + ":" + itoa(int(now.Weekday())) + ":" + itoa(int(now.Month()))
}

// handleTemporalBaseline detects anomalies against a learned per-slot baseline
// (in-memory Welford). Ported from api/temporal-baseline.js (Redis→in-process).
func (s *Server) handleTemporalBaseline(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, POST, OPTIONS")
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		s.temporalGet(w, r)
	case http.MethodPost:
		s.temporalPost(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func (s *Server) temporalGet(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	typ := q.Get("type")
	region := q.Get("region")
	if region == "" {
		region = "global"
	}
	count, err := strconv.ParseFloat(q.Get("count"), 64)
	if !validBaselineTypes[typ] || err != nil {
		writeError(w, http.StatusBadRequest, "Missing or invalid params: type, count required")
		return
	}
	baselines.mu.Lock()
	wf := baselines.m[baselineKey(typ, region)]
	var mean, std, n float64
	if wf != nil {
		mean, n = wf.mean, wf.count
		if wf.count > 1 {
			std = math.Sqrt(wf.m2 / (wf.count - 1))
		}
	}
	baselines.mu.Unlock()

	if wf == nil || n < 10 {
		writeJSON(w, http.StatusOK, "no-store", map[string]any{
			"anomaly": nil, "learning": true, "sampleCount": int(n), "samplesNeeded": 10,
		})
		return
	}
	var anomaly any
	if std > 0 {
		z := (count - mean) / std
		sev := ""
		switch {
		case math.Abs(z) >= 3:
			sev = "critical"
		case math.Abs(z) >= 2:
			sev = "high"
		case math.Abs(z) >= 1.5:
			sev = "medium"
		}
		if sev != "" {
			mult := 1.0
			if mean == 0 {
				if count > 0 {
					mult = 999
				}
			} else {
				mult = round2s(count / mean)
			}
			anomaly = map[string]any{"zScore": round2s(z), "severity": sev, "multiplier": mult}
		}
	}
	writeJSON(w, http.StatusOK, "no-store", map[string]any{
		"anomaly":  anomaly,
		"baseline": map[string]any{"mean": round2s(mean), "stdDev": round2s(std), "sampleCount": int(n)},
		"learning": false,
	})
}

func (s *Server) temporalPost(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > 51200 {
		writeError(w, http.StatusRequestEntityTooLarge, "Payload too large")
		return
	}
	var body struct {
		Updates []struct {
			Type   string   `json:"type"`
			Region string   `json:"region"`
			Count  *float64 `json:"count"`
		} `json:"updates"`
	}
	if err := decodeJSONBody(r, &body); err != nil || body.Updates == nil {
		writeError(w, http.StatusBadRequest, "Body must have updates array")
		return
	}
	updates := body.Updates
	if len(updates) > 20 {
		updates = updates[:20]
	}
	written := 0
	baselines.mu.Lock()
	for _, u := range updates {
		if !validBaselineTypes[u.Type] || u.Count == nil {
			continue
		}
		region := u.Region
		if region == "" {
			region = "global"
		}
		k := baselineKey(u.Type, region)
		wf := baselines.m[k]
		if wf == nil {
			wf = &welford{}
			baselines.m[k] = wf
		}
		x := *u.Count
		wf.count++
		delta := x - wf.mean
		wf.mean += delta / wf.count
		wf.m2 += delta * (x - wf.mean)
		written++
	}
	baselines.mu.Unlock()
	writeJSON(w, http.StatusOK, "no-store", map[string]any{"updated": written})
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	}
	return 0
}
