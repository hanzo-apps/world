package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// AI Compute pulse — the live "what is Hanzo's inference plane doing right now"
// stream for the AI variant (world.hanzo.ai/?variant=ai). It is the same honest
// platform aggregate cloud-pulse reads, reshaped for a compute-first panel and
// PUSHED over SSE so the number moves without the client polling.
//
// ONE route, two representations (the handleAnalyst idiom): an EventSource client
// (Accept: text/event-stream) gets typed events — `usage` (tokens/s, req/s, spend,
// top models) and `fleet` (gpu/machine/region counts) — re-emitted each interval,
// plus a `status` frame carrying the honest state. A plain GET gets ONE JSON
// snapshot of the same data, which the frontend uses as its poll fallback.
//
// Honesty: with no service token, or when every upstream is unreachable, the
// state is "unavailable" with a reason — the panel says so rather than showing a
// zero as if it were live. The service bearer is read server-side only and never
// reaches the browser.

const (
	aiPulseKey      = "ai-pulse"
	aiPulseTTL      = 10 * time.Second // shared snapshot horizon (coalesces SSE clients)
	aiPulseFailTTL  = 3 * time.Second  // retry an unavailable pulse sooner
	aiPulseInterval = 15 * time.Second // SSE re-emit cadence
)

// aiUsage is the measured inference volume (get-cloud-usages ?org=all).
type aiUsage struct {
	Window         string       `json:"window"`
	RequestsPerSec float64      `json:"requestsPerSec"`
	TokensPerSec   float64      `json:"tokensPerSec"`
	Requests24h    int64        `json:"requests24h"`
	Tokens24h      int64        `json:"tokens24h"`
	SpendCents     int64        `json:"spendCents"`
	Models         []cloudModel `json:"models"` // top by real spend
}

// aiFleet is the live serving fleet (visor + ai catalog). Counts only.
type aiFleet struct {
	Machines       int `json:"machines"`
	MachinesOnline int `json:"machinesOnline"`
	Gpus           int `json:"gpus"`
	Regions        int `json:"regions"`
	ModelsServed   int `json:"modelsServed"`
}

// aiPulse is one snapshot of the compute plane. State is "live" when at least one
// half resolved, else "unavailable" with a Reason.
type aiPulse struct {
	State     string   `json:"state"` // "live" | "unavailable"
	Reason    string   `json:"reason,omitempty"`
	UpdatedAt string   `json:"updatedAt"`
	Usage     *aiUsage `json:"usage,omitempty"`
	Fleet     *aiFleet `json:"fleet,omitempty"`
}

// typed SSE frames. Embedding the pointer flattens its JSON fields under the
// envelope's "type", so the wire shape stays DRY with the snapshot structs.
type aiUsageEvent struct {
	Type string `json:"type"` // "usage"
	*aiUsage
	UpdatedAt string `json:"updatedAt"`
}

type aiFleetEvent struct {
	Type string `json:"type"` // "fleet"
	*aiFleet
	UpdatedAt string `json:"updatedAt"`
}

// handleAIPulse serves the compute pulse as SSE (EventSource) or, for a plain GET,
// a single JSON snapshot (the poll fallback). It never 5xxes.
func (s *Server) handleAIPulse(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	ctx := r.Context()

	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		if f, ok := w.(http.Flusher); ok {
			// The HTTP server sets a 60s WriteTimeout (cmd/world/main.go). A long-lived
			// SSE stream trips it, and the mid-stream connection reset surfaces in the
			// browser as net::ERR_HTTP2_PROTOCOL_ERROR followed by an EventSource
			// reconnect storm. Clear the write deadline so the stream lives until the
			// client disconnects (ctx cancellation ends the emit loop).
			_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
			h := w.Header()
			h.Set("Content-Type", "text/event-stream; charset=utf-8")
			h.Set("Cache-Control", "no-cache")
			h.Set("X-Accel-Buffering", "no")
			w.WriteHeader(http.StatusOK)
			emit := func(v any) {
				b, _ := json.Marshal(v)
				_, _ = w.Write([]byte("data: "))
				_, _ = w.Write(b)
				_, _ = w.Write([]byte("\n\n"))
				f.Flush()
			}
			s.streamAIPulse(ctx, emit)
			return
		}
	}

	// Poll fallback: one JSON snapshot (never cached downstream — it is live).
	// EventSource cannot send Authorization, so the AUTHED transport is this poll:
	// a signed-in admin gets a fresh per-caller snapshot built with THEIR OWN bearer
	// (full measured usage + fleet), never the shared service-token snapshot.
	w.Header().Set("Vary", "Authorization")
	sctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if bearer, ok := s.adminIdentity(r); ok {
		writeJSON(w, http.StatusOK, "private, no-store", s.produceAIPulse(sctx, map[string]string{"Authorization": bearer}))
		return
	}
	writeJSON(w, http.StatusOK, "no-store", s.aiPulseSnapshot(sctx))
}

