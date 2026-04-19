// Hanzo World product IDs for frontend checkout CTAs.
// Matches Commerce plan slugs in /Users/z/work/hanzo/plans/subscription.json.

export const WORLD_PRODUCTS = {
  FREE: 'world-free',
  PRO_MONTHLY: 'world-pro',
  PRO_ANNUAL: 'world-pro',
  TEAM_MONTHLY: 'world-team',
  TEAM_ANNUAL: 'world-team',
} as const;

/** Default product for upgrade CTAs (Pro Monthly). */
export const DEFAULT_UPGRADE_PRODUCT = WORLD_PRODUCTS.PRO_MONTHLY;

/** Backward-compat alias — old call sites expected DODO_PRODUCTS. */
export const DODO_PRODUCTS = WORLD_PRODUCTS;
