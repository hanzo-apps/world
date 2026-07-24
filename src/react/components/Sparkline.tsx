import { sparkline } from '@/utils/market-format';

/**
 * Sparkline — the ONE React sparkline, a thin wrapper over the vanilla
 * `sparkline()` util (src/utils/market-format.ts). Point math + SVG are NOT
 * re-authored here; we render the util's trusted, self-owned SVG string into an
 * inline host so every ported panel (and the chassis `sparkline` slot) draws dense
 * series exactly as the vanilla surface does. Stroke inherits `currentColor`, so a
 * parent row/label tints it (monochrome-by-default, red/green when a row sets color).
 */
export function Sparkline({
  data,
  width = 54,
  height = 16,
  color,
}: {
  data: number[] | undefined;
  width?: number;
  height?: number;
  color?: string;
}): React.JSX.Element | null {
  const svg = sparkline(data, { w: width, h: height, stroke: color ?? 'currentColor' });
  if (!svg) return null;
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', color, lineHeight: 0 }}
      // Trusted, self-generated SVG from our own util — no user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
