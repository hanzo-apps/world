package world

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Alt-asset feeds behind the finance-terminal "Art & Collectibles — Auctions"
// and "Luxury Real Estate" panels (src/components/finance/AltFeedPanel.ts).
// Neither headline source is usable server-side, so each panel is served by a
// reachable, public, respectfully-scraped equivalent — fetched once an hour and
// served from cache to every caller. Both degrade to an honest empty
// {items:[]} (the SPA then renders "live feed pending") and NEVER fabricate a
// row.
//
//   /v1/world/auctions          → Christie's public results (realized SALE
//     totals). Sotheby's — the requested headline — gates realized prices behind
//     a login (its /data/api/asset.saleresults.json returns 401 "Not signed in"),
//     so the honest public major house is Christie's, exactly the fallback the
//     panel names ("Sotheby's / major-house results").
//
//   /v1/world/luxury-realestate → LuxuryEstate.com listings. JamesEdition — the
//     requested headline — sits behind a Cloudflare JS challenge that blocks
//     datacenter egress (the pod runs in DOKS), so it cannot be fetched
//     server-side; LuxuryEstate is a reachable, robots-permitted real source of
//     the same thing (luxury listings with a price, place, type, image, link).
//
// The SPA reads exactly {items: AltFeedItem[]} where AltFeedItem is
// {title, subtitle?, price?, href?, imageUrl?, meta?}. Extra top-level fields
// (source, asOf, count, pending) are ignored by the panel and kept for
// humans/debugging + honest attribution.

const (
	christiesResultsURL  = "https://www.christies.com/en/results"
	luxuryEstateURL      = "https://www.luxuryestate.com/united-states?currency=USD"
	auctionsCacheKey     = "auctions:v1"
	luxuryRealtyCacheKey = "luxury-realestate:v1"
	altAssetsTTL         = time.Hour      // fresh window: at most one scrape/source/hour
	altAssetsStale       = 24 * time.Hour // serve last-good for a day through any source outage
	altAssetsRefresh     = time.Hour      // background warmer cadence
	altFeedMaxItems      = 12             // the panel itself renders at most 12
	altFeedCacheControl  = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
)

// altFeedItem mirrors the SPA's AltFeedItem exactly (see AltFeedPanel.ts). JSON
// tags match field-for-field; omitempty keeps optional fields absent, not empty.
type altFeedItem struct {
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	Price    string `json:"price,omitempty"`
	Href     string `json:"href,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"`
	Meta     string `json:"meta,omitempty"`
}

// handleAuctions serves /v1/world/auctions (Christie's realized sale totals).
func (s *Server) handleAuctions(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, auctionsCacheKey, altFeedCacheControl, altAssetsTTL, altAssetsStale,
		func(ctx context.Context) (any, error) { return s.computeAuctions(ctx) },
		func(w http.ResponseWriter, _ error) { writeAltFeedPending(w, "Christie's") })
}

// handleLuxuryRealestate serves /v1/world/luxury-realestate (LuxuryEstate listings).
func (s *Server) handleLuxuryRealestate(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, luxuryRealtyCacheKey, altFeedCacheControl, altAssetsTTL, altAssetsStale,
		func(ctx context.Context) (any, error) { return s.computeLuxuryRealestate(ctx) },
		func(w http.ResponseWriter, _ error) { writeAltFeedPending(w, "LuxuryEstate") })
}

// writeAltFeedPending is the honest cold-miss fallback (no cache yet AND the
// source is unreachable): an empty item list with a pending flag. The SPA
// renders "Live feed pending" for an empty list. Never a fabricated row, never a
// 5xx — so the routes smoke sweep and the panel both stay green.
func writeAltFeedPending(w http.ResponseWriter, source string) {
	writeJSON(w, http.StatusOK, "", map[string]any{
		"asOf": nowISO(), "source": source, "pending": true, "count": 0,
		"items": []altFeedItem{},
	})
}

// altFeedPayload is the shaped, cacheable success value. produce returns an error
// (not this) when it parses zero rows, so an empty list is never cached — the
// caller then serves the last-good copy or the pending fallback.
func altFeedPayload(source string, items []altFeedItem) map[string]any {
	if len(items) > altFeedMaxItems {
		items = items[:altFeedMaxItems]
	}
	return map[string]any{
		"asOf": nowISO(), "source": source, "count": len(items), "items": items,
	}
}

// ── auctions: Christie's ──────────────────────────────────────────────────────

