package world

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// AIClient talks to Hanzo's own OpenAI-compatible inference gateway
// (api.hanzo.ai /v1 by default) instead of third-party LLM providers. The
// summarize/classify/brief endpoints route here; when it is unconfigured or
// fails, the handlers degrade cleanly (the SPA has a local fallback).
type AIClient struct {
	base  string
	key   string
	model string
}

func newAIClient() *AIClient {
	base := env("HANZO_AI_BASE", "HANZO_API_BASE")
	if base == "" {
		base = "https://api.hanzo.ai/v1"
	}
	model := env("HANZO_AI_MODEL")
	if model == "" {
		// "best" is the gateway's own routing alias (owned_by hanzo in /v1/models):
		// it always resolves to a servable model. A pinned family id (zen5) goes
		// dark whenever the plane's claim catalog shifts — an unclaimed id falls
		// through to a proxy that rejects every credential, killing all AI here.
		model = "best"
	}
	return &AIClient{
		base:  strings.TrimRight(base, "/"),
		key:   env("HANZO_AI_KEY", "HANZO_API_KEY", "HANZO_AI_TOKEN"),
		model: model,
	}
}

// userBearer extracts the caller's IAM token exactly as Hanzo services accept
// it: the Authorization header first, then the browser session cookies. This is
// the logged-in world.hanzo.ai user's token — forwarding it lets api.hanzo.ai
// derive their org + project + linked billing account and meter the inference to
// THEM. No shared key: user-facing AI runs on the normal IAM login flow.
func userBearer(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return h
	}
	for _, name := range []string{"hanzo_token", "access_token"} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			return "Bearer " + c.Value
		}
	}
	return ""
}

// bearerFor returns the Authorization value to use for an inference call. The
// signed-in user's IAM token is preferred (metered to their org/project/billing);
// a.key is only a fallback for keyed self-host/dev deployments (env HANZO_AI_KEY),
// never the path for a normal metered user on world.hanzo.ai.
func (a *AIClient) bearerFor(r *http.Request) string {
	if b := userBearer(r); b != "" {
		return b
	}
	if a.key != "" {
		return "Bearer " + a.key
	}
	return ""
}

// Tenant-selector headers the cloud gateway reads to scope a bearer call to a
// specific org/project. Only X-Org-Id is honored as a requested org, and only
// for a global-admin token (a normal token is re-pinned to its own owner); the
// value is otherwise inert but correct to forward. Evidence:
// hanzo/cloud/middleware_identity.go (Peek "X-Org-Id" / "X-Project-Id").
const (
	orgHeader     = "X-Org-Id"
	projectHeader = "X-Project-Id"
)

