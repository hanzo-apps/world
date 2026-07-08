// Package model is the Hanzo World Model: an in-memory, continuously-updated
// world-state engine layered on top of the /v1/world/* data plane.
//
// It is decomplected from the feeds. This package knows nothing about GDELT,
// OpenSky, ACLED or any upstream — it only folds VALUES (Observation) into a
// typed per-entity state vector, derives composite signals in ONE place, tracks
// what changed, snapshots to disk for warm-start, and serves the query/SSE API.
// The adapters that turn feeds into Observations live in package world (which
// owns the fetchers) and are handed in as Sources. Values flow in; state and
// deltas flow out.
//
// Entities are countries, theaters, and markets. Each carries a metric vector;
// the engine computes a composite `instability` and a severity `level` from
// whatever metrics are present, so a partial feed (or none) still yields a
// coherent, honestly-degraded state.
package model

import (
	"math"
	"sort"
	"sync"
	"time"
)

// SchemaVersion tags every JSON response envelope and the on-disk snapshot.
const SchemaVersion = 1

// Entity kinds.
const (
	KindCountry = "country"
	KindTheater = "theater"
	KindMarket  = "market"
)

// Canonical metric keys. Sources emit a disjoint subset; the engine derives
// Instability + NewsVelocity. One name per concept, used everywhere.
const (
	MetricInstability      = "instability"
	MetricBaseline         = "baseline"
	MetricNewsVolume       = "newsVolume"
	MetricNewsVelocity     = "newsVelocity"
	MetricSentiment        = "sentiment"
	MetricConflictEvents   = "conflictEvents"
	MetricMilitaryActivity = "militaryActivity"
	MetricMarketStress     = "marketStress"
)

// Observation is one source's measurement of one entity at ingest time. Metrics
// carries only what the source actually measured; unset metrics retain their
// last-known value in the store (sticky state), so a throttled or absent feed
// degrades to staleness, never to zero. Src is the source label, stamped by the
// engine at ingest — adapters don't set it.
type Observation struct {
	ID      string
	Kind    string
	Name    string
	Metrics map[string]float64
	Note    string
	Src     string
}

// Source is a named feed adapter: poll it, get observations. Poll must be safe
// to call on the engine's schedule and should return a transport error rather
// than panic; a failing source is skipped for the cycle (entities keep prior
// state).
type Source struct {
	Name string
	Poll func() ([]Observation, error)
}

// Entity is the stored state vector for one country/theater/market.
type Entity struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	Name      string             `json:"name"`
	Metrics   map[string]float64 `json:"metrics"`
	Deltas    map[string]float64 `json:"deltas"` // change vs previous ingest cycle
	Level     string             `json:"level"`
	Note      string             `json:"note,omitempty"`
	Sources   []string           `json:"sources"`
	UpdatedAt time.Time          `json:"updatedAt"`
}

// Change is one entity moving in one cycle — the "what changed" signal that
// feeds changes?since and the SSE stream.
type Change struct {
	At          time.Time          `json:"at"`
	ID          string             `json:"id"`
	Kind        string             `json:"kind"`
	Name        string             `json:"name"`
	Level       string             `json:"level"`
	Instability float64            `json:"instability"`
	Deltas      map[string]float64 `json:"deltas"`
}

// changeLogMax bounds the retained change history (changes?since replays from
// here). Older entries are dropped; the live state itself is unbounded-fresh.
const changeLogMax = 5000

// A Change fires when an existing entity moves materially: instability shifts by
// at least instabilityEpsilon, OR its news volume swings by newsVelocityTrigger
// articles in a cycle. The second trigger is the point of the model — it surfaces
// news surges the instant they feed in, even before they move the composite.
const (
	instabilityEpsilon  = 0.5
	newsVelocityTrigger = 15
)

// Store is the concurrent world state: entities + a bounded change log + SSE
// subscribers. All access goes through the mutex; it is the single source of
// truth the API and snapshotter read.
type Store struct {
	mu       sync.RWMutex
	entities map[string]*Entity
	changes  []Change
	subs     map[chan Change]struct{}
	asOf     time.Time
}

func NewStore() *Store {
	return &Store{
		entities: make(map[string]*Entity),
		subs:     make(map[chan Change]struct{}),
	}
}

