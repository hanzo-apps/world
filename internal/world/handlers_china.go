package world

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// China macro snapshot + official release calendar. A faithful Go port of the
// worldmonitor seed adapters (scripts/china-macro/{adapters,calendar}.mjs) and
// the merge in server/worldmonitor/economic/v1/get-china-macro-snapshot.ts.
//
// Every source parser is a small pure func over a raw body so it is unit-tested
// against the same fixtures as the TypeScript original. handleChinaMacro is the
// only impure piece: it fetches the live sources (<=2 sequential OECD requests,
// per OECD's "<60 downloads/hour" ask), builds both flows, and merges them into
// the exact upstream payload shape, cached aggressively (daily/monthly series).

const (
	oecdCPIURL        = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_G20_PRICES@DF_G20_PRICES,1.0/CHN.M...PA...?startPeriod=2024-01&dimensionAtObservation=AllDimensions&format=csvfile"
	oecdCLIURL        = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/CHN.M.LI...AA...H?startPeriod=2024-01&dimensionAtObservation=AllDimensions&format=csvfile"
	hkmaCNYURL        = "https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily?pagesize=2&fields=end_of_day,cny&sortby=end_of_day&sortorder=desc"
	fredDEXCHUSURL    = "https://api.stlouisfed.org/fred/series/observations?series_id=DEXCHUS&file_type=json&sort_order=desc&limit=2"
	bisPolicyCacheKey = "economic:bis:policy:v1"

	nbsCalendarIndexURL    = "https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/"
	chinaMoneyLPRURL       = "https://www.chinamoney.com.cn/chinese/bklpr/?tab=2"
	chinaMoneyLPRNoticeAPI = "https://www.chinamoney.com.cn/ags/ms/cm-s-notice-query/contentsinshorttime"
	chinaMoneyLPRChannelID = "3686"
)

// chinaIndicator is one macro series in the snapshot. Value/PriorValue are
// pointers so an unavailable observation marshals as JSON null (never a fake 0),
// matching the upstream `value: null` contract.
type chinaIndicator struct {
	ID                string   `json:"id"`
	Label             string   `json:"label"`
	Category          string   `json:"category"`
	Value             *float64 `json:"value"`
	PriorValue        *float64 `json:"priorValue"`
	Unit              string   `json:"unit"`
	ObservationDate   string   `json:"observationDate"`
	Source            string   `json:"source"`
	SourceURL         string   `json:"sourceUrl"`
	Stale             bool     `json:"stale"`
	UnavailableReason string   `json:"unavailableReason"`
	ContextOnly       bool     `json:"contextOnly"`
}

type chinaSourceDecision struct {
	Source       string `json:"source"`
	Host         string `json:"host"`
	Status       string `json:"status"`
	Reason       string `json:"reason"`
	CheckedAt    string `json:"checkedAt"`
	Optional     bool   `json:"optional"`
	RequestCount int    `json:"requestCount"`
}

