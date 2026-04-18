/**
 * Unified search endpoint for LLM agents, WhatsApp bot, and MCP tools.
 *
 * GET /api/search?q=...&format=brief&limit=5
 *
 * Accepts a natural-language query, determines relevant data domains,
 * fans out to the existing Redis-cached data services, and returns a
 * unified JSON response. With format=brief returns a concise text summary.
 *
 * Auth: X-Hanzo-World-Key header (same as MCP/bootstrap).
 */

export const config = { runtime: 'edge' };

// @ts-expect-error — JS module, no declaration file
import { getPublicCorsHeaders } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { validateApiKey } from './_api-key.js';
// @ts-expect-error — JS module, no declaration file
import { redisPipeline, readJsonFromUpstash } from './_upstash-json.js';

// ---------------------------------------------------------------------------
// Domain definitions — each domain maps to one or more Redis cache keys and
// a set of trigger keywords that a query must contain to activate it.
// ---------------------------------------------------------------------------

interface Domain {
  keys: Record<string, string>;
  triggers: string[];
}

const DOMAINS: Record<string, Domain> = {
  news: {
    keys: {
      insights: 'news:insights:v1',
      gdeltIntel: 'intelligence:gdelt-intel:v1',
      crossSourceSignals: 'intelligence:cross-source-signals:v1',
      advisories: 'intelligence:advisories-bootstrap:v1',
      telegramFeed: 'intelligence:telegram-feed:v1',
    },
    triggers: ['news', 'headline', 'headlines', 'press', 'media', 'breaking', 'report', 'journalism', 'article'],
  },
  markets: {
    keys: {
      stocks: 'market:stocks-bootstrap:v1',
      commodities: 'market:commodities-bootstrap:v1',
      crypto: 'market:crypto:v1',
      sectors: 'market:sectors:v2',
      etfFlows: 'market:etf-flows:v1',
      fearGreed: 'market:fear-greed:v1',
      stablecoins: 'market:stablecoins:v1',
    },
    triggers: ['market', 'markets', 'stock', 'stocks', 'equity', 'equities', 'crypto', 'bitcoin', 'btc', 'eth',
               'commodity', 'commodities', 'oil', 'gold', 'silver', 'price', 'prices', 'trading', 'forex', 'fx',
               'etf', 'sector', 'sectors', 'nasdaq', 'dow', 's&p', 'sp500'],
  },
  military: {
    keys: {
      theaterPosture: 'theater_posture:sebuf:stale:v1',
      militaryFlights: 'military:flights:stale:v1',
      usniFleet: 'usni-fleet:sebuf:stale:v1',
    },
    triggers: ['military', 'defense', 'defence', 'army', 'navy', 'air force', 'missile', 'weapon', 'nato',
               'pentagon', 'fleet', 'aircraft', 'fighter', 'bomber', 'troops', 'deployment', 'posture'],
  },
  earthquakes: {
    keys: {
      earthquakes: 'seismology:earthquakes:v1',
    },
    triggers: ['earthquake', 'earthquakes', 'seismic', 'quake', 'tremor', 'magnitude', 'richter', 'usgs'],
  },
  conflict: {
    keys: {
      ucdpEvents: 'conflict:ucdp-events:v1',
      iranEvents: 'conflict:iran-events:v1',
      unrestEvents: 'unrest:events:v1',
      riskScores: 'risk:scores:sebuf:stale:v1',
    },
    triggers: ['conflict', 'war', 'battle', 'fighting', 'unrest', 'protest', 'violence', 'coup', 'insurgency',
               'terrorism', 'attack', 'casualty', 'casualties', 'crisis', 'escalation', 'iran', 'ukraine', 'gaza'],
  },
  cyber: {
    keys: {
      threats: 'cyber:threats-bootstrap:v2',
      ddos: 'cf:radar:ddos:v1',
    },
    triggers: ['cyber', 'hack', 'hacker', 'malware', 'ransomware', 'vulnerability', 'cve', 'ddos', 'breach',
               'phishing', 'exploit', 'infosec', 'cybersecurity'],
  },
  climate: {
    keys: {
      anomalies: 'climate:anomalies:v2',
      disasters: 'climate:disasters:v1',
      co2: 'climate:co2-monitoring:v1',
      weatherAlerts: 'weather:alerts:v1',
      airQuality: 'climate:air-quality:v1',
      oceanIce: 'climate:ocean-ice:v1',
    },
    triggers: ['climate', 'weather', 'temperature', 'hurricane', 'typhoon', 'cyclone', 'flood', 'drought',
               'storm', 'tornado', 'wildfire', 'fire', 'co2', 'carbon', 'emission', 'ice', 'arctic', 'heat'],
  },
  wildfires: {
    keys: {
      fires: 'wildfire:fires:v1',
    },
    triggers: ['wildfire', 'wildfires', 'fire', 'fires', 'blaze', 'burn', 'firms', 'nasa fire'],
  },
  economic: {
    keys: {
      macroSignals: 'economic:macro-signals:v1',
      spending: 'economic:spending:v1',
      econCalendar: 'economic:econ-calendar:v1',
      fuelPrices: 'economic:fuel-prices:v1',
      stress: 'economic:stress-index:v1',
    },
    triggers: ['economic', 'economy', 'gdp', 'inflation', 'interest rate', 'fed', 'central bank', 'ecb',
               'unemployment', 'jobs', 'recession', 'growth', 'fiscal', 'monetary', 'debt', 'deficit',
               'tariff', 'trade war', 'sanctions'],
  },
  supply_chain: {
    keys: {
      shippingStress: 'supply_chain:shipping_stress:v1',
      chokepoints: 'supply_chain:chokepoints:v4',
      portwatch: 'supply_chain:portwatch:v1',
    },
    triggers: ['supply chain', 'shipping', 'freight', 'port', 'chokepoint', 'suez', 'panama', 'strait',
               'container', 'logistics', 'cargo', 'trade route'],
  },
  health: {
    keys: {
      diseaseOutbreaks: 'health:disease-outbreaks:v1',
      airQuality: 'health:air-quality:v1',
    },
    triggers: ['health', 'disease', 'outbreak', 'pandemic', 'epidemic', 'virus', 'covid', 'who',
               'vaccination', 'infection', 'mortality', 'air quality', 'pollution'],
  },
  radiation: {
    keys: {
      observations: 'radiation:observations:v1',
    },
    triggers: ['radiation', 'nuclear', 'radioactive', 'chernobyl', 'fukushima', 'reactor'],
  },
  prediction: {
    keys: {
      markets: 'prediction:markets-bootstrap:v1',
      forecasts: 'forecast:predictions:v2',
    },
    triggers: ['prediction', 'forecast', 'probability', 'polymarket', 'odds', 'betting', 'prediction market',
               'will', 'chance', 'likelihood'],
  },
  sanctions: {
    keys: {
      pressure: 'sanctions:pressure:v1',
      entities: 'sanctions:entities:v1',
    },
    triggers: ['sanction', 'sanctions', 'ofac', 'sdn', 'embargo', 'blacklist', 'designat'],
  },
  aviation: {
    keys: {
      delays: 'aviation:delays-bootstrap:v1',
    },
    triggers: ['aviation', 'airport', 'flight', 'flights', 'airline', 'delay', 'delays', 'faa', 'notam', 'airspace'],
  },
  infrastructure: {
    keys: {
      outages: 'infra:outages:v1',
      serviceStatuses: 'infra:service-statuses:v1',
    },
    triggers: ['infrastructure', 'outage', 'outages', 'internet', 'downtime', 'aws', 'cloudflare', 'service status'],
  },
  displacement: {
    keys: {
      displacement: `displacement:summary:v1:${new Date().getUTCFullYear()}`,
    },
    triggers: ['displacement', 'refugee', 'refugees', 'migration', 'asylum', 'idp', 'unhcr', 'displaced'],
  },
};