func (s *Server) computeAuctions(ctx context.Context) (any, error) {
	body, status, err := s.get(ctx, christiesResultsURL, map[string]string{
		"Accept":          "text/html,application/xhtml+xml",
		"Accept-Language": "en-US,en;q=0.9",
		"User-Agent":      browserUA,
	})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("christies status %d", status)
	}
	items := parseChristiesAuctions(body)
	if len(items) == 0 {
		return nil, errUnavailable
	}
	return altFeedPayload("Christie's", items), nil
}

// christieSale is the subset of Christie's embedded results JSON we render. Only
// scalars are unmarshalled; the image URL is pulled from the raw object bytes
// (its nested srcset schema is picked over by regex, so a schema tweak can't
// break the whole parse).
type christieSale struct {
	TitleTxt          string `json:"title_txt"`
	SubtitleTxt       string `json:"subtitle_txt"`
	DateDisplayTxt    string `json:"date_display_txt"`
	LocationTxt       string `json:"location_txt"`
	SaleTotalValueTxt string `json:"sale_total_value_txt"`
	LandingURL        string `json:"landing_url"`
}

// realizedTotalRe matches a realized total like "USD 1,135,380" / "HKD 10,319,750"
// — a 2–3 letter ISO currency code, a space, then a grouped amount. It filters
// out upcoming/estimate-only cards that carry no realized figure.
var realizedTotalRe = regexp.MustCompile(`^[A-Z]{2,3}\s[\d,]+$`)

// christiesImgRe matches a Christie's sale image URL and captures its width, so
// pickChristiesImage can choose a mid-size variant.
var christiesImgRe = regexp.MustCompile(`https://www\.christies\.com/img/SaleImages/[^"\\ ]+?\.jpg\?w=(\d+)`)

// parseChristiesAuctions extracts the embedded "events":[…] results array from
// the SSR HTML and maps each realized sale to an altFeedItem. Malformed input
// yields an empty slice, never a panic.
func parseChristiesAuctions(body []byte) []altFeedItem {
	arr := extractBracketed(body, `"events":`, '[', ']')
	if arr == nil {
		return nil
	}
	var sales []json.RawMessage
	if err := json.Unmarshal(arr, &sales); err != nil {
		return nil
	}
	out := make([]altFeedItem, 0, len(sales))
	for _, raw := range sales {
		var sale christieSale
		if err := json.Unmarshal(raw, &sale); err != nil {
			continue
		}
		price := strings.TrimSpace(sale.SaleTotalValueTxt)
		title := strings.TrimSpace(sale.TitleTxt)
		if title == "" || !realizedTotalRe.MatchString(price) {
			continue // upcoming / estimate-only / malformed — not a realized result
		}
		cat := classifyAuction(title + " " + sale.SubtitleTxt)
		item := altFeedItem{
			Title:    title,
			Price:    price,
			Href:     absURL(sale.LandingURL, "https://www.christies.com"),
			ImageURL: pickChristiesImage(raw),
			Subtitle: "Christie's",
		}
		if loc := strings.TrimSpace(sale.LocationTxt); loc != "" {
			item.Subtitle = "Christie's · " + loc
		}
		if d := strings.TrimSpace(sale.DateDisplayTxt); d != "" {
			item.Meta = cat + " · " + d
		} else {
			item.Meta = cat
		}
		out = append(out, item)
	}
	return out
}

// pickChristiesImage returns the sale image whose width is closest to 640px (a
// crisp thumbnail without pulling the largest hero), scanning the raw object.
func pickChristiesImage(raw []byte) string {
	best := ""
	bestDiff := 1 << 30
	for _, m := range christiesImgRe.FindAllSubmatch(raw, -1) {
		w, err := strconv.Atoi(string(m[1]))
		if err != nil || w <= 0 {
			continue
		}
		d := w - 640
		if d < 0 {
			d = -d
		}
		if d < bestDiff {
			bestDiff, best = d, string(m[0])
		}
	}
	return best
}

