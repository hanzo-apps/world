package world

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// ── FRED (macro series) ──────────────────────────────────────────────────────

// handleFRED proxies FRED series observations (verbatim). Ported from
// api/fred-data.js. Requires FRED_API_KEY; degrades to an empty, skipped body.
func (s *Server) handleFRED(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	series := q.Get("series_id")
	if series == "" {
		writeError(w, http.StatusBadRequest, "Missing series_id parameter")
		return
	}
	key := env("FRED_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
			map[string]any{"observations": []any{}, "skipped": true, "reason": "FRED_API_KEY not configured"})
		return
	}
	params := "series_id=" + urlQueryEscape(series) + "&api_key=" + key + "&file_type=json&sort_order=desc&limit=10"
	if v := q.Get("observation_start"); v != "" {
		params += "&observation_start=" + urlQueryEscape(v)
	}
	if v := q.Get("observation_end"); v != "" {
		params += "&observation_end=" + urlQueryEscape(v)
	}
	upstream := "https://api.stlouisfed.org/fred/series/observations?" + params
	s.passthrough(w, "fred:"+params, upstream, "application/json",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
		map[string]string{"Accept": "application/json"}, time.Hour, 3*time.Hour,
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"observations": []any{}, "error": err.Error()})
		})
}

// ── World Bank (tech indicators) ─────────────────────────────────────────────

var wbIndicators = map[string]string{
	"IT.NET.USER.ZS": "Internet Users (% of population)", "IT.CEL.SETS.P2": "Mobile Subscriptions (per 100 people)",
	"IT.NET.BBND.P2": "Fixed Broadband Subscriptions (per 100 people)", "IT.NET.SECR.P6": "Secure Internet Servers (per million people)",
	"GB.XPD.RSDV.GD.ZS": "R&D Expenditure (% of GDP)", "IP.PAT.RESD": "Patent Applications (residents)",
	"IP.PAT.NRES": "Patent Applications (non-residents)", "IP.TMK.TOTL": "Trademark Applications",
	"TX.VAL.TECH.MF.ZS": "High-Tech Exports (% of manufactured exports)", "BX.GSR.CCIS.ZS": "ICT Service Exports (% of service exports)",
	"TM.VAL.ICTG.ZS.UN": "ICT Goods Imports (% of total goods imports)", "SE.TER.ENRR": "Tertiary Education Enrollment (%)",
	"SE.XPD.TOTL.GD.ZS": "Education Expenditure (% of GDP)", "NY.GDP.MKTP.KD.ZG": "GDP Growth (annual %)",
	"NY.GDP.PCAP.CD": "GDP per Capita (current US$)", "NE.EXP.GNFS.ZS": "Exports of Goods & Services (% of GDP)",
}

var wbCountries = []string{
	"USA", "CHN", "JPN", "DEU", "KOR", "GBR", "IND", "ISR", "SGP", "TWN", "FRA", "CAN", "SWE", "NLD", "CHE",
	"FIN", "IRL", "AUS", "BRA", "IDN", "ARE", "SAU", "QAT", "BHR", "EGY", "TUR", "MYS", "THA", "VNM", "PHL",
	"ESP", "ITA", "POL", "CZE", "DNK", "NOR", "AUT", "BEL", "PRT", "EST", "MEX", "ARG", "CHL", "COL", "ZAF", "NGA", "KEN",
}

