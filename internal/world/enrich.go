package world

import (
	_ "embed"
	"encoding/json"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Server-side news enrichment: threat classification + geo inference.
//
// This is the Go-native home for work the browser used to do on every client,
// on every render. The keyword tables and geo hubs are DATA (enrichdata/*.json)
// — one source of truth, embedded here and imported by the frontend, so the two
// runtimes can never drift. enrich_test.go proves byte-for-byte parity with the
// TypeScript implementation over an exhaustive 494-case corpus.
//
// Two parity traps, both handled deliberately:
//   - JS object key order IS the match priority (first match wins). Go maps are
//     unordered, so the tables stay ORDERED SLICES.
//   - JS Array.sort is stable. Go's sort.Slice is not — geo matches use
//     sort.SliceStable so equal-confidence hubs keep index order.

//go:embed enrichdata/threat-keywords.json
var threatKeywordsJSON []byte

//go:embed enrichdata/geo-hubs.json
var geoHubsJSON []byte

// ThreatClassification mirrors the frontend type (services/threat-classifier.ts).
type ThreatClassification struct {
	Level      string  `json:"level"`
	Category   string  `json:"category"`
	Confidence float64 `json:"confidence"`
	Source     string  `json:"source"`
}

// GeoHub is a strategic location an item can be pinned to.
type GeoHub struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Region   string   `json:"region"`
	Country  string   `json:"country"`
	Lat      float64  `json:"lat"`
	Lon      float64  `json:"lon"`
	Type     string   `json:"type"`
	Tier     string   `json:"tier"`
	Keywords []string `json:"keywords"`
}

// GeoMatch is one inferred hub for a headline.
type GeoMatch struct {
	HubID          string  `json:"hubId"`
	Confidence     float64 `json:"confidence"`
	MatchedKeyword string  `json:"matchedKeyword"`
}

type keywordEntry struct {
	Keyword  string `json:"keyword"`
	Category string `json:"category"`
}

type threatTier struct {
	Level      string         `json:"level"`
	Confidence float64        `json:"confidence"`
	Variant    string         `json:"variant"` // "any" | "tech"
	Keywords   []keywordEntry `json:"keywords"`
}

type threatTables struct {
	Exclusions    []string     `json:"exclusions"`
	ShortKeywords []string     `json:"shortKeywords"`
	Tiers         []threatTier `json:"tiers"`
}

type enricher struct {
	tables   threatTables
	short    map[string]bool
	res      map[string]*regexp.Regexp // keyword → compiled matcher
	hubs     []GeoHub
	hubIndex map[string]*GeoHub
	// hubKeywords preserves insertion order, matching the JS Map iteration the
	// frontend index relies on.
	hubKeywords []hubKeyword
}

type hubKeyword struct {
	keyword string
	hubIDs  []string
	re      *regexp.Regexp // non-nil only for short keywords (word-boundary)
}

var (
	enrichOnce sync.Once
	enr        *enricher
)

func enrichEngine() *enricher {
	enrichOnce.Do(func() {
		e := &enricher{
			short:    map[string]bool{},
			res:      map[string]*regexp.Regexp{},
			hubIndex: map[string]*GeoHub{},
		}
		if err := json.Unmarshal(threatKeywordsJSON, &e.tables); err != nil {
			log.Printf("world: enrich: threat tables: %v", err)
		}
		for _, s := range e.tables.ShortKeywords {
			e.short[s] = true
		}
		// Precompile one matcher per keyword, mirroring getKeywordRegex: short
		// keywords are word-bounded (so "war" never matches "wardrobe"), the rest
		// are plain substring matches. Titles are lowercased before matching.
		for _, tier := range e.tables.Tiers {
			for _, k := range tier.Keywords {
				e.res[k.Keyword] = compileKeyword(k.Keyword, e.short[k.Keyword])
			}
		}

		var hubData struct {
			Hubs []GeoHub `json:"hubs"`
		}
		if err := json.Unmarshal(geoHubsJSON, &hubData); err != nil {
			log.Printf("world: enrich: geo hubs: %v", err)
		}
		e.hubs = hubData.Hubs
		seen := map[string]int{} // keyword → index into hubKeywords
		for i := range e.hubs {
			h := &e.hubs[i]
			e.hubIndex[h.ID] = h
			for _, kw := range h.Keywords {
				lower := strings.ToLower(kw)
				if idx, ok := seen[lower]; ok {
					e.hubKeywords[idx].hubIDs = append(e.hubKeywords[idx].hubIDs, h.ID)
					continue
				}
				seen[lower] = len(e.hubKeywords)
				var re *regexp.Regexp
				// The frontend word-bounds geo keywords shorter than 5 chars.
				if len(lower) < 5 {
					re = regexp.MustCompile(`\b` + regexp.QuoteMeta(lower) + `\b`)
				}
				e.hubKeywords = append(e.hubKeywords, hubKeyword{keyword: lower, hubIDs: []string{h.ID}, re: re})
			}
		}
		enr = e
	})
	return enr
}

