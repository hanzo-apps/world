package world

// The one seam between zip and the net/http handlers. The handlers stay
// net/http because that is where their behaviour is defined — method dispatch,
// CORS, cache headers, upstream proxying — and a rewrite would be a rewrite, not
// a migration. This file is the whole cost of that decision: a path translation,
// a buffered bridge, and a streaming bridge for the endpoints that must not be
// buffered.

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/zap-proto/fiber/v3/middleware/adaptor"
	"github.com/zap-proto/zip"
)

// pattern maps a net/http ServeMux pattern to its zip equivalent: a
// trailing-slash subtree becomes a wildcard. Exact paths pass through unchanged,
// and zip's specificity rule (static ≻ *) reproduces ServeMux's longest-prefix
// win, so registration order stays irrelevant.
func pattern(p string) string {
	if strings.HasSuffix(p, "/") {
		return p + "*"
	}
	return p
}

// streams names the endpoints that write their response incrementally
// (Server-Sent Events) and says for WHICH requests — the same condition the
// handler itself branches on. Those responses have to be relayed chunk by chunk;
// the buffered bridge would hold an event stream open forever. Every other
// response stays buffered, which keeps its Content-Length intact.
var streams = map[string]func(*zip.Ctx) bool{
	worldPrefix + "/model/stream": always,
	worldPrefix + "/ai-pulse":     acceptsEventStream,
	worldPrefix + "/analyst":      acceptsEventStream,
}

func always(*zip.Ctx) bool { return true }

func acceptsEventStream(c *zip.Ctx) bool {
	return strings.Contains(c.Header("Accept"), "text/event-stream")
}

// bridge mounts a net/http handler on zip. Every route is registered for every
// method because the handlers own their own method dispatch and CORS (preflight
// / methodNotGet) exactly as they did under ServeMux — method policy stays in
// one place and the responses stay byte-identical.
func bridge(abs string, h http.HandlerFunc) zip.Handler {
	buffered := zip.AdaptNetHTTPFunc(h)
	streaming, ok := streams[abs]
	if !ok {
		return buffered
	}
	relayed := relayNetHTTP(h)
	return func(c *zip.Ctx) error {
		if streaming(c) {
			return relayed(c)
		}
		return buffered(c)
	}
}

// relayNetHTTP is the streaming counterpart of zip.AdaptNetHTTPFunc: the handler
// runs on its own goroutine, its header block reaches the wire as soon as it is
// written, and its body is forwarded with a flush per write. A dropped
// connection cancels the request context, which is how the SSE loops learn the
// client left.
func relayNetHTTP(h http.HandlerFunc) zip.Handler {
	return func(c *zip.Ctx) error {
		req, err := adaptor.ConvertRequest(c.Fiber(), true)
		if err != nil {
			return zip.ErrInternal(err.Error())
		}
		ctx, cancel := context.WithCancel(c.Context())
		pr, pw := io.Pipe()
		rw := &relayWriter{hdr: http.Header{}, body: pw, ready: make(chan struct{})}
		go func() {
			defer pw.Close()
			h(rw, req.WithContext(ctx))
			rw.commit(http.StatusOK) // in case the handler wrote nothing at all
		}()
		<-rw.ready

		res := c.Fiber().Response()
		for k, vs := range rw.hdr {
			for _, v := range vs {
				res.Header.Add(k, v)
			}
		}
		c.Status(rw.status)
		return c.SendStreamWriter(func(w *bufio.Writer) {
			defer cancel()
			defer pr.Close()
			buf := make([]byte, 4<<10)
			for {
				n, rerr := pr.Read(buf)
				if n > 0 {
					if _, werr := w.Write(buf[:n]); werr != nil {
						return
					}
					if ferr := w.Flush(); ferr != nil {
						return // client gone; the deferred cancel unwinds the handler
					}
				}
				if rerr != nil {
					return
				}
			}
		})
	}
}

// relayWriter is the http.ResponseWriter a relayed handler writes into. It
// freezes the header block on the first write and forwards everything after it
// straight to the wire; Flush is a no-op because each Write is already flushed
// downstream.
type relayWriter struct {
	hdr    http.Header
	body   *io.PipeWriter
	ready  chan struct{}
	once   sync.Once
	status int
}

func (rw *relayWriter) Header() http.Header  { return rw.hdr }
func (rw *relayWriter) WriteHeader(code int) { rw.commit(code) }
func (rw *relayWriter) Flush()               {}

func (rw *relayWriter) Write(b []byte) (int, error) {
	rw.commit(http.StatusOK)
	return rw.body.Write(b)
}

// commit freezes the status + headers and releases the relay, which cannot copy
// them to the wire until the handler has written them.
func (rw *relayWriter) commit(code int) {
	rw.once.Do(func() { rw.status = code; close(rw.ready) })
}

// Handler is app as a net/http handler: the in-process dispatch view the MCP
// tool bridge runs its calls through (an httptest recorder, no socket). Same
// routes, same middleware, one implementation of every data path. It buffers the
// response, so it serves every route a tool may target and none of the three in
// `streams` — which is exactly the read-only projection MCP is.
func Handler(app *zip.App) http.Handler {
	return adaptor.FiberApp(app.Fiber())
}