type chinaReleaseEvent struct {
	ID          string `json:"id"`
	Event       string `json:"event"`
	CountryCode string `json:"countryCode"`
	ReleaseDate string `json:"releaseDate"`
	ReleaseTime string `json:"releaseTime"`
	Timezone    string `json:"timezone"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	SourceURL   string `json:"sourceUrl"`
}

// chinaMacroSnapshot is the merged payload the SPA consumes. Empty slices are
// initialized so they marshal as [] rather than null.
type chinaMacroSnapshot struct {
	CountryCode            string                `json:"countryCode"`
	GeneratedAt            string                `json:"generatedAt"`
	Status                 string                `json:"status"`
	LaunchReady            bool                  `json:"launchReady"`
	ContentObservationDate string                `json:"contentObservationDate"`
	LatestObservationDate  string                `json:"latestObservationDate"`
	Indicators             []chinaIndicator      `json:"indicators"`
	SourceDecisions        []chinaSourceDecision `json:"sourceDecisions"`
	ReleaseEvents          []chinaReleaseEvent   `json:"releaseEvents"`
	Unavailable            bool                  `json:"unavailable"`
}

// indicatorDef is the static description of a series (labels, source, staleness
// horizon) shared by the complete/unavailable builders.
type indicatorDef struct {
	id, label, category, unit, source, sourceURL string
	maxAgeDays                                    int
}

var chinaRequiredCategories = []string{"price", "activity", "policy", "fx"}

// ── observation health ───────────────────────────────────────────────────────

var (
	reObsMonth   = regexp.MustCompile(`^(\d{4})-(\d{2})$`)
	reObsDay     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reStatusCode = regexp.MustCompile(`status (\d+)`)
)

// observationTime resolves a source timestamp to the instant used for staleness.
// Monthly values ('2026-05') anchor at month-end 23:59:59 UTC so a fresh FX tick
// never makes stale monthly content look current; daily values anchor at day-end.
func observationTime(v string) (time.Time, bool) {
	if v == "" {
		return time.Time{}, false
	}
	if m := reObsMonth.FindStringSubmatch(v); m != nil {
		y, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		// day 0 of month mo+1 == last day of month mo.
		return time.Date(y, time.Month(mo)+1, 0, 23, 59, 59, 0, time.UTC), true
	}
	if reObsDay.MatchString(v) {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.UTC), true
		}
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func isStale(obsDate string, maxAgeDays int, now time.Time) bool {
	t, ok := observationTime(obsDate)
	if !ok {
		return true
	}
	return now.Sub(t) > time.Duration(maxAgeDays)*24*time.Hour
}

func unavailableIndicator(def indicatorDef, reason string, contextOnly bool) chinaIndicator {
	if reason == "" {
		reason = "SOURCE_UNAVAILABLE"
	}
	return chinaIndicator{
		ID: def.id, Label: def.label, Category: def.category, Unit: def.unit,
		Source: def.source, SourceURL: def.sourceURL,
		UnavailableReason: reason, ContextOnly: contextOnly,
	}
}

func completeIndicator(def indicatorDef, value float64, prior *float64, obsDate string, now time.Time, contextOnly bool) chinaIndicator {
	stale := isStale(obsDate, def.maxAgeDays, now)
	reason := ""
	if stale {
		reason = "STALE_OBSERVATION"
	}
	v := value
	return chinaIndicator{
		ID: def.id, Label: def.label, Category: def.category, Value: &v, PriorValue: prior,
		Unit: def.unit, ObservationDate: obsDate, Source: def.source, SourceURL: def.sourceURL,
		Stale: stale, UnavailableReason: reason, ContextOnly: contextOnly,
	}
}

// ── source parsers (pure) ────────────────────────────────────────────────────

type dateValue struct {
	date  string
	value float64
}

func latestTwo(rows []dateValue) (dateValue, *float64) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].date < rows[j].date })
	latest := rows[len(rows)-1]
	if len(rows) >= 2 {
		p := rows[len(rows)-2].value
		return latest, &p
	}
	return latest, nil
}

func csvColumn(header []string, names ...string) int {
	for i, h := range header {
		for _, n := range names {
			if h == n {
				return i
			}
		}
	}
	return -1
}

// parseOecdCsvIndicator reads an OECD SDMX CSV (CPI YoY from DF_G20_PRICES or CLI
// from DF_CLI), keeping only mainland-China (REF_AREA=CHN) observations and
// returning the latest value with the prior for change context.
func parseOecdCsvIndicator(body []byte, def indicatorDef, now time.Time) chinaIndicator {
	r := csv.NewReader(strings.NewReader(string(body)))
	r.FieldsPerRecord = -1
	recs, _ := r.ReadAll()
	if len(recs) == 0 {
		return unavailableIndicator(def, "MALFORMED_RESPONSE", false)
	}
	header := recs[0]
	area := csvColumn(header, "REF_AREA", "ReferenceArea")
	date := csvColumn(header, "TIME_PERIOD", "TimePeriod")
	val := csvColumn(header, "OBS_VALUE", "ObservationValue")
	if area < 0 || date < 0 || val < 0 {
		return unavailableIndicator(def, "MALFORMED_RESPONSE", false)
	}
	var rows []dateValue
	for _, rec := range recs[1:] {
		if area >= len(rec) || date >= len(rec) || val >= len(rec) {
			continue
		}
		if strings.ToUpper(rec[area]) != "CHN" || rec[date] == "" {
			continue
		}
		v, err := strconv.ParseFloat(rec[val], 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		rows = append(rows, dateValue{rec[date], v})
	}
	if len(rows) == 0 {
		return unavailableIndicator(def, "NO_CHINA_OBSERVATIONS", false)
	}
	latest, prior := latestTwo(rows)
	return completeIndicator(def, latest.value, prior, latest.date, now, false)
}

var bisPolicyDef = indicatorDef{
	id: "policy_rate", label: "Policy Rate", category: "policy", unit: "%",
	source: "BIS (mainland China policy rate)", sourceURL: "https://stats.bis.org/api/v1/data/WS_CBPOL", maxAgeDays: 75,
}

// parseBisPolicy reads the seeded BIS central-bank policy-rate cache shape and
// returns China's latest rate. Prior falls back to the row's previousRate when
// only one observation is present.
func parseBisPolicy(body []byte, now time.Time) chinaIndicator {
	var payload struct {
		Rates []struct {
			CountryCode  string   `json:"countryCode"`
			Rate         *float64 `json:"rate"`
			PreviousRate *float64 `json:"previousRate"`
			Date         string   `json:"date"`
		} `json:"rates"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return unavailableIndicator(bisPolicyDef, "NO_CHINA_POLICY_RATE", false)
	}
	type row struct {
		date         string
		rate         float64
		previousRate *float64
	}
	var matches []row
	for _, r := range payload.Rates {
		if r.CountryCode != "CN" || r.Rate == nil || r.Date == "" || math.IsNaN(*r.Rate) {
			continue
		}
		matches = append(matches, row{r.Date, *r.Rate, r.PreviousRate})
	}
	if len(matches) == 0 {
		return unavailableIndicator(bisPolicyDef, "NO_CHINA_POLICY_RATE", false)
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].date < matches[j].date })
	latest := matches[len(matches)-1]
	var prior *float64
	if len(matches) > 1 {
		p := matches[len(matches)-2].rate
		prior = &p
	} else if latest.previousRate != nil && !math.IsNaN(*latest.previousRate) {
		p := *latest.previousRate
		prior = &p
	}
	return completeIndicator(bisPolicyDef, latest.rate, prior, latest.date, now, false)
}

