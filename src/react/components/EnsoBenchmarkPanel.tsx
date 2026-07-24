import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getEnsoBenchmarks,
  type EnsoBenchmarks,
  type BenchTable,
  type AblationTable,
  type AgenticTable,
} from '@/services/enso-benchmarks';
import { isAdmin } from '@/services/iam';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * EnsoBenchmarkPanel — the vanilla `EnsoBenchmarkPanel` (src/components/EnsoBenchmarkPanel.ts)
 * ported onto the React Panel chassis. The ADMIN-ONLY measured head-to-head for the
 * private Enso product: per-bench accuracy/cost tables, the enso-ultra logic ablation,
 * the SWE-Bench Pro agentic pilot, the competitor reported-figures reference table, and
 * the honest-framing caveats.
 *
 * It REUSES the vanilla data layer verbatim — `getEnsoBenchmarks` (the same server-gated
 * /v1/world/enso-benchmarks admin endpoint, returns null on 401/403) and `isAdmin` (the
 * client mirror of the server gate). No fetch logic is re-authored. The vanilla HTML
 * emitters (statTile/shareBar/adminOnlyState) can't render into React, so — exactly as the
 * sibling cloud ports do (see LlmUsagePanel) — they are re-expressed as @hanzo/gui longhand
 * primitives; the `usd`/`acc` number helpers are ported verbatim.
 *
 * Admin gate maps onto the chassis honestly: a non-admin, OR an admin whose (server-gated)
 * fetch failed, gets the "admin only" empty state — never fabricated data. The chassis owns
 * the frame + loading/empty/error states; this file owns which state to show and the rows.
 */

const usd = (n: number): string => (n > 0 ? `$${n.toFixed(2)}` : '—');
const acc = (n: number): string => `${n.toFixed(1)}`;

const ADMIN_ONLY =
  'Enso benchmark suite is available to the platform admin org. Sign in with an admin account to view it.';

export function EnsoBenchmarkPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<EnsoBenchmarks | null>(null);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla fetchData: a non-admin never even attempts the fetch;
    // an admin whose (server-gated) fetch returns null stays honest (no fake data).
    const load = async (): Promise<void> => {
      try {
        if (!(await isAdmin())) {
          if (cancelled) return;
          setState('empty');
          return;
        }
        const d = await getEnsoBenchmarks();
        if (cancelled) return;
        if (d) {
          setData(d); // keep last-good across a transient null
          setState('ready');
        } else {
          // Admin, but the fetch failed — the same clean "admin only" body.
          setState((prev) => (prev === 'ready' ? 'ready' : 'empty'));
        }
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Enso Benchmark Suite"
      state={state}
      loadingText="Loading benchmark suite…"
      emptyText={ADMIN_ONLY}
      width={520}
      actions={<PanelLiveDot />}
    >
      {data ? <BenchBody data={data} /> : null}
    </Panel>
  );
}

function BenchBody({ data }: { data: EnsoBenchmarks }): React.JSX.Element {
  const d = data;
  return (
    <YStack gap="$3">
      <XStack alignItems="center" justifyContent="space-between" gap="$2" flexWrap="wrap">
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          Enso vs SOTA · measured head-to-head
        </SizableText>
        <SizableText size="$1" color="$color8">
          private · admin only
        </SizableText>
      </XStack>

      <XStack gap="$2" flexWrap="wrap">
        <StatTile value={`${d.benches.length}`} label="benches measured" sub={d.source} />
        <StatTile value={usd(d.totalUsdEst)} label="total spend" sub="all runs" />
        <StatTile value={`${d.pending.length}`} label="run pending" sub={d.pending.join(' · ') || '—'} />
      </XStack>

      {d.benches.map((b) => (
        <BenchBlock key={b.key} bench={b} />
      ))}
      <AblationBlock rows={d.ablation} />
      {d.agentic ? <AgenticBlock agentic={d.agentic} /> : null}
      <EnsoBlock data={d} />
      <CaveatsBlock caveats={d.caveats} />
    </YStack>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of cloud-format `statTile`. */
function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }): React.JSX.Element {
  return (
    <YStack
      minWidth={140}
      flex={1}
      gap="$1"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
    >
      <SizableText size="$5" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {label}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color8">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}

function Subhead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SizableText size="$2" color="$color11" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
      {children}
    </SizableText>
  );
}

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SizableText size="$1" color="$color9">
      {children}
    </SizableText>
  );
}