func key(kind, id string) string { return kind + ":" + id }

// Apply folds one cycle's observations into the store and returns the Changes it
// produced (already appended to the log and broadcast to subscribers). All
// observations for a cycle are merged per entity FIRST, then diffed once against
// the previous cycle, so an entity fed by several sources moves atomically.
func (st *Store) Apply(obs []Observation, at time.Time) []Change {
	// Merge observations by entity: union metrics (last write wins per key),
	// union sources, first non-empty name/note.
	type merged struct {
		kind, id, name, note string
		metrics              map[string]float64
		sources              []string
		refreshedVolume      bool
	}
	groups := make(map[string]*merged)
	for _, o := range obs {
		k := key(o.Kind, o.ID)
		g := groups[k]
		if g == nil {
			g = &merged{kind: o.Kind, id: o.ID, metrics: map[string]float64{}}
			groups[k] = g
		}
		if g.name == "" {
			g.name = o.Name
		}
		if g.note == "" {
			g.note = o.Note
		}
		for m, v := range o.Metrics {
			g.metrics[m] = v
			if m == MetricNewsVolume {
				g.refreshedVolume = true
			}
		}
		g.sources = append(g.sources, o.Src)
	}

	st.mu.Lock()
	defer st.mu.Unlock()
	st.asOf = at

	out := make([]Change, 0, len(groups))
	for k, g := range groups {
		prev := st.entities[k]

		// Sticky merge: start from prior metrics, overlay this cycle's.
		metrics := map[string]float64{}
		var prevInst, prevVol float64
		if prev != nil {
			for m, v := range prev.Metrics {
				metrics[m] = v
			}
			prevInst = prev.Metrics[MetricInstability]
			prevVol = prev.Metrics[MetricNewsVolume]
		}
		for m, v := range g.metrics {
			metrics[m] = v
		}

		// Derived, in one place: news velocity (only when volume refreshed this
		// cycle) then the composite instability.
		if g.refreshedVolume {
			metrics[MetricNewsVelocity] = metrics[MetricNewsVolume] - prevVol
		} else if _, ok := metrics[MetricNewsVelocity]; ok {
			metrics[MetricNewsVelocity] = 0
		}
		inst := compositeInstability(metrics)
		metrics[MetricInstability] = inst

		deltas := map[string]float64{MetricInstability: round2(inst - prevInst)}
		if g.refreshedVolume {
			deltas[MetricNewsVolume] = round2(metrics[MetricNewsVolume] - prevVol)
		}

		name := g.name
		if name == "" && prev != nil {
			name = prev.Name
		}
		note := g.note
		if note == "" && prev != nil {
			note = prev.Note
		}
		ent := &Entity{
			ID: g.id, Kind: g.kind, Name: name, Metrics: roundAll(metrics),
			Deltas: deltas, Level: levelOf(inst), Note: note,
			Sources: dedupe(g.sources), UpdatedAt: at,
		}
		st.entities[k] = ent

		// A Change is a real move on an entity that already existed: cold-start
		// population is visible via /state, not replayed as thousands of deltas.
		moved := math.Abs(inst-prevInst) >= instabilityEpsilon ||
			math.Abs(metrics[MetricNewsVelocity]) >= newsVelocityTrigger
		if prev != nil && moved {
			out = append(out, Change{
				At: at, ID: ent.ID, Kind: ent.Kind, Name: ent.Name,
				Level: ent.Level, Instability: ent.Metrics[MetricInstability], Deltas: deltas,
			})
		}
	}

	if len(out) > 0 {
		st.changes = append(st.changes, out...)
		if len(st.changes) > changeLogMax {
			st.changes = append(st.changes[:0], st.changes[len(st.changes)-changeLogMax:]...)
		}
		st.broadcastLocked(out)
	}
	return out
}

// broadcastLocked pushes changes to every subscriber without blocking: a slow
// consumer drops deltas rather than stalling ingest (it can re-sync via /state).
func (st *Store) broadcastLocked(changes []Change) {
	for ch := range st.subs {
		for _, c := range changes {
			select {
			case ch <- c:
			default:
			}
		}
	}
}

