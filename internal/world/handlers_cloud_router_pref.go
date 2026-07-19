package world

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Enso Router — org cost↔quality preference + the mean-field judge panel.
//
// Two same-origin proxies for the Enso Router panel, holding the exact discipline
// of handlers_cloud_router.go (public router-stats/history): raw pass-through of
// the upstream shape, honest degrade (never a 5xx, never a fabricated number).
//
//   - router-preference  GET|PUT → ai gateway GET|POST /v1/router/preference
//       ORG-SCOPED: the caller's own IAM bearer is forwarded (userBearer), so the
//       gateway derives their org and stores/returns THAT org's routing bias — no
//       shared key, exactly like the admin aggregates forward the caller bearer.
//       GET yields {bias,default}; PUT writes {bias}. Degrades to a well-formed
//       disabled payload {available:false} on ANY upstream failure — including a
//       404 while the gateway route is not yet deployed — so the slider renders a
//       read-only "not deployed" state instead of erroring.
//
//   - judge-panel        GET     → ai gateway GET /v1/router/judge-panel?scope=platform
//       PUBLIC platform aggregate (like router-stats): the diverse judge panel that
//       scores routing quality + its published rank-corr benchmark. scope is
//       HARD-PINNED to platform. Honest {available:false} on failure, never faked.
//
// Honesty: the only value shown when the real one can't be read is a neutral 0.5
// ("balanced") bias, and it always rides with available:false so the panel never
// presents it as a saved preference.

// prefResponse is world's normalized preference control: the two 0..1 knobs the ai
// gateway tracks (bias = 0 max-savings … 1 max-quality; default = platform neutral)
// plus an availability flag the panel uses to pick live vs disabled rendering.
type prefResponse struct {
	Bias      float64 `json:"bias"`
	Default   float64 `json:"default"`
	Available bool    `json:"available"`
}

// clamp01 keeps a bias in the valid [0,1] band.
func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// disabledPref is the honest degraded control: a neutral balanced bias rendered
// read-only (available:false). Never implies a saved value.
func disabledPref() prefResponse { return prefResponse{Bias: 0.5, Default: 0.5, Available: false} }

// upstreamPref parses the gateway's preference body, tolerating either the bare
// {bias,default} shape or the casibase {status,data:{…}} envelope the sibling
// router endpoints use. ok=false when neither yields a bias.
func upstreamPref(body []byte) (prefResponse, bool) {
	type shape struct {
		Bias    *float64 `json:"bias"`
		Default *float64 `json:"default"`
	}
	var env struct {
		shape
		Data *shape `json:"data"`
	}
	if json.Unmarshal(body, &env) != nil {
		return prefResponse{}, false
	}
	s := env.shape
	if env.Data != nil && env.Data.Bias != nil {
		s = *env.Data
	}
	if s.Bias == nil {
		return prefResponse{}, false
	}
	out := prefResponse{Bias: clamp01(*s.Bias), Default: 0.5, Available: true}
	if s.Default != nil {
		out.Default = clamp01(*s.Default)
	}
	return out, true
}

func (s *Server) handleCloudRouterPreference(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, PUT, POST, OPTIONS") {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.getRouterPreference(w, r)
	case http.MethodPut, http.MethodPost:
		s.putRouterPreference(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// getRouterPreference reads the caller-org's current bias. Forwards the caller's
// bearer (if any); on any failure returns the honest disabled default.
func (s *Server) getRouterPreference(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	hdr := map[string]string{}
	if b := userBearer(r); b != "" {
		hdr["Authorization"] = b
	}
	body, status, err := s.get(ctx, apiHost()+"/v1/router/preference", hdr)
	if err != nil || status < 200 || status >= 300 {
		writeJSON(w, http.StatusOK, "no-store", disabledPref())
		return
	}
	pref, ok := upstreamPref(body)
	if !ok {
		writeJSON(w, http.StatusOK, "no-store", disabledPref())
		return
	}
	writeJSON(w, http.StatusOK, "no-store", pref)
}

// putRouterPreference writes a new bias for the caller-org. Body: {"bias": 0..1}.
// Forwards as POST /v1/router/preference with the caller's bearer. On any upstream
// failure it echoes the ATTEMPTED bias with available:false (honest "not saved" —
// the panel keeps the user's slider position and shows the control couldn't save),
// never a 5xx.
func (s *Server) putRouterPreference(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Bias *float64 `json:"bias"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil || in.Bias == nil {
		writeError(w, http.StatusBadRequest, `body must be {"bias": 0..1}`)
		return
	}
	bias := clamp01(*in.Bias)
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	hdr := map[string]string{"Content-Type": "application/json"}
	if b := userBearer(r); b != "" {
		hdr["Authorization"] = b
	}
	reqBody, _ := json.Marshal(map[string]float64{"bias": bias})
	body, status, err := s.do(ctx, http.MethodPost, apiHost()+"/v1/router/preference", hdr, reqBody)
	if err != nil || status < 200 || status >= 300 {
		writeJSON(w, http.StatusOK, "no-store", prefResponse{Bias: bias, Default: 0.5, Available: false})
		return
	}
	if pref, ok := upstreamPref(body); ok {
		writeJSON(w, http.StatusOK, "no-store", pref)
		return
	}
	// Accepted, but the gateway echoed nothing parseable — report the saved bias.
	writeJSON(w, http.StatusOK, "no-store", prefResponse{Bias: bias, Default: 0.5, Available: true})
}

// judgePanelUnavailable is the honest empty payload for the judge panel: no judges,
// no benchmark — the panel shows "warming up", never fabricated calibration.
var judgePanelUnavailable = json.RawMessage(`{"available":false,"enabled":false,"sampleRate":0,"models":[],"judges":[],"benchmark":null}`)

// normalizeJudgePanel tolerates either the bare judge-panel shape or the casibase
// {status,data} envelope, and guarantees an available:true flag on a real body so
// the panel renders. A non-ok envelope or unparseable body is a soft failure
// (bad gateway) → the honest empty payload via the cachedJSON onError path.
func normalizeJudgePanel(body []byte) (any, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil {
		return nil, httpErr(http.StatusBadGateway)
	}
	// Envelope {status,data:{…}}: require ok + non-null data, then descend into it.
	if _, hasData := obj["data"]; hasData {
		if _, hasStatus := obj["status"]; hasStatus {
			var env struct {
				Status string          `json:"status"`
				Data   json.RawMessage `json:"data"`
			}
			if json.Unmarshal(body, &env) != nil || env.Status != "ok" || len(env.Data) == 0 || string(env.Data) == "null" {
				return nil, httpErr(http.StatusBadGateway)
			}
			if json.Unmarshal(env.Data, &obj) != nil {
				return nil, httpErr(http.StatusBadGateway)
			}
		}
	}
	if _, ok := obj["available"]; !ok {
		obj["available"] = json.RawMessage("true")
	}
	return obj, nil
}

func (s *Server) handleCloudJudgePanel(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "judge-panel", "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
		30*time.Second, 5*time.Minute,
		func(ctx context.Context) (any, error) {
			// scope pinned to platform — aggregates only, no vendor-labeled scope.
			body, status, err := s.get(ctx, apiHost()+"/v1/router/judge-panel?scope=platform", nil)
			if err != nil {
				return nil, err
			}
			if status < 200 || status >= 300 {
				return nil, httpErr(status)
			}
			return normalizeJudgePanel(body)
		},
		func(w http.ResponseWriter, _ error) {
			writeJSON(w, http.StatusOK, "no-store", judgePanelUnavailable)
		},
	)
}