// handleWorldBank proxies + reshapes World Bank indicator time series. Ported
// from api/worldbank.js.
func (s *Server) handleWorldBank(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") {
		return
	}
	q := r.URL.Query()
	if q.Get("action") == "indicators" {
		writeJSON(w, http.StatusOK, "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
			map[string]any{"indicators": wbIndicators, "defaultCountries": wbCountries})
		return
	}
	indicator := q.Get("indicator")
	if indicator == "" {
		writeJSON(w, http.StatusBadRequest, "", map[string]any{"error": "Missing indicator parameter", "availableIndicators": mapKeys(wbIndicators)})
		return
	}
	countryList := joinComma(wbCountries)
	countryList = replaceAll(countryList, ",", ";")
	if c := q.Get("country"); c != "" {
		countryList = c
	} else if cs := q.Get("countries"); cs != "" {
		countryList = replaceAll(cs, ",", ";")
	}
	years := atoiDefault(q.Get("years"), 5)
	cur := time.Now().Year()
	cacheKey := "worldbank:" + indicator + ":" + countryList + ":" + itoa(years)
	s.cachedJSON(w, cacheKey, "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
		time.Hour, 6*time.Hour,
		func(ctx context.Context) (any, error) {
			u := "https://api.worldbank.org/v2/country/" + countryList + "/indicator/" + indicator +
				"?format=json&date=" + itoa(cur-years) + ":" + itoa(cur) + "&per_page=1000"
			b, status, err := s.get(ctx, u, map[string]string{"Accept": "application/json", "User-Agent": browserUA})
			if err != nil {
				return nil, err
			}
			if status < 200 || status >= 300 {
				return nil, httpErr(status)
			}
			return reshapeWorldBank(b, indicator), nil
		},
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "indicator": indicator})
		})
}

func reshapeWorldBank(body []byte, indicator string) map[string]any {
	empty := map[string]any{
		"indicator": indicator, "indicatorName": wbName(indicator, ""),
		"metadata": map[string]any{"page": 1, "pages": 1, "total": 0},
		"byCountry": map[string]any{}, "latestByCountry": map[string]any{}, "timeSeries": []any{},
	}
	var pair []json.RawMessage
	if err := json.Unmarshal(body, &pair); err != nil || len(pair) < 2 {
		return empty
	}
	var meta struct {
		Page, Pages, Total int
	}
	_ = decodeNumberInto(pair[0], &meta)
	var records []struct {
		CountryISO3 string          `json:"countryiso3code"`
		Country     struct{ ID, Value string } `json:"country"`
		Date        string          `json:"date"`
		Value       *float64        `json:"value"`
		Indicator   struct{ Value string } `json:"indicator"`
	}
	if err := json.Unmarshal(pair[1], &records); err != nil || len(records) == 0 {
		return empty
	}
	byCountry := map[string]map[string]any{}
	latest := map[string]map[string]any{}
	var timeSeries []map[string]any
	indName := wbName(indicator, records[0].Indicator.Value)
	for _, rec := range records {
		code := rec.CountryISO3
		if code == "" {
			code = rec.Country.ID
		}
		if code == "" || rec.Value == nil {
			continue
		}
		name := rec.Country.Value
		if byCountry[code] == nil {
			byCountry[code] = map[string]any{"code": code, "name": name, "values": []map[string]any{}}
		}
		byCountry[code]["values"] = append(byCountry[code]["values"].([]map[string]any), map[string]any{"year": rec.Date, "value": *rec.Value})
		if cur, ok := latest[code]; !ok || rec.Date > asString(cur["year"]) {
			latest[code] = map[string]any{"code": code, "name": name, "year": rec.Date, "value": *rec.Value}
		}
		timeSeries = append(timeSeries, map[string]any{"countryCode": code, "countryName": name, "year": rec.Date, "value": *rec.Value})
	}
	for _, c := range byCountry {
		vals := c["values"].([]map[string]any)
		sort.SliceStable(vals, func(i, j int) bool { return asString(vals[i]["year"]) < asString(vals[j]["year"]) })
	}
	sort.SliceStable(timeSeries, func(i, j int) bool {
		if timeSeries[i]["year"] != timeSeries[j]["year"] {
			return asString(timeSeries[i]["year"]) > asString(timeSeries[j]["year"])
		}
		return asString(timeSeries[i]["countryCode"]) < asString(timeSeries[j]["countryCode"])
	})
	return map[string]any{
		"indicator": indicator, "indicatorName": indName,
		"metadata":  map[string]any{"page": meta.Page, "pages": meta.Pages, "total": meta.Total},
		"byCountry": toAnyMap(byCountry), "latestByCountry": toAnyMap(latest), "timeSeries": timeSeries,
	}
}

