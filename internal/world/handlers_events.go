package world

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// handlers_events.go is the AI-plane event aggregator: the ONE place that maps
// the backend's existing per-source fetchers into the canonical ZAP topic
// records the world-gw MCP/ZAP gateway (~/work/hanzo/world-zap) ingests.
//
//	GET /v1/world/events            → {"events":[<record>...]}  (snapshot poll)
//	GET /v1/world/events?stream=1   → long-lived NDJSON stream of <record> lines
//
// A record is {"topic":"<name>","payload":{...}}. Every specific record is ALSO
// emitted on world.events.all in stream mode (the gw hub fans that topic out to
// "everything" subscribers). The aggregator NEVER opens a second fetcher for a
// source: each producer is a thin, cache-first projection over the exact cache
// key + upstream its sibling handler already uses (so warm hits are shared and
// the two can never drift), and honestly emits nothing when a source is cold or
// unconfigured — no fabricated records.

// Canonical ZAP topics. This list MUST match the world-gw hub catalog
// (world-zap/hub/hub.go); the gw rejects any topic outside it. It is duplicated
// here (not imported) because the backend and the gw are separate binaries — the
// wire contract is the shared surface, not a Go package.
const (
	topicAll         = "world.events.all"
	topicConflicts   = "world.events.conflicts"
	topicEarthquakes = "world.events.earthquakes"
	topicFires       = "world.events.fires"
	topicQuotes      = "world.markets.quotes"
	topicCrypto      = "world.markets.crypto"
	topicAIS         = "world.ships.ais"
	topicOpenSky     = "world.aviation.opensky"
	topicNews        = "world.news.live"
	topicWeather     = "world.weather.alerts"
)

// zapTopics is the canonical catalog in stable order (mirrors hub.TopicNames()).
var zapTopics = []string{
	topicAll, topicConflicts, topicEarthquakes, topicFires,
	topicQuotes, topicCrypto, topicAIS, topicOpenSky, topicNews, topicWeather,
}

// layerTopics maps a caller-supplied ?layers= name to the topic(s) it selects.
// Unknown layer names simply select nothing (ignored gracefully).
var layerTopics = map[string][]string{
	"conflicts":   {topicConflicts},
	"conflict":    {topicConflicts},
	"earthquakes": {topicEarthquakes},
	"quakes":      {topicEarthquakes},
	"fires":       {topicFires},
	"fire":        {topicFires},
	"weather":     {topicWeather},
	"alerts":      {topicWeather},
	"news":        {topicNews},
	"markets":     {topicQuotes, topicCrypto},
	"quotes":      {topicQuotes},
	"crypto":      {topicCrypto},
}

// eventRecord is one aggregated event before it is written to the wire. ID is a
// stable per-source identity (dedupe key for the stream); TS drives ?since= and
// newest-first ordering; Payload is the JSON object emitted under Topic.
type eventRecord struct {
	Topic   string
	ID      string
	TS      time.Time
	Payload map[string]any
}

// mkRecord builds a record, stamping id/ts/topic into a FRESH payload so the
// consumer always has provenance and the caller can never alias a shared map.
func mkRecord(topic, id string, ts time.Time, fields map[string]any) eventRecord {
	p := make(map[string]any, len(fields)+3)
	for k, v := range fields {
		p[k] = v
	}
	p["id"] = id
	p["ts"] = ts.UTC().Format(time.RFC3339)
	p["topic"] = topic
	return eventRecord{Topic: topic, ID: id, TS: ts, Payload: p}
}

// ── cache-first snapshot readers (value + bytes twins of cachedJSON/passthrough)
//
// The aggregator needs the produced VALUE, not an HTTP response, so it reads the
// shared cache directly. Both readers are cache-first and single-flighted on a
// cold miss, and share the exact keys the sibling handlers write.

// snapshotJSON returns the cached value for key, producing+caching it on a cold
// miss (falling back to a stale value if produce fails).
func (s *Server) snapshotJSON(ctx context.Context, key string, ttl, staleFor time.Duration, produce func(context.Context) (any, error)) (any, bool) {
	if v, ok := s.cache.Get(key); ok {
		return v, true
	}
	v, err := s.flight.do(key, func() (any, error) {
		vv, e := produce(ctx)
		if e != nil {
			return nil, e
		}
		s.cache.Set(key, vv, ttl, staleFor)
		return vv, nil
	})
	if err != nil {
		if sv, ok := s.cache.GetStale(key); ok {
			return sv, true
		}
		return nil, false
	}
	return v, true
}

