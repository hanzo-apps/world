package world

import (
	"context"
	"net/http"
	"time"
)

// acledCC is the shared cache-control for conflict endpoints.
const acledCC = "public, max-age=300, s-maxage=300, stale-while-revalidate=60"

// fetchACLED queries acleddata.com for one event-type filter and returns the
// sanitized {success,count,data,cached_at} object. Ported from api/acled.js and
// api/acled-conflict.js (same shape, different event_type).
func (s *Server) fetchACLED(ctx context.Context, token, eventType string) (any, error) {
	params := "event_type=" + urlQueryEscape(eventType) +
		"&event_date=" + daysAgoUTC(30) + "|" + todayUTC() +
		"&event_date_where=BETWEEN&limit=500&_format=json"
	var raw struct {
		Data []map[string]any `json:"data"`
	}
	b, status, err := s.get(ctx, "https://acleddata.com/api/acled/read?"+params, map[string]string{
		"Accept":        "application/json",
		"Authorization": "Bearer " + token,
	})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, httpErr(status)
	}
	if err := decodeNumber(b, &raw); err != nil {
		return nil, err
	}
	events := make([]map[string]any, 0, len(raw.Data))
	for _, e := range raw.Data {
		notes := asString(mapGet(e, "notes"))
		if len(notes) > 500 {
			notes = notes[:500]
		}
		events = append(events, map[string]any{
			"event_id_cnty":  mapGet(e, "event_id_cnty"),
			"event_date":     mapGet(e, "event_date"),
			"event_type":     mapGet(e, "event_type"),
			"sub_event_type": mapGet(e, "sub_event_type"),
			"actor1":         mapGet(e, "actor1"),
			"actor2":         mapGet(e, "actor2"),
			"country":        mapGet(e, "country"),
			"admin1":         mapGet(e, "admin1"),
			"location":       mapGet(e, "location"),
			"latitude":       mapGet(e, "latitude"),
			"longitude":      mapGet(e, "longitude"),
			"fatalities":     mapGet(e, "fatalities"),
			"notes":          notes,
			"source":         mapGet(e, "source"),
			"tags":           mapGet(e, "tags"),
		})
	}
	return map[string]any{
		"success":   true,
		"count":     len(events),
		"data":      events,
		"cached_at": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) acledEndpoint(w http.ResponseWriter, r *http.Request, cacheKey, eventType string) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	token := env("ACLED_ACCESS_TOKEN")
	if token == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{
			"error": "ACLED not configured", "data": []any{}, "configured": false,
		})
		return
	}
	s.cachedJSON(w, cacheKey, acledCC, 10*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) { return s.fetchACLED(ctx, token, eventType) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "data": []any{}})
		})
}

func (s *Server) handleACLED(w http.ResponseWriter, r *http.Request) {
	s.acledEndpoint(w, r, "acled:protests:v2", "Protests")
}

func (s *Server) handleACLEDConflict(w http.ResponseWriter, r *http.Request) {
	s.acledEndpoint(w, r, "acled:conflict:v2", "Battles|Explosions/Remote violence|Violence against civilians")
}

// handleUCDP proxies the UCDP PRIO conflict dataset, keeping the highest-year /
// highest-intensity conflict per location. Ported from api/ucdp.js.
func (s *Server) handleUCDP(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "ucdp:country-conflicts:v2", "public, max-age=3600", 24*time.Hour, 6*time.Hour,
		func(ctx context.Context) (any, error) {
			type entry struct {
				year, intensity int
				val             map[string]any
			}
			byLoc := map[string]entry{}
			page, totalPages := 0, 1
			for page < totalPages {
				var pg struct {
					TotalPages int              `json:"TotalPages"`
					Result     []map[string]any `json:"Result"`
				}
				b, status, err := s.get(ctx, "https://ucdpapi.pcr.uu.se/api/ucdpprioconflict/24.1?pagesize=100&page="+itoa(page), nil)
				if err != nil {
					return nil, err
				}
				if status < 200 || status >= 300 {
					return nil, httpErr(status)
				}
				if err := decodeNumber(b, &pg); err != nil {
					return nil, err
				}
				if pg.TotalPages > 0 {
					totalPages = pg.TotalPages
				}
				for _, c := range pg.Result {
					name := asString(mapGet(c, "location"))
					year := asInt(mapGet(c, "year"))
					intensity := asInt(mapGet(c, "intensity_level"))
					cur := map[string]any{
						"conflictId":     asInt(mapGet(c, "conflict_id")),
						"conflictName":   asString(mapGet(c, "side_b")),
						"location":       name,
						"year":           year,
						"intensityLevel": intensity,
						"typeOfConflict": asInt(mapGet(c, "type_of_conflict")),
						"startDate":      mapGet(c, "start_date"),
						"startDate2":     mapGet(c, "start_date2"),
						"sideA":          mapGet(c, "side_a"),
						"sideB":          mapGet(c, "side_b"),
						"region":         mapGet(c, "region"),
					}
					prev, ok := byLoc[name]
					if !ok || year > prev.year || (year == prev.year && intensity > prev.intensity) {
						byLoc[name] = entry{year, intensity, cur}
					}
				}
				page++
			}
			conflicts := make([]map[string]any, 0, len(byLoc))
			for _, e := range byLoc {
				conflicts = append(conflicts, e.val)
			}
			return map[string]any{
				"success": true, "count": len(conflicts), "conflicts": conflicts,
				"cached_at": time.Now().UTC().Format(time.RFC3339),
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "conflicts": []any{}})
		})
}