// Fallback: when no specific domains match, return a broad overview.
const OVERVIEW_DOMAINS = ['news', 'markets', 'conflict', 'climate', 'earthquakes', 'cyber'];

// ---------------------------------------------------------------------------
// Query classification
// ---------------------------------------------------------------------------

function classifyQuery(q: string): string[] {
  const lower = q.toLowerCase();
  const matched: string[] = [];

  for (const [name, domain] of Object.entries(DOMAINS)) {
    for (const trigger of domain.triggers) {
      if (lower.includes(trigger)) {
        matched.push(name);
        break;
      }
    }
  }

  return matched.length > 0 ? matched : OVERVIEW_DOMAINS;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface DomainResult {
  domain: string;
  data: Record<string, unknown>;
}

async function fetchDomains(domainNames: string[]): Promise<DomainResult[]> {
  // Collect all Redis keys across selected domains.
  const keyEntries: { domain: string; label: string; redisKey: string }[] = [];
  for (const name of domainNames) {
    const domain = DOMAINS[name];
    if (!domain) continue;
    for (const [label, redisKey] of Object.entries(domain.keys)) {
      keyEntries.push({ domain: name, label, redisKey });
    }
  }

  if (keyEntries.length === 0) return [];

  // Single pipeline read for all keys.
  const commands = keyEntries.map(e => ['GET', e.redisKey]);
  const results = await redisPipeline(commands, 6_000);
  if (!results) return [];

  // Group results by domain.
  const grouped = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < keyEntries.length; i++) {
    const entry = keyEntries[i]!;
    const raw = results[i]?.result;
    let parsed: unknown = null;
    if (raw && typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { /* skip unparseable */ }
    }
    if (!grouped.has(entry.domain)) grouped.set(entry.domain, {});
    grouped.get(entry.domain)![entry.label] = parsed;
  }

  return Array.from(grouped.entries()).map(([domain, data]) => ({ domain, data }));
}