func wbName(indicator, fallback string) string {
	if n, ok := wbIndicators[indicator]; ok {
		return n
	}
	if fallback != "" {
		return fallback
	}
	return indicator
}

// ── EIA (energy series) ──────────────────────────────────────────────────────

var eiaSeries = map[string]string{
	"wti": "PET.RWTC.W", "brent": "PET.RBRTE.W", "production": "PET.WCRFPUS2.W", "inventory": "PET.WCESTUS1.W",
}

// handleEIA serves the EIA energy sub-router. Ported from api/eia/[[...path]].js.
func (s *Server) handleEIA(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	key := env("EIA_API_KEY")
	if key == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"configured": false, "skipped": true, "reason": "EIA_API_KEY not configured"})
		return
	}
	path := trimPrefix(r.URL.Path, "/v1/world/eia")
	switch path {
	case "", "/", "/health":
		writeJSON(w, http.StatusOK, "", map[string]any{"configured": true})
	case "/petroleum":
		s.cachedJSON(w, "eia:petroleum", "public, max-age=1800, s-maxage=1800, stale-while-revalidate=300",
			30*time.Minute, 2*time.Hour,
			func(ctx context.Context) (any, error) { return s.eiaPetroleum(ctx, key) },
			func(w http.ResponseWriter, err error) { writeError(w, http.StatusInternalServerError, "Failed to fetch EIA data") })
	default:
		writeError(w, http.StatusNotFound, "Not found")
	}
}

func (s *Server) eiaPetroleum(ctx context.Context, key string) (any, error) {
	out := map[string]any{}
	var mu sync.Mutex
	runParallelKV(eiaSeries, func(name, id string) {
		var resp struct {
			Response struct {
				Data []struct {
					Period string   `json:"period"`
					Value  *float64 `json:"value"`
					Units  string   `json:"units"`
				} `json:"data"`
			} `json:"response"`
		}
		u := "https://api.eia.gov/v2/seriesid/" + id + "?api_key=" + key + "&num=2"
		if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json"}, &resp); err != nil {
			return
		}
		d := resp.Response.Data
		if len(d) == 0 || d[0].Value == nil {
			return
		}
		prev := *d[0].Value
		if len(d) > 1 && d[1].Value != nil {
			prev = *d[1].Value
		}
		mu.Lock()
		out[name] = map[string]any{"current": *d[0].Value, "previous": prev, "date": d[0].Period, "unit": d[0].Units}
		mu.Unlock()
	})
	return out, nil
}

// ── UNHCR (forced displacement) ──────────────────────────────────────────────

var unhcrCentroids = map[string][2]float64{
	"AFG": {33.9, 67.7}, "SYR": {35.0, 38.0}, "UKR": {48.4, 31.2}, "SDN": {15.5, 32.5},
	"SSD": {6.9, 31.3}, "SOM": {5.2, 46.2}, "COD": {-4.0, 21.8}, "MMR": {19.8, 96.7},
	"YEM": {15.6, 48.5}, "ETH": {9.1, 40.5}, "VEN": {6.4, -66.6}, "IRQ": {33.2, 43.7},
	"COL": {4.6, -74.1}, "NGA": {9.1, 7.5}, "PSE": {31.9, 35.2}, "TUR": {39.9, 32.9},
	"DEU": {51.2, 10.4}, "PAK": {30.4, 69.3}, "UGA": {1.4, 32.3}, "BGD": {23.7, 90.4},
	"KEN": {0.0, 38.0}, "TCD": {15.5, 19.0}, "JOR": {31.0, 36.0}, "LBN": {33.9, 35.5},
	"EGY": {26.8, 30.8}, "IRN": {32.4, 53.7}, "TZA": {-6.4, 34.9}, "RWA": {-1.9, 29.9},
	"CMR": {7.4, 12.4}, "MLI": {17.6, -4.0}, "BFA": {12.3, -1.6}, "NER": {17.6, 8.1},
	"CAF": {6.6, 20.9}, "MOZ": {-18.7, 35.5}, "USA": {37.1, -95.7}, "FRA": {46.2, 2.2},
	"GBR": {55.4, -3.4}, "IND": {20.6, 79.0}, "CHN": {35.9, 104.2}, "RUS": {61.5, 105.3},
}

