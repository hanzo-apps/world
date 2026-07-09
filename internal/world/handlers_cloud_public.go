package world

import (
	"context"
	"net/http"
	"time"
)

// Public Cloud data — the customer/investor "excitement layer". No auth: these
// are non-sensitive facts that make the platform look big + alive + global. The
// deep, sensitive views live behind requireAdmin (handlers_cloud_admin.go).

// ── models catalog (public) ──────────────────────────────────────────────────
//
// Real source: the gateway's /v1/models (public, OpenAI-compatible). We surface
// the served-model count + family breakdown + a ranked slice with tier/provider/
// context/pricing so the public console can show real scale, not a demo number.

type publicModel struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Provider string  `json:"provider"`
	Tier     string  `json:"tier"`
	Context  int64   `json:"context"`
	InPrice  float64 `json:"inPrice"`
	OutPrice float64 `json:"outPrice"`
}

type cloudModels struct {
	UpdatedAt    string        `json:"updatedAt"`
	TotalModels  int           `json:"totalModels"`
	ZenModels    int           `json:"zenModels"`
	CloudRegions int           `json:"cloudRegions"`
	CloudPlans   int           `json:"cloudPlans"`
	Families     []string      `json:"families"`
	Models       []publicModel `json:"models"`
}

func (s *Server) handleCloudModels(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "cloud-models", "public, max-age=120, s-maxage=120, stale-while-revalidate=600",
		2*time.Minute, 10*time.Minute,
		func(ctx context.Context) (any, error) {
			var src struct {
				Summary struct {
					ZenModels    int `json:"zenModels"`
					TotalModels  int `json:"totalModels"`
					CloudPlans   int `json:"cloudPlans"`
					CloudRegions int `json:"cloudRegions"`
				} `json:"summary"`
				Families []struct {
					Name string `json:"name"`
				} `json:"families"`
				Data []struct {
					ID       string `json:"id"`
					Name     string `json:"name"`
					Provider string `json:"provider"`
					Tier     string `json:"tier"`
					Context  int64  `json:"context"`
					Pricing  struct {
						Input  float64 `json:"input"`
						Output float64 `json:"output"`
					} `json:"pricing"`
				} `json:"data"`
			}
			if err := s.getJSON(ctx, apiHost()+"/v1/models", nil, &src); err != nil {
				return nil, err
			}
			out := cloudModels{
				UpdatedAt:    nowRFC(),
				TotalModels:  max2(src.Summary.TotalModels, len(src.Data)),
				ZenModels:    src.Summary.ZenModels,
				CloudRegions: src.Summary.CloudRegions,
				CloudPlans:   src.Summary.CloudPlans,
			}
			for _, fam := range src.Families {
				if fam.Name != "" {
					out.Families = append(out.Families, fam.Name)
				}
			}
			for i, m := range src.Data {
				if i >= 24 {
					break
				}
				out.Models = append(out.Models, publicModel{
					ID: m.ID, Name: orModelName(m.Name, m.ID), Provider: m.Provider,
					Tier: m.Tier, Context: m.Context, InPrice: m.Pricing.Input, OutPrice: m.Pricing.Output,
				})
			}
			return out, nil
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "", cloudModels{UpdatedAt: nowRFC()})
		},
	)
}

func orModelName(name, id string) string {
	if name != "" {
		return name
	}
	return id
}

func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}