// Snapshot returns the entities sorted by instability desc (stable, deterministic
// order for the API) and the as-of time.
func (st *Store) Snapshot() ([]*Entity, time.Time) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]*Entity, 0, len(st.entities))
	for _, e := range st.entities {
		out = append(out, e)
	}
	sortByInstability(out)
	return out, st.asOf
}

// AsOf returns the timestamp of the last folded cycle.
func (st *Store) AsOf() time.Time {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.asOf
}

// Get returns a single entity by kind+id.
func (st *Store) Get(kind, id string) (*Entity, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	e, ok := st.entities[key(kind, id)]
	return e, ok
}

// Top returns up to n entities of the given kind ranked by metric. Recognized
// metrics: instability (desc), velocity (|Δ| desc), sentiment (asc = worst
// first); anything else falls back to instability.
func (st *Store) Top(kind, metric string, n int) []*Entity {
	st.mu.RLock()
	out := make([]*Entity, 0, len(st.entities))
	for _, e := range st.entities {
		if kind == "" || e.Kind == kind {
			out = append(out, e)
		}
	}
	st.mu.RUnlock()

	switch metric {
	case "velocity", MetricNewsVelocity:
		sort.SliceStable(out, func(i, j int) bool {
			return math.Abs(out[i].Metrics[MetricNewsVelocity]) > math.Abs(out[j].Metrics[MetricNewsVelocity])
		})
	case "sentiment":
		sort.SliceStable(out, func(i, j int) bool {
			return out[i].Metrics[MetricSentiment] < out[j].Metrics[MetricSentiment]
		})
	default:
		sortByInstability(out)
	}
	if n > 0 && len(out) > n {
		out = out[:n]
	}
	return out
}

// Since returns every logged change strictly after t, oldest first.
func (st *Store) Since(t time.Time) []Change {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]Change, 0)
	for _, c := range st.changes {
		if c.At.After(t) {
			out = append(out, c)
		}
	}
	return out
}

// Subscribe registers an SSE consumer; the returned cancel removes and closes
// the channel. The channel is buffered so brief consumer stalls don't drop the
// newest deltas.
func (st *Store) Subscribe() (<-chan Change, func()) {
	ch := make(chan Change, 64)
	st.mu.Lock()
	st.subs[ch] = struct{}{}
	st.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			st.mu.Lock()
			delete(st.subs, ch)
			close(ch)
			st.mu.Unlock()
		})
	}
}

// ── derived signals (the ONE place composites are computed) ──────────────────

// compositeInstability folds the metric vector into a 0..100 instability score.
// Countries build up from a baseline modulated by negative news (amplified by
// volume) and conflict; theaters from military activity; markets take their
// stress directly. Absent metrics simply don't contribute.
func compositeInstability(m map[string]float64) float64 {
	score := m[MetricBaseline]
	if vol, ok := m[MetricNewsVolume]; ok {
		volNorm := math.Min(1, vol/50)
		tone := m[MetricSentiment] // GDELT tone: negative = adverse coverage
		score += clamp(-tone*2.5*volNorm, -8, 26)
	}
	if c, ok := m[MetricConflictEvents]; ok {
		score += math.Min(26, c*0.6)
	}
	if a, ok := m[MetricMilitaryActivity]; ok {
		score += math.Min(20, a*1.5)
	}
	if s, ok := m[MetricMarketStress]; ok {
		score = math.Max(score, s) // market entities are stress-dominated
	}
	return clamp(score, 0, 100)
}

func levelOf(inst float64) string {
	switch {
	case inst >= 70:
		return "critical"
	case inst >= 55:
		return "high"
	case inst >= 40:
		return "elevated"
	case inst >= 25:
		return "normal"
	default:
		return "low"
	}
}

// ── small helpers ────────────────────────────────────────────────────────────

func sortByInstability(e []*Entity) {
	sort.SliceStable(e, func(i, j int) bool {
		return e[i].Metrics[MetricInstability] > e[j].Metrics[MetricInstability]
	})
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func round2(f float64) float64        { return math.Round(f*100) / 100 }

func roundAll(m map[string]float64) map[string]float64 {
	for k, v := range m {
		m[k] = round2(v)
	}
	return m
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
