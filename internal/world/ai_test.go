package world

import "testing"

// TestAIStatusError: the non-2xx inference body is parsed into an actionable
// error across every shape the gateway/billing layers emit; an unparseable body
// degrades to the bare status.
func TestAIStatusError(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"nested code", 402, `{"error":{"code":"insufficient_balance","message":"no funds"}}`, "hanzo ai status 402: insufficient_balance"},
		{"nested spend cap", 402, `{"error":{"code":"spend_cap_exceeded","message":"cap hit"}}`, "hanzo ai status 402: spend_cap_exceeded"},
		{"error string", 401, `{"error":"unauthorized","message":"bad token"}`, "hanzo ai status 401: unauthorized"},
		{"id + message", 401, `{"id":"Unauthorized","message":"login required"}`, "hanzo ai status 401: Unauthorized"},
		{"detail only", 400, `{"detail":"missing field query"}`, "hanzo ai status 400: missing field query"},
		{"nested message no code", 403, `{"error":{"message":"forbidden here"}}`, "hanzo ai status 403: forbidden here"},
		{"unparseable html", 500, `<html>502 bad gateway</html>`, "hanzo ai status 500"},
		{"empty body", 429, ``, "hanzo ai status 429"},
	}
	for _, c := range cases {
		if got := aiStatusError(c.status, []byte(c.body)).Error(); got != c.want {
			t.Errorf("%s: aiStatusError(%d, %q) = %q, want %q", c.name, c.status, c.body, got, c.want)
		}
	}
}

// TestTrim80 caps a long upstream message to 80 runes without splitting UTF-8.
func TestTrim80(t *testing.T) {
	long := ""
	for i := 0; i < 200; i++ {
		long += "x"
	}
	if got := trim80(long); len([]rune(got)) != 80 {
		t.Fatalf("trim80 long = %d runes, want 80", len([]rune(got)))
	}
	if got := trim80("  short  "); got != "short" {
		t.Fatalf("trim80 trimmed = %q, want %q", got, "short")
	}
}