// auctionCategory pairs a substring probe (lowercased title+subtitle) with the
// category label shown to the user. Ordered: first match wins.
var auctionCategories = []struct{ probe, label string }{
	{"cellar", "Wine & Spirits"}, {"wine", "Wine & Spirits"}, {"whisky", "Wine & Spirits"},
	{"whiskey", "Wine & Spirits"}, {"spirit", "Wine & Spirits"}, {"vintage", "Wine & Spirits"},
	{"watch", "Watches"}, {"rolex", "Watches"}, {"patek", "Watches"}, {"horolog", "Watches"},
	{"jewel", "Jewellery"}, {"diamond", "Jewellery"}, {"gemstone", "Jewellery"},
	{"handbag", "Handbags & Accessories"}, {"hermès", "Handbags & Accessories"},
	{"hermes", "Handbags & Accessories"}, {"birkin", "Handbags & Accessories"},
	{"coin", "Gold & Coins"}, {"numismat", "Gold & Coins"}, {"bullion", "Gold & Coins"},
	{"gold", "Gold & Coins"},
}

// classifyAuction infers a human category from the sale name (the source has no
// stable category label). It is a best-effort hint, never a fabricated fact;
// anything unmatched is the honest generic "Art & Collectibles".
func classifyAuction(text string) string {
	t := strings.ToLower(text)
	for _, c := range auctionCategories {
		if strings.Contains(t, c.probe) {
			return c.label
		}
	}
	return "Art & Collectibles"
}

// ── luxury real estate: LuxuryEstate ──────────────────────────────────────────

func (s *Server) computeLuxuryRealestate(ctx context.Context) (any, error) {
	body, status, err := s.get(ctx, luxuryEstateURL, map[string]string{
		"Accept":          "text/html,application/xhtml+xml",
		"Accept-Language": "en-US,en;q=0.9",
		"User-Agent":      browserUA,
	})
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("luxuryestate status %d", status)
	}
	items := parseLuxuryEstateListings(body)
	if len(items) == 0 {
		return nil, errUnavailable
	}
	return altFeedPayload("LuxuryEstate", items), nil
}

// luxuryListing is the subset of a LuxuryEstate propertiesList entry we render.
type luxuryListing struct {
	Title        string `json:"title"`
	Label        string `json:"label"`
	Type         string `json:"type"`
	URL          string `json:"url"`
	Surface      string `json:"surface"`
	Bedrooms     string `json:"bedrooms"`
	PictureThumb string `json:"pictureThumb"`
	Picture      string `json:"picture"`
	Price        struct {
		Amount         string `json:"amount"`
		Currency       string `json:"currency"`
		CurrencySymbol string `json:"currencySymbol"`
	} `json:"price"`
	GeoInfo struct {
		Country string `json:"country"`
		Region  string `json:"region"`
		City    string `json:"city"`
	} `json:"geoInfo"`
}

// parseLuxuryEstateListings extracts the embedded "propertiesList":[…] array and
// maps each listing to an altFeedItem. Malformed input yields an empty slice.
func parseLuxuryEstateListings(body []byte) []altFeedItem {
	arr := extractBracketed(body, `"propertiesList":`, '[', ']')
	if arr == nil {
		return nil
	}
	var listings []luxuryListing
	if err := json.Unmarshal(arr, &listings); err != nil {
		return nil
	}
	out := make([]altFeedItem, 0, len(listings))
	for _, l := range listings {
		title := strings.TrimSpace(l.Title)
		if title == "" {
			title = strings.TrimSpace(l.Label)
		}
		if title == "" {
			continue
		}
		img := strings.TrimSpace(l.PictureThumb)
		if img == "" {
			img = strings.TrimSpace(l.Picture)
		}
		out = append(out, altFeedItem{
			Title:    title,
			Price:    luxuryPrice(l),
			Subtitle: luxuryLocation(l),
			Href:     absURL(l.URL, "https://www.luxuryestate.com"),
			ImageURL: absScheme(img),
			Meta:     luxuryMeta(l),
		})
	}
	return out
}

// luxuryPrice renders the listing's real price + currency, preferring the
// currency symbol ("US$5,950,000"), falling back to the currency code.
func luxuryPrice(l luxuryListing) string {
	amt := strings.TrimSpace(l.Price.Amount)
	if amt == "" {
		return ""
	}
	if sym := strings.TrimSpace(l.Price.CurrencySymbol); sym != "" {
		return sym + amt
	}
	if c := strings.TrimSpace(l.Price.Currency); c != "" {
		return amt + " " + c
	}
	return amt
}

// luxuryLocation joins city with region (else country): "Banner Elk, North Carolina".
func luxuryLocation(l luxuryListing) string {
	parts := make([]string, 0, 2)
	if c := strings.TrimSpace(l.GeoInfo.City); c != "" {
		parts = append(parts, c)
	}
	if r := strings.TrimSpace(l.GeoInfo.Region); r != "" {
		parts = append(parts, r)
	} else if c := strings.TrimSpace(l.GeoInfo.Country); c != "" {
		parts = append(parts, c)
	}
	return strings.Join(parts, ", ")
}