// handleUNHCR aggregates UNHCR forced-displacement stats by origin/asylum with
// top flows. Ported from api/unhcr-population.js.
func (s *Server) handleUNHCR(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "unhcr:population:v2",
		"public, max-age=3600, s-maxage=3600, stale-while-revalidate=600", 24*time.Hour, 24*time.Hour,
		func(ctx context.Context) (any, error) { return s.unhcrAggregate(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{"error": err.Error(), "countries": []any{}, "topFlows": []any{}})
		})
}

func (s *Server) unhcrAggregate(ctx context.Context) (any, error) {
	type agg struct{ refugees, asylum, idps, stateless float64; name string }
	byOrigin := map[string]*agg{}
	byAsylum := map[string]*agg{}
	type flow struct{ originCode, originName, asylumCode, asylumName string; refugees float64 }
	flows := map[string]*flow{}
	var tR, tA, tI, tS float64

	year := time.Now().Year()
	usedYear := year
	var items []map[string]any
	for y := year; y >= year-2; y-- {
		it, err := s.unhcrYear(ctx, y)
		if err != nil {
			continue
		}
		items = it
		if len(it) > 0 {
			usedYear = y
			break
		}
	}
	for _, item := range items {
		oc := asString(mapGet(item, "coo_iso"))
		ac := asString(mapGet(item, "coa_iso"))
		ref := asFloat(mapGet(item, "refugees"))
		asy := asFloat(mapGet(item, "asylum_seekers"))
		idp := asFloat(mapGet(item, "idps"))
		stl := asFloat(mapGet(item, "stateless"))
		tR += ref
		tA += asy
		tI += idp
		tS += stl
		if oc != "" {
			o := byOrigin[oc]
			if o == nil {
				o = &agg{name: firstNonEmpty(asString(mapGet(item, "coo_name")), oc)}
				byOrigin[oc] = o
			}
			o.refugees += ref
			o.asylum += asy
			o.idps += idp
			o.stateless += stl
		}
		if ac != "" {
			a := byAsylum[ac]
			if a == nil {
				a = &agg{name: firstNonEmpty(asString(mapGet(item, "coa_name")), ac)}
				byAsylum[ac] = a
			}
			a.refugees += ref
			a.asylum += asy
		}
		if oc != "" && ac != "" && ref > 0 {
			k := oc + "->" + ac
			f := flows[k]
			if f == nil {
				f = &flow{oc, firstNonEmpty(asString(mapGet(item, "coo_name")), oc), ac, firstNonEmpty(asString(mapGet(item, "coa_name")), ac), 0}
				flows[k] = f
			}
			f.refugees += ref
		}
	}

	countries := map[string]map[string]any{}
	for code, d := range byOrigin {
		c := map[string]any{
			"code": code, "name": d.name, "refugees": d.refugees, "asylumSeekers": d.asylum,
			"idps": d.idps, "stateless": d.stateless,
			"totalDisplaced": d.refugees + d.asylum + d.idps + d.stateless,
			"hostRefugees":   0.0, "hostAsylumSeekers": 0.0, "hostTotal": 0.0,
		}
		if ce, ok := unhcrCentroids[code]; ok {
			c["lat"], c["lon"] = ce[0], ce[1]
		}
		countries[code] = c
	}
	for code, d := range byAsylum {
		hostTotal := d.refugees + d.asylum
		if c, ok := countries[code]; ok {
			c["hostRefugees"], c["hostAsylumSeekers"], c["hostTotal"] = d.refugees, d.asylum, hostTotal
		} else {
			c := map[string]any{
				"code": code, "name": d.name, "refugees": 0.0, "asylumSeekers": 0.0, "idps": 0.0, "stateless": 0.0,
				"totalDisplaced": 0.0, "hostRefugees": d.refugees, "hostAsylumSeekers": d.asylum, "hostTotal": hostTotal,
			}
			if ce, ok := unhcrCentroids[code]; ok {
				c["lat"], c["lon"] = ce[0], ce[1]
			}
			countries[code] = c
		}
	}

	flowList := make([]*flow, 0, len(flows))
	for _, f := range flows {
		flowList = append(flowList, f)
	}
	sort.SliceStable(flowList, func(i, j int) bool { return flowList[i].refugees > flowList[j].refugees })
	if len(flowList) > 50 {
		flowList = flowList[:50]
	}
	topFlows := make([]map[string]any, 0, len(flowList))
	for _, f := range flowList {
		m := map[string]any{"originCode": f.originCode, "originName": f.originName, "asylumCode": f.asylumCode, "asylumName": f.asylumName, "refugees": f.refugees}
		if ce, ok := unhcrCentroids[f.originCode]; ok {
			m["originLat"], m["originLon"] = ce[0], ce[1]
		}
		if ce, ok := unhcrCentroids[f.asylumCode]; ok {
			m["asylumLat"], m["asylumLon"] = ce[0], ce[1]
		}
		topFlows = append(topFlows, m)
	}

	countryList := make([]map[string]any, 0, len(countries))
	for _, c := range countries {
		countryList = append(countryList, c)
	}
	sort.SliceStable(countryList, func(i, j int) bool {
		return maxf(asFloat(countryList[i]["totalDisplaced"]), asFloat(countryList[i]["hostTotal"])) >
			maxf(asFloat(countryList[j]["totalDisplaced"]), asFloat(countryList[j]["hostTotal"]))
	})

	return map[string]any{
		"success": true, "year": usedYear,
		"globalTotals": map[string]any{"refugees": tR, "asylumSeekers": tA, "idps": tI, "stateless": tS, "total": tR + tA + tI + tS},
		"countries":    countryList, "topFlows": topFlows, "cached_at": nowISO(),
	}, nil
}

