package model

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestHTTPStreamAndChanges drives the real HTTP handlers end-to-end with a
// controlled source: a fold that surges news volume must (a) push an SSE `delta`
// event to a live subscriber and (b) show up in changes?since. This proves the
// query/SSE plane without depending on any throttled external feed.
func TestHTTPStreamAndChanges(t *testing.T) {
	dir := t.TempDir()
	vol := 10.0
	src := Source{Name: "stub", Poll: func() ([]Observation, error) {
		return []Observation{{
			ID: "US", Kind: KindCountry, Name: "United States",
			Metrics: map[string]float64{MetricBaseline: 5, MetricNewsVolume: vol, MetricSentiment: -2},
		}}, nil
	}}
	e := New([]Source{src}, dir, time.Hour)

	mux := http.NewServeMux()
	e.Mount(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// Cycle 1: cold populate (no changes — entity is created, not "moved").
	e.IngestOnce(context.Background())
	asOf1 := e.store.AsOf()

	// Subscribe over real HTTP SSE.
	resp, err := http.Get(ts.URL + "/v1/world/model/stream")
	if err != nil {
		t.Fatalf("stream GET: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("stream content-type = %q, want text/event-stream", ct)
	}

	events := make(chan sseEvent, 8)
	go readSSE(resp.Body, events)

	// First event is the initial snapshot — and receiving it proves the server
	// has registered our subscriber, so the next fold's delta will reach us.
	if ev := waitEvent(t, events); ev.name != "snapshot" {
		t.Fatalf("first event = %q, want snapshot", ev.name)
	}

	// Cycle 2: news volume surges 10 -> 90. Fold in the background.
	vol = 90
	go e.IngestOnce(context.Background())

	// The live subscriber must receive a delta for US.
	ev := waitEvent(t, events)
	if ev.name != "delta" {
		t.Fatalf("second event = %q, want delta", ev.name)
	}
	if !strings.Contains(ev.data, `"id":"US"`) {
		t.Fatalf("delta payload missing US: %s", ev.data)
	}

	// changes?since replays the same move over HTTP JSON.
	cr, err := http.Get(ts.URL + "/v1/world/model/changes?since=" + asOf1.Add(-time.Second).Format(time.RFC3339))
	if err != nil {
		t.Fatalf("changes GET: %v", err)
	}
	defer cr.Body.Close()
	var body struct {
		Count   int      `json:"count"`
		Changes []Change `json:"changes"`
	}
	if err := json.NewDecoder(cr.Body).Decode(&body); err != nil {
		t.Fatalf("changes decode: %v", err)
	}
	if body.Count < 1 || body.Changes[0].ID != "US" {
		t.Fatalf("changes?since = %+v, want >=1 US change", body)
	}
}

type sseEvent struct{ name, data string }

// readSSE parses the SSE line protocol into (event, data) pairs.
func readSSE(r interface{ Read([]byte) (int, error) }, out chan<- sseEvent) {
	br := bufio.NewReader(r)
	var name string
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			close(out)
			return
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: ") && name != "":
			out <- sseEvent{name, strings.TrimPrefix(line, "data: ")}
			name = ""
		}
	}
}

func waitEvent(t *testing.T, ch <-chan sseEvent) sseEvent {
	t.Helper()
	select {
	case ev, ok := <-ch:
		if !ok {
			t.Fatal("SSE stream closed before an event arrived")
		}
		return ev
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for SSE event")
		return sseEvent{}
	}
}