// snapshotBytes returns cached upstream bytes for key, fetching+caching on a cold
// miss via the shared fetchAndCache policy. Used for the byte-passthrough sources
// (USGS quakes, CoinGecko) so this reader and the passthrough handler share a key.
func (s *Server) snapshotBytes(ctx context.Context, key, upstream string, headers map[string]string, ttl, staleFor time.Duration) ([]byte, bool) {
	if v, ok := s.cache.Get(key); ok {
		if b, ok2 := v.([]byte); ok2 {
			return b, true
		}
	}
	b, err := s.fetchAndCache(ctx, key, upstream, headers, ttl, staleFor)
	if err != nil {
		if v, ok := s.cache.GetStale(key); ok {
			if sb, ok2 := v.([]byte); ok2 {
				return sb, true
			}
		}
		return nil, false
	}
	return b, true
}

// readWarm returns a cached value ONLY if it is already warm (or stale) — never
// fetches. Used for the heavy / key-gated layers (fires, weather) so the
// aggregator projects them when their panel/warmer has populated the cache and
// stays silent (honestly empty) otherwise, instead of triggering an expensive
// multi-fetch on the event path.
func (s *Server) readWarm(key string) (any, bool) {
	if v, ok := s.cache.Get(key); ok {
		return v, true
	}
	return s.cache.GetStale(key)
}

// ── per-source producers ─────────────────────────────────────────────────────
//
// Each returns the CURRENT set of records for one topic. They are the single
// source of truth reused by both the aggregator and the sibling endpoints
// (/v1/world/{conflicts,news,markets}).

// conflictRecords projects the UCDP GED events (the same value handleUCDPEvents
// caches) into world.events.conflicts records.
func (s *Server) conflictRecords(ctx context.Context) []eventRecord {
	v, ok := s.snapshotJSON(ctx, "ucdp:gedevents:v2", 6*time.Hour, 6*time.Hour,
		func(c context.Context) (any, error) { return s.fetchUCDPEvents(c) })
	if !ok {
		return nil
	}
	rows := sliceOfMaps(mapGet(mapOf(v), "data"))
	out := make([]eventRecord, 0, len(rows))
	for _, e := range rows {
		id := asString(mapGet(e, "id"))
		if id == "" {
			continue
		}
		ts := parseAnyTime(asString(mapGet(e, "date_start")))
		deaths := asInt(mapGet(e, "deaths_best"))
		out = append(out, mkRecord(topicConflicts, "ucdp:"+id, ts, map[string]any{
			"country":          mapGet(e, "country"),
			"side_a":           mapGet(e, "side_a"),
			"side_b":           mapGet(e, "side_b"),
			"deaths":           deaths,
			"lat":              mapGet(e, "latitude"),
			"lon":              mapGet(e, "longitude"),
			"type_of_violence": mapGet(e, "type_of_violence"),
			"date":             mapGet(e, "date_start"),
			"severity":         conflictSeverity(deaths),
			"source":           "ucdp-ged",
		}))
	}
	return out
}

// conflictSeverity buckets an event by best-estimate fatalities. Thresholds match
// the gw's minor|major|critical vocabulary.
func conflictSeverity(deaths int) string {
	switch {
	case deaths >= 25:
		return "critical"
	case deaths >= 5:
		return "major"
	default:
		return "minor"
	}
}

const usgsQuakeFeed = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"