func compileKeyword(kw string, short bool) *regexp.Regexp {
	q := regexp.QuoteMeta(kw)
	if short {
		return regexp.MustCompile(`\b` + q + `\b`)
	}
	return regexp.MustCompile(q)
}

// ClassifyByKeyword is the Go port of services/threat-classifier.ts
// classifyByKeyword. Same priority cascade, same confidences, same categories.
func ClassifyByKeyword(title, variant string) ThreatClassification {
	e := enrichEngine()
	lower := strings.ToLower(title)

	info := ThreatClassification{Level: "info", Category: "general", Confidence: 0.3, Source: "keyword"}
	for _, ex := range e.tables.Exclusions {
		if strings.Contains(lower, ex) {
			return info
		}
	}
	isTech := variant == "tech"
	for _, tier := range e.tables.Tiers {
		if tier.Variant == "tech" && !isTech {
			continue
		}
		for _, k := range tier.Keywords {
			if re := e.res[k.Keyword]; re != nil && re.MatchString(lower) {
				return ThreatClassification{
					Level:      tier.Level,
					Category:   k.Category,
					Confidence: tier.Confidence,
					Source:     "keyword",
				}
			}
		}
	}
	return info
}

// InferGeoHubs is the Go port of services/geo-hub-index.ts inferGeoHubsFromTitle:
// keyword → hub, confidence by keyword length, boosted for conflict/strategic
// type and critical tier, sorted by confidence (stable).
func InferGeoHubs(title string) []GeoMatch {
	e := enrichEngine()
	lower := strings.ToLower(title)
	matches := []GeoMatch{}
	seen := map[string]bool{}

	for _, hk := range e.hubKeywords {
		if len(hk.keyword) < 2 {
			continue
		}
		found := false
		if hk.re != nil {
			found = hk.re.MatchString(lower)
		} else {
			found = strings.Contains(lower, hk.keyword)
		}
		if !found {
			continue
		}
		for _, id := range hk.hubIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			hub := e.hubIndex[id]
			if hub == nil {
				continue
			}
			confidence := 0.5
			switch n := len(hk.keyword); {
			case n >= 10:
				confidence = 0.9
			case n >= 6:
				confidence = 0.75
			case n >= 4:
				confidence = 0.6
			}
			if hub.Type == "conflict" || hub.Type == "strategic" {
				confidence = min1(confidence + 0.1)
			}
			if hub.Tier == "critical" {
				confidence = min1(confidence + 0.1)
			}
			matches = append(matches, GeoMatch{HubID: id, Confidence: confidence, MatchedKeyword: hk.keyword})
		}
	}
	// JS Array.sort is stable — equal confidences keep discovery order.
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].Confidence > matches[j].Confidence })
	return matches
}

// GeoHubByID exposes a hub for callers that need its coordinates/name.
func GeoHubByID(id string) *GeoHub {
	return enrichEngine().hubIndex[id]
}

func min1(v float64) float64 {
	if v > 1 {
		return 1
	}
	return v
}