// aiForwardHeaders lifts the caller's active org/project selectors off the
// inbound request so the same-origin world backend forwards them upstream to
// api.hanzo.ai — the inference then meters to the org the user is acting in.
// Absent selectors forward nothing (the gateway falls back to the token owner),
// so this is backward-compatible with callers that don't send them.
func aiForwardHeaders(r *http.Request) map[string]string {
	out := map[string]string{}
	if v := strings.TrimSpace(r.Header.Get(orgHeader)); v != "" {
		out[orgHeader] = v
	}
	if v := strings.TrimSpace(r.Header.Get(projectHeader)); v != "" {
		out[projectHeader] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	TopP        float64       `json:"top_p,omitempty"`
}

type chatResponse struct {
	// ID is the gateway's response id (OpenAI chat.completion `id`). It is the
	// stable key a content-free reward signal is attributed to (POST /v1/feedback),
	// so it is threaded back out of every completion — never the prompt/response.
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

// chat runs a single system+user completion and returns the trimmed content.
// bearer is the Authorization value (the signed-in user's IAM token, so the
// inference meters to their org/project/billing); extra carries the caller's
// org/project selectors to forward upstream (aiForwardHeaders), nil when absent.
func (a *AIClient) chat(ctx context.Context, s *Server, bearer, system, user string, temperature float64, maxTokens int, extra map[string]string) (string, int, error) {
	return a.chatMessages(ctx, s, bearer,
		[]chatMessage{{Role: "system", Content: system}, {Role: "user", Content: user}},
		temperature, maxTokens, extra)
}

// chatMessages runs a multi-turn completion over a full messages array (system +
// prior turns) and returns the trimmed content. It is the single completion path;
// chat is the system+user special case. bearer is the caller's IAM token so the
// inference meters to their org/project/billing; extra forwards the caller's
// org/project selectors so it meters to the org the user is acting in. It drops
// the gateway response id — only the analyst's reward-signal path
// (runAnalystLoop → chatMessagesModel) needs it.
func (a *AIClient) chatMessages(ctx context.Context, s *Server, bearer string, messages []chatMessage, temperature float64, maxTokens int, extra map[string]string) (string, int, error) {
	out, tokens, _, err := a.chatMessagesModel(ctx, s, bearer, a.model, messages, temperature, maxTokens, extra)
	return out, tokens, err
}

// chatMessagesModel is chatMessages with an explicit model override — the single
// completion path once a caller (the analyst's model dropdown) chooses the model.
// An empty model falls back to the client default (a.model). Everything else —
// auth forwarding, org/project selectors, degrade semantics — is identical. It
// also returns the gateway response id (chatResponse.ID) so the analyst can key a
// content-free reward signal to it; "" when the gateway omits one.
func (a *AIClient) chatMessagesModel(ctx context.Context, s *Server, bearer, model string, messages []chatMessage, temperature float64, maxTokens int, extra map[string]string) (string, int, string, error) {
	if strings.TrimSpace(model) == "" {
		model = a.model
	}
	reqBody, err := json.Marshal(chatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		TopP:        0.9,
	})
	if err != nil {
		return "", 0, "", err
	}
	headers := map[string]string{
		"Authorization": bearer,
		"Content-Type":  "application/json",
	}
	for k, v := range extra {
		headers[k] = v
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	body, status, err := s.do(cctx, "POST", a.base+"/chat/completions", headers, reqBody)
	if err != nil {
		logf("world: ai request error: model=%s: %v", model, err)
		return "", 0, "", err
	}
	if status < 200 || status >= 300 {
		e := newAIError(status, body)
		logf("world: ai non-success: status=%d code=%q model=%s", status, e.code, model)
		return "", status, "", e
	}
	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		logf("world: ai decode error: status=%d model=%s: %v", status, model, err)
		return "", status, "", err
	}
	if len(cr.Choices) == 0 {
		// The gateway answers some failures — notably insufficient balance — with a
		// 2xx AND an error envelope carrying NO choices. Parse that envelope with the
		// SAME lenient logic aiStatusError uses so an out-of-credits user gets a typed,
		// actionable error (→ top-up CTA) instead of an opaque "empty response".
		if e := newAIError(status, body); e.code != "" || e.msg != "" {
			logf("world: ai 2xx empty-choices error: status=%d code=%q model=%s", status, e.code, model)
			return "", status, "", e
		}
		logf("world: ai 2xx empty response: status=%d model=%s", status, model)
		return "", status, "", fmt.Errorf("empty response")
	}
	return strings.TrimSpace(cr.Choices[0].Message.Content), cr.Usage.TotalTokens, cr.ID, nil
}

// aiError is a typed inference error carrying the upstream HTTP status plus the
// error {code,message} parsed from the response body, so callers can branch on
// the code (isBalanceError) instead of string-matching the rendered message. Its
// Error() reproduces the actionable one-liner the SPA renders verbatim in chat:
// "hanzo ai status <n>" plus the upstream code (or a short message) when present.
type aiError struct {
	status int
	code   string
	msg    string
}

func (e *aiError) Error() string {
	base := fmt.Sprintf("hanzo ai status %d", e.status)
	switch {
	case e.code != "":
		return base + ": " + e.code
	case e.msg != "":
		return base + ": " + trim80(e.msg)
	}
	return base
}

// parseAIErrorBody leniently extracts an error {code, message} from an inference
// or billing response body, across every shape the gateway/billing layers emit.
// It is the SINGLE parse shared by the non-2xx path (newAIError) and the 2xx
// empty-choices path (chatMessagesModel): the gateway answers some failures —
// notably insufficient balance — with HTTP 2xx and an error envelope carrying no
// choices, so both must read the same envelope. Empty strings ⇒ no error found.
//
//	{"error":{"code":"insufficient_balance","message":…}} → code
//	{"error":"unauthorized","message":…}                  → "unauthorized"
//	{"id":"Unauthorized","message":…}                     → "Unauthorized"
//	{"detail":…}                                          → message
func parseAIErrorBody(body []byte) (code, msg string) {
	var p struct {
		Error   json.RawMessage `json:"error"`
		Detail  string          `json:"detail"`
		ID      string          `json:"id"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &p) != nil {
		return "", ""
	}
	msg = strings.TrimSpace(p.Message)
	if len(p.Error) > 0 {
		// error is either a nested {code,message} object or a bare string.
		var eo struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(p.Error, &eo) == nil {
			code = strings.TrimSpace(eo.Code)
			if msg == "" {
				msg = strings.TrimSpace(eo.Message)
			}
		} else {
			var es string
			if json.Unmarshal(p.Error, &es) == nil {
				code = strings.TrimSpace(es)
			}
		}
	}
	if code == "" {
		code = strings.TrimSpace(p.ID)
	}
	if msg == "" {
		msg = strings.TrimSpace(p.Detail)
	}
	return code, msg
}

// newAIError builds a typed aiError from a response status + body.
func newAIError(status int, body []byte) *aiError {
	code, msg := parseAIErrorBody(body)
	return &aiError{status: status, code: code, msg: msg}
}

// aiStatusError turns a non-2xx inference response into an ACTIONABLE error. The
// SPA renders it verbatim in chat, so surfacing e.g. "insufficient_balance" turns
// a dead chat into a fixable one; a body it can't parse degrades to the bare status.
func aiStatusError(status int, body []byte) error {
	return newAIError(status, body)
}

// balanceErrorFrom reports whether err is the canonical "out of credits" signal
// the ONE AI gateway emits — HTTP 402 with code=insufficient_balance
// (hanzo/ai routers/filter_balance.go, the single balance-enforcement point).
// World is a thin client of that contract: it neither re-derives balance
// semantics (no message keyword-matching) nor invents codes the backend never
// sends. The analyst renders a top-up CTA for exactly this case.
func balanceErrorFrom(err error) bool {
	var ae *aiError
	if errors.As(err, &ae) {
		return ae.status == http.StatusPaymentRequired || ae.code == "insufficient_balance"
	}
	return false
}

// trim80 trims s to at most 80 characters (runes, never splitting UTF-8) so a
// long upstream message stays a compact one-liner in the chat error.
func trim80(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > 80 {
		return strings.TrimSpace(string(r[:80]))
	}
	return string(r)
}

// dateContext mirrors the original prompts' current-date grounding.
func dateContext(isTech bool) string {
	base := "Current date: " + time.Now().UTC().Format("2006-01-02") + "."
	if isTech {
		return base
	}
	return base + " Donald Trump is the current US President (second term, inaugurated Jan 2025)."
}
