package world

import (
	"context"
	"errors"
	"time"
)

// Service-plane access to the Hanzo Cloud (api.hanzo.ai) — the ONE place that
// knows how world authenticates as a platform service and reads the platform-wide
// aggregates the public dashboard surfaces (cloud-pulse volume, ai-pulse,
// enso-training). Org-scoped drill-down never comes through here: those panels
// call api.hanzo.ai directly with the CALLER's IAM bearer (see cloud-pulse.ts).
//
// One credential, one base. The service token is the repo's established,
// KMS-injected bearer (kms.go's fetch list) — it is NEVER sent to the browser.
// All aggregate reads share it, so there is exactly one secret for ops to
// provision. For the platform-wide reads (get-cloud-usages ?org=all and the
// routing-ledger exports) it must be a super-admin bearer; a non-admin token
// 4xxes upstream and every caller degrades to its honest demo/unavailable state.

// errNoServiceToken is returned by the service-plane readers when no service
// token is configured, so callers keep their honest degrade instead of faking.
var errNoServiceToken = errors.New("world: no service token configured")

// serviceToken returns the platform service bearer (KMS-injected). Empty ⇒ every
// service-side aggregate read degrades to demo/unavailable. Never exposed to the
// browser.
func serviceToken() string { return env("HANZO_CLOUD_PULSE_TOKEN") }

// serviceAuth is the Authorization header map for a service-side call, or nil
// when no service token is configured (so callers short-circuit to their demo
// path).
func serviceAuth() map[string]string {
	tok := serviceToken()
	if tok == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + tok}
}

// ── platform usage ledger (ai GET /v1/get-cloud-usages) ───────────────────────

// cloudUsageOverview decodes the fields world aggregates from ai's
// object.CloudUsageOverview. The upstream is ClickHouse-backed; ?org=all is the
// platform-wide view and requires a super-admin bearer.
type cloudUsageOverview struct {
	Range    string                  `json:"range"`
	Interval string                  `json:"interval"`
	Totals   cloudUsageTotals        `json:"totals"`
	Series   []cloudUsageSeriesPoint `json:"series"`
	ByModel  cloudUsageByModel       `json:"byModel"`
}

type cloudUsageTotals struct {
	Tokens     int64 `json:"tokens"`
	Requests   int64 `json:"requests"`
	SpendCents int64 `json:"spendCents"`
	Models     int64 `json:"models"`
}

type cloudUsageSeriesPoint struct {
	T          string `json:"t"`
	Tokens     int64  `json:"tokens"`
	SpendCents int64  `json:"spendCents"`
	Requests   int64  `json:"requests"`
}

type cloudUsageModelSpend struct {
	Model      string  `json:"model"`
	SpendCents int64   `json:"spendCents"`
	Tokens     int64   `json:"tokens"`
	Requests   int64   `json:"requests"`
	Pct        float64 `json:"pct"` // share of total spend, 0..100
}

type cloudUsageByModel struct {
	Items []cloudUsageModelSpend `json:"items"`
}

// fetchCloudUsage reads the platform-wide usage overview (?org=all) for a range
// label ("24h" | "7d" | "30d"). It requires a super-admin service token; it
// returns errNoServiceToken when none is set and the upstream error otherwise, so
// callers keep their honest modeled/demo fallback.
func (s *Server) fetchCloudUsage(ctx context.Context, rangeLabel string) (*cloudUsageOverview, error) {
	hdr := serviceAuth()
	if hdr == nil {
		return nil, errNoServiceToken
	}
	var ov cloudUsageOverview
	url := apiHost() + "/v1/get-cloud-usages?org=all&range=" + rangeLabel
	if err := s.getJSON(ctx, url, hdr, &ov); err != nil {
		return nil, err
	}
	return &ov, nil
}

// intervalSeconds parses a Go duration string (the usage series bucket width,
// e.g. "1h") to seconds; 0 when unparseable so callers fall back to a window
// average instead of dividing by a bogus interval.
func intervalSeconds(d string) float64 {
	if d == "" {
		return 0
	}
	v, err := time.ParseDuration(d)
	if err != nil || v <= 0 {
		return 0
	}
	return v.Seconds()
}

// usageRate returns the freshest honest per-second rate for a metric: the most
// recent complete series bucket over its interval, falling back to the 24h
// average when there is no usable interval/series. sel picks the metric from a
// bucket. Shared by cloud-pulse and ai-pulse so the rate is derived one way.
func usageRate(total24h int64, series []cloudUsageSeriesPoint, interval string, sel func(cloudUsageSeriesPoint) int64) float64 {
	if n := len(series); n > 0 {
		if iv := intervalSeconds(interval); iv > 0 {
			return float64(sel(series[n-1])) / iv
		}
	}
	const windowSecs = 86400.0
	return float64(total24h) / windowSecs
}

// seriesRequests / seriesTokens are the bucket selectors for usageRate.
func seriesRequests(p cloudUsageSeriesPoint) int64 { return p.Requests }
func seriesTokens(p cloudUsageSeriesPoint) int64   { return p.Tokens }

// topModelsFromUsage maps the ledger's ranked byModel spend into the shared
// cloudModel shape (share normalized 0..1). nil when the ledger listed none.
func topModelsFromUsage(ov *cloudUsageOverview) []cloudModel {
	if len(ov.ByModel.Items) == 0 {
		return nil
	}
	out := make([]cloudModel, 0, len(ov.ByModel.Items))
	for _, m := range ov.ByModel.Items {
		out = append(out, cloudModel{
			ID:          m.Model,
			Name:        m.Model,
			Requests24h: m.Requests,
			Tokens24h:   m.Tokens,
			Share:       m.Pct / 100,
		})
	}
	return out
}
