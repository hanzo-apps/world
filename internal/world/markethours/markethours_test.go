package markethours

import (
	"testing"
	"time"
)

// et builds a time at the given ET wall-clock.
func et(t *testing.T, y int, m time.Month, d, hh, mm int) time.Time {
	t.Helper()
	return time.Date(y, m, d, hh, mm, 0, 0, nyLoc)
}

func TestCurrentSession(t *testing.T) {
	// Wednesday 2026-01-07 is an ordinary trading day.
	cases := []struct {
		hh, mm int
		want   Session
	}{
		{3, 30, SessionClosed},  // pre-dawn
		{4, 0, SessionPre},      // pre-market opens
		{9, 29, SessionPre},     // one minute before the bell
		{9, 30, SessionRegular}, // opening bell
		{12, 0, SessionRegular}, // midday
		{15, 59, SessionRegular},
		{16, 0, SessionPost}, // regular close → after-hours
		{19, 59, SessionPost},
		{20, 0, SessionClosed}, // after-hours ends
		{23, 0, SessionClosed},
	}
	for _, c := range cases {
		got := CurrentSession(et(t, 2026, time.January, 7, c.hh, c.mm))
		if got != c.want {
			t.Errorf("2026-01-07 %02d:%02d ET = %q, want %q", c.hh, c.mm, got, c.want)
		}
	}
}

func TestWeekend(t *testing.T) {
	// 2026-01-10 Sat, 2026-01-11 Sun — always weekend regardless of clock.
	if s := CurrentSession(et(t, 2026, time.January, 10, 12, 0)); s != SessionWeekend {
		t.Errorf("Saturday = %q, want weekend", s)
	}
	if s := CurrentSession(et(t, 2026, time.January, 11, 12, 0)); s != SessionWeekend {
		t.Errorf("Sunday = %q, want weekend", s)
	}
	if IsTradingDay(et(t, 2026, time.January, 10, 12, 0)) {
		t.Error("Saturday must not be a trading day")
	}
}

func TestGoodFriday2026(t *testing.T) {
	// Easter 2026 is April 5; Good Friday is April 3 (a weekday holiday).
	gf := et(t, 2026, time.April, 3, 11, 0)
	if IsTradingDay(gf) {
		t.Error("Good Friday 2026-04-03 must not be a trading day")
	}
	if s := CurrentSession(gf); s != SessionClosed {
		t.Errorf("Good Friday during regular hours = %q, want closed", s)
	}
	// Sanity: the surrounding Thursday IS a trading day.
	if !IsTradingDay(et(t, 2026, time.April, 2, 11, 0)) {
		t.Error("2026-04-02 (Thu) should be a trading day")
	}
}

func TestJuly42026ObservedFriday(t *testing.T) {
	// July 4, 2026 is a Saturday → observed Friday July 3.
	if !isHolidayDay(2026, time.July, 3) {
		t.Error("Independence Day 2026 must be observed on Friday 2026-07-03")
	}
	if IsTradingDay(et(t, 2026, time.July, 3, 11, 0)) {
		t.Error("2026-07-03 (observed July 4) must not be a trading day")
	}
	// The actual July 4 is a Saturday (weekend), not itself a holiday entry.
	if s := CurrentSession(et(t, 2026, time.July, 4, 11, 0)); s != SessionWeekend {
		t.Errorf("2026-07-04 (Sat) = %q, want weekend", s)
	}
}

func TestNewYearObservance(t *testing.T) {
	// Jan 1, 2028 is a Saturday → observed the prior Friday, Dec 31, 2027.
	if !isHolidayDay(2027, time.December, 31) {
		t.Error("New Year's 2028 (Sat) must be observed Fri 2027-12-31")
	}
	// Jan 1, 2023 was a Sunday → observed Monday Jan 2, 2023.
	if !isHolidayDay(2023, time.January, 2) {
		t.Error("New Year's 2023 (Sun) must be observed Mon 2023-01-02")
	}
}

func TestFullHolidaySet2026(t *testing.T) {
	// Every 2026 NYSE full holiday, observed date.
	want := []civil{
		{2026, time.January, 1},   // New Year (Thu)
		{2026, time.January, 19},  // MLK (3rd Mon)
		{2026, time.February, 16}, // Presidents (3rd Mon)
		{2026, time.April, 3},     // Good Friday
		{2026, time.May, 25},      // Memorial (last Mon)
		{2026, time.June, 19},     // Juneteenth (Fri)
		{2026, time.July, 3},      // Independence observed (Sat→Fri)
		{2026, time.September, 7}, // Labor (1st Mon)
		{2026, time.November, 26}, // Thanksgiving (4th Thu)
		{2026, time.December, 25}, // Christmas (Fri)
	}
	for _, c := range want {
		if !isHolidayDay(c.y, c.m, c.d) {
			t.Errorf("expected 2026 holiday missing: %v", c)
		}
	}
}

func TestEasterKnownYears(t *testing.T) {
	cases := map[int]civil{
		2024: {2024, time.March, 31},
		2025: {2025, time.April, 20},
		2026: {2026, time.April, 5},
		2027: {2027, time.March, 28},
	}
	for y, want := range cases {
		if got := easterSunday(y); got != want {
			t.Errorf("easterSunday(%d) = %v, want %v", y, got, want)
		}
	}
}

// isHolidayDay checks a bare calendar date via the ET path.
func isHolidayDay(y int, m time.Month, d int) bool {
	return isHoliday(time.Date(y, m, d, 12, 0, 0, 0, nyLoc))
}
