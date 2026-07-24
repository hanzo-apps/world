// Canonical variant set for the React surface, mirroring the vanilla header
// switcher (Cloud · AI · Crypto · Finance · Tech · World). The variant IDS and
// aliasing stay owned by @/config/variant (getSiteVariant / setSiteVariantRuntime)
// — this only carries the presentation (label + icon + order) for the React tabs,
// so the switch logic remains one source of truth in the config layer.
export interface VariantTab {
  id: string;
  label: string;
  icon: string;
}

export const VARIANT_TABS: readonly VariantTab[] = [
  { id: 'cloud', label: 'Cloud', icon: '☁️' },
  { id: 'ai', label: 'AI', icon: '🤖' },
  { id: 'crypto', label: 'Crypto', icon: '₿' },
  { id: 'finance', label: 'Finance', icon: '📈' },
  { id: 'tech', label: 'Tech', icon: '💻' },
  { id: 'full', label: 'World', icon: '🌍' },
] as const;
