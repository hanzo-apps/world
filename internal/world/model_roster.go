package world

// countryRoster is the authoritative ISO-3166-1 alpha-2 country/territory list
// the world model seeds as entities — the "planet-scale" baseline. Every entry
// exists in /v1/world/model/state from cold start; live feeds (GDELT news,
// ACLED conflict) then modulate the strategically-significant subset that
// carries curated keyword queries (see countryKeywords). Baseline instability
// comes from baselineRisk (reused, no duplication) or defaultBaseline.
//
// This is standard reference data in ONE place: the roster grows by adding a
// row here; the live set grows by adding keywords to countryKeywords.
var countryRoster = []struct{ code, name string }{
	// Africa
	{"DZ", "Algeria"}, {"AO", "Angola"}, {"BJ", "Benin"}, {"BW", "Botswana"},
	{"BF", "Burkina Faso"}, {"BI", "Burundi"}, {"CM", "Cameroon"}, {"CV", "Cape Verde"},
	{"CF", "Central African Republic"}, {"TD", "Chad"}, {"KM", "Comoros"},
	{"CG", "Congo"}, {"CD", "DR Congo"}, {"DJ", "Djibouti"}, {"EG", "Egypt"},
	{"GQ", "Equatorial Guinea"}, {"ER", "Eritrea"}, {"SZ", "Eswatini"}, {"ET", "Ethiopia"},
	{"GA", "Gabon"}, {"GM", "Gambia"}, {"GH", "Ghana"}, {"GN", "Guinea"},
	{"GW", "Guinea-Bissau"}, {"CI", "Ivory Coast"}, {"KE", "Kenya"}, {"LS", "Lesotho"},
	{"LR", "Liberia"}, {"LY", "Libya"}, {"MG", "Madagascar"}, {"MW", "Malawi"},
	{"ML", "Mali"}, {"MR", "Mauritania"}, {"MU", "Mauritius"}, {"MA", "Morocco"},
	{"MZ", "Mozambique"}, {"NA", "Namibia"}, {"NE", "Niger"}, {"NG", "Nigeria"},
	{"RW", "Rwanda"}, {"ST", "Sao Tome and Principe"}, {"SN", "Senegal"},
	{"SC", "Seychelles"}, {"SL", "Sierra Leone"}, {"SO", "Somalia"}, {"ZA", "South Africa"},
	{"SS", "South Sudan"}, {"SD", "Sudan"}, {"TZ", "Tanzania"}, {"TG", "Togo"},
	{"TN", "Tunisia"}, {"UG", "Uganda"}, {"ZM", "Zambia"}, {"ZW", "Zimbabwe"},
	// Americas
	{"AG", "Antigua and Barbuda"}, {"AR", "Argentina"}, {"BS", "Bahamas"},
	{"BB", "Barbados"}, {"BZ", "Belize"}, {"BO", "Bolivia"}, {"BR", "Brazil"},
	{"CA", "Canada"}, {"CL", "Chile"}, {"CO", "Colombia"}, {"CR", "Costa Rica"},
	{"CU", "Cuba"}, {"DM", "Dominica"}, {"DO", "Dominican Republic"}, {"EC", "Ecuador"},
	{"SV", "El Salvador"}, {"GD", "Grenada"}, {"GT", "Guatemala"}, {"GY", "Guyana"},
	{"HT", "Haiti"}, {"HN", "Honduras"}, {"JM", "Jamaica"}, {"MX", "Mexico"},
	{"NI", "Nicaragua"}, {"PA", "Panama"}, {"PY", "Paraguay"}, {"PE", "Peru"},
	{"KN", "Saint Kitts and Nevis"}, {"LC", "Saint Lucia"},
	{"VC", "Saint Vincent and the Grenadines"}, {"SR", "Suriname"},
	{"TT", "Trinidad and Tobago"}, {"US", "United States"}, {"UY", "Uruguay"},
	{"VE", "Venezuela"},
	// Asia
	{"AF", "Afghanistan"}, {"AM", "Armenia"}, {"AZ", "Azerbaijan"}, {"BH", "Bahrain"},
	{"BD", "Bangladesh"}, {"BT", "Bhutan"}, {"BN", "Brunei"}, {"KH", "Cambodia"},
	{"CN", "China"}, {"GE", "Georgia"}, {"IN", "India"}, {"ID", "Indonesia"},
	{"IR", "Iran"}, {"IQ", "Iraq"}, {"IL", "Israel"}, {"JP", "Japan"},
	{"JO", "Jordan"}, {"KZ", "Kazakhstan"}, {"KW", "Kuwait"}, {"KG", "Kyrgyzstan"},
	{"LA", "Laos"}, {"LB", "Lebanon"}, {"MY", "Malaysia"}, {"MV", "Maldives"},
	{"MN", "Mongolia"}, {"MM", "Myanmar"}, {"NP", "Nepal"}, {"KP", "North Korea"},
	{"OM", "Oman"}, {"PK", "Pakistan"}, {"PS", "Palestine"}, {"PH", "Philippines"},
	{"QA", "Qatar"}, {"SA", "Saudi Arabia"}, {"SG", "Singapore"}, {"KR", "South Korea"},
	{"LK", "Sri Lanka"}, {"SY", "Syria"}, {"TW", "Taiwan"}, {"TJ", "Tajikistan"},
	{"TH", "Thailand"}, {"TL", "Timor-Leste"}, {"TR", "Turkey"}, {"TM", "Turkmenistan"},
	{"AE", "United Arab Emirates"}, {"UZ", "Uzbekistan"}, {"VN", "Vietnam"}, {"YE", "Yemen"},
	// Europe
	{"AL", "Albania"}, {"AD", "Andorra"}, {"AT", "Austria"}, {"BY", "Belarus"},
	{"BE", "Belgium"}, {"BA", "Bosnia and Herzegovina"}, {"BG", "Bulgaria"},
	{"HR", "Croatia"}, {"CY", "Cyprus"}, {"CZ", "Czechia"}, {"DK", "Denmark"},
	{"EE", "Estonia"}, {"FI", "Finland"}, {"FR", "France"}, {"DE", "Germany"},
	{"GR", "Greece"}, {"HU", "Hungary"}, {"IS", "Iceland"}, {"IE", "Ireland"},
	{"IT", "Italy"}, {"XK", "Kosovo"}, {"LV", "Latvia"}, {"LI", "Liechtenstein"},
	{"LT", "Lithuania"}, {"LU", "Luxembourg"}, {"MT", "Malta"}, {"MD", "Moldova"},
	{"MC", "Monaco"}, {"ME", "Montenegro"}, {"NL", "Netherlands"},
	{"MK", "North Macedonia"}, {"NO", "Norway"}, {"PL", "Poland"}, {"PT", "Portugal"},
	{"RO", "Romania"}, {"RU", "Russia"}, {"SM", "San Marino"}, {"RS", "Serbia"},
	{"SK", "Slovakia"}, {"SI", "Slovenia"}, {"ES", "Spain"}, {"SE", "Sweden"},
	{"CH", "Switzerland"}, {"UA", "Ukraine"}, {"GB", "United Kingdom"}, {"VA", "Vatican City"},
	// Oceania
	{"AU", "Australia"}, {"FJ", "Fiji"}, {"KI", "Kiribati"}, {"MH", "Marshall Islands"},
	{"FM", "Micronesia"}, {"NR", "Nauru"}, {"NZ", "New Zealand"}, {"PW", "Palau"},
	{"PG", "Papua New Guinea"}, {"WS", "Samoa"}, {"SB", "Solomon Islands"},
	{"TO", "Tonga"}, {"TV", "Tuvalu"}, {"VU", "Vanuatu"},
}

// defaultBaseline is the seed instability for a country with no hotspot rating
// in baselineRisk — low but non-zero, so calm states read "low", not empty.
const defaultBaseline = 8.0

// rosterBaseline returns the seed baseline for an ISO code: the curated hotspot
// value when known, else the default.
func rosterBaseline(code string) float64 {
	if b, ok := baselineRisk[code]; ok {
		return b
	}
	return defaultBaseline
}
