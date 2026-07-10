package mcp_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hanzoai/world/internal/world"
	"github.com/hanzoai/world/internal/world/mcp"
)

// ── discovery drift guards (like agentskills' index.json) ────────────────────

// TestServerCardNotDrifted: the on-disk server-card.json MUST equal the
// freshly-built card byte-for-byte. A tool/app/shell edit not regenerated with
// `go generate ./internal/world/mcp` fails here instead of shipping a stale card.
func TestServerCardNotDrifted(t *testing.T) {
	card, err := mcp.BuildCard()
	if err != nil {
		t.Fatalf("build card: %v", err)
	}
	want, err := mcp.Marshal(card)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := os.ReadFile(mcp.CardRelPath)
	if err != nil {
		t.Fatalf("read server-card.json: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("server-card.json is stale — run `go generate ./internal/world/mcp`.\n--- on disk ---\n%s\n--- expected ---\n%s", got, want)
	}
}

// TestServerJSONNotDrifted: the root registry manifest must match too.
func TestServerJSONNotDrifted(t *testing.T) {
	want, err := mcp.Marshal(mcp.BuildServerJSON())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := os.ReadFile(mcp.ServerJSONRelPath)
	if err != nil {
		t.Fatalf("read server.json: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("server.json is stale — run `go generate ./internal/world/mcp`.\n--- on disk ---\n%s\n--- expected ---\n%s", got, want)
	}
}

// TestShellDigestsMatch independently recomputes each app shell's digest from the
// generated card and the on-disk source (belt-and-suspenders vs BuildCard).
func TestShellDigestsMatch(t *testing.T) {
	card, err := mcp.BuildCard()
	if err != nil {
		t.Fatalf("build card: %v", err)
	}
	if len(card.Apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(card.Apps))
	}
	for _, a := range card.Apps {
		name := strings.TrimPrefix(a.URI, "ui://world/")
		b, err := os.ReadFile(filepath.Join("shells", name+".html"))
		if err != nil {
			t.Fatalf("%s: read shell: %v", a.Name, err)
		}
		sum := sha256.Sum256(b)
		if got := hex.EncodeToString(sum[:]); got != a.SHA256 {
			t.Errorf("%s: digest %s, want %s", a.Name, got, a.SHA256)
		}
	}
}

// ── app-shell safety: data-free + no innerHTML ───────────────────────────────

// TestShellsAreSafe enforces the app-shell contract: rendered only via textContent
// (never innerHTML/outerHTML/insertAdjacentHTML/document.write), no external refs
// or network (data-free), a strict CSP, and the two-phase ready signal.
func TestShellsAreSafe(t *testing.T) {
	shells, _ := filepath.Glob(filepath.Join("shells", "*.html"))
	if len(shells) != 2 {
		t.Fatalf("expected 2 shells, found %d", len(shells))
	}
	banned := []string{
		"innerHTML", "outerHTML", "insertAdjacentHTML", "document.write",
		"http://", "https://", // no external refs / embedded links → no exfil
		"fetch(", "XMLHttpRequest", "WebSocket", "eval(",
	}
	required := []string{
		"Content-Security-Policy", "default-src 'none'",
		"textContent",     // rendering path
		`"mcp:ui:ready"`,  // two-phase: data arrives after mount
		`"mcp:ui:render"`, // host→shell data push
	}
	for _, path := range shells {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		body := string(b)
		base := filepath.Base(path)
		for _, bad := range banned {
			if strings.Contains(body, bad) {
				t.Errorf("%s: must not contain %q (shell must be data-free + textContent-only)", base, bad)
			}
		}
		for _, want := range required {
			if !strings.Contains(body, want) {
				t.Errorf("%s: missing required marker %q", base, want)
			}
		}
	}
}

// ── every tool wraps a real route (like agentskills' registration check) ─────

// TestToolRoutesAreRegistered: each tool's underlying endpoint must be a real,
// mounted /v1/world route — no tool can wrap a path that does not exist.
func TestToolRoutesAreRegistered(t *testing.T) {
	routes := map[string]bool{}
	for _, r := range world.NewServer().Routes() {
		routes[r] = true
	}
	if !routes["/v1/world/mcp"] {
		t.Errorf("/v1/world/mcp is not registered on the world mux")
	}
	card, err := mcp.BuildCard()
	if err != nil {
		t.Fatalf("build card: %v", err)
	}
	for _, tool := range card.Tools {
		if !routes[tool.Endpoint] {
			t.Errorf("%s: endpoint %q is not a registered /v1/world route", tool.Name, tool.Endpoint)
		}
	}
}

// ── JSON-RPC round-trip over the live wiring ─────────────────────────────────

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// rpc POSTs a JSON-RPC request to the live MCP endpoint and returns the response.
func rpc(t *testing.T, ts *httptest.Server, id int, method string, params any) rpcResp {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": id, "method": method, "params": params,
	})
	res, err := http.Post(ts.URL+mcp.Endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("%s: post: %v", method, err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("%s: status %d: %s", method, res.StatusCode, b)
	}
	var out rpcResp
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("%s: decode: %v", method, err)
	}
	if out.Error != nil {
		t.Fatalf("%s: rpc error %d: %s", method, out.Error.Code, out.Error.Message)
	}
	return out
}

