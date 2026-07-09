package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// ── AI Analyst (agentic control surface) ─────────────────────────────────────
//
// /v1/world/analyst is a multi-turn chat grounded in a client-composed snapshot
// of the live dashboard. It is BOTH a Q&A analyst and the dashboard's control
// surface: the model may answer in prose AND/OR emit a small vocabulary of typed
// actions that the SPA executor maps 1:1 to existing App capabilities (show/hide
// panels, reorder, toggle map layers, time range, variant, add an allowlisted RSS
// feed panel). The action contract lives HERE, in one place — the system prompt.
//
// Like every other AI endpoint, it forwards the CALLER's IAM bearer to Hanzo
// inference so usage meters to their org/project/billing. No shared key.

// analystMaxTurns caps how much history we forward (cost + context guard).
const analystMaxTurns = 12

// analystMaxContent caps a single message's content (abuse / OOM guard).
const analystMaxContent = 8000

// analystContextCap bounds the client-supplied grounding snapshot.
const analystContextCap = 12000

// handleAnalyst answers a multi-turn analyst conversation and, when the user asks
// for a change, returns typed actions for the SPA to execute.
func (s *Server) handleAnalyst(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var body struct {
		Messages []chatMessage `json:"messages"`
		Context  string        `json:"context"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	msgs := sanitizeAnalystMessages(body.Messages)
	if len(msgs) == 0 {
		writeError(w, http.StatusBadRequest, "messages array required")
		return
	}

	// Per-user billing: forward the signed-in caller's IAM token, never a shared
	// key. Signed-out callers get a quiet prompt to sign in (same as the other AI
	// endpoints), never a 5xx.
	bearer := s.ai.bearerFor(r)
	if bearer == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{
			"reply": "", "actions": []any{}, "fallback": true, "skipped": true,
			"reason": "Sign in to chat with the analyst",
		})
		return
	}

	system := analystSystemPrompt(body.Context)
	full := make([]chatMessage, 0, len(msgs)+1)
	full = append(full, chatMessage{Role: "system", Content: system})
	full = append(full, msgs...)

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	out, tokens, err := s.ai.chatMessages(ctx, s, bearer, full, 0.4, 700)
	if err != nil || out == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{
			"reply": "", "actions": []any{}, "fallback": true, "error": errStr(err),
		})
		return
	}

	reply, actions := parseAnalystOutput(out)
	writeJSON(w, http.StatusOK, "", map[string]any{
		"reply": reply, "actions": actions, "model": s.ai.model, "tokens": tokens,
	})
}

// sanitizeAnalystMessages validates roles, drops empties, caps content length,
// and keeps only the most recent analystMaxTurns turns.
func sanitizeAnalystMessages(in []chatMessage) []chatMessage {
	out := make([]chatMessage, 0, len(in))
	for _, m := range in {
		role := strings.ToLower(strings.TrimSpace(m.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		if len(content) > analystMaxContent {
			content = content[:analystMaxContent]
		}
		out = append(out, chatMessage{Role: role, Content: content})
	}
	if len(out) > analystMaxTurns {
		out = out[len(out)-analystMaxTurns:]
	}
	return out
}

// analystSystemPrompt frames the analyst persona, grounds it in the client
// snapshot, and specifies the STRICT-JSON action contract. This is the single
// source of truth for the action vocabulary.
func analystSystemPrompt(snapshot string) string {
	snapshot = strings.TrimSpace(snapshot)
	if len(snapshot) > analystContextCap {
		snapshot = snapshot[:analystContextCap]
	}
	ground := "No live dashboard snapshot was provided."
	if snapshot != "" {
		ground = "LIVE DASHBOARD SNAPSHOT (the user's current view — treat as ground truth):\n" + snapshot
	}

	return dateContext(false) + `

You are the Hanzo World analyst — an intelligence analyst embedded in a live
geopolitical/markets dashboard AND the dashboard's control surface. Answer the
user's questions grounded ONLY in the snapshot below and widely-known context; be
factual, concise, and specific. Do not invent numbers not present in the snapshot.

You can also RECONFIGURE the dashboard when the user asks for a change, by emitting
typed actions. Only emit actions when the user asks to change/rearrange/add/remove
something. For a plain question, reply in prose with NO actions.

Reply with STRICT JSON ONLY — no markdown, no code fences, no prose outside JSON:
{"reply": "<your message to the user>", "actions": [ <zero or more actions> ]}

Action types (use panel/layer keys EXACTLY as they appear in the snapshot):
- {"type":"show_panel","key":"<panelKey>"}
- {"type":"hide_panel","key":"<panelKey>"}
- {"type":"move_panel","key":"<panelKey>","position":"top"|"bottom"}   (or "before"/"after":"<otherKey>")
- {"type":"toggle_layer","key":"<layerKey>","on":true|false}
- {"type":"set_time_range","range":"1h"|"6h"|"24h"|"48h"|"7d"|"all"}
- {"type":"set_variant","variant":"full"|"tech"|"finance"|"saas"}
- {"type":"reset_layout"}
- {"type":"add_feed_panel","name":"<short title>","url":"<https RSS/Atom URL>"}
- {"type":"remove_custom_panel","name":"<title used when adding>"}

Rules:
- Prefer the fewest actions that satisfy the request. Reference panels by their
  names in "reply" (e.g. "moved Live News to the top"), but use their keys in the action.
- add_feed_panel only works for domains on the server RSS allowlist. If you are not
  sure a domain is allowlisted, still emit the action — the executor validates it and
  will report "domain not in the allowlist" if it is blocked. Never try to bypass it.
- Never emit an action type not listed above. Unknown or unsupported requests: explain
  briefly in "reply" with no action.
- "reply" is always present, even when there are actions (say what you changed).

` + ground
}

// analystAction is a permissive decode of one model-emitted action. The SPA
// executor re-validates every field before dispatching; the backend only needs
// to pass structurally-valid actions through.
type analystAction struct {
	Type     string `json:"type"`
	Key      string `json:"key,omitempty"`
	On       *bool  `json:"on,omitempty"`
	Before   string `json:"before,omitempty"`
	After    string `json:"after,omitempty"`
	Position string `json:"position,omitempty"`
	Range    string `json:"range,omitempty"`
	Variant  string `json:"variant,omitempty"`
	Name     string `json:"name,omitempty"`
	URL      string `json:"url,omitempty"`
}

var analystActionTypes = map[string]bool{
	"show_panel": true, "hide_panel": true, "move_panel": true, "toggle_layer": true,
	"set_time_range": true, "set_variant": true, "reset_layout": true,
	"add_feed_panel": true, "remove_custom_panel": true,
}

// parseAnalystOutput extracts {reply, actions} from the model output. The model
// is asked for strict JSON; if it wraps it in prose or fences, we recover the
// first JSON object. If nothing parses, the whole output is treated as the reply
// with no actions (safe degrade — a chat answer is never lost).
func parseAnalystOutput(raw string) (string, []analystAction) {
	obj := extractJSONObject(raw)
	if obj == "" {
		return strings.TrimSpace(raw), nil
	}
	var parsed struct {
		Reply   string          `json:"reply"`
		Actions []analystAction `json:"actions"`
	}
	if err := json.Unmarshal([]byte(obj), &parsed); err != nil {
		return strings.TrimSpace(raw), nil
	}
	actions := make([]analystAction, 0, len(parsed.Actions))
	for _, a := range parsed.Actions {
		if analystActionTypes[strings.ToLower(strings.TrimSpace(a.Type))] {
			a.Type = strings.ToLower(strings.TrimSpace(a.Type))
			actions = append(actions, a)
		}
	}
	reply := strings.TrimSpace(parsed.Reply)
	if reply == "" && len(actions) == 0 {
		return strings.TrimSpace(raw), nil
	}
	return reply, actions
}

// extractJSONObject returns the outermost {...} span in s (fence/prose tolerant),
// or "" if none is balanced.
func extractJSONObject(s string) string {
	start := strings.Index(s, "{")
	if start < 0 {
		return ""
	}
	depth, inStr, esc := 0, false, false
	for i := start; i < len(s); i++ {
		c := s[i]
		switch {
		case esc:
			esc = false
		case c == '\\' && inStr:
			esc = true
		case c == '"':
			inStr = !inStr
		case inStr:
			// skip
		case c == '{':
			depth++
		case c == '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}
