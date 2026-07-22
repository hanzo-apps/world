package world

import (
	"bytes"
	"context"
	"encoding/xml"
	"net/http"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// Insider activity from SEC EDGAR: the live feed of Form 4 filings (an insider's
// change in beneficial ownership — buys and sells by officers, directors and 10%
// holders). This surfaces the VELOCITY and the recent stream of insider filings —
// the "insiders are filing" macro signal. Per-filing buy/sell classification
// requires fetching each filing's ownership XML and is a follow-on; this is the
// filing-flow layer.
//
// SEC requires a descriptive User-Agent with a contact; a browser UA gets blocked.

const secUA = "Hanzo World research@hanzo.ai"

// handleInsider serves /v1/world/insider.
func (s *Server) handleInsider(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "insider:v1",
		"public, max-age=600, s-maxage=600, stale-while-revalidate=1800",
		10*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) { return s.computeInsider(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "unavailable": true, "count": 0, "recent": []any{},
			})
		})
}

func (s *Server) computeInsider(ctx context.Context) (any, error) {
	url := "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom"
	body, status, err := s.get(ctx, url, map[string]string{"User-Agent": secUA, "Accept": "application/atom+xml"})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, errUnavailable
	}
	entries := parseEdgarAtom(body)
	recent := make([]map[string]any, 0, 40)
	for i, e := range entries {
		if i >= 40 {
			break
		}
		name, role := splitFormTitle(e.Title)
		recent = append(recent, map[string]any{"filer": name, "role": role, "at": e.Updated, "link": e.Link})
	}
	return map[string]any{
		"asOf":   nowISO(),
		"source": "SEC EDGAR · Form 4",
		"count":  len(entries),
		"recent": recent,
	}, nil
}

// ── pure parsing (unit-tested) ───────────────────────────────────────────────

type edgarEntry struct {
	Title   string
	Updated string
	Link    string
}

type atomFeed struct {
	XMLName xml.Name `xml:"feed"`
	Entries []struct {
		Title   string `xml:"title"`
		Updated string `xml:"updated"`
		Link    struct {
			Href string `xml:"href,attr"`
		} `xml:"link"`
	} `xml:"entry"`
}

// parseEdgarAtom pulls entries out of an EDGAR getcurrent atom feed. The live
// feed is served as ISO-8859-1 (not UTF-8), so the decoder carries a
// CharsetReader — plain xml.Unmarshal errors out on any declared non-UTF-8
// charset. Malformed input yields an empty slice, never a panic.
func parseEdgarAtom(body []byte) []edgarEntry {
	var f atomFeed
	dec := xml.NewDecoder(bytes.NewReader(body))
	dec.CharsetReader = charset.NewReaderLabel
	if err := dec.Decode(&f); err != nil {
		return nil
	}
	out := make([]edgarEntry, 0, len(f.Entries))
	for _, e := range f.Entries {
		out = append(out, edgarEntry{Title: strings.TrimSpace(e.Title), Updated: e.Updated, Link: e.Link.Href})
	}
	return out
}

// splitFormTitle parses an EDGAR title like "4 - ACME CORP (0001234567) (Issuer)"
// into the filer name and role. Robust to missing pieces.
func splitFormTitle(title string) (name, role string) {
	t := strings.TrimSpace(title)
	if i := strings.Index(t, " - "); i >= 0 {
		t = t[i+3:] // drop the leading "4 - "
	}
	role = ""
	// The role is the LAST parenthesised group; the CIK is the one before it.
	if i := strings.LastIndex(t, "("); i >= 0 {
		if j := strings.Index(t[i:], ")"); j >= 0 {
			role = strings.TrimSpace(t[i+1 : i+j])
			t = strings.TrimSpace(t[:i])
		}
	}
	// Strip a trailing "(CIK)" group if present.
	if i := strings.LastIndex(t, "("); i >= 0 {
		t = strings.TrimSpace(t[:i])
	}
	return strings.TrimSpace(t), role
}