func (s *Server) unhcrYear(ctx context.Context, year int) ([]map[string]any, error) {
	const limit = 10000
	var items []map[string]any
	for page := 1; page <= 25; page++ {
		var data struct {
			Items    []map[string]any `json:"items"`
			MaxPages json.Number      `json:"maxPages"`
		}
		u := "https://api.unhcr.org/population/v1/population/?year=" + itoa(year) + "&limit=" + itoa(limit) + "&page=" + itoa(page)
		if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json"}, &data); err != nil {
			return nil, err
		}
		if len(data.Items) == 0 {
			break
		}
		items = append(items, data.Items...)
		if mp, err := data.MaxPages.Int64(); err == nil && mp > 0 {
			if int64(page) >= mp {
				break
			}
			continue
		}
		if len(data.Items) < limit {
			break
		}
	}
	return items, nil
}

// ── WorldPop (population exposure) ───────────────────────────────────────────

type popCountry struct {
	name      string
	pop, area float64
}

var priorityCountries = map[string]popCountry{
	"UKR": {"Ukraine", 37000000, 603550}, "RUS": {"Russia", 144100000, 17098242}, "ISR": {"Israel", 9800000, 22072},
	"PSE": {"Palestine", 5400000, 6020}, "SYR": {"Syria", 22100000, 185180}, "IRN": {"Iran", 88600000, 1648195},
	"TWN": {"Taiwan", 23600000, 36193}, "ETH": {"Ethiopia", 126500000, 1104300}, "SDN": {"Sudan", 48100000, 1861484},
	"SSD": {"South Sudan", 11400000, 619745}, "SOM": {"Somalia", 18100000, 637657}, "YEM": {"Yemen", 34400000, 527968},
	"AFG": {"Afghanistan", 42200000, 652230}, "PAK": {"Pakistan", 240500000, 881913}, "IND": {"India", 1428600000, 3287263},
	"MMR": {"Myanmar", 54200000, 676578}, "COD": {"DR Congo", 102300000, 2344858}, "NGA": {"Nigeria", 223800000, 923768},
	"MLI": {"Mali", 22600000, 1240192}, "BFA": {"Burkina Faso", 22700000, 274200},
}

