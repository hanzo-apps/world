package world

import (
	"strings"
	"testing"
)

// feedChunks drives an extractor with the given chunking and returns the
// emitted reply text and thinking text.
func feedChunks(t *testing.T, chunks []string) (reply, think string) {
	t.Helper()
	var r, th strings.Builder
	x := newReplyExtractor(func(s string) { r.WriteString(s) })
	x.emitThink = func(s string) { th.WriteString(s) }
	for _, c := range chunks {
		x.Feed(c)
	}
	return r.String(), th.String()
}

func TestReplyExtractor(t *testing.T) {
	cases := []struct {
		name      string
		chunks    []string
		want      string
		wantThink string
	}{
		{"whole envelope", []string{`{"reply":"Hello world","actions":[]}`}, "Hello world", ""},
		{"split mid-value", []string{`{"reply":"Hel`, `lo wor`, `ld","actions":[]}`}, "Hello world", ""},
		{"split mid-key", []string{`{"re`, `ply":"hi"}`}, "hi", ""},
		{"escapes", []string{`{"reply":"a\nb\t\"q\" c\\d"}`}, "a\nb\t\"q\" c\\d", ""},
		{"escape split across chunks", []string{`{"reply":"x\`, `ny"}`}, "x\ny", ""},
		{"unicode escape", []string{`{"reply":"snow ☃!"}`}, "snow ☃!", ""},
		{"unicode escape split", []string{`{"reply":"a\u26`, `03b"}`}, "a☃b", ""},
		{"tool round stays silent", []string{`{"reply":"","tools":[{"name":"world_brief","arguments":{"n":5}}]}`}, "", ""},
		{"prose streams as thinking", []string{"Just a plain ", "prose answer."}, "", "Just a plain prose answer."},
		{"reasoning preamble then envelope", []string{"We need to answer briefly. ", `{"reply":"The answer.","actions":[]}`}, "The answer.", "We need to answer briefly. "},
		{"reasoning split around the brace", []string{"thinking…", " done ", `{"rep`, `ly":"yes"}`}, "yes", "thinking… done "},
		{"leading whitespace then envelope", []string{"  \n ", `{"reply":"ok"}`}, "ok", ""},
		{"other key first (defensive)", []string{`{"model":"x","reply":"later"}`}, "later", ""},
		{"stops at closing quote", []string{`{"reply":"done","actions":[{"type":"noise \"reply\":\"nope\""}]}`}, "done", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, think := feedChunks(t, tc.chunks)
			if got != tc.want || think != tc.wantThink {
				t.Errorf("got (%q, think %q), want (%q, think %q)", got, think, tc.want, tc.wantThink)
			}
		})
	}
}

// Byte-at-a-time is the cruellest chunking — every state transition lands on a
// boundary.
func TestReplyExtractorByteAtATime(t *testing.T) {
	in := `{"reply":"line1\nline2 é end","actions":[]}`
	chunks := make([]string, 0, len(in))
	for i := 0; i < len(in); i++ {
		chunks = append(chunks, in[i:i+1])
	}
	if got, _ := feedChunks(t, chunks); got != "line1\nline2 é end" {
		t.Errorf("got %q", got)
	}
}
