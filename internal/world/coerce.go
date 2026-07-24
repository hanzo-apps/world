package world

import (
	"bytes"
	"encoding/json"
	"strconv"
)

// Several upstreams (ACLED, UCDP, World Bank, HAPI) emit numeric fields
// inconsistently as JSON numbers or quoted strings. Decoding into map[string]any
// with UseNumber and coercing per-field is the DRY way to stay faithful without
// a bespoke struct per upstream quirk.

// decodeNumber unmarshals body into v with numbers preserved as json.Number.
func decodeNumber(body []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	return dec.Decode(v)
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	case nil:
		return ""
	default:
		return ""
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case json.Number:
		f, _ := t.Float64()
		return f
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case string:
		f, _ := strconv.ParseFloat(t, 64)
		return f
	default:
		return 0
	}
}

func asInt(v any) int { return int(asFloat(v)) }

// mapGet safely reads a key from a decoded object.
func mapGet(m map[string]any, key string) any {
	if m == nil {
		return nil
	}
	return m[key]
}
