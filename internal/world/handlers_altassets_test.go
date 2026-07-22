package world

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// The parsers are tested against REAL (trimmed) source captures in testdata, so
// a schema change at the source is caught here rather than in production. No
// network — deterministic. Live fetching is exercised by the routes smoke sweep
// (routes_test.go).

func TestParseChristiesAuctions(t *testing.T) {
	body, err := os.ReadFile("testdata/christies_results.html")
	if err != nil {
		t.Fatal(err)
	}
	items := parseChristiesAuctions(body)
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d: %+v", len(items), items)
	}
	got := items[0]
	want := altFeedItem{
		Title:    "The Cellar of an Obsessive Collector Part III: Online",
		Subtitle: "Christie's · Hong Kong",
		Price:    "HKD 10,319,750",
		Href:     "https://onlineonly.christies.com/sso?SaleID=31386&SaleNumber=24946",
		ImageURL: "https://www.christies.com/img/SaleImages/DEMO-1.jpg?w=600", // closest to 640
		Meta:     "Wine & Spirits · 9 – 21 July",                              // "Cellar" → wine
	}
	if got != want {
		t.Errorf("item0 mismatch:\n got %+v\nwant %+v", got, want)
	}
	// A non-keyword sale falls back to the honest generic category.
	if !strings.HasPrefix(items[1].Meta, "Art & Collectibles") {
		t.Errorf("item1 category: want 'Art & Collectibles …', got %q", items[1].Meta)
	}
	if items[1].Price != "USD 1,135,380" {
		t.Errorf("item1 price: got %q", items[1].Price)
	}
}

func TestParseLuxuryEstateListings(t *testing.T) {
	body, err := os.ReadFile("testdata/luxuryestate_results.html")
	if err != nil {
		t.Fatal(err)
	}
	items := parseLuxuryEstateListings(body)
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d: %+v", len(items), items)
	}
	got := items[0]
	want := altFeedItem{
		Title:    "Luxury home in Banner Elk, Avery County",
		Subtitle: "Banner Elk, North Carolina",
		Price:    "US$5,950,000",
		Href:     "https://www.luxuryestate.com/p131998951-luxury-home-for-sale-banner-elk",
		ImageURL: "https://pic.le-cdn.com/thumbs/520x390/04/1/properties/Property-e7240000000007de000169121ee3-131998951.jpg",
		Meta:     "House · 5 bd · 655 m²",
	}
	if got != want {
		t.Errorf("item0 mismatch:\n got %+v\nwant %+v", got, want)
	}
	if items[1].Price != "US$2,995,000" || items[1].Meta != "House · 4 bd · 403 m²" {
		t.Errorf("item1: got price=%q meta=%q", items[1].Price, items[1].Meta)
	}
}

func TestClassifyAuction(t *testing.T) {
	cases := map[string]string{
		"The Cellar of an Obsessive Collector": "Wine & Spirits",
		"Fine and Rare Wines":                  "Wine & Spirits",
		"Important Watches":                    "Watches",
		"Magnificent Jewels and Diamonds":      "Jewellery",
		"Handbags & Accessories: Online":       "Handbags & Accessories",
		"Gold Coins of the Ancient World":      "Gold & Coins",
		"Tom Wesselmann: American Beauty":      "Art & Collectibles", // no keyword → generic
	}
	for in, want := range cases {
		if got := classifyAuction(in); got != want {
			t.Errorf("classifyAuction(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExtractBracketed(t *testing.T) {
	cases := []struct {
		name, body, key string
		open, close     byte
		want            string
	}{
		{"array", `x "events": [1,2,3] y`, `"events":`, '[', ']', `[1,2,3]`},
		{"nested-obj", `p "a":{"b":{"c":1}} q`, `"a":`, '{', '}', `{"b":{"c":1}}`},
		{"bracket-in-string", `"k": ["a]b", "c"]`, `"k":`, '[', ']', `["a]b", "c"]`},
		{"escaped-quote-in-string", `"k": ["a\"]b"]`, `"k":`, '[', ']', `["a\"]b"]`},
		{"missing-key", `"other": [1]`, `"k":`, '[', ']', ""},
		{"unbalanced", `"k": [1,2`, `"k":`, '[', ']', ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := string(extractBracketed([]byte(c.body), c.key, c.open, c.close))
			if got != c.want {
				t.Errorf("extractBracketed = %q, want %q", got, c.want)
			}
		})
	}
}

// TestAltFeedItemMatchesSPAShape locks the JSON contract with the SPA's
// AltFeedItem interface (AltFeedPanel.ts): the exact key names, and omitempty so
// an item with only a title carries no empty optional keys.
func TestAltFeedItemMatchesSPAShape(t *testing.T) {
	full, _ := json.Marshal(altFeedItem{
		Title: "T", Subtitle: "S", Price: "P", Href: "H", ImageURL: "I", Meta: "M",
	})
	for _, k := range []string{`"title"`, `"subtitle"`, `"price"`, `"href"`, `"imageUrl"`, `"meta"`} {
		if !strings.Contains(string(full), k) {
			t.Errorf("marshalled item missing key %s: %s", k, full)
		}
	}
	min, _ := json.Marshal(altFeedItem{Title: "only"})
	if string(min) != `{"title":"only"}` {
		t.Errorf("omitempty broken: %s", min)
	}
}

// TestAltFeedPendingShape: the cold-miss fallback carries an empty ARRAY (never
// null) so the SPA's Array.isArray/length check renders "live feed pending"
// instead of throwing, and never a fabricated row.
func TestAltFeedPendingShape(t *testing.T) {
	rec := httptest.NewRecorder()
	writeAltFeedPending(rec, "Christie's")
	var out struct {
		Items   []altFeedItem `json:"items"`
		Pending bool          `json:"pending"`
		Source  string        `json:"source"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Items == nil || len(out.Items) != 0 {
		t.Errorf("items must be empty array, got %#v", out.Items)
	}
	if !out.Pending || out.Source != "Christie's" {
		t.Errorf("want pending+source, got %+v", out)
	}
	if !strings.Contains(rec.Body.String(), `"items":[]`) {
		t.Errorf("items must serialize as [] not null: %s", rec.Body.String())
	}
}

// TestParseGarbageNoPanic: malformed / empty input yields an empty slice, never
// a panic — the source can rot without taking the endpoint down.
func TestParseGarbageNoPanic(t *testing.T) {
	for _, b := range [][]byte{nil, {}, []byte("not html"), []byte(`{"events": "oops"}`), []byte(`"propertiesList": [`)} {
		if got := parseChristiesAuctions(b); len(got) != 0 {
			t.Errorf("christies garbage → %d items", len(got))
		}
		if got := parseLuxuryEstateListings(b); len(got) != 0 {
			t.Errorf("luxe garbage → %d items", len(got))
		}
	}
}
