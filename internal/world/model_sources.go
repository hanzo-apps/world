package world

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/hanzoai/world/internal/world/model"
)

// This file is the ONLY bridge between the feeds and the world model: each
// Source turns an existing Server fetcher into model.Observations. The model
// package stays feed-agnostic; add a feed to the model by adding a Source here.

// modelSources returns the feed adapters the engine folds every cycle.
func (s *Server) modelSources() []model.Source {
	return []model.Source{
		{Name: "roster", Poll: s.sourceRoster},
		{Name: "gdelt", Poll: s.sourceGDELT},
		{Name: "acled", Poll: s.sourceConflict},
		{Name: "theaters", Poll: s.sourceTheaters},
		{Name: "markets", Poll: s.sourceMarkets},
	}
}

// sourceRoster seeds every country in the ISO roster with its baseline. Pure,
// always succeeds — so the planet-scale entity set exists even with every
// network feed down.
func (s *Server) sourceRoster() ([]model.Observation, error) {
	out := make([]model.Observation, 0, len(countryRoster))
	for _, c := range countryRoster {
		out = append(out, model.Observation{
			ID: c.code, Kind: model.KindCountry, Name: c.name,
			Metrics: map[string]float64{model.MetricBaseline: rosterBaseline(c.code)},
		})
	}
	return out, nil
}

// sourceGDELT folds live news volume + average tone per strategically-significant
// country (the keyworded set). Concurrency is capped so GDELT isn't hammered;
// a throttled or empty country is simply skipped (keeps prior state).
func (s *Server) sourceGDELT() ([]model.Observation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var (
		mu  sync.Mutex
		out []model.Observation
		wg  sync.WaitGroup
	)
	sem := make(chan struct{}, 3)
	for _, c := range tier1Countries {
		kws := countryKeywords[c.code]
		if len(kws) == 0 {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(code, name string, kws []string) {
			defer wg.Done()
			defer func() { <-sem }()
			arts, err := s.fetchGDELTArticles(ctx, gdeltCountryQuery(kws), "24h", 75)
			if err != nil || len(arts) == 0 {
				return
			}
			var toneSum float64
			for _, a := range arts {
				toneSum += a.Tone
			}
			mu.Lock()
			out = append(out, model.Observation{
				ID: code, Kind: model.KindCountry, Name: name,
				Metrics: map[string]float64{
					model.MetricNewsVolume: float64(len(arts)),
					model.MetricSentiment:  toneSum / float64(len(arts)),
				},
			})
			mu.Unlock()
		}(c.code, c.name, kws)
	}
	wg.Wait()
	return out, nil
}

// gdeltCountryQuery builds a GDELT DOC OR-query from a country's keywords,
// quoting multi-word phrases: (ukraine OR kyiv OR "donbas region").
func gdeltCountryQuery(kws []string) string {
	parts := make([]string, 0, len(kws))
	for _, k := range kws {
		if strings.Contains(k, " ") {
			parts = append(parts, `"`+k+`"`)
		} else {
			parts = append(parts, k)
		}
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

// sourceConflict folds ACLED protest/riot counts per country. Key-gated: with no
// ACLED_ACCESS_TOKEN it contributes nothing and countries keep their baseline.
func (s *Server) sourceConflict() ([]model.Observation, error) {
	token := env("ACLED_ACCESS_TOKEN")
	if token == "" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	protests, err := s.fetchACLEDProtests(ctx, token)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, e := range protests {
		if code := normalizeCountry(asString(mapGet(e, "country"))); code != "" {
			counts[code]++
		}
	}
	out := make([]model.Observation, 0, len(counts))
	for code, n := range counts {
		out = append(out, model.Observation{
			ID: code, Kind: model.KindCountry,
			Metrics: map[string]float64{model.MetricConflictEvents: float64(n)},
		})
	}
	return out, nil
}

// sourceTheaters folds live military-air posture per strategic theater from
// OpenSky. Empty feed (throttled) → keep prior state.
func (s *Server) sourceTheaters() ([]model.Observation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	flights := s.fetchMilitaryFlights(ctx)
	if len(flights) == 0 {
		return nil, nil
	}
	out := make([]model.Observation, 0, len(postureTheaters))
	for _, th := range postureTheaters {
		p, n := buildPosture(th, flights)
		out = append(out, model.Observation{
			ID: th.id, Kind: model.KindTheater, Name: th.name,
			Metrics: map[string]float64{model.MetricMilitaryActivity: float64(n)},
			Note:    asString(p["headline"]),
		})
	}
	return out, nil
}

// sourceMarkets folds crypto market stress from 24h price change magnitude.
func (s *Server) sourceMarkets() ([]model.Observation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	u := "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
	var raw map[string]struct {
		USD       float64 `json:"usd"`
		Change24h float64 `json:"usd_24h_change"`
	}
	if err := s.getJSON(ctx, u, map[string]string{"Accept": "application/json"}, &raw); err != nil {
		return nil, err
	}
	names := map[string][2]string{
		"bitcoin":  {"BTC", "Bitcoin"},
		"ethereum": {"ETH", "Ethereum"},
		"solana":   {"SOL", "Solana"},
	}
	out := make([]model.Observation, 0, len(raw))
	for id, d := range raw {
		meta, ok := names[id]
		if !ok {
			continue
		}
		out = append(out, model.Observation{
			ID: meta[0], Kind: model.KindMarket, Name: meta[1],
			Metrics: map[string]float64{model.MetricMarketStress: math.Min(100, math.Abs(d.Change24h)*4)},
			Note:    fmt.Sprintf("$%.0f (%+.1f%% 24h)", d.USD, d.Change24h),
		})
	}
	return out, nil
}