var fredUsdCnyDef = indicatorDef{
	id: "usd_cny", label: "USD/CNY", category: "fx", unit: "CNY per USD",
	source: "FRED DEXCHUS (Federal Reserve H.10)", sourceURL: "https://fred.stlouisfed.org/series/DEXCHUS", maxAgeDays: 10,
}

// parseFredUsdCny reads FRED DEXCHUS observations (values are strings, '.' for
// missing) and returns the latest USD/CNY fixing.
func parseFredUsdCny(body []byte, now time.Time) chinaIndicator {
	var payload struct {
		Observations []struct {
			Date  string `json:"date"`
			Value string `json:"value"`
		} `json:"observations"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return unavailableIndicator(fredUsdCnyDef, "NO_CURRENT_DEXCHUS", false)
	}
	var rows []dateValue
	for _, o := range payload.Observations {
		v, err := strconv.ParseFloat(o.Value, 64)
		if o.Date == "" || err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		rows = append(rows, dateValue{o.Date, v})
	}
	if len(rows) == 0 {
		return unavailableIndicator(fredUsdCnyDef, "NO_CURRENT_DEXCHUS", false)
	}
	latest, prior := latestTwo(rows)
	return completeIndicator(fredUsdCnyDef, latest.value, prior, latest.date, now, false)
}

var hkmaCnyDef = indicatorDef{
	id: "cnh_context", label: "CNY/HKD Context", category: "context", unit: "HKD per CNY",
	source:     "HKMA (Hong Kong/CNH context)",
	sourceURL:  "https://apidocs.hkma.gov.hk/documentation/market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily/",
	maxAgeDays: 10,
}

// parseHkmaCnyContext reads the optional HKMA daily CNY/HKD context series. It is
// context-only: it never gates the launch decision.
func parseHkmaCnyContext(body []byte, now time.Time) chinaIndicator {
	var payload struct {
		Result struct {
			Records []struct {
				EndOfDay string   `json:"end_of_day"`
				CNY      *float64 `json:"cny"`
			} `json:"records"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return unavailableIndicator(hkmaCnyDef, "NO_HKMA_CNY_CONTEXT", true)
	}
	var rows []dateValue
	for _, rec := range payload.Result.Records {
		if rec.EndOfDay == "" || rec.CNY == nil || math.IsNaN(*rec.CNY) {
			continue
		}
		rows = append(rows, dateValue{rec.EndOfDay, *rec.CNY})
	}
	if len(rows) == 0 {
		return unavailableIndicator(hkmaCnyDef, "NO_HKMA_CNY_CONTEXT", true)
	}
	latest, prior := latestTwo(rows)
	return completeIndicator(hkmaCnyDef, latest.value, prior, latest.date, now, true)
}

// ── release calendar (pure) ──────────────────────────────────────────────────

var (
	reNbsRow      = regexp.MustCompile(`(?is)<tr\b[^>]*>(.*?)</tr>`)
	reNbsCell     = regexp.MustCompile(`(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>`)
	reNbsBr       = regexp.MustCompile(`(?i)<br\s*/?\s*>`)
	reNbsTag      = regexp.MustCompile(`<[^>]+>`)
	reNbsSpaces   = regexp.MustCompile(`[ \t]+`)
	reNbsNumeric  = regexp.MustCompile(`^\d+$`)
	reNbsEllipsis = regexp.MustCompile(`^(\x{2026}+|\.{3,})$`)
	reNbsDay      = regexp.MustCompile(`(^|\s)(\d{1,2})\s*/[A-Za-z]+`)
	reNbsTime     = regexp.MustCompile(`\b(\d{1,2}:\d{2})\b`)
	reNbsWS       = regexp.MustCompile(`\s`)
)

