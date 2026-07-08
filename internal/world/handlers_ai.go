package world

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// decodeJSONBody decodes a bounded request body into v.
func decodeJSONBody(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

var validLevels = map[string]bool{"critical": true, "high": true, "medium": true, "low": true, "info": true}
var validCategories = map[string]bool{
	"conflict": true, "protest": true, "disaster": true, "diplomatic": true, "economic": true, "terrorism": true,
	"cyber": true, "health": true, "environmental": true, "military": true, "crime": true, "infrastructure": true,
	"tech": true, "general": true,
}

// ── Summarize (groq/openrouter → Hanzo inference) ────────────────────────────

// handleSummarize backs both /api/groq-summarize and /api/openrouter-summarize,
// routed to Hanzo's own inference instead of a third-party LLM. Ported from
// api/groq-summarize.js + api/openrouter-summarize.js.
func (s *Server) handleSummarize(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var body struct {
		Headlines  []string `json:"headlines"`
		Mode       string   `json:"mode"`
		GeoContext string   `json:"geoContext"`
		Variant    string   `json:"variant"`
		Lang       string   `json:"lang"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if len(body.Headlines) == 0 {
		writeError(w, http.StatusBadRequest, "Headlines array required")
		return
	}
	bearer := s.ai.bearerFor(r)
	if bearer == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"summary": nil, "fallback": true, "skipped": true, "reason": "Sign in to enable AI insights"})
		return
	}
	mode := body.Mode
	if mode == "" {
		mode = "brief"
	}
	variant := body.Variant
	if variant == "" {
		variant = "full"
	}
	isTech := variant == "tech"
	heads := body.Headlines
	if len(heads) > 8 {
		heads = heads[:8]
	}
	numbered := numberLines(heads)
	intel := ""
	if body.GeoContext != "" {
		intel = "\n\n" + body.GeoContext
	}
	langNote := ""
	if body.Lang != "" && body.Lang != "en" {
		langNote = "\nIMPORTANT: Output the summary in " + body.Lang + " language."
	}

	var system, user string
	switch mode {
	case "analysis":
		system = dateContext(isTech) + " You are a geopolitical analyst. Identify the single most important pattern or risk in these headlines in 2-3 sentences." + langNote
		user = "What's the key pattern or risk?\n" + numbered + intel
	case "translate":
		system = "You are a professional news translator. Translate the text faithfully into " + variant + ", preserving meaning and tone. Output only the translation."
		user = "Translate to " + variant + ":\n" + body.Headlines[0]
	case "brief":
		system = dateContext(isTech) + " Summarize the key development across these headlines in 2-3 clear sentences. Be factual and concise." + langNote
		user = "Summarize the top story:\n" + numbered + intel
	default:
		system = dateContext(isTech) + " Synthesize the key takeaway from these headlines in 2 sentences." + langNote
		user = "Key takeaway:\n" + numbered + intel
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	out, tokens, err := s.ai.chat(ctx, s, bearer, system, user, 0.3, 150)
	if err != nil || out == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"summary": nil, "fallback": true, "error": errStr(err)})
		return
	}
	writeJSON(w, http.StatusOK, "public, max-age=1800, s-maxage=1800, stale-while-revalidate=300",
		map[string]any{"summary": out, "model": s.ai.model, "provider": "hanzo", "cached": false, "tokens": tokens})
}

// ── Classify batch ───────────────────────────────────────────────────────────

// handleClassifyBatch classifies a batch of headlines into threat level +
// category via Hanzo inference. Ported from api/classify-batch.js.
func (s *Server) handleClassifyBatch(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var body struct {
		Titles  []string `json:"titles"`
		Variant string   `json:"variant"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if len(body.Titles) == 0 {
		writeError(w, http.StatusBadRequest, "titles array required")
		return
	}
	bearer := s.ai.bearerFor(r)
	if bearer == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"results": []any{}, "fallback": true, "skipped": true, "reason": "Sign in to enable AI insights"})
		return
	}
	titles := body.Titles
	if len(titles) > 20 {
		titles = titles[:20]
	}
	system := classifySystemPrompt(body.Variant == "tech", true)
	user := numberLines(titles)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	out, _, err := s.ai.chat(ctx, s, bearer, system, user, 0, len(titles)*60)
	results := make([]any, len(titles))
	if err == nil {
		parsed := parseClassifyArray(out)
		for i := range titles {
			if i < len(parsed) && parsed[i] != nil {
				results[i] = map[string]any{"level": parsed[i]["level"], "category": parsed[i]["category"], "cached": false}
			}
		}
	}
	fallback := err != nil
	resp := map[string]any{"results": results}
	if fallback {
		resp["fallback"] = true
	}
	writeJSON(w, http.StatusOK, "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600", resp)
}

