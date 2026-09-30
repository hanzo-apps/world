package world

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The public panel prices a model per 1M tokens from the listing's per-million keys,
// never from its per-token `prompt`/`completion`.
func TestCloudModelsReadsPerMillionRates(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","models":[],"data":[{"id":"enso","object":"model",
			"pricing":{"prompt":"0.000004","completion":"0.00002","input_per_million":4,"output_per_million":20}}]}`))
	}))
	t.Cleanup(up.Close)
	t.Setenv("HANZO_API_BASE", up.URL)
	t.Setenv("WORLD_DATA_DIR", t.TempDir())
	t.Setenv("WORLD_KV_DISABLE", "1")
	ts := aiPulseServer(t)

	resp, err := http.Get(ts.URL + "/v1/world/cloud/models")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got cloudModels
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Models) != 1 || got.Models[0].InPrice != 4 || got.Models[0].OutPrice != 20 {
		t.Fatalf("want enso at $4/$20 per 1M, got %+v", got.Models)
	}
}
