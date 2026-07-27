package world

import (
	"net"
	"testing"

	"github.com/valyala/fasthttp"
)

// serveLive puts s on a loopback port and returns the running server. It is the
// ONE way the suite reaches the data plane, and it uses the same fasthttp wire
// cmd/world listens on — so streaming routes stream in tests exactly as they do
// in production, which an in-process adapter could not do (it would buffer an
// event stream forever).
func serveLive(t *testing.T, s *Server) *liveServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ts := &liveServer{URL: "http://" + ln.Addr().String(), ln: ln}
	go func() { _ = fasthttp.Serve(ln, s.NewApp().Fiber().Handler()) }()
	t.Cleanup(ts.Close)
	return ts
}

// liveServer is a running world app; URL is its base address.
type liveServer struct {
	URL string
	ln  net.Listener
}

// Close stops the listener. Safe to call more than once (t.Cleanup plus an
// explicit defer in a test both run).
func (ts *liveServer) Close() { _ = ts.ln.Close() }
