/**
 * Hanzo World product slugs for frontend checkout CTAs.
 *
 * Plain string slugs that map to the plans in /Users/z/work/hanzo/plans/subscription.json.
 * The api/v1/world/checkout edge function takes the planId and resolves the
 * Stripe price via STRIPE_PRICE_<UPPER_SLUG> env vars at request time.
 *
 * No auto-generation step — the slugs are stable, and the Convex catalog
 * that used to drive scripts/generate-product-config.mjs has been retired.
 */

export const WORLD_PRODUCTS = {
  FREE: 'world-free',
  PRO_MONTHLY: 'world-pro',
  PRO_ANNUAL: 'world-pro-annual',
  TEAM_MONTHLY: 'world-team',
  TEAM_ANNUAL: 'world-team-annual',
} as const;

/** Default product for upgrade CTAs (Pro Monthly). */
export const DEFAULT_UPGRADE_PRODUCT = WORLD_PRODUCTS.PRO_MONTHLY;

/** Backward-compat alias — old call sites expected DODO_PRODUCTS. */
export const DODO_PRODUCTS = WORLD_PRODUCTS;
