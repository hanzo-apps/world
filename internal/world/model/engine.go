package model

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DefaultInterval is the ingest cadence when unset. Feeds are polled, folded,
// and snapshotted every cycle.
const DefaultInterval = 10 * time.Minute

// Engine owns the Store, the Sources, and the ingest schedule. It loads the
// last snapshot on Start (warm restart), folds every interval, and persists
// after each cycle so a restart resumes at most one interval stale.
type Engine struct {
	store    *Store
	sources  []Source
	interval time.Duration
	snapPath string
	history  *History

	startOnce sync.Once
}

// New builds an engine. dataDir is where the warm-start snapshot and the history
// ring live; interval<=0 uses DefaultInterval.
func New(sources []Source, dataDir string, interval time.Duration) *Engine {
	if interval <= 0 {
		interval = DefaultInterval
	}
	return &Engine{
		store:    NewStore(),
		sources:  sources,
		interval: interval,
		snapPath: filepath.Join(dataDir, "world-model.json"),
		history:  NewHistory(dataDir, HistoryCap),
	}
}

// History exposes the durable snapshot ring (queried by the /history handler).
func (e *Engine) History() *History { return e.history }

// Store exposes the state store to the API handlers.
func (e *Engine) Store() *Store { return e.store }

// Start loads the snapshot, folds once immediately, then folds every interval
// until ctx is cancelled (final snapshot on the way out). Idempotent.
func (e *Engine) Start(ctx context.Context) {
	e.startOnce.Do(func() {
		e.load()
		e.history.Load() // keep the 24h chart warm across restarts
		go e.loop(ctx)
	})
}

func (e *Engine) loop(ctx context.Context) {
	e.IngestOnce(ctx) // populate on boot, don't wait a full interval
	e.persist()
	t := time.NewTicker(e.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			e.persist()
			return
		case <-t.C:
			e.IngestOnce(ctx)
			e.persist()
		}
	}
}

// persist writes both durable artifacts after a fold: the full warm-start
// snapshot (current state) and one compact history Point (the trajectory).
func (e *Engine) persist() {
	e.save()
	e.history.Record(pointFromStore(e.store, e.store.AsOf()))
}

// IngestOnce polls every source concurrently and folds the union into the
// store. A source error is logged and skipped — its entities keep prior state.
// Exported so tests and a future manual-refresh route can drive one cycle.
func (e *Engine) IngestOnce(ctx context.Context) {
	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		all []Observation
	)
	for _, src := range e.sources {
		wg.Add(1)
		go func(src Source) {
			defer wg.Done()
			obs, err := src.Poll()
			if err != nil {
				log.Printf("world-model: source %s: %v", src.Name, err)
				return
			}
			for i := range obs {
				obs[i].Src = src.Name // stamp the real source label
			}
			mu.Lock()
			all = append(all, obs...)
			mu.Unlock()
		}(src)
	}
	wg.Wait()
	changes := e.store.Apply(all, time.Now().UTC())
	log.Printf("world-model: ingest folded %d observations, %d changes", len(all), len(changes))
}

// ── snapshot ─────────────────────────────────────────────────────────────────

type snapshot struct {
	V        int                `json:"v"`
	AsOf     time.Time          `json:"asOf"`
	Entities map[string]*Entity `json:"entities"`
	Changes  []Change           `json:"changes"`
}

func (e *Engine) load() {
	b, err := os.ReadFile(e.snapPath)
	if err != nil {
		return // no snapshot: cold start is fine
	}
	var s snapshot
	if err := json.Unmarshal(b, &s); err != nil || s.V != SchemaVersion {
		log.Printf("world-model: ignoring snapshot (v=%d err=%v)", s.V, err)
		return
	}
	e.store.mu.Lock()
	e.store.entities = s.Entities
	if e.store.entities == nil {
		e.store.entities = map[string]*Entity{}
	}
	e.store.changes = s.Changes
	e.store.asOf = s.AsOf
	e.store.mu.Unlock()
	log.Printf("world-model: warm-started %d entities from %s", len(s.Entities), e.snapPath)
}

// save writes the snapshot atomically (temp + rename) so a crash mid-write never
// corrupts the warm-start file.
func (e *Engine) save() {
	e.store.mu.RLock()
	s := snapshot{V: SchemaVersion, AsOf: e.store.asOf, Entities: e.store.entities, Changes: e.store.changes}
	b, err := json.Marshal(s)
	e.store.mu.RUnlock()
	if err != nil {
		log.Printf("world-model: snapshot marshal: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(e.snapPath), 0o755); err != nil {
		log.Printf("world-model: snapshot mkdir: %v", err)
		return
	}
	tmp := e.snapPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("world-model: snapshot write: %v", err)
		return
	}
	if err := os.Rename(tmp, e.snapPath); err != nil {
		log.Printf("world-model: snapshot rename: %v", err)
	}
}

// ── AI grounding (ModelContext) ──────────────────────────────────────────────

// Context returns a compact plain-text briefing of the current world state —
// the top movers and highest-instability entities — for grounding AI answers in
// the model instead of raw feeds. One helper, called by the AI handlers.
func (e *Engine) Context() string {
	top := e.store.Top(KindCountry, MetricInstability, 8)
	movers := e.store.Top(KindCountry, "velocity", 6)
	theaters := e.store.Top(KindTheater, MetricInstability, 4)
	asOf := e.store.AsOf()

	var b strings.Builder
	b.WriteString("WORLD MODEL (as of ")
	b.WriteString(asOf.Format(time.RFC3339))
	b.WriteString(")\nHighest instability:\n")
	for _, ent := range top {
		b.WriteString("  - " + ent.Name + " (" + ent.ID + "): instability " +
			ftoa(ent.Metrics[MetricInstability]) + " [" + ent.Level + "]" + toneNote(ent) + "\n")
	}
	b.WriteString("Biggest news movers:\n")
	for _, ent := range movers {
		v := ent.Metrics[MetricNewsVelocity]
		if v == 0 {
			continue
		}
		b.WriteString("  - " + ent.Name + ": news velocity " + signed(v) + "\n")
	}
	if len(theaters) > 0 {
		b.WriteString("Active theaters:\n")
		for _, ent := range theaters {
			b.WriteString("  - " + ent.Name + ": " + ent.Level + " (" +
				ftoa(ent.Metrics[MetricMilitaryActivity]) + " mil. aircraft)\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// CountryContext returns the state vector for one country (ISO alpha-2) as a
// JSON-friendly map, or false if the model has no such entity. AI country
// briefs merge this so the narrative matches the numbers.
func (e *Engine) CountryContext(iso string) (map[string]any, bool) {
	ent, ok := e.store.Get(KindCountry, strings.ToUpper(strings.TrimSpace(iso)))
	if !ok {
		return nil, false
	}
	return map[string]any{
		"id": ent.ID, "name": ent.Name, "level": ent.Level,
		"metrics": ent.Metrics, "deltas": ent.Deltas,
		"updatedAt": ent.UpdatedAt.Format(time.RFC3339),
	}, true
}

func toneNote(e *Entity) string {
	t, ok := e.Metrics[MetricSentiment]
	if !ok {
		return ""
	}
	return ", tone " + ftoa(t)
}

func ftoa(f float64) string {
	b, _ := json.Marshal(round2(f))
	return string(b)
}

func signed(f float64) string {
	if f > 0 {
		return "+" + ftoa(f)
	}
	return ftoa(f)
}
