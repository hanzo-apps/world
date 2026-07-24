import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getRouterStats, type RouterStats } from '@/services/router-stats';
import { getCloudModels, type CloudModels } from '@/services/cloud-admin';
import { fmtCompact, fmtPct, fmtAgo } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * EnsoTrainingPanel — the vanilla `EnsoTrainingPanel` (src/components/EnsoTrainingPanel.ts)
 * ported onto the React Panel chassis. A live window into the learned router Hanzo
 * trains on its own routing decisions: platform-wide aggregates (throughput,
 * learned-engine share, a blended-price cost-saved proxy, the latest retrain gate)
 * plus the REAL served-model catalog it trains across.
 *
 * It REUSES the vanilla data layer verbatim — `getRouterStats` + `getCloudModels`
 * fetched independently via `Promise.allSettled` (one down never blanks the other,
 * last-good is held, unavailable payloads are dropped), `fmtCompact` / `fmtPct` /
 * `fmtAgo`, and the vanilla sparkline via <Sparkline>. No data or format logic is
 * re-authored; only the view moves to @hanzo/gui longhand primitives against the
 * chassis, which owns the frame + the loading / empty / error states. Honest: until
 * the first real router payload lands the chassis holds a muted "connecting…" state
 * rather than render zeros.
 */

const HOURS = 24;

/** Normalize a 0..1 fraction OR an already-scaled percent into 0..100 (verbatim
 * from the vanilla panel — engine_share/shadow_agreement arrive as fractions). */
function pctOf(v: number): number {
  return Math.abs(v) <= 1 ? v * 100 : v;
}

/** A gate number: keep precision for sub-1 metrics, trim otherwise (verbatim). */
function fmtGate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2);
}

/** $/M-token price, compact but honest (0 = not priced) (verbatim). */
function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  return v < 10 ? v.toFixed(2) : v.toFixed(0);
}

export function EnsoTrainingPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [stats, setStats] = useState<RouterStats | null>(null);
  const [models, setModels] = useState<CloudModels | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla fetchData: independent allSettled fetches, keep only
    // real payloads (drop `unavailable`), never blank one when the other is down.
    const load = async (): Promise<void> => {
      const [statsRes, modelsRes] = await Promise.allSettled([
        getRouterStats(HOURS),
        getCloudModels(),
      ]);
      if (cancelled) return;
      if (statsRes.status === 'fulfilled' && !statsRes.value.unavailable) {
        setStats(statsRes.value);
      } else if (statsRes.status === 'rejected') {
        console.error('[EnsoTraining] router-stats refresh failed:', statsRes.reason);
      }
      if (modelsRes.status === 'fulfilled' && modelsRes.value && modelsRes.value.models.length) {
        setModels(modelsRes.value);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Until the first real router payload lands, hold the muted connecting state.
  const state: PanelState = stats ? 'ready' : 'loading';

  const spark =
    stats && stats.throughput.per_hour.length >= 2 ? (
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$1" color="$color9">
          {`last ${stats.throughput.per_hour.length}h · ${fmtCompact(stats.throughput.total_window)} total`}
        </SizableText>
        <Sparkline data={stats.throughput.per_hour} width={220} height={30} />
      </XStack>
    ) : undefined;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Enso Live Training"
      state={state}
      loadingText="Connecting to the Enso router…"
      infoTooltip="Hanzo Cloud — the learned router, live. Platform-wide aggregates from the router that continually retrains on its own routing decisions (throughput, learned-engine share, a blended-price cost-saved proxy, the latest retrain gate), plus the REAL model catalog it serves and trains across — real names, tiers, context and pricing from the public /v1/models. No fabricated numbers."
      actions={<PanelLiveDot />}
      sparkline={spark}
    >
      {stats ? <EnsoBody stats={stats} models={models} /> : null}
    </Panel>
  );
}

function EnsoBody({
  stats,
  models,
}: {
  stats: RouterStats;
  models: CloudModels | null;
}): React.JSX.Element {
  const q = stats.quality;
  const shadow =
    q.shadow_agreement === null || q.shadow_agreement === undefined
      ? '—'
      : fmtPct(pctOf(q.shadow_agreement), 0);

  return (
    <YStack gap="$2">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        Learned routing · platform
      </SizableText>

      <XStack gap="$2" flexWrap="wrap">
        <StatTile value={fmtPct(stats.cost.saved_pct, 1)} label="cost saved" sub={`last ${HOURS}h`} />
        <StatTile value={fmtPct(pctOf(q.engine_share), 0)} label="learned-engine share" sub="vs heuristic" />
        <StatTile value={fmtCompact(stats.window.events)} label={`events · ${HOURS}h`} />
      </XStack>

      <SizableText size="$1" color="$color9">
        {`Cumulative saved index ${fmtCompact(stats.cost.cumulative_saved_index)} · blended-price proxy (not billed $)`}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {`Shadow-vs-served agreement: ${shadow}`}
      </SizableText>

      <Subhead>Models served &amp; trained across</Subhead>
      <ModelsSection models={models} />

      <Subhead>Last retrain &amp; gate</Subhead>
      <RetrainLine stats={stats} />
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

function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }): React.JSX.Element {
  return (
    <YStack gap="$0.5" minWidth={92}>
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

function ModelsSection({ models }: { models: CloudModels | null }): React.JSX.Element {
  if (!models || !models.models.length) {
    return (
      <SizableText size="$1" color="$color9">
        Loading the served-model catalog…
      </SizableText>
    );
  }
  const zen = models.zenModels > 0 ? ` · ${fmtCompact(models.zenModels)} Zen` : '';
  return (
    <YStack gap="$1.5">
      <SizableText size="$1" color="$color9">
        {`${fmtCompact(models.totalModels)} models served${zen}`}
      </SizableText>
      <YStack gap="$1">
        {models.models.map((mod) => {
          const parts: string[] = [];
          if (mod.provider) parts.push(mod.provider);
          if (mod.context > 0) parts.push(`${fmtCompact(mod.context)} ctx`);
          const inP = fmtPrice(mod.inPrice);
          const outP = fmtPrice(mod.outPrice);
          if (inP && outP) parts.push(`$${inP} / $${outP} per M`);
          const sub = parts.join(' · ');
          return (
            <YStack key={mod.id} gap="$0.5">
              <XStack alignItems="center" gap="$2">
                <SizableText size="$2" color="$color12">
                  {mod.name}
                </SizableText>
                {mod.tier ? (
                  <SizableText size="$1" color="$color9">
                    {mod.tier}
                  </SizableText>
                ) : null}
              </XStack>
              {sub ? (
                <SizableText size="$1" color="$color8">
                  {sub}
                </SizableText>
              ) : null}
            </YStack>
          );
        })}
      </YStack>
    </YStack>
  );
}

function RetrainLine({ stats }: { stats: RouterStats }): React.JSX.Element {
  const r = stats.retrain;
  if (!r) {
    return (
      <SizableText size="$1" color="$color9">
        Awaiting first retrain — the router is still gathering routing events.
      </SizableText>
    );
  }
  const verdict = r.gate_passed ? 'passed' : 'kept incumbent';
  const note = r.note ? ` · ${r.note}` : '';
  return (
    <SizableText size="$1" color="$color9">
      {`Last retrained ${fmtAgo(r.trained_time)} ago · ${r.version} · gate ${r.gate_kind}:${r.gate_metric} ${fmtGate(r.gate_value)} vs ${fmtGate(r.gate_base)} → ${verdict}${note}`}
    </SizableText>
  );
}
