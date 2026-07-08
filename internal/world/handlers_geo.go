package world

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── OpenSky (live flights) ───────────────────────────────────────────────────

// handleOpenSky proxies the OpenSky states/all endpoint (verbatim), optionally
// bounded by a bbox. Ported from api/opensky.js.
func (s *Server) handleOpenSky(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	var parts []string
	for _, k := range []string{"lamin", "lomin", "lamax", "lomax"} {
		if v := q.Get(k); v != "" {
			parts = append(parts, k+"="+urlQueryEscape(v))
		}
	}
	upstream := "https://opensky-network.org/api/states/all"
	if len(parts) > 0 {
		upstream += "?" + strings.Join(parts, "&")
	}
	s.passthrough(w, "opensky:"+strings.Join(parts, "&"), upstream, "application/json",
		"public, max-age=30, s-maxage=30, stale-while-revalidate=15",
		map[string]string{"User-Agent": browserUA, "Accept-Language": "en-US,en;q=0.9"},
		30*time.Second, 2*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"error": "OpenSky unavailable: " + err.Error(), "time": time.Now().UnixMilli(), "states": nil,
			})
		})
}

// ── Earthquakes (USGS) ───────────────────────────────────────────────────────

// handleEarthquakes proxies the USGS 4.5+/day GeoJSON feed verbatim. Ported
// from api/earthquakes.js.
func (s *Server) handleEarthquakes(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.passthrough(w, "earthquakes:4.5_day",
		"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
		"application/json", "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		map[string]string{"Accept": "application/json"}, 5*time.Minute, 30*time.Minute,
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusOK, "Failed to fetch data")
		})
}

// ── NASA FIRMS (satellite fires) ─────────────────────────────────────────────

var firmsRegions = map[string]string{
	"Ukraine": "22,44,40,53", "Russia": "20,50,180,82", "Iran": "44,25,63,40",
	"Israel/Gaza": "34,29,36,34", "Syria": "35,32,42,37", "Taiwan": "119,21,123,26",
	"North Korea": "124,37,131,43", "Saudi Arabia": "34,16,56,32", "Turkey": "26,36,45,42",
}

const firmsSource = "VIIRS_SNPP_NRT"

// handleFIRMS aggregates NASA FIRMS fire detections for monitored regions.
// Ported from api/firms-fires.js. Requires NASA_FIRMS_API_KEY; degrades cleanly.
func (s *Server) handleFIRMS(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	key := env("NASA_FIRMS_API_KEY", "FIRMS_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "public, max-age=600", map[string]any{
			"regions": map[string]any{}, "totalCount": 0, "skipped": true,
			"reason": "NASA_FIRMS_API_KEY not configured", "source": firmsSource, "days": 0, "timestamp": nowISO(),
		})
		return
	}
	q := r.URL.Query()
	regionName := q.Get("region")
	days := clampInt(q.Get("days"), 1, 1, 5)
	regions := firmsRegions
	if regionName != "" {
		bbox, ok := firmsRegions[regionName]
		if !ok {
			writeError(w, http.StatusBadRequest, "Unknown region: "+regionName)
			return
		}
		regions = map[string]string{regionName: bbox}
	}
	cacheKey := fmt.Sprintf("firms:%s:%d", regionName, days)
	s.cachedJSON(w, cacheKey, "public, max-age=600, s-maxage=600, stale-while-revalidate=120",
		10*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) {
			type res struct {
				name  string
				fires []map[string]any
			}
			out := make(chan res, len(regions))
			var wg sync.WaitGroup
			for name, bbox := range regions {
				wg.Add(1)
				go func(name, bbox string) {
					defer wg.Done()
					u := fmt.Sprintf("https://firms.modaps.eosdis.nasa.gov/api/area/csv/%s/%s/%s/%d", key, firmsSource, bbox, days)
					csv, err := s.getText(ctx, u, map[string]string{"Accept": "text/csv"})
					if err != nil {
						return
					}
					out <- res{name, parseFIRMSCSV(csv)}
				}(name, bbox)
			}
			go func() { wg.Wait(); close(out) }()
			allFires := map[string]any{}
			total := 0
			for rr := range out {
				allFires[rr.name] = rr.fires
				total += len(rr.fires)
			}
			return map[string]any{
				"regions": allFires, "totalCount": total, "source": firmsSource,
				"days": days, "timestamp": nowISO(),
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeError(w, http.StatusOK, "Failed to fetch fire data")
		})
}