/** A horizontal share bar (0..1) — the @hanzo/gui analogue of cloud-format `shareBar`. */
function ShareBar({ fraction }: { fraction: number }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <XStack height={5} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
      <XStack width={`${pct.toFixed(1)}%`} backgroundColor="rgba(255,255,255,0.55)" />
    </XStack>
  );
}

// ── block 1: per-bench measured head-to-head ──────────────────────────────────
function BenchBlock({ bench }: { bench: BenchTable }): React.JSX.Element {
  const b = bench;
  const maxAcc = Math.max(...b.systems.map((s) => s.accuracyPct), 1);
  return (
    <YStack gap="$1.5">
      <Subhead>{b.name}</Subhead>
      <XStack paddingBottom="$0.5" gap="$2">
        <SizableText size="$1" color="$color8" style={{ flexBasis: 180, flexShrink: 0 }}>
          system
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flex: 1, textAlign: 'right' }}>
          accuracy %
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flexBasis: 48, textAlign: 'right', flexShrink: 0 }}>
          n
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
          cost
        </SizableText>
      </XStack>
      {b.systems.map((s) => {
        const isEnso = s.family === 'enso';
        const isBest = s.system === b.bestArm;
        const tag = isEnso ? 'enso' : isBest ? 'best arm' : '';
        return (
          <XStack key={s.system} alignItems="center" gap="$2">
            <XStack alignItems="center" gap="$1" style={{ flexBasis: 180, flexShrink: 0 }}>
              <SizableText size="$2" color={isEnso ? '$color12' : '$color11'} numberOfLines={1}>
                {s.system}
              </SizableText>
              {tag ? (
                <SizableText size="$1" color="$color8">
                  {tag}
                </SizableText>
              ) : null}
            </XStack>
            <YStack flex={1} gap="$0.5">
              <SizableText size="$2" color="$color12" style={{ textAlign: 'right' }}>
                {s.preflight ? 'preflight' : `${acc(s.accuracyPct)} ± ${s.stderrPct.toFixed(1)}`}
              </SizableText>
              {s.preflight ? null : <ShareBar fraction={s.accuracyPct / maxAcc} />}
            </YStack>
            <SizableText size="$2" color="$color10" style={{ flexBasis: 48, textAlign: 'right', flexShrink: 0 }}>
              n={s.n}
            </SizableText>
            <SizableText size="$2" color="$color12" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
              {usd(s.usdEst)}
            </SizableText>
          </XStack>
        );
      })}
      {b.note ? <Note>{b.note}</Note> : null}
    </YStack>
  );
}

// ── block 2: v1 blind-synthesis → v2 verify-then-select ablation ───────────────
function AblationBlock({ rows }: { rows: AblationTable[] }): React.JSX.Element | null {
  if (!rows.length) return null;
  return (
    <YStack gap="$2">
      <Subhead>enso-ultra logic ablation</Subhead>
      <Note>Better AND cheaper: the shipped selector beats the v1 baseline on the open-ended bench.</Note>
      {rows.map((a) => {
        const better = a.deltaPts > 0;
        const cheaper = a.costDropPct > 0;
        return (
          <YStack key={a.key} gap="$1">
            <SizableText size="$2" color="$color11">
              {a.name}
            </SizableText>
            <AblationRow label={a.v1.label} accuracyPct={a.v1.accuracyPct} usdEst={a.v1.usdEst} />
            <AblationRow label={a.v2.label} accuracyPct={a.v2.accuracyPct} usdEst={a.v2.usdEst} enso />
            <XStack gap="$3">
              <SizableText size="$1" color={better ? '#22c55e' : '#ef4444'}>
                {`${better ? '+' : ''}${a.deltaPts.toFixed(1)} pts`}
              </SizableText>
              <SizableText size="$1" color={cheaper ? '#22c55e' : '#ef4444'}>
                {`${cheaper ? '−' : '+'}${Math.abs(a.costDropPct).toFixed(1)}% cost`}
              </SizableText>
            </XStack>
          </YStack>
        );
      })}
    </YStack>
  );
}

