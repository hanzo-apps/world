// Hanzo World plan catalog fallback.
//
// Used by api/product-catalog.js when commerce.hanzo.ai is unreachable.
// Pricing source: /Users/z/work/hanzo/plans/subscription.json (the world-*
// plans). Slugs match api/v1/world/checkout's PLAN_PRICE_ENV map.
//
// Editing rules:
//   - Slugs (id) MUST match the keys in api/v1/world/checkout.js PLAN_PRICE_ENV.
//   - prices are USD per month / per year. The Stripe price ID lives in env
//     (STRIPE_PRICE_WORLD_PRO etc.); the catalog only carries display prices.

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

// Legacy export kept for prior callers — the cents-priced Dodo SKU map.
export const FALLBACK_PRICES = {
  'world-pro': 2900,
  'world-pro-annual': 29000,
  'world-team': 9900,
  'world-team-annual': 99000,
};