// ---------------------------------------------------------------------------
// Brief formatter — condenses each domain into a few lines of text.
// ---------------------------------------------------------------------------

function summarizeItem(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  // Prefer title/headline/name + location/country
  const title = obj.title ?? obj.headline ?? obj.name ?? obj.summary ?? obj.description ?? '';
  const loc = obj.country ?? obj.location ?? obj.region ?? '';
  if (!title) return '';
  return loc ? `${title} (${loc})` : String(title);
}

function formatBrief(results: DomainResult[], limit: number): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  lines.push(`WorldMonitor Brief — ${now}`);
  lines.push('');

  for (const { domain, data } of results) {
    const sectionLines: string[] = [];

    for (const [, value] of Object.entries(data)) {
      if (!value) continue;

      // Handle arrays — take top items.
      if (Array.isArray(value)) {
        for (const item of value.slice(0, limit)) {
          const line = summarizeItem(item);
          if (line) sectionLines.push(`  - ${line}`);
        }
        continue;
      }

      // Handle objects with nested arrays (e.g. { items: [...] }).
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        // Look for the first array-valued property.
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) {
            for (const item of v.slice(0, limit)) {
              const line = summarizeItem(item);
              if (line) sectionLines.push(`  - ${line}`);
            }
            break;
          }
        }
      }
    }

    if (sectionLines.length > 0) {
      lines.push(`## ${domain.toUpperCase()}`);
      lines.push(...sectionLines.slice(0, limit));
      lines.push('');
    }
  }

  return lines.length > 2 ? lines.join('\n') : 'No relevant data found for this query.';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function jsonResp(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const cors = getPublicCorsHeaders('GET, OPTIONS') as Record<string, string>;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'GET') {
    return jsonResp({ error: 'Method not allowed' }, 405, cors);
  }

  // Auth — require API key for non-browser callers (same as bootstrap/mcp).
  const keyCheck = validateApiKey(req) as { valid: boolean; required: boolean; error?: string };
  if (keyCheck.required && !keyCheck.valid) {
    return jsonResp({ error: keyCheck.error ?? 'API key required' }, 401, cors);
  }

  // Parse query params.
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return jsonResp({ error: 'Missing required parameter: q' }, 400, cors);
  }
  if (q.length > 500) {
    return jsonResp({ error: 'Query too long (max 500 chars)' }, 400, cors);
  }

  const format = url.searchParams.get('format') ?? 'json';
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10) || 5, 20));

  // Classify and fetch.
  const domainNames = classifyQuery(q);
  const results = await fetchDomains(domainNames);

  // Return brief text format.
  if (format === 'brief') {
    const text = formatBrief(results, limit);
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300',
        ...cors,
      },
    });
  }

  // Default JSON response.
  return jsonResp({
    query: q,
    domains: domainNames,
    results: results.map(({ domain, data }) => ({ domain, data })),
    ts: new Date().toISOString(),
  }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=300',
    ...cors,
  });
}
