import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getEnsoTraining, type EnsoTraining } from '@/services/enso-training';
import { fmtInt, fmtPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * EnsoFlywheelPanel — the vanilla `EnsoFlywheelPanel`
 * (src/components/EnsoFlywheelPanel.ts) ported onto the React Panel chassis. The
 * router's self-improvement loop for the AI variant: the routing-ledger growth +
 * engine-vs-heuristic mix + confidence histogram (live only, needs a service
 * token) folded with the latest enso-bench eval scores (always present).
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same
 * `getEnsoTraining` fetcher (same-origin /v1/world/enso-training) and the same
 * `fmtInt` / `fmtPct` formatters. No fetch/format logic is re-authored; the port
 * is purely the view, expressed in @hanzo/gui longhand primitives against the
 * chassis. The vanilla `statTile()` / `shareBar()` HTML helpers are re-expressed
 * as the <StatTile> / <ShareBar> primitives below (same shape); the chassis owns
 * the frame + the loading / error states.
 *
 * HONEST STATE preserved from the vanilla render(): no data + an error → the
 * error state; no data → loading; when the ledger is unreachable the eval scores
 * still render with a quiet note — never a faked mix. The live dot shows only
 * when the ledger is actually folding (`state === 'live'`).
 */
export function EnsoFlywheelPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<EnsoTraining | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla fetchData: on success set data + clear error; on
    // failure keep last-good data and record the message (drives the error state
    // only while there is still no data at all).
    const load = async (): Promise<void> => {
      try {
        const d = await getEnsoTraining();
        if (cancelled) return;
        setData(d);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'failed');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Vanilla render() gate: no data + error → error; no data → loading; else ready.
  const state: PanelState = !data && error ? 'error' : !data ? 'loading' : 'ready';

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Enso Flywheel"
      state={state}
      loadingText="Loading router telemetry…"
      errorText={error ?? undefined}
      infoTooltip="The Enso router's self-improvement loop. Routing-ledger growth, engine-vs-heuristic mix and a confidence histogram (live only, needs a service token), folded with the latest enso-bench eval scores (always present). When the ledger is unreachable the eval scores still render — never a faked mix."
      actions={data?.state === 'live' ? <PanelLiveDot /> : <XStack />}
      width={460}
    >
      {data ? <FlywheelBody data={data} /> : null}
    </Panel>
  );
}

function FlywheelBody({ data }: { data: EnsoTraining }): React.JSX.Element {
  const l = data.ledger;
  const maxBucket = Math.max(...l.confidence.map((b) => b.count), 1);

  return (
    <YStack gap="$2.5">
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Enso router flywheel
      </SizableText>

      {/* ── ledger: growth + mix + confidence (live only) ── */}
      {l.available ? (
        <YStack gap="$2.5">
          <XStack flexWrap="wrap" gap="$2">
            <StatTile value={fmtInt(l.total)} label="routing decisions" sub={data.window} />
            <StatTile
              value={fmtPct(l.enginePct, 0)}
              label="engine-routed"
              sub={`${fmtInt(l.heuristic)} heuristic`}
            />
            <StatTile
              value={fmtInt(l.rewarded)}
              label="rewarded"
              sub={l.rewarded > 0 ? `avg ${l.avgReward.toFixed(2)}` : undefined}
            />
            <StatTile value={l.avgConfidence.toFixed(2)} label="avg confidence" />
          </XStack>

          <YStack gap="$1.5">
            <Subhead>{`Routing confidence · ${data.window}`}</Subhead>
            <YStack gap="$1">
              {l.confidence.map((b) => (
                <YStack key={b.label} gap="$0.5">
                  <XStack alignItems="center" justifyContent="space-between">
                    <SizableText size="$2" color="$color12">
                      {b.label}
                    </SizableText>
                    <SizableText size="$2" color="$color11" fontFamily="$mono">
                      {fmtInt(b.count)}
                    </SizableText>
                  </XStack>
                  <ShareBar fraction={b.count / maxBucket} />
                </YStack>
              ))}
            </YStack>
          </YStack>
        </YStack>
      ) : (
        <SizableText size="$1" color="$color9">
          Routing telemetry needs a service token — showing eval scores only.
        </SizableText>
      )}

      {/* ── evals: latest enso-bench scores (always present) ── */}
      {data.evals.systems.length > 0 ? (
        <YStack gap="$1.5">
          <XStack alignItems="center" gap="$2">
            <Subhead>{`Eval · ${data.evals.bench}`}</Subhead>
            <SizableText size="$1" color="$color9">
              {data.evals.source === 'live' ? 'live' : 'snapshot'}
            </SizableText>
          </XStack>
          <YStack gap="$1.5">
            {data.evals.systems.map((sysRow) => {
              const isEnso = sysRow.system.includes('enso');
              const sub = `± ${sysRow.stderrPct.toFixed(1)}% · n=${fmtInt(sysRow.n)}${
                sysRow.usdEst > 0 ? ` · $${sysRow.usdEst.toFixed(2)}` : ''
              }`;
              return (
                <YStack key={sysRow.system} gap="$0.5">
                  <XStack alignItems="center" justifyContent="space-between" gap="$2">
                    <XStack alignItems="center" gap="$2" flex={1}>
                      <SizableText size="$2" color="$color12" numberOfLines={1}>
                        {sysRow.system}
                      </SizableText>
                      {isEnso ? (
                        <SizableText size="$1" color="$color9">
                          enso
                        </SizableText>
                      ) : null}
                    </XStack>
                    <SizableText size="$2" color="$color12" fontFamily="$mono">
                      {`${sysRow.accuracyPct.toFixed(1)}%`}
                    </SizableText>
                  </XStack>
                  <ShareBar fraction={sysRow.accuracyPct / 100} />
                  <SizableText size="$1" color="$color9">
                    {sub}
                  </SizableText>
                </YStack>
              );
            })}
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

function Subhead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </SizableText>
  );
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label, optional sub. Matches the other cloud panels. */
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
      minWidth={100}
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

/** A horizontal share bar (0..1) — the primitive-native analogue of the vanilla
 * `shareBar()` HTML helper. Matches LlmUsagePanel's bar. */
function ShareBar({ fraction }: { fraction: number }): React.JSX.Element {
  return (
    <XStack height={6} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
      <XStack
        width={`${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%`}
        backgroundColor="rgba(255,255,255,0.55)"
      />
    </XStack>
  );
}
