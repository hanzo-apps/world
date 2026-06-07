// Hanzo World plan catalog fallback.
//
// Used by api/product-catalog.js when commerce.hanzo.ai is unreachable.
// Pricing source: ~/work/hanzo/plans/subscription.json (the canonical
// hanzoai/plans repo) mirrored into commerce's embedded catalog.
//
// Editing rules:
//   - Slugs (id) MUST match commerce's `/v1/billing/plans` slugs and
//     the keys in functions/v1/world/checkout.js PLAN_PRICE_CENTS.
//   - prices are USD per month / per year.
//   - World-Pro is included free in pro / max / team / team-max /
//     enterprise. The fallback advertises both paths so a customer who
//     wants only the OSINT dashboard pays $29, while a customer who
//     wants Pro + World pays $49 instead of $29 + $49.

const FALLBACK_TIERS = [
  {
    id: 'world-free',
    name: 'Free',
    description: 'Real-time global intelligence dashboard — free tier.',
    priceMonthly: 0,
    priceAnnual: 0,
    features: [
      'Live OSINT dashboard',
      '3 saved alerts',
      'Community Discord',
      'Daily email digest',
    ],
    limits: { maxAlerts: 3, apiRateLimit: 60, mcpRateLimit: 30 },
    popular: false,
  },
  {
    id: 'world-pro',
    name: 'Pro',
    description: 'Everything in Free plus Zen AI analyst, MCP/ZAP API, priority feeds, WhatsApp/Telegram/SMS alerts.',
    priceMonthly: 29,
    priceAnnual: 290,
    features: [
      'Everything in Free',
      'Unlimited alerts',
      'ZAP + MCP real-time API',
      'WhatsApp / Telegram / SMS alerts',
      'Priority data feeds (AIS, FIRMS, GDELT)',
      'Zen AI analyst chat (unlimited)',
      'Data export (CSV, JSON, parquet)',
      'Priority support',
    ],
    limits: { maxAlerts: -1, apiRateLimit: 6000, mcpRateLimit: 3000 },
    popular: true,
  },
  {
    id: 'world-team',
    name: 'Team',
    description: 'Everything in Pro for up to 5 seats + shared workspace.',
    priceMonthly: 99,
    priceAnnual: 990,
    features: [
      'Everything in Pro',
      '5 team seats',
      'Shared alert rules + saved views',
      'SSO via Hanzo IAM',
      'Org-level API keys',
      'Audit log',
      'Higher rate limits',
    ],
    limits: { maxAlerts: -1, apiRateLimit: 15000, mcpRateLimit: 15000, maxMembers: 5 },
    popular: false,
  },
  {
    id: 'pro',
    name: 'Hanzo Pro',
    description: 'Hanzo Pro for developers — includes Hanzo World Pro at no extra cost.',
    priceMonthly: 49,
    priceAnnual: 39,
    bundles: ['world-pro'],
    features: [
      'Everything in World Pro',
      '500 requests/min on Hanzo APIs',
      '1M tokens/min',
      'Email support',
      'Analytics dashboard',
      'Priority inference across Zen + frontier models',
    ],
    limits: { maxAlerts: -1, apiRateLimit: 6000, mcpRateLimit: 3000 },
    popular: false,
  },
  {
    id: 'team',
    name: 'Hanzo Team',
    description: 'Hanzo Team for shared workspaces — includes Hanzo World Team at no extra cost.',
    priceMonthly: 199,
    priceAnnual: 159,
    bundles: ['world-team'],
    features: [
      'Everything in World Team',
      'Up to 10 team seats',
      'SSO / SAML',
      'Custom model training',
      'Shared billing',
    ],
    limits: { maxAlerts: -1, apiRateLimit: 30000, mcpRateLimit: 15000, maxMembers: 10 },
    popular: false,
  },
];

/** Catalog returned when commerce.hanzo.ai is unreachable. */
export function getFallbackCatalog() {
  // Defensive clone — callers occasionally mutate the result (e.g. tagging
  // each tier with a `source: 'fallback'` marker before render) and that
  // would otherwise bleed across cache hits in the same process.
  return FALLBACK_TIERS.map((tier) => ({ ...tier, features: [...tier.features], limits: { ...tier.limits } }));
}

/** Per-slug monthly price (USD) lookup, used by checkout-attempt validation. */
export function getFallbackPrice(planId) {
  const tier = FALLBACK_TIERS.find((t) => t.id === planId);
  return tier ? tier.priceMonthly : null;
}

// Legacy export kept for prior callers — the cents-priced SKU map.
// Mirrors the keys in functions/v1/world/checkout.js PLAN_PRICE_CENTS.
// Hanzo platform tiers bundle World Pro / Team at no extra cost via
// commerce's `bundles` field, so a Pro purchase ($49) also entitles
// the user to World Pro features without a second charge.
export const FALLBACK_PRICES = {
  'world-pro': 2900,
  'world-pro-annual': 29000,
  'world-team': 9900,
  'world-team-annual': 99000,
  pro: 4900,
  'pro-annual': 39 * 12 * 100,
  team: 19900,
  'team-annual': 159 * 12 * 100,
};
