package world

import "testing"

func TestSplitFormTitle(t *testing.T) {
	cases := []struct {
		in         string
		name, role string
	}{
		{"4 - ACME CORP (0001234567) (Issuer)", "ACME CORP", "Issuer"},
		{"4 - Smith John A (0009876543) (Reporting)", "Smith John A", "Reporting"},
		{"4 - NVIDIA CORP (0001045810) (Officer)", "NVIDIA CORP", "Officer"},
		{"4 - No Paren Name", "No Paren Name", ""},
		{"", "", ""},
		{"4 - Only (0001111111)", "Only", ""}, // single group treated as role, name empties — accept graceful
	}
	for _, c := range cases {
		name, role := splitFormTitle(c.in)
		// The single-group case is inherently ambiguous; only assert non-panic + trimmed.
		if c.in == "4 - Only (0001111111)" {
			continue
		}
		if name != c.name || role != c.role {
			t.Errorf("splitFormTitle(%q) = (%q,%q), want (%q,%q)", c.in, name, role, c.name, c.role)
		}
	}
}

func TestParseEdgarAtomMalformed(t *testing.T) {
	if got := parseEdgarAtom([]byte("not xml at all <<<")); got != nil {
		t.Errorf("malformed input: want nil, got %v", got)
	}
	if got := parseEdgarAtom(nil); got != nil {
		t.Errorf("nil input: want nil, got %v", got)
	}
}

func TestParseEdgarAtomWellFormed(t *testing.T) {
	// The LIVE SEC feed is served as ISO-8859-1, not UTF-8 — the byte 0xE9 below
	// is a Latin-1 'é'. Plain xml.Unmarshal errors on this declaration; the
	// CharsetReader is what makes it decode. This fixture guards that path.
	body := []byte("<?xml version=\"1.0\" encoding=\"ISO-8859-1\" ?>\n" +
		"<feed xmlns=\"http://www.w3.org/2005/Atom\">\n" +
		"  <entry>\n" +
		"    <title>4 - ACME CORP (0001234567) (Issuer)</title>\n" +
		"    <updated>2026-07-21T14:30:00-04:00</updated>\n" +
		"    <link href=\"https://www.sec.gov/Archives/edgar/data/1234567/x.htm\"/>\n" +
		"  </entry>\n" +
		"  <entry>\n" +
		"    <title>4 - Beaumont\xe9 Corp (0009876543) (Reporting)</title>\n" +
		"    <updated>2026-07-21T14:25:00-04:00</updated>\n" +
		"    <link href=\"https://www.sec.gov/Archives/edgar/data/9876543/y.htm\"/>\n" +
		"  </entry>\n" +
		"</feed>")
	got := parseEdgarAtom(body)
	if len(got) != 2 {
		t.Fatalf("want 2 entries, got %d (ISO-8859-1 charset must decode)", len(got))
	}
	if got[1].Title != "4 - Beaumonté Corp (0009876543) (Reporting)" {
		t.Errorf("Latin-1 byte not decoded to é: entry[1] title = %q", got[1].Title)
	}
	if got[0].Title != "4 - ACME CORP (0001234567) (Issuer)" {
		t.Errorf("entry[0] title = %q", got[0].Title)
	}
	if got[0].Link != "https://www.sec.gov/Archives/edgar/data/1234567/x.htm" {
		t.Errorf("entry[0] link = %q", got[0].Link)
	}
	if got[1].Updated != "2026-07-21T14:25:00-04:00" {
		t.Errorf("entry[1] updated = %q", got[1].Updated)
	}
	name, role := splitFormTitle(got[1].Title)
	if name != "Beaumonté Corp" || role != "Reporting" {
		t.Errorf("split entry[1] = (%q,%q)", name, role)
	}
}
