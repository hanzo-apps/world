// Model family marks — the ONE place a model id maps to a visual identity.
// The Zen ring is Zen's brand mark and must appear ONLY on zen* models; every
// other family gets its own monochrome mark (same lucide stroke language), so
// e.g. gpt-oss never wears the Zen logo. Consumers: the analyst model pill,
// the model menu rows, and assistant avatars.

import { icon, zenLogo } from './icons';

export type ModelFamily = 'auto' | 'zen' | 'gpt' | 'llama' | 'claude' | 'agent' | 'other';

/** Infer the family from a served model id (prefix rules, lowercase). */
export function modelFamily(id: string | undefined): ModelFamily {
  const m = (id || '').toLowerCase();
  if (!m || m === 'best') return 'auto';
  if (m.startsWith('agent:')) return 'agent';
  if (m.startsWith('zen')) return 'zen';
  if (m.startsWith('gpt') || m.includes('gpt-oss')) return 'gpt';
  if (m.startsWith('llama') || m.includes('llama')) return 'llama';
  if (m.startsWith('claude') || m.startsWith('anthropic')) return 'claude';
  return 'other';
}

/** Monochrome letter-in-rounded-square mark (for families without a house
 *  logo). Reads crisply at 13-15px next to the lucide set. */
function monogram(letter: string, size: number, cls: string): string {
  return `<svg class="model-mark${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="5"/><text x="12" y="16.2" text-anchor="middle" stroke="none" fill="currentColor" font-size="11.5" font-weight="700" font-family="inherit">${letter}</text></svg>`;
}

/** The mark for a model id. Never the Zen ring for a non-zen family. */
export function modelMark(id: string | undefined, size = 13, cls = ''): string {
  switch (modelFamily(id)) {
    case 'zen':
      return zenLogo(size, cls);
    case 'auto':
      return icon('sparkles', size, cls);
    case 'agent':
      return icon('bot', size, cls);
    case 'gpt':
      return monogram('G', size, cls);
    case 'llama':
      return monogram('L', size, cls);
    case 'claude':
      return monogram('C', size, cls);
    default:
      return icon('cpu', size, cls);
  }
}
