package world

import "testing"

func TestParseWarnCount(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"244", 244},
		{"1,250", 1250},
		{" 90 ", 90},
		{"", 0},
		{"n/a", 0},
		{"-5", 0},
	}
	for _, c := range cases {
		if got := parseWarnCount(c.in); got != c.want {
			t.Errorf("parseWarnCount(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestWarnDate(t *testing.T) {
	cases := []struct{ in, want string }{
		{"2026-06-23T00:00:00.000", "2026-06-23"},
		{"2026-06-23", "2026-06-23"},
		{"", ""},
		{"  2026-06-23T12:00:00 ", "2026-06-23"},
	}
	for _, c := range cases {
		if got := warnDate(c.in); got != c.want {
			t.Errorf("warnDate(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseWarnNoticesMalformed(t *testing.T) {
	if got := parseWarnNotices([]byte("not json {{{")); got != nil {
		t.Errorf("malformed: want nil, got %v", got)
	}
	if got := parseWarnNotices(nil); got != nil {
		t.Errorf("nil: want nil, got %v", got)
	}
	if got := parseWarnNotices([]byte("[]")); len(got) != 0 {
		t.Errorf("empty array: want 0, got %d", len(got))
	}
}

func TestParseWarnNoticesWellFormed(t *testing.T) {
	body := []byte(`[
	  {"notice_date":"2026-06-23T00:00:00.000","job_site_name":"JPMorgan Chase & Co.","city_name":"Plano","layoff_date":"2026-08-21T00:00:00.000","total_layoff_number":"244"},
	  {"notice_date":"2026-06-16T00:00:00.000","job_site_name":" KUEHNE + NAGEL ","city_name":"Lewisville","layoff_date":"2026-06-29T00:00:00.000","total_layoff_number":""}
	]`)
	got := parseWarnNotices(body)
	if len(got) != 2 {
		t.Fatalf("want 2 notices, got %d", len(got))
	}
	if got[0].Employer != "JPMorgan Chase & Co." || got[0].Workers != 244 {
		t.Errorf("notice[0] = %+v", got[0])
	}
	if got[0].NoticeDate != "2026-06-23" || got[0].LayoffDate != "2026-08-21" {
		t.Errorf("notice[0] dates = %q / %q", got[0].NoticeDate, got[0].LayoffDate)
	}
	if got[1].Employer != "KUEHNE + NAGEL" { // trimmed
		t.Errorf("notice[1] employer = %q", got[1].Employer)
	}
	if got[1].Workers != 0 { // blank count -> 0, no panic
		t.Errorf("notice[1] workers = %d, want 0", got[1].Workers)
	}
}
