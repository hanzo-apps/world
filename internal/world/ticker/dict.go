package ticker

import "sort"

type nameEntry struct {
	name   string // lowercase; matched word-bounded against a lowercased headline
	ticker string
}

// nameEntries is the curated company/crypto name → ticker table, sorted
// longest-name-first at init so multi-word names ("morgan stanley") win over any
// shorter contained name.
//
// CURATION RULE: list a name only when it is DISTINCTIVE enough that its
// appearance in a news headline almost always means the security. Deliberately
// OMITTED (they require a "$" cashtag): apple, amazon, meta, oracle, visa,
// intel, target, ford, gap, block, zoom, shell, bp, avalanche, polygon, unity,
// workday — each is a common English word or otherwise ambiguous, and bare
// English-word symbols (GM, IT, V, ALL) are never keys either.
var rawNames = map[string]string{
	// Mega-cap tech / software / internet
	"microsoft": "MSFT", "google": "GOOGL", "facebook": "META", "nvidia": "NVDA",
	"tesla": "TSLA", "netflix": "NFLX", "adobe": "ADBE", "salesforce": "CRM",
	"qualcomm": "QCOM", "broadcom": "AVGO", "micron": "MU", "accenture": "ACN",
	"servicenow": "NOW", "snowflake": "SNOW", "palantir": "PLTR", "datadog": "DDOG",
	"cloudflare": "NET", "crowdstrike": "CRWD", "fortinet": "FTNT", "twilio": "TWLO",
	"atlassian": "TEAM", "palo alto networks": "PANW", "roblox": "RBLX", "zscaler": "ZS",
	"mongodb": "MDB", "okta": "OKTA", "dropbox": "DBX", "docusign": "DOCU",
	"pinterest": "PINS", "snapchat": "SNAP", "spotify": "SPOT", "shopify": "SHOP",
	"paypal": "PYPL", "coinbase": "COIN", "robinhood": "HOOD", "sofi": "SOFI",
	"uber": "UBER", "lyft": "LYFT", "airbnb": "ABNB", "doordash": "DASH",
	"instacart": "CART", "reddit": "RDDT",

	// Semiconductors / hardware
	"amd": "AMD", "arm holdings": "ARM", "tsmc": "TSM", "taiwan semiconductor": "TSM",
	"asml": "ASML", "applied materials": "AMAT", "lam research": "LRCX",
	"texas instruments": "TXN", "analog devices": "ADI", "marvell": "MRVL",
	"cisco": "CSCO", "ibm": "IBM", "dell": "DELL", "hewlett packard": "HPQ",
	"seagate": "STX", "western digital": "WDC", "corning": "GLW",

	// Autos / industrials / defense
	"general motors": "GM", "rivian": "RIVN", "lucid motors": "LCID", "toyota": "TM",
	"honda": "HMC", "volkswagen": "VWAGY", "ferrari": "RACE", "stellantis": "STLA",
	"boeing": "BA", "airbus": "EADSY", "lockheed martin": "LMT", "raytheon": "RTX",
	"northrop grumman": "NOC", "general dynamics": "GD", "general electric": "GE",
	"ge aerospace": "GE", "caterpillar": "CAT", "john deere": "DE", "deere": "DE",
	"honeywell": "HON", "emerson": "EMR",

	// Finance
	"jpmorgan": "JPM", "jp morgan": "JPM", "goldman sachs": "GS", "morgan stanley": "MS",
	"wells fargo": "WFC", "bank of america": "BAC", "citigroup": "C", "citibank": "C",
	"blackrock": "BLK", "blackstone": "BX", "charles schwab": "SCHW", "mastercard": "MA",
	"american express": "AXP", "berkshire hathaway": "BRK.B", "capital one": "COF",
	"us bancorp": "USB",

	// Media / telecom
	"disney": "DIS", "comcast": "CMCSA", "warner bros discovery": "WBD",
	"warner bros": "WBD", "paramount": "PARA", "verizon": "VZ", "t-mobile": "TMUS",
	"at&t": "T", "charter communications": "CHTR",

	// Retail / consumer
	"walmart": "WMT", "costco": "COST", "home depot": "HD", "lowe's": "LOW",
	"lowes": "LOW", "nike": "NKE", "lululemon": "LULU", "starbucks": "SBUX",
	"mcdonald's": "MCD", "mcdonalds": "MCD", "chipotle": "CMG", "coca-cola": "KO",
	"coca cola": "KO", "pepsico": "PEP", "procter & gamble": "PG", "colgate": "CL",
	"unilever": "UL", "estee lauder": "EL", "kraft heinz": "KHC", "mondelez": "MDLZ",
	"general mills": "GIS", "kroger": "KR", "walgreens": "WBA", "dollar general": "DG",
	"best buy": "BBY", "nordstrom": "JWN", "macy's": "M", "macys": "M",

	// Pharma / health
	"pfizer": "PFE", "moderna": "MRNA", "johnson & johnson": "JNJ", "merck": "MRK",
	"eli lilly": "LLY", "abbvie": "ABBV", "bristol myers": "BMY", "amgen": "AMGN",
	"gilead": "GILD", "biogen": "BIIB", "novartis": "NVS", "astrazeneca": "AZN",
	"novo nordisk": "NVO", "unitedhealth": "UNH", "cigna": "CI", "humana": "HUM",
	"cvs health": "CVS", "thermo fisher": "TMO", "danaher": "DHR", "medtronic": "MDT",
	"intuitive surgical": "ISRG",

	// Energy / utilities
	"exxonmobil": "XOM", "exxon": "XOM", "chevron": "CVX", "conocophillips": "COP",
	"schlumberger": "SLB", "halliburton": "HAL", "occidental": "OXY", "phillips 66": "PSX",
	"marathon petroleum": "MPC", "valero": "VLO", "nextera": "NEE", "totalenergies": "TTE",

	// Airlines / travel / leisure
	"delta air lines": "DAL", "american airlines": "AAL", "united airlines": "UAL",
	"southwest airlines": "LUV", "jetblue": "JBLU", "carnival": "CCL",
	"royal caribbean": "RCL", "marriott": "MAR", "hilton": "HLT",
	"booking holdings": "BKNG", "expedia": "EXPE",

	// International majors
	"alibaba": "BABA", "tencent": "TCEHY", "baidu": "BIDU", "pinduoduo": "PDD",
	"sony": "SONY", "nintendo": "NTDOY", "samsung": "SSNLF",

	// Crypto — names always; bare symbols only for BTC/ETH (non-words). SOL/ADA/
	// DOT/LINK/XRP are English words as bare symbols, so name-only.
	"bitcoin": "BTC", "btc": "BTC", "ethereum": "ETH", "eth": "ETH", "solana": "SOL",
	"cardano": "ADA", "dogecoin": "DOGE", "ripple": "XRP", "polkadot": "DOT",
	"litecoin": "LTC", "chainlink": "LINK", "binance": "BNB",
}

var nameEntries []nameEntry

func init() {
	nameEntries = make([]nameEntry, 0, len(rawNames))
	for name, tk := range rawNames {
		nameEntries = append(nameEntries, nameEntry{name: name, ticker: tk})
	}
	// Longest name first; ties broken by name for a deterministic order.
	sort.Slice(nameEntries, func(i, j int) bool {
		if len(nameEntries[i].name) != len(nameEntries[j].name) {
			return len(nameEntries[i].name) > len(nameEntries[j].name)
		}
		return nameEntries[i].name < nameEntries[j].name
	})
}
