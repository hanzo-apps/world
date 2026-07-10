package world

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hanzoai/world/internal/world/mcp"
)

// canonicalCommands is the command set the SPA registry (app-commands.ts) defines.
// The embedded mirror (data/analyst_commands.json, generated from that registry)
// MUST cover exactly this set — this test is the drift guard between TS and Go.
var canonicalCommands = []string{
	"show_panel", "hide_panel", "move_panel", "resize_panel", "toggle_layer",
	"set_map_mode", "fly_to", "set_region", "set_time_range", "set_variant",
	"set_theme", "search", "reset_layout", "add_feed_panel", "remove_custom_panel",
	"switch_org",
}

func TestAnalystCommandManifest(t *testing.T) {
	cmds := defaultCommands()
	if len(cmds) == 0 {
		t.Fatal("embedded analyst_commands.json decoded to zero commands")
	}
	got := map[string]analystCommand{}
	for _, c := range cmds {
		if c.Name == "" {
			t.Fatalf("command with empty name: %+v", c)
		}
		if strings.TrimSpace(c.Description) == "" {
			t.Errorf("command %q has no description", c.Name)
		}
		if c.Params.Type != "object" {
			t.Errorf("command %q params.type = %q, want object", c.Name, c.Params.Type)
		}
		got[c.Name] = c
	}
	// Exact coverage of the canonical set (no missing, no stray).
	for _, name := range canonicalCommands {
		if _, ok := got[name]; !ok {
			t.Errorf("embedded manifest missing canonical command %q", name)
		}
	}
	if len(got) != len(canonicalCommands) {
		t.Errorf("embedded manifest has %d commands, canonical set has %d", len(got), len(canonicalCommands))
	}
	// Required params must exist in properties (well-formed schema).
	for _, c := range got {
		for _, req := range c.Params.Required {
			if _, ok := c.Params.Properties[req]; !ok {
				t.Errorf("command %q requires %q but it is not a declared property", c.Name, req)
			}
		}
	}
}

func TestSanitizeCommands(t *testing.T) {
	in := []analystCommand{
		{Name: "show_panel", Params: analystParams{Type: "object"}},
		{Name: "show_panel", Params: analystParams{Type: "object"}}, // dup dropped
		{Name: "", Params: analystParams{Type: "object"}},           // empty dropped
		{Name: "bad", Params: analystParams{Type: "string"}},        // non-object dropped
		{Name: " fly_to ", Params: analystParams{Type: "object"}},   // trimmed + kept
	}
	out := sanitizeCommands(in)
	if len(out) != 2 {
		t.Fatalf("sanitizeCommands kept %d, want 2: %+v", len(out), out)
	}
	if out[0].Name != "show_panel" || out[1].Name != "fly_to" {
		t.Fatalf("unexpected order/names: %+v", out)
	}
}

func TestRenderCommandContract(t *testing.T) {
	contract := renderCommandContract(defaultCommands())

	// Every command type must appear as an emittable action.
	for _, name := range canonicalCommands {
		if !strings.Contains(contract, `{"type":"`+name+`"`) {
			t.Errorf("contract missing command %q", name)
		}
	}
	// Enum values are rendered inline (deterministic set) for the model.
	for _, want := range []string{`"range":"1h|6h|24h|48h|7d|all"`, `"mode":"2d|3d"`, `"theme":"dark|light"`} {
		if !strings.Contains(contract, want) {
			t.Errorf("contract missing enum rendering %q", want)
		}
	}
	// Optional fields are marked with a trailing ? (fly_to.zoom is optional).
	if !strings.Contains(contract, `"zoom":<number>?`) {
		t.Errorf("contract did not mark optional zoom: \n%s", contract)
	}
	// Number/boolean types render without quotes.
	if !strings.Contains(contract, `"lat":<number>`) || !strings.Contains(contract, `"on":true|false`) {
		t.Errorf("contract number/boolean rendering wrong:\n%s", contract)
	}
}

func TestRenderCommandContractDeterministic(t *testing.T) {
	a := renderCommandContract(defaultCommands())
	for i := 0; i < 5; i++ {
		if b := renderCommandContract(defaultCommands()); b != a {
			t.Fatal("renderCommandContract is not deterministic across runs")
		}
	}
}

