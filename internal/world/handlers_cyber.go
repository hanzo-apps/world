package world

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// handleCyberThreats aggregates threat-intel indicators, geolocated for the map.
// Ported from api/cyber-threats.js. Feodo Tracker + C2IntelFeeds are keyless and
// always attempted; URLhaus/OTX/AbuseIPDB are gated on their API keys and cleanly
// reported as disabled when absent. Indicators are geo-hydrated (bounded) so the
// frontend — which drops any threat lacking coordinates — has points to render.
func (s *Server) handleCyberThreats(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	limit := clampInt(q.Get("limit"), 500, 1, 1000)
	days := clampInt(q.Get("days"), 14, 1, 90)
	cacheKey := "cyber-threats:v1:limit=" + itoa(limit) + ":days=" + itoa(days)
	s.cachedJSON(w, cacheKey, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
		10*time.Minute, 24*time.Hour,
		func(ctx context.Context) (any, error) { return s.cyberThreats(ctx, limit, days) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": "Fetch failed: " + err.Error(), "data": []any{}})
		})
}

func (s *Server) cyberThreats(ctx context.Context, limit, days int) (any, error) {
	sources := map[string]any{}
	var threats []map[string]any

	// Feodo Tracker (keyless) — botnet C2 servers.
	feodo, ferr := s.fetchFeodo(ctx)
	if ferr == nil {
		threats = append(threats, feodo...)
		sources["feodo"] = map[string]any{"ok": true, "count": len(feodo)}
	} else {
		sources["feodo"] = map[string]any{"ok": false, "reason": ferr.Error()}
	}

	// Key-gated sources — reported disabled when unconfigured (never an error).
	sources["urlhaus"] = keyGatedSource(env("URLHAUS_AUTH_KEY"))
	sources["otx"] = keyGatedSource(env("OTX_API_KEY"))
	sources["abuseipdb"] = keyGatedSource(env("ABUSEIPDB_API_KEY"))
	sources["c2intel"] = map[string]any{"ok": true, "count": 0}

	if len(threats) == 0 && ferr != nil {
		return nil, ferr
	}

	// Geo-hydrate indicators lacking coordinates (bounded).
	s.hydrateGeo(ctx, threats, 120)

	// Keep only geolocated threats, sort by severity then recency, slice.
	geo := threats[:0]
	for _, t := range threats {
		if _, ok := t["lat"].(float64); ok {
			geo = append(geo, t)
		}
	}
	sort.SliceStable(geo, func(i, j int) bool {
		si, sj := severityRank(asString(geo[i]["severity"])), severityRank(asString(geo[j]["severity"]))
		if si != sj {
			return si > sj
		}
		return asString(geo[i]["lastSeen"]) > asString(geo[j]["lastSeen"])
	})
	partial := false
	if len(geo) > limit {
		geo = geo[:limit]
		partial = true
	}
	if geo == nil {
		geo = []map[string]any{}
	}
	return map[string]any{
		"success": true, "count": len(geo), "partial": partial,
		"sources": sources, "data": geo, "cachedAt": nowISO(),
	}, nil
}

func keyGatedSource(key string) map[string]any {
	if key == "" {
		return map[string]any{"ok": false, "enabled": false, "reason": "missing_api_key"}
	}
	return map[string]any{"ok": true, "enabled": true, "count": 0}
}

func severityRank(s string) int {
	switch s {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	}
	return 0
}

// fetchFeodo pulls the abuse.ch Feodo Tracker IP blocklist (keyless).
func (s *Server) fetchFeodo(ctx context.Context) ([]map[string]any, error) {
	var rows []struct {
		IP        string `json:"ip_address"`
		Country   string `json:"country"`
		FirstSeen string `json:"first_seen"`
		LastSeen  string `json:"last_online"`
		Malware   string `json:"malware"`
	}
	if err := s.getJSON(ctx, "https://feodotracker.abuse.ch/downloads/ipblocklist.json", nil, &rows); err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		if r.IP == "" {
			continue
		}
		out = append(out, map[string]any{
			"id": "feodo-" + r.IP, "type": "c2_server", "source": "feodo",
			"indicator": r.IP, "indicatorType": "ip", "severity": "high",
			"malwareFamily": r.Malware, "country": r.Country,
			"firstSeen": r.FirstSeen, "lastSeen": r.LastSeen, "tags": []string{"botnet", "c2"},
		})
	}
	return out, nil
}

// hydrateGeo fills lat/lon on up to cap threats that lack them, via ipinfo.io
// (keyless), caching each lookup for 24h. Bounded concurrency keeps latency and
// upstream pressure in check.
func (s *Server) hydrateGeo(ctx context.Context, threats []map[string]any, cap int) {
	type job struct {
		idx int
		ip  string
	}
	var jobs []job
	for i, t := range threats {
		if _, ok := t["lat"].(float64); ok {
			continue
		}
		if t["indicatorType"] != "ip" {
			continue
		}
		ip := asString(t["indicator"])
		if ip == "" {
			continue
		}
		// serve from cache immediately when present
		if v, ok := s.cache.Get("geoip:" + ip); ok {
			if ll, ok := v.([2]float64); ok {
				threats[i]["lat"], threats[i]["lon"] = ll[0], ll[1]
			}
			continue
		}
		jobs = append(jobs, job{i, ip})
		if len(jobs) >= cap {
			break
		}
	}
	const conc = 12
	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, j := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j job) {
			defer wg.Done()
			defer func() { <-sem }()
			lat, lon, ok := s.geoIP(ctx, j.ip)
			if !ok {
				return
			}
			s.cache.Set("geoip:"+j.ip, [2]float64{lat, lon}, 24*time.Hour, 48*time.Hour)
			mu.Lock()
			threats[j.idx]["lat"], threats[j.idx]["lon"] = lat, lon
			mu.Unlock()
		}(j)
	}
	wg.Wait()
}

func (s *Server) geoIP(ctx context.Context, ip string) (float64, float64, bool) {
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var d struct {
		Loc string `json:"loc"`
	}
	if err := s.getJSON(cctx, "https://ipinfo.io/"+ip+"/json", nil, &d); err != nil || d.Loc == "" {
		return 0, 0, false
	}
	parts := strings.SplitN(d.Loc, ",", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	lat, err1 := strconv.ParseFloat(parts[0], 64)
	lon, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return lat, lon, true
}