func stripHTML(v string) string {
	v = reNbsBr.ReplaceAllString(v, "\n")
	v = reNbsTag.ReplaceAllString(v, " ")
	v = strings.ReplaceAll(v, "&nbsp;", " ")
	v = strings.ReplaceAll(v, "&#160;", " ")
	v = strings.ReplaceAll(v, "&amp;", "&")
	v = strings.ReplaceAll(v, "&#39;", "'")
	v = strings.ReplaceAll(v, "&apos;", "'")
	v = strings.ReplaceAll(v, "&quot;", "\"")
	v = reNbsSpaces.ReplaceAllString(v, " ")
	return strings.TrimSpace(v)
}

func nbsCells(row string) []string {
	matches := reNbsCell.FindAllStringSubmatch(row, -1)
	cells := make([]string, 0, len(matches))
	for _, m := range matches {
		cells = append(cells, stripHTML(m[1]))
	}
	return cells
}

func isoDate(year, month, day int) string {
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
}

// parseNbsReleaseCalendar scrapes the National Bureau of Statistics HTML release
// grid (one row per statistic, one column per month) into dated release events.
// Blank/ellipsis month cells stay empty; a cell may carry several days (e.g. the
// Spring-Festival-shifted PMI) and each becomes its own event.
func parseNbsReleaseCalendar(html []byte, year int, sourceURL string) []chinaReleaseEvent {
	var events []chinaReleaseEvent
	for _, rowMatch := range reNbsRow.FindAllStringSubmatch(string(html), -1) {
		cells := nbsCells(rowMatch[1])
		if len(cells) < 14 || !reNbsNumeric.MatchString(cells[0]) {
			continue
		}
		event := cells[1]
		rowNo, _ := strconv.Atoi(cells[0])
		for month := 1; month <= 12; month++ {
			cell := ""
			if month+1 < len(cells) {
				cell = cells[month+1]
			}
			if cell == "" || reNbsEllipsis.MatchString(reNbsWS.ReplaceAllString(cell, "")) {
				continue
			}
			releaseTime := "09:30"
			if m := reNbsTime.FindStringSubmatch(cell); m != nil {
				releaseTime = m[1]
			}
			for _, dm := range reNbsDay.FindAllStringSubmatch(cell, -1) {
				day, _ := strconv.Atoi(dm[2])
				releaseDate := isoDate(year, month, day)
				events = append(events, chinaReleaseEvent{
					ID:          fmt.Sprintf("nbs-%02d-%s", rowNo, releaseDate),
					Event:       event,
					CountryCode: "CN",
					ReleaseDate: releaseDate,
					ReleaseTime: releaseTime,
					Timezone:    "Asia/Shanghai",
					Kind:        "nbs",
					Status:      "scheduled",
					Source:      "National Bureau of Statistics of China",
					SourceURL:   sourceURL,
				})
			}
		}
	}
	sortReleaseEvents(events)
	return events
}

func sortReleaseEvents(events []chinaReleaseEvent) {
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].ReleaseDate != events[j].ReleaseDate {
			return events[i].ReleaseDate < events[j].ReleaseDate
		}
		return events[i].Event < events[j].Event
	})
}

// chinaBusinessCalendar is the official mainland-China holiday + adjusted-workday
// set for a year. LPR candidate dates are rolled forward over these.
type chinaBusinessCalendar struct {
	holidays         map[string]bool
	adjustedWorkdays map[string]bool
}

func toSet(days ...string) map[string]bool {
	m := make(map[string]bool, len(days))
	for _, d := range days {
		m[d] = true
	}
	return m
}

// chinaBusinessCalendars is the hardcoded official calendar. 2027 must be added
// here before January 2027, or buildLprCandidates fails closed for that year.
var chinaBusinessCalendars = map[int]chinaBusinessCalendar{
	2026: {
		holidays: toSet(
			"2026-01-01", "2026-01-02", "2026-01-03",
			"2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
			"2026-04-04", "2026-04-05", "2026-04-06",
			"2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
			"2026-06-19", "2026-06-20", "2026-06-21",
			"2026-09-25", "2026-09-26", "2026-09-27",
			"2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
		),
		adjustedWorkdays: toSet("2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"),
	},
}

func businessCalendar(year int) (chinaBusinessCalendar, error) {
	if cal, ok := chinaBusinessCalendars[year]; ok {
		return cal, nil
	}
	return chinaBusinessCalendar{}, fmt.Errorf("CHINA_HOLIDAY_CALENDAR_UNAVAILABLE:%d", year)
}

func isChinaBusinessDay(d time.Time, cal chinaBusinessCalendar) bool {
	iso := d.UTC().Format("2006-01-02")
	if cal.adjustedWorkdays[iso] {
		return true
	}
	if cal.holidays[iso] {
		return false
	}
	wd := d.UTC().Weekday()
	return wd != time.Sunday && wd != time.Saturday
}

