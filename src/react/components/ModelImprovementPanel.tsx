import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getRouterHistory, type RouterHistory } from '@/services/router-history';
import { fmtCompact, fmtInt, fmtPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * ModelImprovementPanel — the vanilla `ModelImprovementPanel`
 * (src/components/ModelImprovementPanel.ts) ported onto the React Panel chassis.
 * The flywheel getting verifiably smarter over time: the public router-history
 * aggregate (/v1/world/cloud/router-history) — a cumulative cost-saved hero
 * (routing vs always-premium), a reward-rate window, the retrain timeline, and a
 * requests/day adoption sparkline.
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same
 * `getRouterHistory` fetcher, the same `fmtCompact` / `fmtInt` / `fmtPct`
 * formatters, and the vanilla `sparkline()` util (via <Sparkline>). No fetch/format
 * logic is re-authored; the port is purely the view, expressed in @hanzo/gui
 * longhand primitives against the chassis. The vanilla `statTile()` HTML helper is
 * re-expressed as the <StatTile> primitive below (same value/label/sub shape). The
 * chassis owns the frame + the loading state.
 *
 * HONEST EMPTY is preserved: until the first payload lands the chassis holds the
 * "Loading flywheel…" state (mirroring the vanilla `if (!this.data)` gate); when the
 * ledger is barely lit the reward window shows the "warming up" note rather than a
 * fabricated climb, and every number is the measured value from the ledger.
 *
 * View-port simplifications (presentation-only, no data changed — see notes): the
 * bespoke reward-rate area chart with per-retrain vertical markers is rendered as
 * the reward-rate series via the shared <Sparkline> (retrain detail is surfaced in
 * the "retrains" tile + the last-spark line instead of SVG ticks), and the hero
 * count-up animation resolves straight to its final measured value.
 */

export function ModelImprovementPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<RouterHistory | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla fetchData: hold last-good, only replace on a real
    // payload (a null fetch — HTTP/network/parse error — never blanks the panel).
    const load = async (): Promise<void> => {
      const d = await getRouterHistory(30);
      if (cancelled) return;
      if (d) setData(d);
    };

    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Vanilla render() gate: no data → the loading ("flywheel warming up") state.
  const state: PanelState = data ? 'ready' : 'loading';

  // Live badge only when the ledger is the exact measured feed (vanilla `live`).
  const live = !!data && !data.unavailable && data.totals.events > 0;

  // Adoption sparkline — requests/day — through the chassis sparkline slot; shown
  // only when a real series exists (>= 2 points), never a flat line over empties.
  const adoption = data?.daily.map((x) => x.events) ?? [];
  const spark =
    adoption.length >= 2 ? (
      <XStack alignItems="center" justifyContent="space-between" gap="$3">
        <SizableText size="$1" color="$color9">
          requests / day · adoption
        </SizableText>
        <Sparkline data={adoption} width={220} height={28} />
      </XStack>
    ) : undefined;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Model Improvement"
      state={state}
      loadingText="Loading flywheel…"
      infoTooltip="Hanzo Cloud — the flywheel getting verifiably smarter over time. Public router-history aggregate: a cumulative cost-saved hero (routing vs always-premium), a reward-rate window with retrain markers, and a requests/day adoption sparkline. Every number is measured from the routing ledger + the append-only retrain log — nothing is seeded."
      actions={live ? <PanelLiveDot /> : <XStack />}
      width={460}
      sparkline={spark}
    >
      {data ? <FlywheelBody data={data} /> : null}
    </Panel>
  );
}

function FlywheelBody({ data }: { data: RouterHistory }): React.JSX.Element {
  const t = data.totals;
  const events = t.events || 0;
  const daysActive = t.days_active || 0;
  const rewardPct = fmtPct((t.reward_rate || 0) * 100, 1);
  const windowDays = data.window.days || 30;
  const latest = data.retrains[data.retrains.length - 1];

  // Reward-rate window (0..1). Honest empty: a warming-up note when there is fewer
  // than two days or no scored reward yet, never an invented climb.
  const rewards = data.daily.map((d) => d.reward_rate);
  const hasSignal = rewards.length >= 2 && rewards.some((r) => r > 0);

  return (
    <YStack gap="$2.5">
      {/* Cost-saved hero — cumulative routing savings vs an always-premium baseline.
          A proportional $/MTok index (the public ledger carries no token counts), so
          it is labeled as an index, not fabricated $. */}
      <YStack gap="$0.5">
        <SizableText size="$9" color="$color12" fontFamily="$mono">
          {fmtCompact(t.cumulative_cost_saved || 0)}
        </SizableText>
        <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          cost saved · routing vs premium
        </SizableText>
      </YStack>

      <XStack flexWrap="wrap" gap="$2">
        <StatTile value={rewardPct} label="reward rate" sub={`${windowDays}d`} />
        <StatTile value={fmtInt(events)} label="requests scored" />
        <StatTile value={fmtInt(daysActive)} label="active days" />
        <StatTile value={fmtInt(data.retrains.length)} label="retrains" />
      </XStack>

      <YStack gap="$1.5">
        <XStack alignItems="center" justifyContent="space-between" gap="$3">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {`reward rate · ${windowDays}d`}
          </SizableText>
          {hasSignal ? <Sparkline data={rewards} width={220} height={30} /> : null}
        </XStack>
        {hasSignal ? null : (
          <SizableText size="$1" color="$color9">
            Flywheel warming up — the reward curve climbs as requests are routed and scored.
          </SizableText>
        )}
      </YStack>

      <RetrainLine latest={latest} />
    </YStack>
  );
}

/** The last-spark line — the vanilla `.fw-retrain-latest`, honest when none logged. */
function RetrainLine({ latest }: { latest: RouterHistory['retrains'][number] | undefined }): React.JSX.Element {
  if (!latest) {
    return (
      <SizableText size="$1" color="$color9">
        No retrain logged yet — the 4:20 spark records each fit here.
      </SizableText>
    );
  }
  const detail =
    latest.holdout_accuracy != null
      ? ` · holdout ${fmtPct(latest.holdout_accuracy * 100, 1)}`
      : latest.gate_metric
        ? ` · ${latest.gate_metric} ${latest.gate_value.toFixed(3)}`
        : '';
  const gate = latest.gate_pass ? 'passed' : 'held incumbent';
  return (
    <SizableText size="$1" color="$color9">
      {`Last spark ${latest.version || '—'}${detail} · gate ${gate}`}
    </SizableText>
  );
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label, optional sub. Matches CloudOverviewPanel's tile. */
function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={128}
      flexGrow={1}
    >
      <SizableText size="$6" color="$color12" fontFamily="$mono">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}