// ── Classify single event ────────────────────────────────────────────────────

// handleClassifyEvent classifies a single headline. Ported from
// api/classify-event.js.
func (s *Server) handleClassifyEvent(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	title := r.URL.Query().Get("title")
	if title == "" {
		writeError(w, http.StatusBadRequest, "title param required")
		return
	}
	bearer := s.ai.bearerFor(r)
	if bearer == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"fallback": true, "skipped": true, "reason": "Sign in to enable AI insights"})
		return
	}
	system := classifySystemPrompt(r.URL.Query().Get("variant") == "tech", false)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, _, err := s.ai.chat(ctx, s, bearer, system, title, 0, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, "", map[string]any{"fallback": true})
		return
	}
	obj := parseClassifyObject(out)
	if obj == nil {
		writeJSON(w, http.StatusInternalServerError, "", map[string]any{"fallback": true})
		return
	}
	writeJSON(w, http.StatusOK, "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
		map[string]any{"level": obj["level"], "category": obj["category"], "confidence": 0.9, "source": "llm", "cached": false})
}

// ── Country intel brief ──────────────────────────────────────────────────────

// handleCountryIntel generates an analyst brief for a country. Ported from
// api/country-intel.js.
func (s *Server) handleCountryIntel(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "POST, OPTIONS") {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var body struct {
		Country string         `json:"country"`
		Code    string         `json:"code"`
		Context map[string]any `json:"context"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Country == "" || body.Code == "" {
		writeError(w, http.StatusBadRequest, "country and code required")
		return
	}
	bearer := s.ai.bearerFor(r)
	if bearer == "" {
		writeJSON(w, http.StatusOK, "", map[string]any{"intel": nil, "fallback": true, "skipped": true, "reason": "Sign in to enable AI insights"})
		return
	}
	system := dateContext(false) + " You are a senior intelligence analyst. Produce a concise country brief with sections: Current Situation; Military & Security Posture; Key Risk Factors; Regional Context; Outlook & Watch Items. 5-6 paragraphs, factual, cite provided headlines as [N] where relevant."
	dataSection := "\nNo real-time sensor data available for this country."
	if len(body.Context) > 0 {
		if b, err := json.Marshal(body.Context); err == nil {
			dataSection = "\nCURRENT SENSOR DATA:\n" + string(b)
		}
	}
	user := "Country: " + body.Country + " (" + body.Code + ")" + dataSection
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	brief, _, err := s.ai.chat(ctx, s, bearer, system, user, 0.4, 900)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, "", map[string]any{"error": "AI service error", "fallback": true})
		return
	}
	writeJSON(w, http.StatusOK, "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
		map[string]any{"brief": brief, "country": body.Country, "code": body.Code, "model": s.ai.model, "generatedAt": nowISO()})
}

// ── AI helpers ───────────────────────────────────────────────────────────────

func classifySystemPrompt(isTech, batch bool) string {
	focus := "Focus on geopolitical, conflict and security relevance."
	if isTech {
		focus = "Focus on technology, AI, startups and markets."
	}
	ret := `Return: {"level":"...","category":"..."}`
	if batch {
		ret = `Return a JSON array with one object per headline in order: [{"level":"...","category":"..."},...]`
	}
	return "You classify news headlines into threat level and category. Return ONLY valid JSON, no other text.\n" +
		"Levels: critical, high, medium, low, info\n" +
		"Categories: conflict, protest, disaster, diplomatic, economic, terrorism, cyber, health, environmental, military, crime, infrastructure, tech, general\n" +
		focus + "\n" + ret
}

func parseClassifyArray(raw string) []map[string]string {
	raw = strings.TrimSpace(raw)
	var arr []map[string]string
	if json.Unmarshal([]byte(raw), &arr) != nil {
		i, j := strings.Index(raw, "["), strings.LastIndex(raw, "]")
		if i < 0 || j <= i {
			return nil
		}
		if json.Unmarshal([]byte(raw[i:j+1]), &arr) != nil {
			return nil
		}
	}
	for k, item := range arr {
		if !validLevels[item["level"]] || !validCategories[item["category"]] {
			arr[k] = nil
		}
	}
	return arr
}

func parseClassifyObject(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	var obj map[string]string
	if json.Unmarshal([]byte(raw), &obj) != nil {
		i, j := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
		if i < 0 || j <= i || json.Unmarshal([]byte(raw[i:j+1]), &obj) != nil {
			return nil
		}
	}
	if !validLevels[obj["level"]] || !validCategories[obj["category"]] {
		return nil
	}
	return obj
}

func numberLines(items []string) string {
	var b strings.Builder
	for i, it := range items {
		b.WriteString(itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(it)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func errStr(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}