var violenceType = map[int]string{1: "state-based", 2: "non-state", 3: "one-sided"}

// handleUCDPEvents returns recent UCDP GED events within a trailing year of the
// dataset's latest event. Ported from api/ucdp-events.js.
func (s *Server) handleUCDPEvents(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "ucdp:gedevents:v2",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=600", 6*time.Hour, 6*time.Hour,
		func(ctx context.Context) (any, error) { return s.fetchUCDPEvents(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "data": []any{}})
		})
}

func (s *Server) fetchUCDPEvents(ctx context.Context) (any, error) {
	const pageSize, maxPages = 1000, 12
	trailing := 365 * 24 * time.Hour

	fetchPage := func(version string, page int) (map[string]any, error) {
		var pg map[string]any
		b, status, err := s.get(ctx, "https://ucdpapi.pcr.uu.se/api/gedevents/"+version+"?pagesize="+itoa(pageSize)+"&page="+itoa(page), nil)
		if err != nil {
			return nil, err
		}
		if status < 200 || status >= 300 {
			return nil, httpErr(status)
		}
		if err := decodeNumber(b, &pg); err != nil {
			return nil, err
		}
		return pg, nil
	}

	// discover a working dataset version
	yy := time.Now().Year() - 2000
	candidates := []string{itoa(yy) + ".1", itoa(yy-1) + ".1", "25.1", "24.1"}
	var version string
	var page0 map[string]any
	for _, v := range candidates {
		if pg, err := fetchPage(v, 0); err == nil {
			if _, ok := pg["Result"].([]any); ok {
				version, page0 = v, pg
				break
			}
		}
	}
	if version == "" {
		return nil, httpErr(502)
	}

	totalPages := asInt(mapGet(page0, "TotalPages"))
	if totalPages < 1 {
		totalPages = 1
	}
	newest := totalPages - 1

	parseMs := func(v any) (int64, bool) {
		s := asString(v)
		if s == "" {
			return 0, false
		}
		for _, layout := range []string{"2006-01-02", time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
			if t, err := time.Parse(layout, s); err == nil {
				return t.UnixMilli(), true
			}
		}
		return 0, false
	}

	var all []map[string]any
	var latestMs int64
	haveLatest := false
	for offset := 0; offset < maxPages && newest-offset >= 0; offset++ {
		page := newest - offset
		var pg map[string]any
		if page == 0 {
			pg = page0
		} else {
			var err error
			if pg, err = fetchPage(version, page); err != nil {
				break
			}
		}
		results, _ := pg["Result"].([]any)
		var pageMax int64
		havePageMax := false
		for _, ri := range results {
			ev, _ := ri.(map[string]any)
			all = append(all, ev)
			if ms, ok := parseMs(mapGet(ev, "date_start")); ok {
				if !havePageMax || ms > pageMax {
					pageMax, havePageMax = ms, true
				}
			}
		}
		if !haveLatest && havePageMax {
			latestMs, haveLatest = pageMax, true
		}
		if haveLatest && havePageMax && pageMax < latestMs-trailing.Milliseconds() {
			break
		}
	}

	out := make([]map[string]any, 0, len(all))
	for _, ev := range all {
		if haveLatest {
			ms, ok := parseMs(mapGet(ev, "date_start"))
			if !ok || ms < latestMs-trailing.Milliseconds() {
				continue
			}
		}
		out = append(out, map[string]any{
			"id":               asString(mapGet(ev, "id")),
			"date_start":       asString(mapGet(ev, "date_start")),
			"date_end":         asString(mapGet(ev, "date_end")),
			"latitude":         asFloat(mapGet(ev, "latitude")),
			"longitude":        asFloat(mapGet(ev, "longitude")),
			"country":          asString(mapGet(ev, "country")),
			"side_a":           truncate(asString(mapGet(ev, "side_a")), 200),
			"side_b":           truncate(asString(mapGet(ev, "side_b")), 200),
			"deaths_best":      asInt(mapGet(ev, "best")),
			"deaths_low":       asInt(mapGet(ev, "low")),
			"deaths_high":      asInt(mapGet(ev, "high")),
			"type_of_violence": violenceTypeOf(asInt(mapGet(ev, "type_of_violence"))),
			"source_original":  truncate(asString(mapGet(ev, "source_original")), 300),
		})
	}
	// sort by date_start desc
	sortByDateDesc(out, parseMs)
	return map[string]any{
		"success": true, "count": len(out), "data": out, "version": version,
		"cached_at": time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func violenceTypeOf(t int) string {
	if v, ok := violenceType[t]; ok {
		return v
	}
	return "state-based"
}

// handleHAPI aggregates HDX HAPI conflict-event counts per country (most recent
// month). Ported from api/hapi.js.
func (s *Server) handleHAPI(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	s.cachedJSON(w, "hapi:conflict-events:v2", "public, max-age=1800", 6*time.Hour, 6*time.Hour,
		func(ctx context.Context) (any, error) {
			appID := base64Std("worldmonitor:monitor@worldmonitor.app")
			var raw struct {
				Data []map[string]any `json:"data"`
			}
			b, status, err := s.get(ctx, "https://hapi.humdata.org/api/v2/coordination-context/conflict-events?output_format=json&limit=1000&offset=0&app_identifier="+appID, nil)
			if err != nil {
				return nil, err
			}
			if status < 200 || status >= 300 {
				return nil, httpErr(status)
			}
			if err := decodeNumber(b, &raw); err != nil {
				return nil, err
			}
			byCountry := map[string]map[string]any{}
			for _, rec := range raw.Data {
				iso3 := asString(mapGet(rec, "location_code"))
				if iso3 == "" {
					continue
				}
				month := asString(mapGet(rec, "reference_period_start"))
				etype := lower(asString(mapGet(rec, "event_type")))
				events := asInt(mapGet(rec, "events"))
				fat := asInt(mapGet(rec, "fatalities"))
				c := byCountry[iso3]
				if c == nil {
					c = map[string]any{
						"iso3": iso3, "locationName": asString(mapGet(rec, "location_name")), "month": month,
						"eventsTotal": 0, "eventsPoliticalViolence": 0, "eventsCivilianTargeting": 0,
						"eventsDemonstrations": 0, "fatalitiesTotalPoliticalViolence": 0, "fatalitiesTotalCivilianTargeting": 0,
					}
					byCountry[iso3] = c
				}
				cm := asString(c["month"])
				if month > cm {
					c["month"] = month
					c["eventsTotal"] = 0
					c["eventsPoliticalViolence"] = 0
					c["eventsCivilianTargeting"] = 0
					c["eventsDemonstrations"] = 0
					c["fatalitiesTotalPoliticalViolence"] = 0
					c["fatalitiesTotalCivilianTargeting"] = 0
					cm = month
				}
				if month == cm {
					c["eventsTotal"] = c["eventsTotal"].(int) + events
					if contains(etype, "political_violence") {
						c["eventsPoliticalViolence"] = c["eventsPoliticalViolence"].(int) + events
						c["fatalitiesTotalPoliticalViolence"] = c["fatalitiesTotalPoliticalViolence"].(int) + fat
					}
					if contains(etype, "civilian_targeting") {
						c["eventsCivilianTargeting"] = c["eventsCivilianTargeting"].(int) + events
						c["fatalitiesTotalCivilianTargeting"] = c["fatalitiesTotalCivilianTargeting"].(int) + fat
					}
					if contains(etype, "demonstration") {
						c["eventsDemonstrations"] = c["eventsDemonstrations"].(int) + events
					}
				}
			}
			countries := make([]map[string]any, 0, len(byCountry))
			for _, c := range byCountry {
				countries = append(countries, c)
			}
			return map[string]any{
				"success": true, "count": len(countries), "countries": countries,
				"cached_at": time.Now().UTC().Format(time.RFC3339),
			}, nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "countries": []any{}})
		})
}
