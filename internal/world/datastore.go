package world

import (
	"context"
	"encoding/json"
	"time"

	"github.com/hanzoai/bucket"
	"github.com/hanzoai/world/internal/world/kv"
	"github.com/hanzoai/world/internal/world/model"
	"github.com/hanzoai/world/internal/world/store"
)

// datastore.go wires world's three storage concerns onto the Server and owns
// their lifecycle, keeping each in its lane:
//   - cloud KV (shared hot cache)  → instant feed bodies (FeedCache L2)
//   - embedded SQLite (lake)       → the searchable "one place to query everything"
//   - embedded SQLite (settings)   → signed-in per-identity dashboard sync
//
// Everything degrades cleanly: no cloud KV → per-pod in-mem feed cache; no
// SQLite → search/analytics return empty and settings say "not stored". The
// service never 5xxes over storage.

// kvBaseURL is the shared KV's API base. Defaults to the public gateway; set
// empty (WORLD_KV_DISABLE=1) to force the pure in-mem path (local dev / CI).
func kvBaseURL() string {
	if env("WORLD_KV_DISABLE") != "" {
		return ""
	}
	if u := env("HANZO_API_BASE", "WORLD_KV_BASE_URL"); u != "" {
		return u
	}
	return bucket.DefaultBaseURL
}

// kvToken is world's own Hanzo IAM bearer token for the shared KV, sourced
// from a KMS-backed secret. Never hard-code it.
func kvToken() string { return env("HANZO_API_TOKEN", "WORLD_KV_TOKEN") }

// lakeRetention is the rolling window ingested items are kept for.
func lakeRetention() time.Duration {
	if v := env("WORLD_LAKE_RETENTION"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return store.DefaultRetention
}

// initDatastore opens the shared KV + the embedded SQLite datastore and
// builds the two-tier feed cache. Called once from NewServer; never fails
// hard.
func (s *Server) initDatastore() {
	s.kv = kv.Open(kvBaseURL(), kvToken())

	db, err := store.Open(modelDataDir(), lakeRetention())
	if err != nil {
		logf("world-store: degraded (no durable lake/settings): %v", err)
	}
	s.store = db
	s.feeds = NewFeedCache(s.kv, 0, curatedFeedSeed)

	// The world model dumps its folded observations into the lake so model state
	// is queryable alongside news — the engine stays decomplected from storage,
	// it just calls this sink.
	s.worldModel.SetObservationSink(s.ingestObservations)
}

// StartDatastore starts the background loops: the lake write-behind/prune
// consumer and the feed warmer. Call once from main after the server is built.
func (s *Server) StartDatastore(ctx context.Context) {
	if s.kv.Enabled() {
		pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		if err := s.kv.Ping(pctx); err != nil {
			logf("world-kv: %s unreachable, using per-pod in-mem cache: %v", kvBaseURL(), err)
		} else {
			logf("world-kv: connected to %s (shared feed cache)", kvBaseURL())
		}
		cancel()
	} else {
		logf("world-kv: disabled, using per-pod in-mem feed cache")
	}
	go s.store.Lake.Run(ctx)
	s.startFeedWarmer(ctx)
	s.startCacheWarmer(ctx)
}

// Close releases the datastore handles. Safe to call once on shutdown.
func (s *Server) Close() {
	if s.kv != nil {
		s.kv.Close()
	}
	if s.store != nil {
		_ = s.store.Close()
	}
}

// ingestObservations folds one cycle of world-model observations into the lake
// (kind=observation), keyed so each entity+source keeps its latest value. This
// is the model half of "dump ALL ingested data into the datastore".
func (s *Server) ingestObservations(obs []model.Observation) {
	if s.store == nil {
		return
	}
	now := time.Now().UTC()
	for _, o := range obs {
		country := ""
		if o.Kind == model.KindCountry {
			country = o.ID
		}
		payload, _ := json.Marshal(map[string]any{
			"id": o.ID, "kind": o.Kind, "name": o.Name,
			"metrics": o.Metrics, "note": o.Note, "src": o.Src,
		})
		s.store.Lake.Add(store.Item{
			ID:      "obs:" + o.Kind + ":" + o.ID + ":" + o.Src,
			Kind:    "observation",
			Source:  o.Src,
			TS:      now,
			Title:   o.Name,
			Text:    o.Note,
			Country: country,
			Payload: string(payload),
		})
	}
}