func TestParseAnalystOutput(t *testing.T) {
	allowed := commandTypes(defaultCommands())

	// Generic pass-through of allowed actions with arbitrary params.
	raw := `{"reply":"done","actions":[{"type":"fly_to","lat":35.6,"lon":139.7,"zoom":6},{"type":"nope","x":1}]}`
	reply, actions := parseAnalystOutput(raw, allowed)
	if reply != "done" {
		t.Fatalf("reply = %q, want done", reply)
	}
	if len(actions) != 1 {
		t.Fatalf("kept %d actions, want 1 (unknown type dropped): %+v", len(actions), actions)
	}
	if actions[0]["type"] != "fly_to" || actions[0]["lat"].(float64) != 35.6 {
		t.Fatalf("action not passed through intact: %+v", actions[0])
	}

	// Non-JSON output degrades to prose reply, no actions.
	reply, actions = parseAnalystOutput("just a sentence, no json", allowed)
	if reply != "just a sentence, no json" || actions != nil {
		t.Fatalf("plain-text degrade wrong: reply=%q actions=%+v", reply, actions)
	}

	// Fenced JSON is recovered.
	reply, actions = parseAnalystOutput("```json\n{\"reply\":\"hi\",\"actions\":[]}\n```", allowed)
	if reply != "hi" || len(actions) != 0 {
		t.Fatalf("fenced JSON not recovered: reply=%q actions=%+v", reply, actions)
	}
}

func TestParseAnalystTurnTools(t *testing.T) {
	allowed := commandTypes(defaultCommands())
	toolNames := toolNameSet(mcp.ToolSpecs())

	// A tool round: the model requests a known data tool (+ ignores an unknown one).
	raw := `{"reply":"","tools":[{"name":"world_brief","arguments":{"n":5}},{"name":"not_a_tool","arguments":{}}]}`
	reply, actions, calls := parseAnalystTurn(raw, allowed, toolNames)
	if reply != "" || len(actions) != 0 {
		t.Fatalf("tool round should have no reply/actions: reply=%q actions=%+v", reply, actions)
	}
	if len(calls) != 1 || calls[0].Name != "world_brief" {
		t.Fatalf("expected 1 valid tool call (world_brief), got %+v", calls)
	}
	if n, _ := calls[0].Args["n"].(float64); n != 5 {
		t.Fatalf("tool args not passed through: %+v", calls[0].Args)
	}

	// A final answer: reply + actions, no tools.
	reply, actions, calls = parseAnalystTurn(`{"reply":"done","actions":[{"type":"fly_to","lat":1,"lon":2}]}`, allowed, toolNames)
	if reply != "done" || len(actions) != 1 || len(calls) != 0 {
		t.Fatalf("final answer parse wrong: reply=%q actions=%+v calls=%+v", reply, actions, calls)
	}

	// nil toolNames disables tool extraction (the non-loop path).
	if _, _, calls = parseAnalystTurn(raw, allowed, nil); calls != nil {
		t.Fatalf("nil toolNames must not extract tools, got %+v", calls)
	}

	// Tool calls are capped per round.
	var many strings.Builder
	many.WriteString(`{"tools":[`)
	for i := 0; i < analystMaxToolsPerRound+3; i++ {
		if i > 0 {
			many.WriteByte(',')
		}
		many.WriteString(`{"name":"world_brief","arguments":{}}`)
	}
	many.WriteString(`]}`)
	if _, _, calls = parseAnalystTurn(many.String(), allowed, toolNames); len(calls) != analystMaxToolsPerRound {
		t.Fatalf("per-round cap not enforced: got %d, want %d", len(calls), analystMaxToolsPerRound)
	}
}

func TestRenderToolContract(t *testing.T) {
	contract := renderToolContract(mcp.ToolSpecs())
	// Every data tool must appear as a callable line.
	for _, want := range []string{"world_brief", "country_instability", "market_quotes", "feeds"} {
		if !strings.Contains(contract, "- "+want+"(") {
			t.Errorf("tool contract missing %q:\n%s", want, contract)
		}
	}
	// Required params render bare; optional params carry a trailing ?.
	if !strings.Contains(contract, "country_instability(iso)") {
		t.Errorf("required param not rendered bare:\n%s", contract)
	}
	if !strings.Contains(contract, "metric?") || !strings.Contains(contract, "n?") {
		t.Errorf("optional params not marked with ?:\n%s", contract)
	}
	// Deterministic across runs.
	for i := 0; i < 5; i++ {
		if renderToolContract(mcp.ToolSpecs()) != contract {
			t.Fatal("renderToolContract is not deterministic")
		}
	}
}