// streamAIPulse pushes the snapshot immediately, then re-emits on the interval
// until the client disconnects (ctx cancelled).
func (s *Server) streamAIPulse(ctx context.Context, emit func(any)) {
	send := func(p aiPulse) {
		if p.Usage != nil {
			emit(aiUsageEvent{Type: "usage", aiUsage: p.Usage, UpdatedAt: p.UpdatedAt})
		}
		if p.Fleet != nil {
			emit(aiFleetEvent{Type: "fleet", aiFleet: p.Fleet, UpdatedAt: p.UpdatedAt})
		}
		emit(map[string]any{"type": "status", "state": p.State, "reason": p.Reason, "updatedAt": p.UpdatedAt})
	}
	send(s.aiPulseSnapshot(ctx))
	t := time.NewTicker(aiPulseInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			send(s.aiPulseSnapshot(ctx))
		}
	}
}

// aiPulseSnapshot returns the shared snapshot: a fresh cache hit, else one
// single-flighted produce that many concurrent SSE clients coalesce onto (so N
// streams cause ~one upstream sweep per aiPulseTTL).
func (s *Server) aiPulseSnapshot(ctx context.Context) aiPulse {
	if v, ok := s.cache.Get(aiPulseKey); ok {
		return v.(aiPulse)
	}
	v, _ := s.flight.do(aiPulseKey, func() (any, error) {
		p := s.produceAIPulse(ctx, serviceAuth())
		ttl := aiPulseTTL
		if p.State != "live" {
			ttl = aiPulseFailTTL
		}
		s.cache.Set(aiPulseKey, p, ttl, 30*time.Second)
		return p, nil
	})
	return v.(aiPulse)
}

// produceAIPulse reads both honest halves using auth (the KMS service bearer for the
// public SSE, or a signed-in admin's OWN bearer for the authed poll). It is "live"
// when either resolves; "unavailable" (with a reason) when there is no auth or every
// upstream fails.
func (s *Server) produceAIPulse(ctx context.Context, auth map[string]string) aiPulse {
	now := nowRFC()
	if auth == nil {
		return aiPulse{State: "unavailable", Reason: "sign in for live compute telemetry (or wire the service token)", UpdatedAt: now}
	}
	usage := s.buildAIUsage(ctx, auth)
	fleet := s.buildAIFleet(ctx, auth)
	if usage == nil && fleet == nil {
		return aiPulse{State: "unavailable", Reason: "compute plane unreachable", UpdatedAt: now}
	}
	return aiPulse{State: "live", UpdatedAt: now, Usage: usage, Fleet: fleet}
}

// buildAIUsage maps the measured platform usage ledger into the compute-panel
// shape, read with auth. nil when the ledger is unreachable (no auth / non-admin /
// upstream down) so the panel degrades honestly.
func (s *Server) buildAIUsage(ctx context.Context, auth map[string]string) *aiUsage {
	ov, err := s.fetchCloudUsage(ctx, "24h", auth)
	if err != nil {
		// Exact ledger denied → REAL platform usage from LLM observability (measured
		// requests/tokens + real model names), so AI Compute shows live numbers for an
		// operator instead of zeros. nil only when that is also unauthorized.
		if u, ok := s.fetchLLMUsage(ctx, auth); ok {
			return &aiUsage{
				Window:         "24h",
				RequestsPerSec: round1(float64(u.Requests) / 86400),
				TokensPerSec:   round1(float64(u.Tokens) / 86400),
				Requests24h:    u.Requests,
				Tokens24h:      u.Tokens,
				Models:         u.Models,
			}
		}
		return nil
	}
	window := ov.Range
	if window == "" {
		window = "24h"
	}
	return &aiUsage{
		Window:         window,
		RequestsPerSec: round1(usageRate(ov.Totals.Requests, ov.Series, ov.Interval, seriesRequests)),
		TokensPerSec:   round1(usageRate(ov.Totals.Tokens, ov.Series, ov.Interval, seriesTokens)),
		Requests24h:    ov.Totals.Requests,
		Tokens24h:      ov.Totals.Tokens,
		SpendCents:     ov.Totals.SpendCents,
		Models:         topModelsFromUsage(ov),
	}
}

// buildAIFleet reads the live serving fleet (visor machines/gpus + ai model
// catalog) with auth. nil only when the machines read fails; gpus/models are
// best-effort bonus counts.
func (s *Server) buildAIFleet(ctx context.Context, hdr map[string]string) *aiFleet {
	if hdr == nil {
		return nil
	}
	host := apiHost()

	var machines struct {
		Machines []struct {
			Region string `json:"region"`
			Status string `json:"status"`
		} `json:"machines"`
	}
	if err := s.getJSON(ctx, host+"/v1/machines", hdr, &machines); err != nil {
		return nil
	}
	var gpus struct {
		Gpus []struct {
			Region string `json:"region"`
		} `json:"gpus"`
	}
	_ = s.getJSON(ctx, host+"/v1/gpus", hdr, &gpus)
	var models struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = s.getJSON(ctx, host+"/v1/models", hdr, &models)

	regions := map[string]struct{}{}
	online := 0
	for _, m := range machines.Machines {
		if machineOnline(m.Status) {
			online++
		}
		if m.Region != "" {
			regions[m.Region] = struct{}{}
		}
	}
	for _, g := range gpus.Gpus {
		if g.Region != "" {
			regions[g.Region] = struct{}{}
		}
	}
	return &aiFleet{
		Machines:       len(machines.Machines),
		MachinesOnline: online,
		Gpus:           len(gpus.Gpus),
		Regions:        len(regions),
		ModelsServed:   len(models.Data),
	}
}