// buildLprCandidates derives the provisional PBoC Loan Prime Rate release dates:
// the 20th of each month rolled forward to the next mainland-China business day.
// Realized dates are confirmed later via ChinaMoney (mergeVerifiedLprDates).
func buildLprCandidates(year int) ([]chinaReleaseEvent, error) {
	cal, err := businessCalendar(year)
	if err != nil {
		return nil, err
	}
	events := make([]chinaReleaseEvent, 0, 12)
	for month := 1; month <= 12; month++ {
		d := time.Date(year, time.Month(month), 20, 0, 0, 0, 0, time.UTC)
		for !isChinaBusinessDay(d, cal) {
			d = d.AddDate(0, 0, 1)
		}
		releaseDate := d.UTC().Format("2006-01-02")
		events = append(events, chinaReleaseEvent{
			ID:          "pboc-lpr-" + releaseDate[:7],
			Event:       "Loan Prime Rate (LPR)",
			CountryCode: "CN",
			ReleaseDate: releaseDate,
			ReleaseTime: "09:00",
			Timezone:    "Asia/Shanghai",
			Kind:        "pboc_lpr",
			Status:      "provisional",
			Source:      "PBoC rule; realized date verified by ChinaMoney/CFETS",
			SourceURL:   chinaMoneyLPRURL,
		})
	}
	return events, nil
}

var (
	reLprNoticeTitle = regexp.MustCompile(`受权公布贷款市场报价利率.*LPR`)
	reLprNoticeDate  = regexp.MustCompile(`^20\d{2}-\d{2}-\d{2}$`)
)

