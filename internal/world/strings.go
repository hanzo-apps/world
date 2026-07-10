package world

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

func itoa(n int) string                { return strconv.Itoa(n) }
func urlQueryEscape(s string) string   { return url.QueryEscape(s) }
func httpErr(status int) error         { return fmt.Errorf("upstream status %d", status) }
func lower(s string) string            { return strings.ToLower(s) }
func contains(s, sub string) bool      { return strings.Contains(s, sub) }
func base64Std(s string) string        { return base64.StdEncoding.EncodeToString([]byte(s)) }
func trimSpace(s string) string        { return strings.TrimSpace(s) }
func hasPrefix(s, p string) bool       { return strings.HasPrefix(s, p) }
func hasSuffix(s, p string) bool       { return strings.HasSuffix(s, p) }
func trimPrefix(s, p string) string    { return strings.TrimPrefix(s, p) }
func splitComma(s string) []string     { return strings.Split(s, ",") }
func joinComma(parts []string) string  { return strings.Join(parts, ",") }
func upper(s string) string            { return strings.ToUpper(s) }
func replaceAll(s, o, n string) string { return strings.ReplaceAll(s, o, n) }

// truncate limits s to at most n bytes (matching JS substring semantics closely
// enough for the ASCII-dominant fields the upstreams emit).
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// sortByDateDesc stably sorts items by their "date_start" field, newest first.
func sortByDateDesc(items []map[string]any, parse func(any) (int64, bool)) {
	sort.SliceStable(items, func(i, j int) bool {
		a, _ := parse(items[i]["date_start"])
		b, _ := parse(items[j]["date_start"])
		return a > b
	})
}
