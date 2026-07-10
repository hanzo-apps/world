package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