function AblationRow({
  label,
  accuracyPct,
  usdEst,
  enso,
}: {
  label: string;
  accuracyPct: number;
  usdEst: number;
  enso?: boolean;
}): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2">
      <SizableText size="$2" color={enso ? '$color12' : '$color11'} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </SizableText>
      <SizableText size="$2" color="$color12" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
        {acc(accuracyPct)}
      </SizableText>
      <SizableText size="$2" color="$color12" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
        {usd(usdEst)}
      </SizableText>
    </XStack>
  );
}

// ── block 3: agentic SWE-Bench Pro pilot ──────────────────────────────────────
function AgenticBlock({ agentic }: { agentic: AgenticTable }): React.JSX.Element {
  const a = agentic;
  const row = (label: string, r: AgenticTable['stepRouted'], enso: boolean): React.JSX.Element => (
    <XStack alignItems="center" gap="$2">
      <SizableText size="$2" color={enso ? '$color12' : '$color11'} style={{ flexBasis: 180, flexShrink: 0 }} numberOfLines={1}>
        {label}
      </SizableText>
      <SizableText size="$2" color="$color12" style={{ flex: 1, textAlign: 'right' }}>
        {`${(r.resolvedRate * 100).toFixed(1)} (${r.resolved}/${r.n})`}
      </SizableText>
      <SizableText size="$2" color="$color12" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
        {usd(r.usdEst)}
      </SizableText>
      <SizableText size="$2" color="$color10" style={{ flexBasis: 48, textAlign: 'right', flexShrink: 0 }}>
        {r.calls}
      </SizableText>
    </XStack>
  );
  return (
    <YStack gap="$1.5">
      <Subhead>{`${a.bench} · agentic (step-routed)`}</Subhead>
      <XStack paddingBottom="$0.5" gap="$2">
        <SizableText size="$1" color="$color8" style={{ flexBasis: 180, flexShrink: 0 }}>
          system
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flex: 1, textAlign: 'right' }}>
          % resolved
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
          cost
        </SizableText>
        <SizableText size="$1" color="$color8" style={{ flexBasis: 48, textAlign: 'right', flexShrink: 0 }}>
          calls
        </SizableText>
      </XStack>
      {row(a.stepRouted.label, a.stepRouted, true)}
      {row(a.singleOpus.label, a.singleOpus, false)}
      <Note>{a.note}</Note>
    </YStack>
  );
}

// ── block 4: competitor reported figures (Table 1, not measured by us) ─────────
function EnsoBlock({ data }: { data: EnsoBenchmarks }): React.JSX.Element | null {
  const d = data;
  if (!d.enso.length) return null;
  const cols = Array.from(new Set(d.enso.flatMap((f) => Object.keys(f.scores)))).sort();
  if (!cols.length) return null;
  return (
    <YStack gap="$1.5">
      <Subhead>Competitor reported figures · Table 1 (not measured by us)</Subhead>
      <XStack paddingBottom="$0.5" gap="$2">
        <SizableText size="$1" color="$color8" style={{ flexBasis: 140, flexShrink: 0 }}>
          benchmark
        </SizableText>
        {cols.map((c) => (
          <SizableText key={c} size="$1" color="$color8" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
            {c}
          </SizableText>
        ))}
      </XStack>
      {d.enso.map((f) => (
        <XStack key={f.bench} alignItems="center" gap="$2">
          <SizableText size="$2" color="$color11" style={{ flexBasis: 140, flexShrink: 0 }} numberOfLines={1}>
            {f.bench}
          </SizableText>
          {cols.map((c) => (
            <SizableText key={c} size="$2" color="$color12" style={{ flex: 1, textAlign: 'right' }}>
              {f.scores[c] != null ? f.scores[c]!.toFixed(1) : '—'}
            </SizableText>
          ))}
        </XStack>
      ))}
    </YStack>
  );
}

// ── block 5: honest-framing caveats ───────────────────────────────────────────
function CaveatsBlock({ caveats }: { caveats: string[] }): React.JSX.Element | null {
  if (!caveats.length) return null;
  return (
    <YStack gap="$1">
      <Subhead>Honest framing</Subhead>
      {caveats.map((c, i) => (
        <XStack key={i} gap="$1.5" alignItems="flex-start">
          <SizableText size="$1" color="$color8">
            ·
          </SizableText>
          <SizableText size="$1" color="$color9" style={{ flex: 1 }}>
            {c}
          </SizableText>
        </XStack>
      ))}
    </YStack>
  );
}
