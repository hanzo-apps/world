package world

import (
	"context"
	"encoding/json"
	"fmt"
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
		model = "zen"
	}
	return &AIClient{
		base:  strings.TrimRight(base, "/"),
		key:   env("HANZO_AI_KEY", "HANZO_API_KEY", "HANZO_AI_TOKEN"),
		model: model,
	}
}

// configured reports whether an API key is present. Without one the AI
// endpoints return a clean "skipped" response rather than an error.
func (a *AIClient) configured() bool { return a.key != "" }

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
func (a *AIClient) chat(ctx context.Context, s *Server, system, user string, temperature float64, maxTokens int) (string, int, error) {
	reqBody, err := json.Marshal(chatRequest{
		Model:       a.model,
		Messages:    []chatMessage{{Role: "system", Content: system}, {Role: "user", Content: user}},
		Temperature: temperature,
		MaxTokens:   maxTokens,
		TopP:        0.9,
	})
	if err != nil {
		return "", 0, err
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	body, status, err := s.do(cctx, "POST", a.base+"/chat/completions", map[string]string{
		"Authorization": "Bearer " + a.key,
		"Content-Type":  "application/json",
	}, reqBody)
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