func parseFIRMSCSV(csv string) []map[string]any {
	lines := strings.Split(strings.TrimSpace(csv), "\n")
	if len(lines) < 2 {
		return []map[string]any{}
	}
	headers := strings.Split(lines[0], ",")
	idx := map[string]int{}
	for i, h := range headers {
		idx[strings.TrimSpace(h)] = i
	}
	get := func(vals []string, k string) string {
		if i, ok := idx[k]; ok && i < len(vals) {
			return strings.TrimSpace(vals[i])
		}
		return ""
	}
	pf := func(s string) float64 { f, _ := strconv.ParseFloat(s, 64); return f }
	out := make([]map[string]any, 0, len(lines)-1)
	for _, line := range lines[1:] {
		vals := strings.Split(line, ",")
		if len(vals) < len(headers) {
			continue
		}
		out = append(out, map[string]any{
			"lat": pf(get(vals, "latitude")), "lon": pf(get(vals, "longitude")),
			"brightness": pf(get(vals, "bright_ti4")), "scan": pf(get(vals, "scan")), "track": pf(get(vals, "track")),
			"acq_date": get(vals, "acq_date"), "acq_time": get(vals, "acq_time"), "satellite": get(vals, "satellite"),
			"confidence": firmsConfidence(get(vals, "confidence")), "bright_t31": pf(get(vals, "bright_ti5")),
			"frp": pf(get(vals, "frp")), "daynight": get(vals, "daynight"),
		})
	}
	return out
}

func firmsConfidence(c string) int {
	switch c {
	case "h":
		return 95
	case "n":
		return 50
	case "l":
		return 20
	}
	n, _ := strconv.Atoi(c)
	return n
}

// ── Climate anomalies (Open-Meteo archive) ───────────────────────────────────

type climateZone struct {
	name     string
	lat, lon float64
}

var climateZones = []climateZone{
	{"Ukraine", 48.4, 31.2}, {"Middle East", 33.0, 44.0}, {"Sahel", 14.0, 0.0}, {"Horn of Africa", 8.0, 42.0},
	{"South Asia", 25.0, 78.0}, {"California", 36.8, -119.4}, {"Amazon", -3.4, -60.0}, {"Australia", -25.0, 134.0},
	{"Mediterranean", 38.0, 20.0}, {"Taiwan Strait", 24.0, 120.0}, {"Myanmar", 19.8, 96.7}, {"Central Africa", 4.0, 22.0},
	{"Southern Africa", -25.0, 28.0}, {"Central Asia", 42.0, 65.0}, {"Caribbean", 19.0, -72.0},
}

// handleClimate computes 7-day-vs-baseline temp/precip anomalies per zone.
// Ported from api/climate-anomalies.js.
func (s *Server) handleClimate(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "climate:anomalies:v1",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=600", 6*time.Hour, 6*time.Hour,
		func(ctx context.Context) (any, error) {
			end := time.Now().UTC()
			start := end.AddDate(0, 0, -30)
			anomalies := make([]map[string]any, len(climateZones))
			var wg sync.WaitGroup
			for i, z := range climateZones {
				wg.Add(1)
				go func(i int, z climateZone) {
					defer wg.Done()
					anomalies[i] = s.climateZone(ctx, z, start, end)
				}(i, z)
			}
			wg.Wait()
			out := make([]map[string]any, 0, len(anomalies))
			for _, a := range anomalies {
				if a != nil {
					out = append(out, a)
				}
			}
			return map[string]any{"success": true, "anomalies": out, "timestamp": nowISO()}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "anomalies": []any{}})
		})
}

