package world

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// noRedirectClient never auto-follows redirects, so getAllowlisted can
// re-validate every hop's host against the caller's allowlist (SSRF boundary).
var noRedirectClient = &http.Client{
	Timeout: 25 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// getAllowlisted GETs rawURL, following up to 5 redirects, aborting if any hop
// resolves to a host outside allowed. Returns the final body and status. This is
// the only fetch path that accepts a caller-influenced URL (rss-proxy), so the
// host check on every hop is the SSRF guard.
func (s *Server) getAllowlisted(ctx context.Context, rawURL string, allowed map[string]bool, headers map[string]string) ([]byte, int, error) {
	next := rawURL
	for hop := 0; hop < 6; hop++ {
		u, err := url.Parse(next)
		if err != nil {
			return nil, 0, err
		}
		if !allowed[u.Hostname()] {
			return nil, 0, fmt.Errorf("host not allowed: %s", u.Hostname())
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, next, nil)
		if err != nil {
			return nil, 0, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := noRedirectClient.Do(req)
		if err != nil {
			return nil, 0, err
		}
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			loc := resp.Header.Get("Location")
			_ = resp.Body.Close()
			if loc == "" {
				return nil, resp.StatusCode, fmt.Errorf("redirect without location")
			}
			ref, err := u.Parse(loc) // resolve relative redirects
			if err != nil {
				return nil, resp.StatusCode, err
			}
			next = ref.String()
			continue
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
		_ = resp.Body.Close()
		return b, resp.StatusCode, err
	}
	return nil, 0, fmt.Errorf("too many redirects")
}
