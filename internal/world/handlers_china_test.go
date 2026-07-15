package world

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func chinaFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "china-macro", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

var chinaNow = time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

func deref(t *testing.T, p *float64) float64 {
	t.Helper()
	if p == nil {
		t.Fatalf("expected a value, got nil")
	}
	return *p
}

// Parity with the TypeScript adapters: each source parser normalizes to
// independent value / prior / date / source / staleness fields.
func TestChinaSourceParsers(t *testing.T) {
	cpi := parseOecdCsvIndicator(chinaFixture(t, "oecd-cpi.csv"),
		indicatorDef{id: "cpi_yoy", label: "CPI (YoY)", category: "price", unit: "%", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow)
	if deref(t, cpi.Value) != 0.6 || deref(t, cpi.PriorValue) != 0.3 || cpi.ObservationDate != "2026-05" ||
		cpi.Source != "OECD Data Explorer" || cpi.Stale || cpi.UnavailableReason != "" {
		t.Fatalf("cpi mismatch: %+v", cpi)
	}

	cli := parseOecdCsvIndicator(chinaFixture(t, "oecd-cli.csv"),
		indicatorDef{id: "activity_cli", label: "Composite Leading Indicator", category: "activity", unit: "index", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow)
	if deref(t, cli.Value) != 99.58 {
		t.Fatalf("cli value = %v, want 99.58", cli.Value)
	}

	policy := parseBisPolicy(chinaFixture(t, "bis-policy.json"), chinaNow)
	if deref(t, policy.Value) != 3 || deref(t, policy.PriorValue) != 3.1 {
		t.Fatalf("policy mismatch: value=%v prior=%v", policy.Value, policy.PriorValue)
	}

	fx := parseFredUsdCny(chinaFixture(t, "fred-dexchus.json"), chinaNow)
	if deref(t, fx.Value) != 7.1842 {
		t.Fatalf("fx value = %v, want 7.1842", fx.Value)
	}

	hkma := parseHkmaCnyContext(chinaFixture(t, "hkma-cny.json"), chinaNow)
	if !hkma.ContextOnly || hkma.Source != "HKMA (Hong Kong/CNH context)" || deref(t, hkma.Value) != 1.0881 {
		t.Fatalf("hkma mismatch: %+v", hkma)
	}
}

// An old observation is stale even when the fetch itself is fresh.
func TestChinaStaleObservation(t *testing.T) {
	stale := parseOecdCsvIndicator(chinaFixture(t, "oecd-cpi.csv"),
		indicatorDef{id: "cpi_yoy", label: "CPI (YoY)", category: "price", unit: "%", source: "OECD Data Explorer", maxAgeDays: 30},
		time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
	if !stale.Stale || stale.UnavailableReason != "STALE_OBSERVATION" {
		t.Fatalf("expected stale STALE_OBSERVATION, got stale=%v reason=%q", stale.Stale, stale.UnavailableReason)
	}
}

// The launch gate needs current price, activity, policy, and FX; the oldest
// required observation anchors contentObservationDate. Optional context states
// are retained and never gate launch.
func TestChinaLaunchGate(t *testing.T) {
	indicators := []chinaIndicator{
		parseOecdCsvIndicator(chinaFixture(t, "oecd-cpi.csv"), indicatorDef{id: "cpi_yoy", category: "price", unit: "%", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow),
		parseOecdCsvIndicator(chinaFixture(t, "oecd-cli.csv"), indicatorDef{id: "activity_cli", category: "activity", unit: "index", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow),
		parseBisPolicy(chinaFixture(t, "bis-policy.json"), chinaNow),
		parseFredUsdCny(chinaFixture(t, "fred-dexchus.json"), chinaNow),
		unavailableIndicator(hkmaCnyDef, "HOST_BLOCKED", true),
	}
	snap := buildChinaMacroSnapshot(indicators, nil, chinaNow.Format(time.RFC3339))
	if !snap.LaunchReady || snap.Status != "ready" {
		t.Fatalf("expected ready/launch, got status=%q launchReady=%v", snap.Status, snap.LaunchReady)
	}
	if snap.ContentObservationDate != "2026-05" {
		t.Fatalf("contentObservationDate = %q, want oldest required 2026-05", snap.ContentObservationDate)
	}
	if snap.LatestObservationDate != "2026-07-10" {
		t.Fatalf("latestObservationDate = %q, want 2026-07-10", snap.LatestObservationDate)
	}
	if last := snap.Indicators[len(snap.Indicators)-1]; last.UnavailableReason != "HOST_BLOCKED" {
		t.Fatalf("optional context state not retained: %+v", last)
	}

	// A stale required category drops launch readiness to degraded.
	indicators[1].Stale = true
	degraded := buildChinaMacroSnapshot(indicators, nil, chinaNow.Format(time.RFC3339))
	if degraded.LaunchReady || degraded.Status != "degraded" || degraded.ContentObservationDate != "" {
		t.Fatalf("expected degraded with blank content date, got %+v", degraded)
	}
}

// A missing policy source (our fork has no BIS feed) is honestly not_configured
// and holds launch back rather than faking readiness.
func TestChinaNotConfiguredPolicyBlocksLaunch(t *testing.T) {
	indicators := []chinaIndicator{
		parseOecdCsvIndicator(chinaFixture(t, "oecd-cpi.csv"), indicatorDef{id: "cpi_yoy", category: "price", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow),
		parseOecdCsvIndicator(chinaFixture(t, "oecd-cli.csv"), indicatorDef{id: "activity_cli", category: "activity", source: "OECD Data Explorer", maxAgeDays: 120}, chinaNow),
		unavailableIndicator(bisPolicyDef, "not_configured", false),
		parseFredUsdCny(chinaFixture(t, "fred-dexchus.json"), chinaNow),
	}
	snap := buildChinaMacroSnapshot(indicators, nil, chinaNow.Format(time.RFC3339))
	if snap.LaunchReady || snap.Status != "degraded" {
		t.Fatalf("not_configured policy should degrade, got status=%q launchReady=%v", snap.Status, snap.LaunchReady)
	}
	if got := requiredIndicator(snap.Indicators, "policy"); got == nil || got.UnavailableReason != "not_configured" {
		t.Fatalf("policy indicator not marked not_configured: %+v", got)
	}
}

// The NBS grid keeps blank months empty and captures quarterly + Spring-Festival
// shifted releases.
func TestChinaParseNbsReleaseCalendar(t *testing.T) {
	events := parseNbsReleaseCalendar(chinaFixture(t, "nbs-calendar.html"), 2026,
		"https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/202512/t20251226_1962154.html")

	for _, e := range events {
		if e.Event == "National Economic Performance" && len(e.ReleaseDate) >= 7 && e.ReleaseDate[:7] == "2026-02" {
			t.Fatalf("blank February month should stay empty, got %+v", e)
		}
	}

	var prelim []string
	for _, e := range events {
		if strings.HasPrefix(e.Event, "Preliminary Accounting") {
			prelim = append(prelim, e.ReleaseDate)
		}
	}
	want := []string{"2026-01-20", "2026-04-17", "2026-07-16", "2026-10-20"}
	if len(prelim) != len(want) {
		t.Fatalf("preliminary accounting dates = %v, want %v", prelim, want)
	}
	for i := range want {
		if prelim[i] != want[i] {
			t.Fatalf("preliminary accounting dates = %v, want %v", prelim, want)
		}
	}

	if !hasReleaseOn(events, "Purchasing Managers", "2026-03-04") || !hasReleaseOn(events, "Purchasing Managers", "2026-03-31") {
		t.Fatalf("PMI Spring-Festival-shifted dual release not captured")
	}
}

func hasReleaseOn(events []chinaReleaseEvent, eventSubstr, date string) bool {
	for _, e := range events {
		if e.ReleaseDate == date && strings.Contains(e.Event, eventSubstr) {
			return true
		}
	}
	return false
}

// LPR candidates roll over weekends and official holidays; only realized months
// are promoted to verified.
func TestChinaLprCandidates(t *testing.T) {
	candidates, err := buildLprCandidates(2026)
	if err != nil {
		t.Fatalf("buildLprCandidates(2026): %v", err)
	}
	if got := monthDate(candidates, "2026-02"); got != "2026-02-24" {
		t.Fatalf("Feb LPR candidate = %q, want 2026-02-24 (Spring Festival roll-forward)", got)
	}
	if got := monthDate(candidates, "2026-06"); got != "2026-06-22" {
		t.Fatalf("Jun LPR candidate = %q, want 2026-06-22 (Dragon Boat roll-forward)", got)
	}
	for _, c := range candidates {
		if c.Status != "provisional" {
			t.Fatalf("candidate %s not provisional: %q", c.ReleaseDate, c.Status)
		}
	}

	realized := parseChinaMoneyLprNotices(chinaFixture(t, "chinamoney-lpr.json"))
	merged := mergeVerifiedLprDates(candidates, realized)
	if statusOf(merged, "2026-02-24") != "verified" || statusOf(merged, "2026-06-22") != "verified" {
		t.Fatalf("realized LPR dates not verified: %v", merged)
	}
	if statusOf(merged, "2026-07-20") != "provisional" {
		t.Fatalf("unrealized July LPR should stay provisional")
	}
}

// Fails closed when the official holiday calendar is not configured for a year.
func TestChinaLprCalendarUnconfiguredYear(t *testing.T) {
	if _, err := buildLprCandidates(2027); err == nil {
		t.Fatalf("expected CHINA_HOLIDAY_CALENDAR_UNAVAILABLE for unconfigured 2027")
	}
}

// The trusted-origin guard resolves same-origin links and refuses off-origin ones.
func TestChinaCurrentCalendarLink(t *testing.T) {
	got, err := currentCalendarLink(`<a href="calendar.html">2026 release calendar</a>`, 2026)
	if err != nil || got != "https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/calendar.html" {
		t.Fatalf("trusted relative link resolution failed: got=%q err=%v", got, err)
	}

	if _, err := currentCalendarLink(`<a href="https://attacker.example/calendar.html">2026 release calendar</a>`, 2026); err == nil {
		t.Fatalf("off-origin NBS link must be rejected")
	}

	got, err = currentCalendarLink(`<p>no link here</p>`, 2026)
	if err != nil || got != nbsCalendarIndexURL {
		t.Fatalf("missing link should fall back to index URL, got=%q err=%v", got, err)
	}
}

// The handler exposes the merged shape and degrades to an honest unavailable
// payload (never a 5xx) — the fallback branch of the endpoint.
func TestChinaUnavailableShape(t *testing.T) {
	u := chinaUnavailable()
	if u.CountryCode != "CN" || !u.Unavailable || u.Status != "unavailable" ||
		u.Indicators == nil || u.ReleaseEvents == nil || u.SourceDecisions == nil {
		t.Fatalf("unavailable fallback shape wrong: %+v", u)
	}
}

func monthDate(events []chinaReleaseEvent, month string) string {
	for _, e := range events {
		if len(e.ReleaseDate) >= 7 && e.ReleaseDate[:7] == month {
			return e.ReleaseDate
		}
	}
	return ""
}

func statusOf(events []chinaReleaseEvent, date string) string {
	for _, e := range events {
		if e.ReleaseDate == date {
			return e.Status
		}
	}
	return ""
}
