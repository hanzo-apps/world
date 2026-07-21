package world

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"
)

// DeFi snapshot from DeFiLlama's public API (no key): total value locked across
// chains, the largest chains, and the stablecoin float. One cached endpoint so
// every viewer shares one upstream pull. Degrades to a clean unavailable 200.

// handleDefi serves /v1/world/defi.
func (s *Server) handleDefi(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "defi:v1",
		"public, max-age=900, s-maxage=900, stale-while-revalidate=1800",
		15*time.Minute, 30*time.Minute,
		func(ctx context.Context) (any, error) { return s.computeDefi(ctx) },
		func(w http.ResponseWriter, err error) {
			writeJSON(w, http.StatusOK, "", map[string]any{
				"asOf": nowISO(), "unavailable": true,
				"totalTvl": 0, "chains": []any{}, "stablecoins": map[string]any{},
			})
		})
}

func (s *Server) computeDefi(ctx context.Context) (any, error) {
	var (
		wg          sync.WaitGroup
		chains      []defiChain
		stableTotal float64
		stableTop   []map[string]any
		stableErr   error
		chainErr    error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		var raw []defiChain
		if err := s.getJSON(ctx, "https://api.llama.fi/v2/chains",
			map[string]string{"Accept": "application/json", "User-Agent": browserUA}, &raw); err != nil {
			chainErr = err
			return
		}
		chains = raw
	}()
	go func() {
		defer wg.Done()
		var sb struct {
			PeggedAssets []struct {
				Name        string             `json:"name"`
				Symbol      string             `json:"symbol"`
				Circulating map[string]float64 `json:"circulating"`
			} `json:"peggedAssets"`
		}
		if err := s.getJSON(ctx, "https://stablecoins.llama.fi/stablecoins?includePrices=false",
			map[string]string{"Accept": "application/json", "User-Agent": browserUA}, &sb); err != nil {
			stableErr = err
			return
		}
		type sc struct {
			name, symbol string
			mc           float64
		}
		var all []sc
		for _, p := range sb.PeggedAssets {
			mc := p.Circulating["peggedUSD"]
			stableTotal += mc
			all = append(all, sc{p.Name, p.Symbol, mc})
		}
		sort.Slice(all, func(i, j int) bool { return all[i].mc > all[j].mc })
		for i, c := range all {
			if i >= 6 {
				break
			}
			stableTop = append(stableTop, map[string]any{"name": c.name, "symbol": c.symbol, "marketCap": round2s(c.mc)})
		}
	}()
	wg.Wait()

	if chainErr != nil && stableErr != nil {
		return nil, chainErr
	}

	var total float64
	for _, c := range chains {
		total += c.Tvl
	}
	sort.Slice(chains, func(i, j int) bool { return chains[i].Tvl > chains[j].Tvl })
	top := make([]map[string]any, 0, 10)
	for i, c := range chains {
		if i >= 10 {
			break
		}
		share := 0.0
		if total > 0 {
			share = c.Tvl / total * 100
		}
		top = append(top, map[string]any{"name": c.Name, "tvl": round2s(c.Tvl), "share": round2s(share)})
	}

	return map[string]any{
		"asOf":     nowISO(),
		"totalTvl": round2s(total),
		"chains":   top,
		"stablecoins": map[string]any{
			"totalCirculating": round2s(stableTotal),
			"top":              stableTop,
		},
	}, nil
}

type defiChain struct {
	Name string  `json:"name"`
	Tvl  float64 `json:"tvl"`
}