func (s *Server) climateZone(ctx context.Context, z climateZone, start, end time.Time) map[string]any {
	u := fmt.Sprintf("https://archive-api.open-meteo.com/v1/archive?latitude=%.4f&longitude=%.4f&start_date=%s&end_date=%s&daily=temperature_2m_mean,precipitation_sum&timezone=UTC",
		z.lat, z.lon, dateOnly(start), dateOnly(end))
	var data struct {
		Daily struct {
			Temp   []*float64 `json:"temperature_2m_mean"`
			Precip []*float64 `json:"precipitation_sum"`
		} `json:"daily"`
	}
	if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json"}, &data); err != nil {
		return nil
	}
	temps := compact(data.Daily.Temp)
	precips := compact(data.Daily.Precip)
	if len(temps) < 14 {
		return nil
	}
	tempDelta := avgTail(temps, 7) - avgHead(temps, 7)
	precipDelta := avgTail(precips, 7) - avgHead(precips, 7)
	return map[string]any{
		"zone": z.name, "lat": z.lat, "lon": z.lon,
		"tempDelta": round1(tempDelta), "precipDelta": round1(precipDelta),
		"severity": classifyClimateSeverity(tempDelta, precipDelta),
		"type":     classifyClimateType(tempDelta, precipDelta),
		"period":   dateOnly(start) + " to " + dateOnly(end),
	}
}

func avgTail(a []float64, n int) float64 {
	if len(a) < n {
		return mean(a)
	}
	return mean(a[len(a)-n:])
}
func avgHead(a []float64, n int) float64 {
	if len(a) <= n {
		return mean(a)
	}
	return mean(a[:len(a)-n])
}
func mean(a []float64) float64 {
	if len(a) == 0 {
		return 0
	}
	var s float64
	for _, v := range a {
		s += v
	}
	return s / float64(len(a))
}

func classifyClimateSeverity(t, p float64) string {
	at, ap := math.Abs(t), math.Abs(p)
	if at >= 5 || ap >= 80 {
		return "extreme"
	}
	if at >= 3 || ap >= 40 {
		return "moderate"
	}
	return "normal"
}

func classifyClimateType(t, p float64) string {
	at, ap := math.Abs(t), math.Abs(p)
	if at >= ap/20 {
		if t > 0 && p < -20 {
			return "mixed"
		}
		if t > 3 {
			return "warm"
		}
		if t < -3 {
			return "cold"
		}
	}
	if p > 40 {
		return "wet"
	}
	if p < -40 {
		return "dry"
	}
	if t > 0 {
		return "warm"
	}
	return "cold"
}

// ── AIS snapshot (maritime relay) ────────────────────────────────────────────

// handleAISSnapshot proxies the AIS relay snapshot. Ported from api/ais-snapshot.js.
// Without WS_RELAY_URL it degrades to an empty, skipped payload.
func (s *Server) handleAISSnapshot(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	base := relayBase()
	if base == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"vessels": []any{}, "skipped": true, "reason": "AIS relay not configured"})
		return
	}
	candidates := r.URL.Query().Get("candidates") == "true"
	key := "ais-snapshot:" + boolStr(candidates)
	s.cachedJSON(w, key, "public, max-age=8, s-maxage=8, stale-while-revalidate=5", 8*time.Second, time.Minute,
		func(ctx context.Context) (any, error) {
			var snap map[string]any
			if err := s.getJSON(ctx, base+"/ais/snapshot?candidates="+boolStr(candidates), map[string]string{"Accept": "application/json"}, &snap); err != nil {
				return nil, err
			}
			if !validAISSnapshot(snap) {
				return nil, fmt.Errorf("invalid AIS snapshot payload")
			}
			return snap, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusBadGateway, "", map[string]any{"error": err.Error()})
		})
}

func relayBase() string {
	u := env("WS_RELAY_URL")
	if u == "" {
		return ""
	}
	u = strings.NewReplacer("wss://", "https://", "ws://", "http://").Replace(u)
	return strings.TrimRight(u, "/")
}

