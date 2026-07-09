// Package markethours answers "what is the US equity market doing right now"
// for America/New_York, purely from a time.Time. It is self-contained: NYSE
// full-day holidays are COMPUTED (no hand-maintained year tables), and the tz
// database is embedded so it works on a bare container.
//
// Sessions (regular NYSE clock, ET):
//
//	pre      04:00–09:30   regular  09:30–16:00   post  16:00–20:00
//	closed   overnight or a weekday holiday        weekend  Sat/Sun
//
// Early-close half-days are intentionally not modeled — only full-day holidays.
package markethours

import (
	"time"

	_ "time/tzdata" // embed the tz database so America/New_York always resolves
)

// Session is the current market phase. It is a string so it drops straight into
// a JSON response map.
type Session string

const (
	SessionPre     Session = "pre"
	SessionRegular Session = "regular"
	SessionPost    Session = "post"
	SessionClosed  Session = "closed"  // overnight or a weekday holiday
	SessionWeekend Session = "weekend" // Saturday or Sunday
)

// String makes Session satisfy fmt.Stringer.
func (s Session) String() string { return string(s) }

// nyLoc is America/New_York, resolved once. With embedded tzdata this never
// fails; if it somehow did we degrade to UTC (wrong sessions) rather than crash.
var nyLoc = loadNY()

func loadNY() *time.Location {
	if loc, err := time.LoadLocation("America/New_York"); err == nil {
		return loc
	}
	return time.UTC
}

// Regular NYSE session minutes-from-midnight (ET).
const (
	preOpen   = 4 * 60    // 04:00
	regOpen   = 9*60 + 30 // 09:30
	regClose  = 16 * 60   // 16:00
	postClose = 20 * 60   // 20:00
)

// CurrentSession reports the market phase at t (converted to ET).
func CurrentSession(t time.Time) Session {
	et := t.In(nyLoc)
	switch et.Weekday() {
	case time.Saturday, time.Sunday:
		return SessionWeekend
	}
	if isHoliday(et) {
		return SessionClosed
	}
	mins := et.Hour()*60 + et.Minute()
	switch {
	case mins >= preOpen && mins < regOpen:
		return SessionPre
	case mins >= regOpen && mins < regClose:
		return SessionRegular
	case mins >= regClose && mins < postClose:
		return SessionPost
	default:
		return SessionClosed
	}
}

// IsTradingDay reports whether the calendar day of t (in ET) is a normal NYSE
// trading day — a weekday that is not a full-day holiday.
func IsTradingDay(t time.Time) bool {
	et := t.In(nyLoc)
	switch et.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	}
	return !isHoliday(et)
}

// ── holiday computation ──────────────────────────────────────────────────────

type civil struct {
	y int
	m time.Month
	d int
}

func civilOf(t time.Time) civil { return civil{t.Year(), t.Month(), t.Day()} }

// isHoliday reports whether et's calendar day is an NYSE full-day holiday. It
// unions the target year and the next year so a New Year's Day that falls on a
// Saturday — observed on the PRIOR Friday, Dec 31 — is caught when checking late
// December.
func isHoliday(et time.Time) bool {
	c := civilOf(et)
	if nyseHolidays(c.y)[c] {
		return true
	}
	return nyseHolidays(c.y + 1)[c]
}

// nyseHolidays returns the set of observed full-day NYSE holidays for a year.
func nyseHolidays(year int) map[civil]bool {
	h := map[civil]bool{}
	set := func(c civil) { h[c] = true }
	// Fixed-date holidays shift for weekends (Sat→prior Fri, Sun→next Mon).
	set(observed(civil{year, time.January, 1}))   // New Year's Day
	set(observed(civil{year, time.June, 19}))     // Juneteenth
	set(observed(civil{year, time.July, 4}))      // Independence Day
	set(observed(civil{year, time.December, 25})) // Christmas
	// Floating weekday holidays never need an observance shift.
	set(nthWeekday(year, time.January, time.Monday, 3))    // MLK Day
	set(nthWeekday(year, time.February, time.Monday, 3))   // Presidents' Day
	set(goodFriday(year))                                  // Good Friday
	set(lastWeekday(year, time.May, time.Monday))          // Memorial Day
	set(nthWeekday(year, time.September, time.Monday, 1))  // Labor Day
	set(nthWeekday(year, time.November, time.Thursday, 4)) // Thanksgiving
	return h
}

// observed shifts a fixed-date holiday off a weekend per NYSE rules.
func observed(c civil) civil {
	t := dateIn(c)
	switch t.Weekday() {
	case time.Saturday:
		return civilOf(t.AddDate(0, 0, -1)) // observed the prior Friday
	case time.Sunday:
		return civilOf(t.AddDate(0, 0, 1)) // observed the next Monday
	}
	return c
}

// nthWeekday returns the date of the n-th given weekday of a month (n≥1).
func nthWeekday(year int, month time.Month, wd time.Weekday, n int) civil {
	first := dateIn(civil{year, month, 1})
	offset := (int(wd) - int(first.Weekday()) + 7) % 7
	return civil{year, month, 1 + offset + (n-1)*7}
}

// lastWeekday returns the date of the last given weekday of a month.
func lastWeekday(year int, month time.Month, wd time.Weekday) civil {
	// Day 0 of the next month == last day of this month.
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, nyLoc)
	back := (int(last.Weekday()) - int(wd) + 7) % 7
	return civilOf(last.AddDate(0, 0, -back))
}

// goodFriday is two days before Easter Sunday (Gregorian computus).
func goodFriday(year int) civil {
	e := easterSunday(year)
	return civilOf(dateIn(e).AddDate(0, 0, -2))
}

// easterSunday computes Western (Gregorian) Easter via the Anonymous Gregorian
// algorithm (Meeus/Jones/Butcher).
func easterSunday(year int) civil {
	a := year % 19
	b := year / 100
	c := year % 100
	d := b / 4
	e := b % 4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	hh := (19*a + b - d - g + 15) % 30
	i := c / 4
	k := c % 4
	l := (32 + 2*e + 2*i - hh - k) % 7
	mm := (a + 11*hh + 22*l) / 451
	month := (hh + l - 7*mm + 114) / 31
	day := ((hh + l - 7*mm + 114) % 31) + 1
	return civil{year, time.Month(month), day}
}

func dateIn(c civil) time.Time { return time.Date(c.y, c.m, c.d, 0, 0, 0, 0, nyLoc) }