var worldpopCentroids = map[string][2]float64{
	"UKR": {48.4, 31.2}, "RUS": {61.5, 105.3}, "ISR": {31.0, 34.8}, "PSE": {31.9, 35.2}, "SYR": {35.0, 38.0},
	"IRN": {32.4, 53.7}, "TWN": {23.7, 121.0}, "ETH": {9.1, 40.5}, "SDN": {15.5, 32.5}, "SSD": {6.9, 31.3},
	"SOM": {5.2, 46.2}, "YEM": {15.6, 48.5}, "AFG": {33.9, 67.7}, "PAK": {30.4, 69.3}, "IND": {20.6, 79.0},
	"MMR": {19.8, 96.7}, "COD": {-4.0, 21.8}, "NGA": {9.1, 7.5}, "MLI": {17.6, -4.0}, "BFA": {12.3, -1.6},
}

// handleWorldPop serves priority-country densities or a radius exposure
// estimate. Ported from api/worldpop-exposure.js (fully hardcoded, no upstream).
func (s *Server) handleWorldPop(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := r.URL.Query()
	if q.Get("mode") == "exposure" {
		lat, errLat := strconv.ParseFloat(q.Get("lat"), 64)
		lon, errLon := strconv.ParseFloat(q.Get("lon"), 64)
		if errLat != nil || errLon != nil {
			writeError(w, http.StatusBadRequest, "lat and lon required")
			return
		}
		radius := 50.0
		if v, err := strconv.ParseFloat(q.Get("radius"), 64); err == nil && v != 0 {
			radius = v
		}
		best, bestDist := "", math.Inf(1)
		for code, c := range worldpopCentroids {
			d := math.Hypot(lat-c[0], lon-c[1])
			if d < bestDist {
				bestDist, best = d, code
			}
		}
		info, ok := priorityCountries[best]
		if !ok {
			info = popCountry{pop: 50000000, area: 500000}
		}
		density := info.pop / info.area
		exposed := math.Round(density * math.Pi * radius * radius)
		writeJSON(w, http.StatusOK, "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
			map[string]any{"success": true, "exposedPopulation": exposed, "exposureRadiusKm": radius, "nearestCountry": best, "densityPerKm2": math.Round(density)})
		return
	}
	// mode=countries
	countries := make([]map[string]any, 0, len(priorityCountries))
	for code, info := range priorityCountries {
		countries = append(countries, map[string]any{
			"code": code, "name": info.name, "population": info.pop, "densityPerKm2": math.Round(info.pop / info.area),
		})
	}
	sort.SliceStable(countries, func(i, j int) bool { return asString(countries[i]["code"]) < asString(countries[j]["code"]) })
	writeJSON(w, http.StatusOK, "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
		map[string]any{"success": true, "countries": countries, "cached_at": nowISO()})
}

// ── small helpers ────────────────────────────────────────────────────────────

func mapKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func toAnyMap(m map[string]map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func decodeNumberInto(b []byte, v any) error { return json.Unmarshal(b, v) }

func runParallelKV(m map[string]string, fn func(k, v string)) {
	fns := make([]func(), 0, len(m))
	for k, v := range m {
		k, v := k, v
		fns = append(fns, func() { fn(k, v) })
	}
	runParallel(fns...)
}