func validAISSnapshot(m map[string]any) bool {
	if m == nil {
		return false
	}
	if _, ok := m["status"].(map[string]any); !ok {
		return false
	}
	_, dOK := m["disruptions"].([]any)
	_, denOK := m["density"].([]any)
	return dOK && denOK
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// ── Wingbits (ADS-B, key-gated sub-router) ───────────────────────────────────

const wingbitsBase = "https://customer-api.wingbits.com"

// handleWingbits routes the /api/wingbits/* subpaths to the Wingbits customer
// API, keeping the key server-side. Ported from api/wingbits/[[...path]].js.
func (s *Server) handleWingbits(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, POST, OPTIONS") {
		return
	}
	key := env("WINGBITS_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"error": "Wingbits not configured", "configured": false})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/wingbits")
	hdr := map[string]string{"x-api-key": key, "Accept": "application/json"}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	switch {
	case path == "" || path == "/" || path == "/health":
		var d map[string]any
		if err := s.getJSON(ctx, wingbitsBase+"/health", hdr, &d); err != nil {
			writeJSON(w, http.StatusInternalServerError, "", map[string]any{"error": err.Error(), "configured": true})
			return
		}
		d["configured"] = true
		writeJSON(w, http.StatusOK, "", d)

	case path == "/flights" && r.Method == http.MethodGet:
		q := r.URL.Query()
		la := firstNonEmpty(q.Get("la"), q.Get("lat"))
		lo := firstNonEmpty(q.Get("lo"), q.Get("lon"))
		if la == "" || lo == "" {
			writeError(w, http.StatusBadRequest, "lat (la) and lon (lo) required")
			return
		}
		wdt := firstNonEmpty(q.Get("w"), q.Get("width"), "500")
		hgt := firstNonEmpty(q.Get("h"), q.Get("height"), "500")
		unit := firstNonEmpty(q.Get("unit"), "nm")
		u := fmt.Sprintf("%s/v1/flights?by=box&la=%s&lo=%s&w=%s&h=%s&unit=%s",
			wingbitsBase, urlQueryEscape(la), urlQueryEscape(lo), urlQueryEscape(wdt), urlQueryEscape(hgt), urlQueryEscape(unit))
		s.wingbitsProxyGET(w, ctx, u, hdr, "public, max-age=30, s-maxage=30, stale-while-revalidate=15")

	case detailsICAO(path) != "":
		icao := detailsICAO(path)
		s.wingbitsProxyGET(w, ctx, wingbitsBase+"/v1/flights/details/"+icao, hdr,
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600")

	case path == "/details/batch" && r.Method == http.MethodPost:
		s.wingbitsBatch(w, r, ctx, key)

	default:
		writeError(w, http.StatusNotFound, "Not found")
	}
}

func (s *Server) wingbitsProxyGET(w http.ResponseWriter, ctx context.Context, url string, hdr map[string]string, cc string) {
	b, status, err := s.get(ctx, url, hdr)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, "", map[string]any{"error": err.Error()})
		return
	}
	if status < 200 || status >= 300 {
		writeJSON(w, status, "", map[string]any{"error": fmt.Sprintf("Wingbits API error: %d", status)})
		return
	}
	writeBytes(w, http.StatusOK, "application/json", cc, b)
}

func (s *Server) wingbitsBatch(w http.ResponseWriter, r *http.Request, ctx context.Context, key string) {
	var body struct {
		Icao24s []string `json:"icao24s"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(body.Icao24s) == 0 {
		writeError(w, http.StatusBadRequest, "icao24s array required")
		return
	}
	list := body.Icao24s
	if len(list) > 20 {
		list = list[:20]
	}
	results := map[string]any{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	hdr := map[string]string{"x-api-key": key, "Accept": "application/json"}
	for _, id := range list {
		id = lower(id)
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			var d any
			if err := s.getJSON(ctx, wingbitsBase+"/v1/flights/details/"+id, hdr, &d); err == nil {
				mu.Lock()
				results[id] = d
				mu.Unlock()
			}
		}(id)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		map[string]any{"results": results, "fetched": len(results), "requested": len(list)})
}

func detailsICAO(path string) string {
	const p = "/details/"
	if !hasPrefix(path, p) {
		return ""
	}
	icao := lower(path[len(p):])
	if icao == "" || strings.Contains(icao, "/") {
		return ""
	}
	for _, c := range icao {
		if !(c >= 'a' && c <= 'f' || c >= '0' && c <= '9') {
			return ""
		}
	}
	return icao
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
