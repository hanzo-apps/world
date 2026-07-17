package world

import (
	"context"
	"time"
)

// Platform user metrics — REAL signups / active users from Hanzo IAM (Casdoor).
//
// Source: IAM GET /v1/iam/global-users (every user across every org; global-admin
// only). We read it with the signed-in admin's OWN bearer (never a shared key),
// fold it into NON-sensitive aggregates (counts + a daily-signup series), and return
// ONLY those aggregates — no user record, email, name or other PII ever leaves this
// function. Honest-empty (error) when the caller is not a global admin upstream or
// IAM is unreachable, so the overview simply omits the user tiles rather than guess.

type userMetrics struct {
	Total        int     `json:"total"`
	Signups24h   int     `json:"signups24h"`
	Signups7d    int     `json:"signups7d"`
	ActiveNow    int     `json:"activeNow"`
	SignupSeries []int64 `json:"signupSeries"` // new users/day, last 14 days, chronological
}

// iamUser is the minimal, non-PII slice of Casdoor's object.User we read.
type iamUser struct {
	CreatedTime string `json:"createdTime"`
	IsOnline    bool   `json:"isOnline"`
	IsDeleted   bool   `json:"isDeleted"`
}

const userSignupDays = 14

// fetchUserMetrics reads the platform-wide user list from IAM with auth and folds it
// into non-sensitive aggregates. Requires a global-admin bearer upstream; any error
// (non-admin, unreachable) leaves the caller to omit the tiles honestly — never a
// fabricated count.
func (s *Server) fetchUserMetrics(ctx context.Context, auth map[string]string) (*userMetrics, error) {
	if auth == nil {
		return nil, errNoServiceToken
	}
	var users []iamUser
	if err := s.getJSON(ctx, iamIssuer()+"/v1/iam/global-users", auth, &users); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	m := &userMetrics{SignupSeries: make([]int64, userSignupDays)}
	for _, u := range users {
		if u.IsDeleted {
			continue
		}
		m.Total++
		if u.IsOnline {
			m.ActiveNow++
		}
		t, ok := parseUserTime(u.CreatedTime)
		if !ok {
			continue
		}
		if age := now.Sub(t); age >= 0 {
			if age <= 24*time.Hour {
				m.Signups24h++
			}
			if age <= 7*24*time.Hour {
				m.Signups7d++
			}
			if d := int(age.Hours() / 24); d < userSignupDays {
				m.SignupSeries[userSignupDays-1-d]++ // chronological: oldest bucket first, today last
			}
		}
	}
	return m, nil
}

// parseUserTime parses Casdoor's createdTime (RFC3339, with a couple of legacy
// fallbacks). ok=false when unparseable so a bad row is skipped, never guessed.
func parseUserTime(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}