// luxuryMeta renders "House · 5 bd · 655 m²" from whatever fields are present.
func luxuryMeta(l luxuryListing) string {
	parts := make([]string, 0, 3)
	if t := strings.TrimSpace(l.Type); t != "" {
		parts = append(parts, t)
	}
	if b := strings.TrimSpace(l.Bedrooms); b != "" && b != "0" {
		parts = append(parts, b+" bd")
	}
	if s := strings.TrimSpace(l.Surface); s != "" {
		parts = append(parts, s)
	}
	return strings.Join(parts, " · ")
}

// ── shared parsing helpers ────────────────────────────────────────────────────

// extractBracketed returns the substring from the first `open` bracket that
// follows key through its matching `close` bracket, honoring JSON string escapes
// so brackets inside string values don't unbalance the scan. It is a targeted
// extractor for one embedded array/object inside a larger HTML/JS document — so
// the whole page never has to be parsed. Only whitespace or a colon may sit
// between key and the bracket. Returns nil when absent or unbalanced.
func extractBracketed(body []byte, key string, open, close byte) []byte {
	i := bytes.Index(body, []byte(key))
	if i < 0 {
		return nil
	}
	j := i + len(key)
	for j < len(body) && body[j] != open {
		switch body[j] {
		case ' ', '\t', '\n', '\r', ':':
			j++
		default:
			return nil
		}
	}
	if j >= len(body) {
		return nil
	}
	depth, inStr, esc := 0, false, false
	for k := j; k < len(body); k++ {
		c := body[k]
		switch {
		case esc:
			esc = false
		case c == '\\':
			esc = true
		case c == '"':
			inStr = !inStr
		case inStr:
			// inside a string: ignore brackets
		case c == open:
			depth++
		case c == close:
			depth--
			if depth == 0 {
				return body[j : k+1]
			}
		}
	}
	return nil
}

// absURL resolves a possibly-relative URL against base: "//host/…" → https://host/…,
// "/path" → base+/path, anything absolute is returned unchanged.
func absURL(u, base string) string {
	u = strings.TrimSpace(u)
	switch {
	case u == "":
		return ""
	case strings.HasPrefix(u, "//"):
		return "https:" + u
	case strings.HasPrefix(u, "/"):
		return base + u
	default:
		return u
	}
}

// absScheme prepends https: to a scheme-relative ("//host/…") URL; leaves an
// already-absolute URL untouched.
func absScheme(u string) string {
	u = strings.TrimSpace(u)
	if strings.HasPrefix(u, "//") {
		return "https:" + u
	}
	return u
}

// ── background warmer ─────────────────────────────────────────────────────────

// StartAltAssets warms the two alt-asset feeds on boot and refreshes them every
// hour until ctx is cancelled, so the panels serve a fresh cached hit instead of
// blocking on a cold scrape, and stay fresh even with sporadic traffic. These
// sources change at most daily; hourly is respectful — one request per source
// per hour — and the SWR cache keeps serving the last-good copy between
// refreshes and through any source outage. Warmer and handler share the same
// cache key + produce path + TTLs (the constants above), so they can never
// drift. Call once from main after the server is built.
func (s *Server) StartAltAssets(ctx context.Context) {
	go func() {
		s.warmAltAssets(ctx)
		t := time.NewTicker(altAssetsRefresh)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.warmAltAssets(ctx)
			}
		}
	}()
}

// warmAltAssets (re)produces both feeds and stores each under the exact key its
// handler reads. A failure is logged and skipped; the next cycle retries and the
// last-good value keeps serving in the meantime.
func (s *Server) warmAltAssets(ctx context.Context) {
	specs := []struct {
		key     string
		produce func(context.Context) (any, error)
	}{
		{auctionsCacheKey, s.computeAuctions},
		{luxuryRealtyCacheKey, s.computeLuxuryRealestate},
	}
	for _, spec := range specs {
		if ctx.Err() != nil {
			return
		}
		wctx, cancel := context.WithTimeout(ctx, 24*time.Second)
		v, err := spec.produce(wctx)
		cancel()
		if err != nil {
			logf("world-altassets: %s warm failed: %v", spec.key, err)
			continue
		}
		s.cache.Set(spec.key, v, altAssetsTTL, altAssetsStale)
	}
}
