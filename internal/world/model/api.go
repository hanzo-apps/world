package model

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// The query surface: GET /v1/world/model/*. Every response is the same envelope
// {v, asOf, …}. Reads are public today (all data derives from public sources);
// gate() is the ONE place a pro-tier org check attaches when that changes.

const countryPrefix = "/v1/world/model/country/"

// Mount registers the model routes on any registrar (the world mux). Kept as a
// method set so package world wires them exactly like every other route.
func (e *Engine) Mount(reg interface {
	HandleFunc(string, func(http.ResponseWriter, *http.Request))
}) {
	reg.HandleFunc("/v1/world/model/state", e.handleState)
	reg.HandleFunc("/v1/world/model/top", e.handleTop)
	reg.HandleFunc("/v1/world/model/changes", e.handleChanges)
	reg.HandleFunc("/v1/world/model/stream", e.handleStream)
	reg.HandleFunc(countryPrefix, e.handleCountry)
}

// gate is the single authorization point for the model API. Reads are public
// now, so it always allows. When pro-tier gating lands, enforce it HERE and
// nowhere else: the gateway (api.hanzo.ai) injects the caller's org via the
// `X-Hanzo-Owner` header from the IAM `owner` claim — check plan/quota for that
// org and return false to block, writing a 402/403. One function, one place.
func gate(_ http.ResponseWriter, _ *http.Request) bool { return true }

func (e *Engine) handleState(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) || !gate(w, r) {
		return
	}
	entities, asOf := e.store.Snapshot()
	if kind := r.URL.Query().Get("kind"); kind != "" {
		entities = filterKind(entities, kind)
	}
	writeEnvelope(w, asOf, map[string]any{
		"count":    len(entities),
		"entities": entities,
	})
}

func (e *Engine) handleCountry(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) || !gate(w, r) {
		return
	}
	iso := strings.ToUpper(strings.Trim(strings.TrimPrefix(r.URL.Path, countryPrefix), "/"))
	if iso == "" {
		writeErr(w, http.StatusBadRequest, "country ISO code required")
		return
	}
	ent, ok := e.store.Get(KindCountry, iso)
	if !ok {
		writeErr(w, http.StatusNotFound, "no such country: "+iso)
		return
	}
	writeEnvelope(w, ent.UpdatedAt, map[string]any{"entity": ent})
}

func (e *Engine) handleTop(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) || !gate(w, r) {
		return
	}
	q := r.URL.Query()
	metric := q.Get("metric")
	if metric == "" {
		metric = MetricInstability
	}
	kind := q.Get("kind")
	if kind == "" {
		kind = KindCountry
	}
	n, err := strconv.Atoi(q.Get("n"))
	if err != nil || n <= 0 {
		n = 10
	}
	if n > 100 {
		n = 100
	}
	entities := e.store.Top(kind, metric, n)
	writeEnvelope(w, e.store.AsOf(), map[string]any{
		"metric": metric, "kind": kind, "count": len(entities), "entities": entities,
	})
}

func (e *Engine) handleChanges(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) || !gate(w, r) {
		return
	}
	// Default window: the last hour, so a caller can poll changes without
	// tracking a cursor. ?since=RFC3339 overrides.
	since := time.Now().UTC().Add(-time.Hour)
	if v := r.URL.Query().Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "since must be RFC3339")
			return
		}
		since = t
	}
	changes := e.store.Since(since)
	writeEnvelope(w, e.store.AsOf(), map[string]any{
		"since": since.Format(time.RFC3339), "count": len(changes), "changes": changes,
	})
}

// handleStream is Server-Sent Events: subscribe, replay the current top state as
// an initial snapshot event, then push each fold's deltas live. Heartbeats keep
// intermediaries from closing an idle connection.
func (e *Engine) handleStream(w http.ResponseWriter, r *http.Request) {
	if cors(w, r) || !gate(w, r) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	ch, cancel := e.store.Subscribe()
	defer cancel()

	// Initial event so a fresh subscriber has the current top movers immediately.
	top := e.store.Top(KindCountry, MetricInstability, 10)
	sse(w, flusher, "snapshot", map[string]any{"asOf": e.store.AsOf(), "entities": top})

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case c, ok := <-ch:
			if !ok {
				return
			}
			sse(w, flusher, "delta", c)
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": keep-alive\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ── envelope + SSE writers ───────────────────────────────────────────────────

func writeEnvelope(w http.ResponseWriter, asOf time.Time, fields map[string]any) {
	env := map[string]any{"v": SchemaVersion, "asOf": asOf.Format(time.RFC3339)}
	for k, v := range fields {
		env[k] = v
	}
	writeJSON(w, http.StatusOK, env)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"v": SchemaVersion, "error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func sse(w http.ResponseWriter, f http.Flusher, event string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	_, _ = w.Write([]byte("event: " + event + "\ndata: "))
	_, _ = w.Write(b)
	_, _ = w.Write([]byte("\n\n"))
	f.Flush()
}

// cors handles the OPTIONS preflight and sets the shared wildcard policy (public
// data). Returns true when it fully handled the request (OPTIONS).
func cors(w http.ResponseWriter, r *http.Request) bool {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	h.Set("Vary", "Origin")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func filterKind(in []*Entity, kind string) []*Entity {
	out := make([]*Entity, 0, len(in))
	for _, e := range in {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}
