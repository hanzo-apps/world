import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  fetchRotation,
  QUADRANT_LABEL,
  type RotationSnapshot,
  type RotationTheme,
  type RotationSignal,
  type Quadrant,
} from '@/services/rotation';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * RotationScannerPanel — the vanilla `RotationScannerPanel`
 * (src/components/RotationScannerPanel.ts) ported onto the React Panel chassis.
 * Sector-rotation scanner: reads the server-side Relative Rotation Graph and shows
 * where capital is rotating between themes — the AI buildout distributing at the top
 * (Weakening) while the energy complex accumulates from a base (Improving). The
 * quadrant plot is the hero; the signal chips name the thesis triggers; the
 * leaderboard ranks every theme by forward relative momentum.
 *
 * REUSES the vanilla data layer VERBATIM: fed by the same `fetchRotation`
 * (@/services/rotation) and the same `QUADRANT_LABEL` map. The pure view helpers
 * (QUAD_COLOR, plotDomain, fmtPct, dirClass, the RRG scale math) are copied
 * byte-for-byte from the vanilla panel; no fetch/scoring logic is re-authored. The
 * RRG SVG is re-expressed as native React SVG and the signal chips / narrative /
 * leaderboard as @hanzo/gui longhand primitives against the chassis. `escapeHtml` is
 * dropped on purpose — React escapes text nodes. The chassis owns the frame +
 * loading/empty/error; this file owns only the content and which state to show.
 */

// ── vanilla view constants + pure helpers, copied verbatim ─────────────────────
const QUAD_COLOR: Record<Quadrant, string> = {
  leading: '#44ff88', // outperforming and accelerating
  weakening: '#f5a623', // outperforming but rolling over — distribution
  lagging: '#ff5c5c', // underperforming and falling
  improving: '#4aa3ff', // underperforming but turning up — accumulation
};

const INFO =
  'Relative Rotation Graph. Each theme is scored against the S&P 500 on two axes: ' +
  'RS-Ratio (relative strength — is it out- or under-performing) and RS-Momentum ' +
  '(is that relative strength accelerating or rolling over). The four quadrants name ' +
  "a theme's place in the rotation cycle: Leading → Weakening → Lagging → Improving → " +
  'back to Leading. Capital distributes out of a hot theme through Weakening and ' +
  'accumulates an out-of-favour one through Improving. Faithful open approximation of ' +
  'JdK RS-Ratio/Momentum; 6-month daily data, refreshed every few minutes.';

function fmtPct(v: number | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

type Dir = 'up' | 'down' | 'flat';
function dirClass(v: number | undefined): Dir {
  if (v == null || !isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}
const DIR_COLOR: Record<Dir, string> = {
  up: '#22c55e',
  down: '#ef4444',
  flat: '$color10',
};

// Symmetric plot domain around 100 so the benchmark cross sits dead-centre; the
// half-range adapts to the widest point so tails never clip.
function plotDomain(themes: RotationTheme[]): number {
  let dev = 4;
  for (const th of themes) {
    dev = Math.max(dev, Math.abs(th.rsRatio - 100), Math.abs(th.rsMomentum - 100));
    for (const p of th.tail) {
      dev = Math.max(dev, Math.abs(p.rsRatio - 100), Math.abs(p.rsMomentum - 100));
    }
  }
  return Math.ceil(dev * 1.12);
}

export function RotationScannerPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [snap, setSnap] = useState<RotationSnapshot | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      const next = await fetchRotation(controller.signal);
      if (cancelled || controller.signal.aborted) return;
      if (!next) {
        // fetch failed / unparseable — honest error, don't fabricate a plot.
        setState('error');
        return;
      }
      if (next.unavailable || !next.themes.length) {
        setSnap(null);
        setEmptyText('Rotation data unavailable.');
        setState('empty');
        return;
      }
      setSnap(next);
      setState('ready');
    };

    void load();
    // Rotation is a multi-week read; the 6mo server cache is 15min, so polling on the
    // markets cadence just picks up the shared refresh without new upstream load.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Rotation scanner"
      state={state}
      emptyText={emptyText}
      infoTooltip={INFO}
      actions={<PanelLiveDot />}
    >
      {snap ? <RotationBody snap={snap} /> : null}
    </Panel>
  );
}

function RotationBody({ snap }: { snap: RotationSnapshot }): React.JSX.Element {
  const leads = snap.themes.filter((t) => t.lead);
  return (
    <YStack gap="$3">
      <Signals signals={snap.signals} />
      {snap.narrative ? (
        <SizableText size="$2" color="$color11">
          {snap.narrative}
        </SizableText>
      ) : null}
      {leads.length ? <RRG themes={leads} /> : null}
      <Board themes={snap.themes} />
      <SizableText size="$1" color="$color9">
        vs {snap.benchmark} · {snap.window || '6mo'} daily
        {snap.marketSession ? ` · ${snap.marketSession}` : ''}
      </SizableText>
    </YStack>
  );
}