// earthquakeRecords projects the USGS 4.5+/day GeoJSON (same key handleEarthquakes
// caches) into world.events.earthquakes records.
func (s *Server) earthquakeRecords(ctx context.Context) []eventRecord {
	b, ok := s.snapshotBytes(ctx, "earthquakes:4.5_day", usgsQuakeFeed,
		map[string]string{"Accept": "application/json"}, 5*time.Minute, 30*time.Minute)
	if !ok {
		return nil
	}
	var fc struct {
		Features []struct {
			ID   string `json:"id"`
			Prop struct {
				Mag   float64 `json:"mag"`
				Place string  `json:"place"`
				Time  int64   `json:"time"`
				URL   string  `json:"url"`
			} `json:"properties"`
			Geom struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if json.Unmarshal(b, &fc) != nil {
		return nil
	}
	out := make([]eventRecord, 0, len(fc.Features))
	for _, f := range fc.Features {
		if f.ID == "" {
			continue
		}
		lon, lat, depth := 0.0, 0.0, 0.0
		if len(f.Geom.Coordinates) >= 2 {
			lon, lat = f.Geom.Coordinates[0], f.Geom.Coordinates[1]
		}
		if len(f.Geom.Coordinates) >= 3 {
			depth = f.Geom.Coordinates[2]
		}
		ts := time.UnixMilli(f.Prop.Time).UTC()
		out = append(out, mkRecord(topicEarthquakes, "quake:"+f.ID, ts, map[string]any{
			"magnitude": f.Prop.Mag,
			"place":     f.Prop.Place,
			"lat":       lat,
			"lon":       lon,
			"depth_km":  depth,
			"url":       f.Prop.URL,
			"source":    "usgs",
		}))
	}
	return out
}

// fireRecords projects the warm NASA FIRMS aggregate (populated by handleFIRMS /
// the fires panel) into world.events.fires records. Key-gated and heavy, so it is
// read-warm-only: no records until that layer is active — never fabricated.
func (s *Server) fireRecords() []eventRecord {
	v, ok := s.readWarm("firms::1")
	if !ok {
		return nil
	}
	regions := mapOf(mapGet(mapOf(v), "regions"))
	out := make([]eventRecord, 0, 64)
	for region, list := range regions {
		for _, fr := range sliceOfMaps(list) {
			lat := asFloat(mapGet(fr, "lat"))
			lon := asFloat(mapGet(fr, "lon"))
			acq := asString(mapGet(fr, "acq_date"))
			id := "fire:" + region + ":" + fkey(lat) + "," + fkey(lon) + ":" + acq + asString(mapGet(fr, "acq_time"))
			out = append(out, mkRecord(topicFires, id, parseAnyTime(acq), map[string]any{
				"region":     region,
				"lat":        lat,
				"lon":        lon,
				"brightness": mapGet(fr, "brightness"),
				"confidence": mapGet(fr, "confidence"),
				"frp":        mapGet(fr, "frp"),
				"acq_date":   acq,
				"source":     "nasa-firms",
			}))
		}
	}
	return out
}

// weatherRecords projects warm climate anomalies (populated by handleClimate / the
// climate panel) into world.weather.alerts records, keeping only moderate/extreme
// zones — the ones that read as an alert. Read-warm-only (15-zone compute), never
// fabricated.
func (s *Server) weatherRecords() []eventRecord {
	v, ok := s.readWarm("climate:anomalies:v1")
	if !ok {
		return nil
	}
	zones := sliceOfMaps(mapGet(mapOf(v), "anomalies"))
	now := time.Now().UTC()
	out := make([]eventRecord, 0, len(zones))
	for _, z := range zones {
		sev := asString(mapGet(z, "severity"))
		if sev != "moderate" && sev != "extreme" {
			continue
		}
		zone := asString(mapGet(z, "zone"))
		out = append(out, mkRecord(topicWeather, "weather:"+zone+":"+dateOnly(now), now, map[string]any{
			"zone":        zone,
			"lat":         mapGet(z, "lat"),
			"lon":         mapGet(z, "lon"),
			"severity":    sev,
			"kind":        mapGet(z, "type"),
			"tempDelta":   mapGet(z, "tempDelta"),
			"precipDelta": mapGet(z, "precipDelta"),
			"source":      "open-meteo",
		}))
	}
	return out
}

// newsRecords projects the curated-feed news snapshot (world category) into
// world.news.live records.
func (s *Server) newsRecords(ctx context.Context) []eventRecord {
	items := s.newsSnapshot(ctx, "world", 40)
	out := make([]eventRecord, 0, len(items))
	for _, it := range items {
		id := it.Link
		if id == "" {
			id = "news:" + it.Title
		}
		ts := parseAnyTime(it.PubDate)
		if ts.IsZero() {
			ts = time.Now().UTC()
		}
		out = append(out, mkRecord(topicNews, "news:"+id, ts, map[string]any{
			"title":   it.Title,
			"link":    it.Link,
			"pubDate": it.PubDate,
			"tickers": it.Tickers,
			"category": "world",
			"source":  "rss",
		}))
	}
	return out
}

// cryptoRecords projects the CoinGecko crypto snapshot into world.markets.crypto
// records.
func (s *Server) cryptoRecords(ctx context.Context) []eventRecord {
	quotes := s.cryptoSnapshot(ctx, "")
	now := time.Now().UTC()
	out := make([]eventRecord, 0, len(quotes))
	for _, q := range quotes {
		sym := asString(mapGet(q, "symbol"))
		out = append(out, mkRecord(topicCrypto, "crypto:"+sym, now, cloneQuote(q)))
	}
	return out
}

// quoteRecords projects the equity-index quote snapshot into world.markets.quotes
// records.
func (s *Server) quoteRecords(ctx context.Context) []eventRecord {
	quotes := s.quotesSnapshot(ctx, "equities", "")
	now := time.Now().UTC()
	out := make([]eventRecord, 0, len(quotes))
	for _, q := range quotes {
		sym := asString(mapGet(q, "symbol"))
		out = append(out, mkRecord(topicQuotes, "quote:"+sym, now, cloneQuote(q)))
	}
	return out
}

func cloneQuote(q map[string]any) map[string]any {
	c := make(map[string]any, len(q))
	for k, v := range q {
		c[k] = v
	}
	return c
}

// producer is a topic + its record source. topicProducers is the single table the
// aggregator walks; adding a topic means adding one row here.
type producer struct {
	topic string
	fn    func(ctx context.Context) []eventRecord
}

func (s *Server) topicProducers() []producer {
	return []producer{
		{topicConflicts, s.conflictRecords},
		{topicEarthquakes, s.earthquakeRecords},
		{topicFires, func(context.Context) []eventRecord { return s.fireRecords() }},
		{topicWeather, func(context.Context) []eventRecord { return s.weatherRecords() }},
		{topicNews, s.newsRecords},
		{topicCrypto, s.cryptoRecords},
		{topicQuotes, s.quoteRecords},
	}
}

// aggregateSnapshot runs every producer whose topic is selected by want (nil =
// all), concurrently, and returns the merged records newest-first. A slow or
// failing producer contributes nothing; it never fails the aggregate.
func (s *Server) aggregateSnapshot(ctx context.Context, want map[string]bool) []eventRecord {
	prods := s.topicProducers()
	results := make([][]eventRecord, len(prods))
	done := make(chan int, len(prods))
	live := 0
	for i, p := range prods {
		if want != nil && !want[p.topic] {
			continue
		}
		live++
		go func(i int, fn func(context.Context) []eventRecord) {
			defer func() {
				if r := recover(); r != nil {
					logf("world-events: producer panic: %v", r)
				}
				done <- i
			}()
			results[i] = fn(ctx)
		}(i, p.fn)
	}
	for k := 0; k < live; k++ {
		<-done
	}
	var out []eventRecord
	for _, rs := range results {
		out = append(out, rs...)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TS.After(out[j].TS) })
	return out
}

// ── /v1/world/events ─────────────────────────────────────────────────────────

// handleEvents is the aggregate event surface. Poll mode returns a snapshot;
// ?stream=1 opens a long-lived NDJSON stream. Public read (same as its siblings).
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	q := parseEventQuery(r)
	if r.URL.Query().Get("stream") == "1" || r.URL.Query().Get("stream") == "true" {
		s.streamEvents(w, r, q)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	recs := s.aggregateSnapshot(ctx, q.topics)
	events := make([]map[string]any, 0, q.limit)
	for _, rec := range recs {
		if !q.match(rec) {
			continue
		}
		events = append(events, map[string]any{"topic": rec.Topic, "payload": rec.Payload})
		if len(events) >= q.limit {
			break
		}
	}
	writeJSON(w, http.StatusOK, "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
		map[string]any{"events": events, "count": len(events), "asOf": nowISO()})
}

// streamEvents emits the current snapshot then re-polls the sources on a sane
// interval, emitting only NEW records (deduped by stable id) as NDJSON lines. Each
// specific record is mirrored onto world.events.all. A blank-line keepalive every
// ~25s keeps proxies from cutting an idle connection. Honors ctx cancellation.
func (s *Server) streamEvents(w http.ResponseWriter, r *http.Request, q eventQuery) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/x-ndjson")
	h.Set("Cache-Control", "no-store")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // ask any reverse proxy not to buffer
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx := r.Context()
	seen := make(map[string]bool, 512)

	writeLine := func(topic string, payload map[string]any) bool {
		b, err := json.Marshal(map[string]any{"topic": topic, "payload": payload})
		if err != nil {
			return true
		}
		if _, err := w.Write(append(b, '\n')); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	emit := func(recs []eventRecord) bool {
		if len(seen) > 8192 { // bound memory on a very long-lived stream
			seen = make(map[string]bool, 512)
		}
		for _, rec := range recs {
			if !q.match(rec) || seen[rec.ID] {
				continue
			}
			seen[rec.ID] = true
			if !writeLine(rec.Topic, rec.Payload) {
				return false
			}
			if rec.Topic != topicAll { // mirror onto world.events.all
				if !writeLine(topicAll, rec.Payload) {
					return false
				}
			}
		}
		return true
	}

	poll := func() bool {
		cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		return emit(s.aggregateSnapshot(cctx, q.topics))
	}

	if !poll() { // initial snapshot
		return
	}
	pollTick := time.NewTicker(30 * time.Second)
	defer pollTick.Stop()
	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTick.C:
			if !poll() {
				return
			}
		case <-keepalive.C:
			if _, err := w.Write([]byte("\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ── query parsing / filtering ────────────────────────────────────────────────

type eventQuery struct {
	region string
	topics map[string]bool // nil = all topics
	since  time.Time       // zero = no lower bound
	limit  int
}

func parseEventQuery(r *http.Request) eventQuery {
	q := r.URL.Query()
	out := eventQuery{
		region: strings.ToLower(strings.TrimSpace(q.Get("region"))),
		limit:  clampInt(q.Get("limit"), 50, 1, 500),
	}
	if l := strings.TrimSpace(q.Get("layers")); l != "" {
		// An explicit layers filter is authoritative: when it is present we always
		// bind out.topics (to the resolved set, possibly empty), so an all-unknown
		// filter selects NOTHING rather than silently falling through to "all".
		topics := map[string]bool{}
		for _, name := range strings.Split(l, ",") {
			for _, t := range layerTopics[strings.ToLower(strings.TrimSpace(name))] {
				topics[t] = true
			}
		}
		out.topics = topics
	}
	if s := strings.TrimSpace(q.Get("since")); s != "" {
		out.since = parseAnyTime(s)
	}
	return out
}

// match reports whether a record passes the region + since filters. (The topic
// filter is applied earlier, when selecting producers.)
func (q eventQuery) match(rec eventRecord) bool {
	if !q.since.IsZero() && rec.TS.Before(q.since) {
		return false
	}
	if q.region != "" && !recordMatchesRegion(rec.Payload, q.region) {
		return false
	}
	return true
}

// regionKeys are the payload fields a region hint is matched against (substring,
// case-insensitive).
var regionKeys = []string{"country", "place", "name", "title", "zone", "region"}

func recordMatchesRegion(payload map[string]any, region string) bool {
	for _, k := range regionKeys {
		if v := asString(mapGet(payload, k)); v != "" && strings.Contains(strings.ToLower(v), region) {
			return true
		}
	}
	return false
}

// ── small coercion + time helpers ────────────────────────────────────────────

// mapOf coerces a decoded value to a JSON object, or nil.
func mapOf(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// sliceOfMaps coerces a decoded value to a slice of JSON objects, tolerating both
// the in-memory ([]map[string]any) and JSON-decoded ([]any) shapes.
func sliceOfMaps(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, e := range t {
			if m, ok := e.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// parseAnyTime parses the assorted date formats the upstreams emit (RFC3339,
// date-only, "YYYY-MM-DD HH:MM:SS"), returning the zero time when unparseable.
func parseAnyTime(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02", "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

// fkey formats a coordinate to a stable 4-dp string for dedupe ids.
func fkey(f float64) string {
	return strconv.FormatFloat(math.Round(f*1e4)/1e4, 'f', -1, 64)
}
