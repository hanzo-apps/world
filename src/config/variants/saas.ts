// SaaS variant — ALIAS of the Hanzo flagship variant.
//
// The former standalone `saas` (Hanzo Cloud metrics) view has been folded into the
// first-class `hanzo` variant (which adds the live-traffic globe). `saas` is kept as
// an alias so existing ?variant=saas links keep working: variant.ts normalizes
// saas→hanzo at runtime, and this file re-exports the hanzo config for any tooling
// that still imports './variants/saas'. Do not add config here — edit ./hanzo.ts.
export * from './cloud';
