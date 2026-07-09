package world

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsBlankBody(t *testing.T) {
	cases := []struct {
		body string
		want bool
	}{
		{"", true},
		{" ", true},
		{"\n\t  \r\n", true},
		{"{}", false},
		{"[]", false},
		{" x ", false},
		{`{"a":1}`, false},
	}
	for _, c := range cases {
		if got := isBlankBody([]byte(c.body)); got != c.want {
			t.Errorf("isBlankBody(%q) = %v, want %v", c.body, got, c.want)
		}
	}
}

func TestCacheNegativeDoesNotClobberValue(t *testing.T) {
	c := NewCache(16)
	c.Set("k", []byte("good"), time.Minute, time.Minute)
	c.SetNegative("k", negativeTTL)

	if !c.Negative("k") {
		t.Fatal("Negative(k) = false, want true after SetNegative")
	}
	// The negative marker must not have overwritten the real value.
	v, ok := c.Get("k")
	if !ok {
		t.Fatal("Get(k) lost the good value after SetNegative")
	}
	if string(v.([]byte)) != "good" {
		t.Fatalf("Get(k) = %q, want %q", v, "good")
	}
	if c.Negative("absent") {
		t.Fatal("Negative(absent) = true, want false")
	}
}

// upstreamStub is a counting httptest upstream with a settable response.
type upstreamStub struct {
	srv    *httptest.Server
	hits   int32
	status int
	body   string
}

func newUpstreamStub(status int, body string) *upstreamStub {
	u := &upstreamStub{status: status, body: body}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&u.hits, 1)
		w.WriteHeader(u.status)
		_, _ = w.Write([]byte(u.body))
	}))
	return u
}

func (u *upstreamStub) hitCount() int32 { return atomic.LoadInt32(&u.hits) }
func (u *upstreamStub) close()          { u.srv.Close() }

func TestPassthroughBlankBodyNotCached(t *testing.T) {
	up := newUpstreamStub(http.StatusOK, "   \n  ") // 200 but whitespace-only
	defer up.close()
	s := NewServer()

	degradedCalled := false
	rec := httptest.NewRecorder()
	s.passthrough(rec, "blank-key", up.srv.URL, "application/json", "public, max-age=300",
		nil, time.Minute, time.Minute,
		func(w http.ResponseWriter, err error) {
			degradedCalled = true
			writeJSON(w, http.StatusOK, "", map[string]any{"degraded": true})
		})

	if !degradedCalled {
		t.Fatal("degraded callback was not invoked for a blank 200")
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("degraded Cache-Control = %q, want no-store", got)
	}
	if _, ok := s.cache.Get("blank-key"); ok {
		t.Fatal("blank body was cached as a value (poisoned)")
	}
	if !s.cache.Negative("blank-key") {
		t.Fatal("blank body did not set a negative-cache marker")
	}
}

func TestPassthroughNegativeCacheSkipsUpstream(t *testing.T) {
	up := newUpstreamStub(http.StatusOK, "") // empty 200
	defer up.close()
	s := NewServer()

	degraded := func(w http.ResponseWriter, err error) {
		writeJSON(w, http.StatusOK, "", map[string]any{"degraded": true})
	}
	call := func() {
		rec := httptest.NewRecorder()
		s.passthrough(rec, "neg-key", up.srv.URL, "application/json", "public, max-age=300",
			nil, time.Minute, time.Minute, degraded)
	}
	call() // fetches, sees blank, sets negative
	call() // within negative window: must NOT hit upstream again

	if got := up.hitCount(); got != 1 {
		t.Fatalf("upstream hit %d times, want 1 (negative cache should short-circuit)", got)
	}
}

func TestPassthroughBlankServesStale(t *testing.T) {
	up := newUpstreamStub(http.StatusOK, "") // empty 200
	defer up.close()
	s := NewServer()

	// Prime a last-good body that is already past its fresh horizon but still
	// inside the stale window (deterministic: negative fresh ttl).
	s.cache.Set("stale-key", []byte(`{"good":true}`), -time.Second, time.Minute)

	rec := httptest.NewRecorder()
	degradedCalled := false
	s.passthrough(rec, "stale-key", up.srv.URL, "application/json", "public, max-age=300",
		nil, time.Minute, time.Minute,
		func(w http.ResponseWriter, err error) {
			degradedCalled = true
			writeJSON(w, http.StatusOK, "", map[string]any{"degraded": true})
		})

	if degradedCalled {
		t.Fatal("degraded fired even though a stale body was available")
	}
	if body := rec.Body.String(); body != `{"good":true}` {
		t.Fatalf("served body = %q, want the stale last-good body", body)
	}
}

func TestPassthroughGoodBodyCachedNormally(t *testing.T) {
	up := newUpstreamStub(http.StatusOK, `{"ok":true}`)
	defer up.close()
	s := NewServer()

	rec := httptest.NewRecorder()
	s.passthrough(rec, "good-key", up.srv.URL, "application/json", "public, max-age=300",
		nil, time.Minute, time.Minute,
		func(w http.ResponseWriter, err error) { t.Fatal("degraded fired for a good 200") })

	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Fatalf("good Cache-Control = %q, want the fresh policy", got)
	}
	v, ok := s.cache.Get("good-key")
	if !ok || string(v.([]byte)) != `{"ok":true}` {
		t.Fatalf("good body was not cached; got %v ok=%v", v, ok)
	}
	if s.cache.Negative("good-key") {
		t.Fatal("a good 200 set a negative-cache marker")
	}
}