function Signals({ signals }: { signals: RotationSignal[] }): React.JSX.Element | null {
  if (!signals?.length) return null;
  return (
    <XStack gap="$2" flexWrap="wrap">
      {signals.map((s) => {
        const pct = Math.max(0, Math.min(100, Math.round((s.score ?? 0) * 100)));
        const tint = s.state === 'active' ? '#44ff88' : s.state === 'watch' ? '#f5a623' : '$color9';
        return (
          <YStack
            key={s.key}
            gap="$1.5"
            padding="$2"
            borderRadius="$3"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.10)"
            minWidth={150}
            flex={1}
          >
            <XStack alignItems="center" gap="$1.5">
              <XStack width={6} height={6} borderRadius={999} backgroundColor={tint} />
              <SizableText size="$2" color="$color12" flex={1} numberOfLines={1}>
                {s.label}
              </SizableText>
              <SizableText size="$1" color={tint} style={{ textTransform: 'uppercase' }}>
                {s.state}
              </SizableText>
            </XStack>
            <XStack height={4} borderRadius={999} backgroundColor="rgba(255,255,255,0.10)" overflow="hidden">
              <XStack width={`${pct}%`} backgroundColor={tint} />
            </XStack>
          </YStack>
        );
      })}
    </XStack>
  );
}

// The RRG quadrant plot — native SVG re-expression of the vanilla `renderRRG`. Each
// lead theme is drawn as its tail (the path it took through the quadrants) plus a
// labelled head dot coloured by its current quadrant.
function RRG({ themes }: { themes: RotationTheme[] }): React.JSX.Element {
  const size = 260;
  const pad = 18;
  const plot = size - pad * 2;
  const R = plotDomain(themes);
  const sx = (r: number): number => pad + ((r - (100 - R)) / (2 * R)) * plot;
  const sy = (m: number): number => pad + (1 - (m - (100 - R)) / (2 * R)) * plot; // momentum up = smaller y
  const cx = sx(100);
  const cy = sy(100);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Relative rotation graph"
      style={{ width: '100%', height: 'auto', maxWidth: size }}
    >
      {/* quadrant tints — Improving (top-left) + Weakening (bottom-right) read a touch stronger */}
      <rect x={cx} y={pad} width={size - pad - cx} height={cy - pad} fill={QUAD_COLOR.leading} opacity={0.05} />
      <rect x={cx} y={cy} width={size - pad - cx} height={size - pad - cy} fill={QUAD_COLOR.weakening} opacity={0.08} />
      <rect x={pad} y={cy} width={cx - pad} height={size - pad - cy} fill={QUAD_COLOR.lagging} opacity={0.05} />
      <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill={QUAD_COLOR.improving} opacity={0.08} />

      {/* benchmark axes */}
      <line x1={cx} y1={pad} x2={cx} y2={size - pad} stroke="rgba(255,255,255,0.24)" strokeWidth={1} strokeDasharray="2 3" />
      <line x1={pad} y1={cy} x2={size - pad} y2={cy} stroke="rgba(255,255,255,0.24)" strokeWidth={1} strokeDasharray="2 3" />

      {/* corner labels */}
      <text x={size - pad - 2} y={pad + 10} textAnchor="end" fontSize={8} fontWeight={700} fill={QUAD_COLOR.leading}>LEADING</text>
      <text x={size - pad - 2} y={size - pad - 3} textAnchor="end" fontSize={8} fontWeight={700} fill={QUAD_COLOR.weakening}>WEAKENING</text>
      <text x={pad + 2} y={size - pad - 3} textAnchor="start" fontSize={8} fontWeight={700} fill={QUAD_COLOR.lagging}>LAGGING</text>
      <text x={pad + 2} y={pad + 10} textAnchor="start" fontSize={8} fontWeight={700} fill={QUAD_COLOR.improving}>IMPROVING</text>

      {/* per-theme tail + head dot */}
      {themes.map((th) => {
        const color = QUAD_COLOR[th.quadrant];
        const pts = [...th.tail, { rsRatio: th.rsRatio, rsMomentum: th.rsMomentum }];
        const poly = pts.map((p) => `${sx(p.rsRatio).toFixed(1)},${sy(p.rsMomentum).toFixed(1)}`).join(' ');
        const hx = sx(th.rsRatio);
        const hy = sy(th.rsMomentum);
        return (
          <g key={th.key}>
            <polyline points={poly} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5} strokeLinejoin="round" />
            <circle cx={hx.toFixed(1)} cy={hy.toFixed(1)} r={3.4} fill={color} />
            <text x={(hx + 5).toFixed(1)} y={(hy + 3).toFixed(1)} fontSize={8} fill="rgba(255,255,255,0.82)">
              {th.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Board({ themes }: { themes: RotationTheme[] }): React.JSX.Element {
  return (
    <YStack gap="$1">
      <XStack justifyContent="space-between" alignItems="center" paddingBottom="$1">
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          Theme
        </SizableText>
        <XStack gap="$3" alignItems="center">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Quadrant
          </SizableText>
          <SizableText size="$1" color="$color9" style={{ minWidth: 48, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>
            1mo
          </SizableText>
        </XStack>
      </XStack>
      {themes.map((th) => {
        const color = QUAD_COLOR[th.quadrant];
        const retTint = DIR_COLOR[dirClass(th.ret21)];
        return (
          <XStack key={th.key} justifyContent="space-between" alignItems="center" paddingVertical="$1">
            <XStack alignItems="center" gap="$2" flex={1}>
              <XStack width={7} height={7} borderRadius={999} backgroundColor={color} />
              <SizableText size="$2" color="$color12" numberOfLines={1}>
                {th.label}
              </SizableText>
            </XStack>
            <XStack gap="$3" alignItems="center">
              <SizableText size="$2" color={color}>
                {QUADRANT_LABEL[th.quadrant]}
              </SizableText>
              <SizableText size="$2" color={retTint} style={{ minWidth: 48, textAlign: 'right' }}>
                {fmtPct(th.ret21)}
              </SizableText>
            </XStack>
          </XStack>
        );
      })}
    </YStack>
  );
}