// TestAnalystDataToolLoop drives the full agentic loop end-to-end: a stub
// inference server first asks for the world_brief data tool, then (after the
// handler runs it IN-PROCESS through the mcp dispatcher and feeds the result back)
// returns a final grounded answer. The response must carry the tool trace and the
// reply, and the inference server must have been called exactly twice.
func TestAnalystDataToolLoop(t *testing.T) {
	var calls int32
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.Error(w, "unexpected path "+r.URL.Path, http.StatusNotFound)
			return
		}
		n := atomic.AddInt32(&calls, 1)
		var content string
		if n == 1 {
			// Round 1: request the data tool.
			content = `{"reply":"","tools":[{"name":"world_brief","arguments":{"n":3}}]}`
		} else {
			// Round 2: the handler must have injected a TOOL RESULTS turn carrying
			// the model envelope (asOf marker) before this call.
			body, _ := readAllString(r)
			if !strings.Contains(body, "TOOL RESULTS") || !strings.Contains(body, "asOf") {
				t.Errorf("final turn missing injected tool results: %s", body)
			}
			content = `{"reply":"Composite instability is steady; see the ranked movers.","actions":[]}`
		}
		writeChatCompletion(w, content)
	}))
	defer ai.Close()

	s := NewServer()
	s.ai.base = ai.URL
	s.ai.key = "test-key" // no user token → keyed bearer, so the chat path runs
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	reqBody, _ := json.Marshal(map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "What is the state of global instability?"}},
	})
	resp, err := http.Post(ts.URL+"/v1/world/analyst", "application/json", strings.NewReader(string(reqBody)))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out struct {
		Reply   string           `json:"reply"`
		Actions []map[string]any `json:"actions"`
		Traces  []struct {
			Label  string `json:"label"`
			OK     bool   `json:"ok"`
			Result string `json:"result"`
		} `json:"traces"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("inference calls = %d, want 2 (one tool round + final answer)", got)
	}
	if out.Reply == "" {
		t.Fatal("final reply is empty")
	}
	if len(out.Traces) != 1 {
		t.Fatalf("traces = %d, want 1: %+v", len(out.Traces), out.Traces)
	}
	tr := out.Traces[0]
	if !strings.HasPrefix(tr.Label, "world_brief(") {
		t.Errorf("trace label = %q, want world_brief(...)", tr.Label)
	}
	if !tr.OK {
		t.Errorf("world_brief trace should be ok=true: %+v", tr)
	}
	if !strings.Contains(tr.Result, "asOf") {
		t.Errorf("trace result should carry the model envelope (asOf): %q", tr.Result)
	}
}

// writeChatCompletion writes an OpenAI-shaped chat completion whose assistant
// content is body (the analyst strict-JSON envelope).
func writeChatCompletion(w http.ResponseWriter, body string) {
	resp := map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": body}}},
		"usage":   map[string]any{"total_tokens": 12},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func readAllString(r *http.Request) (string, error) {
	b, err := io.ReadAll(r.Body)
	return string(b), err
}

func TestSanitizeModelAndAgentRef(t *testing.T) {
	cases := map[string]string{
		"zen5":          "zen5",
		"zen5-flash":    "zen5-flash",
		"agent:my-bot":  "agent:my-bot",
		"  zen3-omni  ": "zen3-omni",
		"bad model!":    "", // space + ! invalid
		"":              "",
	}
	for in, want := range cases {
		if got := sanitizeModel(in); got != want {
			t.Errorf("sanitizeModel(%q) = %q, want %q", in, got, want)
		}
	}
	if agentRef("agent:my-bot") != "my-bot" {
		t.Errorf("agentRef(agent:my-bot) != my-bot")
	}
	if agentRef("zen5") != "" {
		t.Errorf("agentRef(zen5) should be empty")
	}
}

func TestExtractAgentText(t *testing.T) {
	cases := map[string]string{
		`{"output":"hello"}`:                             "hello",
		`{"result":"  spaced  "}`:                        "spaced",
		`{"output":{"text":"nested"}}`:                   "nested",
		`{"choices":[{"message":{"content":"openai"}}]}`: "openai",
		`{"nothing":true}`:                               "",
		`not json`:                                       "",
	}
	for in, want := range cases {
		if got := extractAgentText([]byte(in)); got != want {
			t.Errorf("extractAgentText(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHandleModelsCuratedRoster(t *testing.T) {
	s := NewServer()
	mux := http.NewServeMux()
	s.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// No bearer → curated Zen roster only, never a 5xx.
	resp, err := http.Get(ts.URL + "/v1/world/models")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("content-type = %q, want json", ct)
	}
	var body struct {
		Data []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
			Group string `json:"group"`
		} `json:"data"`
		Default string `json:"default"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Default != "zen5" {
		t.Errorf("default = %q, want zen5", body.Default)
	}
	if len(body.Data) == 0 {
		t.Fatal("empty model roster")
	}
	var hasZen5 bool
	for _, m := range body.Data {
		if m.ID == "zen5" {
			hasZen5 = true
		}
		if m.Group == "" || m.Label == "" {
			t.Errorf("model entry missing label/group: %+v", m)
		}
	}
	if !hasZen5 {
		t.Error("roster missing zen5")
	}
}
