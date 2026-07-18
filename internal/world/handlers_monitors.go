package world

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/store"
)

// Go-native keyword monitors.
//
// Monitors used to live entirely in the browser: the keyword list in
// localStorage, the matching done client-side over whatever headlines that tab
// had loaded. That means a monitor only ever saw one client's slice of the
// corpus, and it stopped existing the moment you closed the tab or switched
// device.
//
// Here they are server state: the list is persisted per identity (the same
// per-identity store the dashboard settings use, namespaced 'monitors'), and
// matching runs against the LAKE — every item the backend has ingested, not just
// what a browser fetched. Anonymous callers get 401 and keep their local
// monitors; nothing about the signed-out experience changes.
//
//	GET  /v1/world/monitors          → { monitors: [...] }
//	PUT  /v1/world/monitors          → { ok: true }   (body: { monitors: [...] })
//	GET  /v1/world/monitors/matches  → { matches: [...] }  (matched against the lake)

const (
	monitorsDoc        = "monitors" // per-identity store namespace
	monitorMatchWindow = 48 * time.Hour
	monitorMatchLimit  = 60
	maxMonitors        = 50
	maxKeywordsEach    = 25
)

// Monitor is one keyword watch. Mirrors the frontend Monitor type.
type Monitor struct {
	ID       string   `json:"id"`
	Keywords []string `json:"keywords"`
	Color    string   `json:"color,omitempty"`
}

// MonitorMatch is a lake item that tripped a monitor.
type MonitorMatch struct {
	MonitorID string    `json:"monitorId"`
	Color     string    `json:"color,omitempty"`
	Keyword   string    `json:"keyword"`
	Title     string    `json:"title"`
	Link      string    `json:"link"`
	Source    string    `json:"source"`
	TS        time.Time `json:"ts"`
}

// identityForDoc resolves the caller under a per-identity store namespace (doc),
// or writes 401 and reports false. It is world's ONE bearer→identity gate for the
// namespaced settings store — monitors and dashboard both resolve through here.
func (s *Server) identityForDoc(w http.ResponseWriter, r *http.Request, doc string) (store.Identity, bool) {
	bearer := userBearer(r)
	if bearer == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return store.Identity{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	id, err := s.introspectIdentity(ctx, bearer)
	if err != nil || id.Sub == "" {
		writeError(w, http.StatusUnauthorized, "Sign in required")
		return store.Identity{}, false
	}
	return store.Identity{Org: id.Org, UserSub: id.Sub, Project: doc}, true
}

// identityFor resolves the caller for the monitors namespace.
func (s *Server) identityFor(w http.ResponseWriter, r *http.Request) (store.Identity, bool) {
	return s.identityForDoc(w, r, monitorsDoc)
}

func (s *Server) handleMonitors(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, PUT, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "GET or PUT")
		return
	}
	ident, ok := s.identityFor(w, r)
	if !ok {
		return
	}

	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, "private, no-store", map[string]any{"monitors": s.loadMonitors(ident)})
		return
	}

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Body too large")
		return
	}
	var body struct {
		Monitors []Monitor `json:"monitors"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Body must be {\"monitors\":[...]}")
		return
	}
	clean := sanitizeMonitors(body.Monitors)
	blob, err := json.Marshal(map[string]any{"monitors": clean})
	if err != nil {
		writeError(w, http.StatusBadRequest, "Unserializable monitors")
		return
	}
	writeJSON(w, http.StatusOK, "private, no-store", map[string]any{
		"ok":       s.store.Settings.Put(ident, blob),
		"monitors": clean,
	})
}

// handleMonitorMatches runs the caller's monitors against the lake — the whole
// ingested corpus, not one browser's slice of it.
func (s *Server) handleMonitorMatches(w http.ResponseWriter, r *http.Request) {
	setCORS(w, "GET, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "GET")
		return
	}
	ident, ok := s.identityFor(w, r)
	if !ok {
		return
	}
	monitors := s.loadMonitors(ident)
	writeJSON(w, http.StatusOK, "private, no-store", map[string]any{
		"matches": s.matchMonitors(monitors),
	})
}

func (s *Server) loadMonitors(ident store.Identity) []Monitor {
	blob, ok := s.store.Settings.Get(ident)
	if !ok {
		return []Monitor{}
	}
	var doc struct {
		Monitors []Monitor `json:"monitors"`
	}
	if err := json.Unmarshal(blob, &doc); err != nil || doc.Monitors == nil {
		return []Monitor{}
	}
	return doc.Monitors
}

// matchMonitors searches the lake once per keyword and folds the hits together,
// deduped by (monitor, item) so one item can trip two different monitors but
// never the same one twice. Word-boundary re-check mirrors the frontend rule:
// FTS tokenises, but "ai" must not match "train".
func (s *Server) matchMonitors(monitors []Monitor) []MonitorMatch {
	out := []MonitorMatch{}
	if s.store == nil || len(monitors) == 0 {
		return out
	}
	since := time.Now().Add(-monitorMatchWindow)
	seen := map[string]bool{}
	for _, m := range monitors {
		for _, kw := range m.Keywords {
			kw = strings.ToLower(strings.TrimSpace(kw))
			if kw == "" {
				continue
			}
			re := wordBoundary(kw)
			items := s.store.Lake.Search(store.SearchQuery{
				Q: kw, Kind: "news", Since: since, Limit: monitorMatchLimit,
			})
			for _, it := range items {
				if !re.MatchString(strings.ToLower(it.Title + " " + it.Text)) {
					continue // FTS stemming can over-match; the boundary rule decides
				}
				key := m.ID + "\x00" + it.ID
				if seen[key] {
					continue
				}
				seen[key] = true
				out = append(out, MonitorMatch{
					MonitorID: m.ID, Color: m.Color, Keyword: kw,
					Title: it.Title, Link: itemLink(it), Source: it.Source, TS: it.TS,
				})
			}
		}
	}
	return out
}

// itemLink pulls the canonical link out of a lake item's payload, falling back
// to its id (feed items are keyed by link upstream).
func itemLink(it store.Item) string {
	var p struct {
		Link string `json:"link"`
	}
	if it.Payload != "" && json.Unmarshal([]byte(it.Payload), &p) == nil && p.Link != "" {
		return p.Link
	}
	if strings.HasPrefix(it.ID, "http") {
		return it.ID
	}
	return ""
}

var wbCache sync.Map // keyword → *regexp.Regexp

func wordBoundary(kw string) *regexp.Regexp {
	if v, ok := wbCache.Load(kw); ok {
		return v.(*regexp.Regexp)
	}
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(kw) + `\b`)
	wbCache.Store(kw, re)
	return re
}

// sanitizeMonitors bounds what a client can store: no unbounded lists, no empty
// keywords, everything lowercased so matching is case-insensitive by construction.
func sanitizeMonitors(in []Monitor) []Monitor {
	out := make([]Monitor, 0, len(in))
	for _, m := range in {
		if len(out) >= maxMonitors {
			break
		}
		kws := make([]string, 0, len(m.Keywords))
		for _, k := range m.Keywords {
			k = strings.ToLower(strings.TrimSpace(k))
			if k == "" || len(kws) >= maxKeywordsEach {
				continue
			}
			kws = append(kws, k)
		}
		if len(kws) == 0 || strings.TrimSpace(m.ID) == "" {
			continue
		}
		out = append(out, Monitor{ID: m.ID, Keywords: kws, Color: m.Color})
	}
	return out
}