// TestJSONRPCRoundTrip exercises initialize → tools/list → tools/call →
// resources/list → resources/read against the real world server wiring. The
// tools/call targets world_brief (model/top), which is fully in-memory (no
// upstream fetch), so the test is hermetic.
func TestJSONRPCRoundTrip(t *testing.T) {
	srv := world.NewServer()
	mux := http.NewServeMux()
	srv.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// initialize
	init := rpc(t, ts, 1, "initialize", map[string]any{
		"protocolVersion": mcp.ProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "test", "version": "0"},
	})
	var initRes struct {
		ProtocolVersion string `json:"protocolVersion"`
		ServerInfo      struct {
			Name string `json:"name"`
		} `json:"serverInfo"`
		Capabilities struct {
			Tools     *struct{} `json:"tools"`
			Resources *struct{} `json:"resources"`
		} `json:"capabilities"`
	}
	mustJSON(t, init.Result, &initRes)
	if initRes.ProtocolVersion != mcp.ProtocolVersion {
		t.Errorf("initialize protocolVersion = %q, want %q", initRes.ProtocolVersion, mcp.ProtocolVersion)
	}
	if initRes.ServerInfo.Name != mcp.ServerName {
		t.Errorf("serverInfo.name = %q, want %q", initRes.ServerInfo.Name, mcp.ServerName)
	}
	if initRes.Capabilities.Tools == nil || initRes.Capabilities.Resources == nil {
		t.Errorf("initialize must advertise tools + resources capabilities")
	}

	// tools/list
	list := rpc(t, ts, 2, "tools/list", map[string]any{})
	var listRes struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	mustJSON(t, list.Result, &listRes)
	if len(listRes.Tools) != 7 {
		t.Fatalf("tools/list returned %d tools, want 7", len(listRes.Tools))
	}
	names := map[string]bool{}
	for _, tl := range listRes.Tools {
		if tl.Name == "" || tl.Description == "" || len(tl.InputSchema) == 0 {
			t.Errorf("tool %q has empty name/description/inputSchema", tl.Name)
		}
		names[tl.Name] = true
	}
	for _, want := range []string{"world_brief", "country_instability", "model_history", "market_quotes", "chain_status", "traffic_map", "feeds"} {
		if !names[want] {
			t.Errorf("tools/list missing %q", want)
		}
	}

	// tools/call world_brief (hermetic: in-memory model store)
	call := rpc(t, ts, 3, "tools/call", map[string]any{
		"name":      "world_brief",
		"arguments": map[string]any{"n": 5},
	})
	var callRes struct {
		IsError bool `json:"isError"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StructuredContent map[string]any `json:"structuredContent"`
	}
	mustJSON(t, call.Result, &callRes)
	if callRes.IsError {
		t.Errorf("world_brief returned isError=true")
	}
	if len(callRes.Content) == 0 || callRes.Content[0].Type != "text" {
		t.Fatalf("world_brief content malformed: %+v", callRes.Content)
	}
	// The wrapped data-route body must be the model envelope (has an asOf field).
	var env map[string]any
	if err := json.Unmarshal([]byte(callRes.Content[0].Text), &env); err != nil {
		t.Fatalf("world_brief text is not JSON: %v", err)
	}
	if _, ok := env["asOf"]; !ok {
		t.Errorf("world_brief envelope missing asOf: %v", env)
	}
	if callRes.StructuredContent == nil {
		t.Errorf("world_brief missing structuredContent")
	}

	// unknown tool → JSON-RPC error (protocol-level), not a result
	if got := rawRPC(t, ts, 4, "tools/call", map[string]any{"name": "nope"}); got.Error == nil {
		t.Errorf("unknown tool should return a JSON-RPC error")
	}

	// resources/list → 2 ui:// apps
	rl := rpc(t, ts, 5, "resources/list", map[string]any{})
	var rlRes struct {
		Resources []struct {
			URI      string `json:"uri"`
			MimeType string `json:"mimeType"`
		} `json:"resources"`
	}
	mustJSON(t, rl.Result, &rlRes)
	if len(rlRes.Resources) != 2 {
		t.Fatalf("resources/list returned %d, want 2", len(rlRes.Resources))
	}

	// resources/read → data-free shell HTML
	rr := rpc(t, ts, 6, "resources/read", map[string]any{"uri": "ui://world/world-brief"})
	var rrRes struct {
		Contents []struct {
			URI      string `json:"uri"`
			MimeType string `json:"mimeType"`
			Text     string `json:"text"`
		} `json:"contents"`
	}
	mustJSON(t, rr.Result, &rrRes)
	if len(rrRes.Contents) != 1 {
		t.Fatalf("resources/read returned %d contents, want 1", len(rrRes.Contents))
	}
	c := rrRes.Contents[0]
	if c.MimeType != mcp.AppMimeType {
		t.Errorf("shell mimeType = %q, want %q", c.MimeType, mcp.AppMimeType)
	}
	if !strings.Contains(c.Text, "<!doctype html>") || !strings.Contains(c.Text, "textContent") {
		t.Errorf("shell does not look like the expected HTML shell")
	}
	if strings.Contains(c.Text, "innerHTML") {
		t.Errorf("shell returned by resources/read contains innerHTML")
	}
	// Data-free: the shell ships its "Awaiting data" placeholder (it renders
	// nothing until the host pushes tool output over the bridge) and carries no
	// concrete rendered rows.
	if !strings.Contains(c.Text, "Awaiting data") {
		t.Errorf("shell must be data-free (ship the awaiting-data placeholder)")
	}
	if strings.Contains(c.Text, "instability\":") {
		t.Errorf("shell must be data-free but appears to embed live model values")
	}
}

// TestGETReturns405 confirms the transport rejects GET (no server-initiated SSE).
func TestGETReturns405(t *testing.T) {
	srv := world.NewServer()
	mux := http.NewServeMux()
	srv.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	res, err := http.Get(ts.URL + mcp.Endpoint)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET %s = %d, want 405", mcp.Endpoint, res.StatusCode)
	}
}

func mustJSON(t *testing.T, raw json.RawMessage, v any) {
	t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("unmarshal result: %v\n%s", err, raw)
	}
}

// rawRPC posts without failing on an rpc-level error (used to assert errors).
func rawRPC(t *testing.T, ts *httptest.Server, id int, method string, params any) rpcResp {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	res, err := http.Post(ts.URL+mcp.Endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	var out rpcResp
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}