// parseChinaMoneyLprNotices extracts the realized LPR announcement dates from the
// ChinaMoney notice feed, keeping only genuine rate-publication notices.
func parseChinaMoneyLprNotices(body []byte) []string {
	var payload struct {
		Records []struct {
			Title       string `json:"title"`
			ReleaseDate string `json:"releaseDate"`
		} `json:"records"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	seen := map[string]bool{}
	var dates []string
	for _, rec := range payload.Records {
		if !reLprNoticeTitle.MatchString(rec.Title) {
			continue
		}
		d := rec.ReleaseDate
		if len(d) > 10 {
			d = d[:10]
		}
		if !reLprNoticeDate.MatchString(d) || seen[d] {
			continue
		}
		seen[d] = true
		dates = append(dates, d)
	}
	sort.Strings(dates)
	return dates
}

// mergeVerifiedLprDates promotes each provisional candidate to a verified date
// when ChinaMoney published a realized announcement in the same month.
func mergeVerifiedLprDates(candidates []chinaReleaseEvent, realizedDates []string) []chinaReleaseEvent {
	realizedByMonth := map[string]string{}
	for _, d := range realizedDates {
		if len(d) >= 7 {
			realizedByMonth[d[:7]] = d
		}
	}
	out := make([]chinaReleaseEvent, len(candidates))
	for i, c := range candidates {
		out[i] = c
		if realized, ok := realizedByMonth[c.ReleaseDate[:7]]; ok {
			out[i].ReleaseDate = realized
			out[i].Status = "verified"
			out[i].ID = "pboc-lpr-" + realized[:7]
		}
	}
	return out
}

// currentCalendarLink resolves the year's NBS calendar page from the index,
// refusing any link that is not on the trusted www.stats.gov.cn release-calendar
// path so a tampered index can never redirect the scrape off-origin.
func currentCalendarLink(indexHTML string, year int) (string, error) {
	re := regexp.MustCompile(`href=["']([^"']+)["'][^>]*>[^<]*` + strconv.Itoa(year) + `[^<]*<`)
	m := re.FindStringSubmatch(indexHTML)
	if m == nil {
		return nbsCalendarIndexURL, nil
	}
	base, err := url.Parse(nbsCalendarIndexURL)
	if err != nil {
		return "", fmt.Errorf("NBS_CALENDAR_LINK_REJECTED:UNTRUSTED_NBS_CALENDAR_URL")
	}
	ref, err := base.Parse(m[1])
	if err != nil {
		return "", fmt.Errorf("NBS_CALENDAR_LINK_REJECTED:UNTRUSTED_NBS_CALENDAR_URL")
	}
	trustedOrigin := ref.Scheme == "https" && ref.Host == "www.stats.gov.cn"
	trustedPath := strings.HasPrefix(ref.Path, "/english/PressRelease/ReleaseCalendar/")
	if !trustedOrigin || !trustedPath {
		return "", fmt.Errorf("NBS_CALENDAR_LINK_REJECTED:UNTRUSTED_NBS_CALENDAR_URL")
	}
	return ref.String(), nil
}

// ── merge ────────────────────────────────────────────────────────────────────

func requiredIndicator(indicators []chinaIndicator, category string) *chinaIndicator {
	for i := range indicators {
		if indicators[i].Category == category && !indicators[i].ContextOnly {
			return &indicators[i]
		}
	}
	return nil
}

// buildChinaMacroSnapshot applies the launch gate: launchReady only when all four
// required categories (price/activity/policy/fx) carry a current, non-stale
// value. contentObservationDate is the OLDEST required observation — the anchor
// that keeps a fresh FX tick from masking stale CPI/activity content.
func buildChinaMacroSnapshot(indicators []chinaIndicator, decisions []chinaSourceDecision, generatedAt string) chinaMacroSnapshot {
	launchReady := true
	var requiredDates []string
	for _, cat := range chinaRequiredCategories {
		ind := requiredIndicator(indicators, cat)
		if ind == nil || ind.Value == nil || ind.Stale || ind.UnavailableReason != "" {
			launchReady = false
		}
		if ind != nil && ind.ObservationDate != "" {
			requiredDates = append(requiredDates, ind.ObservationDate)
		}
	}
	sort.Strings(requiredDates)
	anyValue := false
	for i := range indicators {
		if indicators[i].Value != nil {
			anyValue = true
			break
		}
	}
	status := "unavailable"
	switch {
	case launchReady:
		status = "ready"
	case anyValue:
		status = "degraded"
	}
	content := ""
	if launchReady && len(requiredDates) == len(chinaRequiredCategories) {
		content = requiredDates[0]
	}
	latest := ""
	if len(requiredDates) > 0 {
		latest = requiredDates[len(requiredDates)-1]
	}
	return chinaMacroSnapshot{
		CountryCode: "CN", GeneratedAt: generatedAt, Status: status, LaunchReady: launchReady,
		ContentObservationDate: content, LatestObservationDate: latest,
		Indicators: indicators, SourceDecisions: decisions,
		ReleaseEvents: []chinaReleaseEvent{},
	}
}

func chinaDecision(source, host, status, reason, checkedAt string, optional bool, requestCount int) chinaSourceDecision {
	return chinaSourceDecision{Source: source, Host: host, Status: status, Reason: reason, CheckedAt: checkedAt, Optional: optional, RequestCount: requestCount}
}

func chinaUnavailable() chinaMacroSnapshot {
	return chinaMacroSnapshot{
		CountryCode: "CN", Status: "unavailable",
		Indicators: []chinaIndicator{}, SourceDecisions: []chinaSourceDecision{}, ReleaseEvents: []chinaReleaseEvent{},
		Unavailable: true,
	}
}

// ── handler ──────────────────────────────────────────────────────────────────

// handleChinaMacro serves GET /v1/world/china-macro: the merged China macro
// snapshot + official release calendar. Cached 30m fresh / 6h stale (these are
// daily/monthly series); on a required-source outage it serves last-good stale,
// else an honest unavailable payload.
func (s *Server) handleChinaMacro(w http.ResponseWriter, r *http.Request) {
	if preflight(w, r, "GET, OPTIONS") || methodNotGet(w, r) {
		return
	}
	s.cachedJSON(w, "china:macro:v1",
		"public, max-age=1800, s-maxage=1800, stale-while-revalidate=600",
		30*time.Minute, 6*time.Hour,
		func(ctx context.Context) (any, error) {
			// Bound the whole live aggregation so a slow/unreachable required source
			// (OECD et al., often laggy from the cluster) can't hold the request — and
			// the SPA's 20s fetch deadline — hostage for ~24s. On timeout the produce
			// fails and cachedJSON serves the honest-empty fallback below; the feed
			// warmer refills the cache in the background for the next caller.
			ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			return s.chinaMacro(ctx)
		},
		func(w http.ResponseWriter, _ error) { writeJSON(w, http.StatusOK, "", chinaUnavailable()) })
}

// oecdHeaders carries the Accept-Language the OECD CLI endpoint requires (it
// answers 500 to language-less clients even where curl succeeds).
var oecdHeaders = map[string]string{
	"Accept":          "text/csv, text/plain;q=0.9, */*;q=0.1",
	"Accept-Language": "en",
	"User-Agent":      browserUA,
}

func chinaReasonFor(err error) string {
	if err == nil {
		return "OK"
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
		return "TIMEOUT"
	}
	if m := reStatusCode.FindStringSubmatch(msg); m != nil {
		return "HTTP_" + m[1]
	}
	return "FETCH_FAILED"
}

func (s *Server) chinaMacro(ctx context.Context) (any, error) {
	now := time.Now().UTC()
	checkedAt := now.Format(time.RFC3339)
	var decisions []chinaSourceDecision

	// 1. OECD — required. Two sequential dataset requests, no retry: OECD asks
	// consumers to stay under 60 downloads/hour, so a failure preserves last-good
	// rather than replaying the flow.
	cpiCSV, err := s.getText(ctx, oecdCPIURL, oecdHeaders)
	reqCount := 1
	if err == nil {
		var cliCSV string
		cliCSV, err = s.getText(ctx, oecdCLIURL, oecdHeaders)
		reqCount = 2
		if err == nil {
			decisions = append(decisions, chinaDecision("OECD Data Explorer", "sdmx.oecd.org", "accepted", "OK", checkedAt, false, reqCount))
			return s.chinaMerge(ctx, now, checkedAt, decisions, []byte(cpiCSV), []byte(cliCSV))
		}
	}
	reason := chinaReasonFor(err)
	decisions = append(decisions, chinaDecision("OECD Data Explorer", "sdmx.oecd.org", "blocked", reason, checkedAt, false, reqCount))
	return nil, fmt.Errorf("OECD_REQUIRED_SOURCE_UNAVAILABLE:%s", reason)
}

func (s *Server) chinaMerge(ctx context.Context, now time.Time, checkedAt string, decisions []chinaSourceDecision, cpiCSV, cliCSV []byte) (any, error) {
	indicators := []chinaIndicator{
		parseOecdCsvIndicator(cpiCSV, indicatorDef{id: "cpi_yoy", label: "CPI (YoY)", category: "price", unit: "%", source: "OECD Data Explorer", sourceURL: oecdCPIURL, maxAgeDays: 120}, now),
		parseOecdCsvIndicator(cliCSV, indicatorDef{id: "activity_cli", label: "Composite Leading Indicator", category: "activity", unit: "index", source: "OECD Data Explorer", sourceURL: oecdCLIURL, maxAgeDays: 120}, now),
	}

	// 2. BIS policy rate — read from the seed cache key the worldmonitor BIS job
	// populates. Our fork ships no such job, so the key is empty and the indicator
	// is honestly not_configured; parseBisPolicy lights up the moment it is seeded.
	if b, ok := s.kvGet(ctx, bisPolicyCacheKey); ok {
		ind := parseBisPolicy(b, now)
		indicators = append(indicators, ind)
		decisions = append(decisions, chinaDecision("BIS seed cache", "hanzo-kv", statusFor(ind), reasonOrOK(ind), checkedAt, false, 1))
	} else {
		indicators = append(indicators, unavailableIndicator(bisPolicyDef, "not_configured", false))
		decisions = append(decisions, chinaDecision("BIS seed cache", "hanzo-kv", "blocked", "not_configured", checkedAt, false, 0))
	}

	// 3. FRED DEXCHUS — reuse the FRED_API_KEY env path the fred-data handler uses.
	if key := env("FRED_API_KEY"); key != "" {
		b, status, err := s.get(ctx, fredDEXCHUSURL+"&api_key="+key, map[string]string{"Accept": "application/json"})
		if err == nil && status >= 200 && status < 300 {
			ind := parseFredUsdCny(b, now)
			indicators = append(indicators, ind)
			decisions = append(decisions, chinaDecision("FRED DEXCHUS", "api.stlouisfed.org", statusFor(ind), reasonOrOK(ind), checkedAt, false, 1))
		} else {
			reason := chinaReasonFor(orStatusErr(err, status))
			indicators = append(indicators, unavailableIndicator(fredUsdCnyDef, reason, false))
			decisions = append(decisions, chinaDecision("FRED DEXCHUS", "api.stlouisfed.org", "blocked", reason, checkedAt, false, 1))
		}
	} else {
		indicators = append(indicators, unavailableIndicator(fredUsdCnyDef, "not_configured", false))
		decisions = append(decisions, chinaDecision("FRED DEXCHUS", "api.stlouisfed.org", "blocked", "not_configured", checkedAt, false, 0))
	}

	// 4. HKMA CNY/HKD context — optional.
	if b, status, err := s.get(ctx, hkmaCNYURL, map[string]string{"Accept": "application/json", "User-Agent": browserUA}); err == nil && status >= 200 && status < 300 {
		ind := parseHkmaCnyContext(b, now)
		indicators = append(indicators, ind)
		decisions = append(decisions, chinaDecision("HKMA CNY context", "api.hkma.gov.hk", statusFor(ind), reasonOrOK(ind), checkedAt, true, 1))
	} else {
		reason := chinaReasonFor(orStatusErr(err, status))
		indicators = append(indicators, unavailableIndicator(hkmaCnyDef, reason, true))
		decisions = append(decisions, chinaDecision("HKMA CNY context", "api.hkma.gov.hk", "blocked", reason, checkedAt, true, 1))
	}

	snapshot := buildChinaMacroSnapshot(indicators, decisions, checkedAt)

	// Calendar is required for the merged product (mirrors get-china-macro-
	// snapshot.ts, which returns unavailable when either indicators or events are
	// empty). On outage, return an error so cachedJSON serves last-good stale.
	events, calDecisions, calErr := s.chinaCalendar(ctx, now, checkedAt)
	snapshot.SourceDecisions = append(snapshot.SourceDecisions, calDecisions...)
	if calErr != nil || len(events) == 0 {
		return nil, fmt.Errorf("CHINA_CALENDAR_UNAVAILABLE")
	}
	snapshot.ReleaseEvents = events
	return snapshot, nil
}

func (s *Server) chinaCalendar(ctx context.Context, now time.Time, checkedAt string) ([]chinaReleaseEvent, []chinaSourceDecision, error) {
	year := now.Year()
	var decisions []chinaSourceDecision
	htmlHeaders := map[string]string{"Accept": "text/html,application/xhtml+xml", "User-Agent": browserUA}

	indexHTML, err := s.getText(ctx, nbsCalendarIndexURL, htmlHeaders)
	nbsReq := 1
	if err != nil {
		decisions = append(decisions, chinaDecision("NBS release calendar", "www.stats.gov.cn", "blocked", chinaReasonFor(err), checkedAt, false, nbsReq))
		return nil, decisions, err
	}
	calURL, err := currentCalendarLink(indexHTML, year)
	if err != nil {
		decisions = append(decisions, chinaDecision("NBS release calendar", "www.stats.gov.cn", "blocked", "UNTRUSTED_NBS_CALENDAR_URL", checkedAt, false, nbsReq))
		return nil, decisions, err
	}
	calHTML := indexHTML
	if calURL != nbsCalendarIndexURL {
		nbsReq = 2
		calHTML, err = s.getText(ctx, calURL, htmlHeaders)
		if err != nil {
			decisions = append(decisions, chinaDecision("NBS release calendar", "www.stats.gov.cn", "blocked", chinaReasonFor(err), checkedAt, false, nbsReq))
			return nil, decisions, err
		}
	}
	nbsEvents := parseNbsReleaseCalendar([]byte(calHTML), year, calURL)
	if len(nbsEvents) == 0 {
		decisions = append(decisions, chinaDecision("NBS release calendar", "www.stats.gov.cn", "blocked", "NO_NBS_EVENTS", checkedAt, false, nbsReq))
		return nil, decisions, fmt.Errorf("NBS_REQUIRED_SOURCE_UNAVAILABLE:NO_NBS_EVENTS")
	}
	decisions = append(decisions, chinaDecision("NBS release calendar", "www.stats.gov.cn", "accepted", "OK", checkedAt, false, nbsReq))

	lpr, err := buildLprCandidates(year)
	if err != nil {
		decisions = append(decisions, chinaDecision("PBoC/ChinaMoney LPR verification", "www.chinamoney.com.cn", "blocked", "CHINA_HOLIDAY_CALENDAR_UNAVAILABLE", checkedAt, false, 0))
		return nil, decisions, err
	}
	if notices, err := s.chinaMoneyNotices(ctx); err == nil {
		lpr = mergeVerifiedLprDates(lpr, parseChinaMoneyLprNotices(notices))
		decisions = append(decisions, chinaDecision("PBoC/ChinaMoney LPR verification", "www.chinamoney.com.cn", "accepted", "OK", checkedAt, false, 1))
	} else {
		decisions = append(decisions, chinaDecision("PBoC/ChinaMoney LPR verification", "www.chinamoney.com.cn", "blocked", chinaReasonFor(err), checkedAt, false, 1))
	}

	events := append(nbsEvents, lpr...)
	sortReleaseEvents(events)
	return events, decisions, nil
}

func (s *Server) chinaMoneyNotices(ctx context.Context) ([]byte, error) {
	body := []byte(url.Values{"channelId": {chinaMoneyLPRChannelID}, "pageSize": {"24"}, "pageNo": {"1"}}.Encode())
	b, status, err := s.do(ctx, http.MethodPost, chinaMoneyLPRNoticeAPI, map[string]string{
		"Accept":       "application/json",
		"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
		"User-Agent":   browserUA,
	}, body)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, httpErr(status)
	}
	return b, nil
}

// kvGet reads a raw value from the shared hot cache, reporting absence (or a
// disabled cache) as ok=false so callers degrade to not_configured.
func (s *Server) kvGet(ctx context.Context, key string) ([]byte, bool) {
	if s.kv == nil {
		return nil, false
	}
	b, ok := s.kv.GetBytes(ctx, key)
	return b, ok && len(b) > 0
}

func statusFor(ind chinaIndicator) string {
	if ind.Value == nil {
		return "blocked"
	}
	return "accepted"
}

func reasonOrOK(ind chinaIndicator) string {
	if ind.UnavailableReason != "" {
		return ind.UnavailableReason
	}
	return "OK"
}

func orStatusErr(err error, status int) error {
	if err != nil {
		return err
	}
	return httpErr(status)
}
