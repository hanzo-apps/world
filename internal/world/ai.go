package world

import (
	"context"
	"encoding/json"
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
		// zen5 = the current flagship general Zen chat model. The bare "zen" alias
		// is NOT a servable id (api.hanzo.ai/v1/models), so it would 4xx and force
		// every AI endpoint (analyst included) into its fallback path.
		model = "zen5"
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
// org/project selectors so it meters to the org the user is acting in.
func (a *AIClient) chatMessages(ctx context.Context, s *Server, bearer string, messages []chatMessage, temperature float64, maxTokens int, extra map[string]string) (string, int, error) {
	return a.chatMessagesModel(ctx, s, bearer, a.model, messages, temperature, maxTokens, extra)
}

// chatMessagesModel is chatMessages with an explicit model override — the single
// completion path once a caller (the analyst's model dropdown) chooses the model.
// An empty model falls back to the client default (a.model). Everything else —
// auth forwarding, org/project selectors, degrade semantics — is identical.
func (a *AIClient) chatMessagesModel(ctx context.Context, s *Server, bearer, model string, messages []chatMessage, temperature float64, maxTokens int, extra map[string]string) (string, int, error) {
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
		return "", 0, err
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
		return "", 0, err
	}
	if status < 200 || status >= 300 {
		return "", status, fmt.Errorf("hanzo ai status %d", status)
	}
	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		return "", status, err
	}
	if len(cr.Choices) == 0 {
		return "", status, fmt.Errorf("empty response")
	}
	return strings.TrimSpace(cr.Choices[0].Message.Content), cr.Usage.TotalTokens, nil
}

// dateContext mirrors the original prompts' current-date grounding.
func dateContext(isTech bool) string {
	base := "Current date: " + time.Now().UTC().Format("2006-01-02") + "."
	if isTech {
		return base
	}
	return base + " Donald Trump is the current US President (second term, inaugurated Jan 2025)."
}
