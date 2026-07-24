import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  streamAiPulse,
  getAiPulse,
  type AiUsage,
  type AiFleet,
  type AiModel,
} from '@/services/ai-pulse';
import { isAuthenticated } from '@/services/iam';
import { fmtCompact, fmtInt, fmtUsd } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * AiComputePanel — the vanilla `AiComputePanel` (src/components/AiComputePanel.ts)
 * ported onto the React Panel chassis. Hanzo's live inference plane: it consumes the
 * SAME /v1/world/ai-pulse feed via the SAME data layer verbatim — `streamAiPulse`
 * (public SSE) with a `getAiPulse` poll fallback, `isAuthenticated` to gate the
 * org-scoped plane, and the `fmtCompact` / `fmtInt` / `fmtUsd` cloud formatters. No
 * fetch/format logic is re-authored; this file owns only the view.
 *
 * The chassis owns the frame + the loading / empty / error states; the vanilla panel's
 * honest states map straight across:
 *   signed-out gate ("Sign in to see the live inference plane…")  →  state="empty"
 *   signed-in but plane unreachable                               →  state="error"
 *   connecting, no data yet                                       →  state="loading"
 *   usage/fleet in hand                                           →  state="ready"
 * The rolling rate buffer drives the header sparkline slot (shape=markets); tiles,
 * top-model rows and the share bar are re-expressed in @hanzo/gui longhand primitives.
 * Never a zero dressed up as live traffic — same honesty contract as the vanilla panel.
 */

const BUF = 60;
const POLL_MS = 15_000;

const GATE_COPY =
  'Sign in to see the live inference plane — tokens/sec, requests, spend and GPUs, metered to your org.';

export function AiComputePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [fleet, setFleet] = useState<AiFleet | null>(null);
  const [conn, setConn] = useState<'connecting' | 'live' | 'unavailable'>('connecting');
  const [reason, setReason] = useState<string | undefined>();
  const [buffer, setBuffer] = useState<number[]>([]);

  // Evaluated once per mount, exactly as the vanilla `connect()` branches on it.
  const authed = isAuthenticated();

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // Mirrors the vanilla `!this.usage && !this.fleet` guard in the poll catch.
    let haveData = false;

    const push = (rps: number): void => {
      if (cancelled) return;
      setBuffer((b) => {
        const next = [...b, rps];
        return next.length > BUF ? next.slice(next.length - BUF) : next;
      });
    };

    // Signed in → the AUTHED poll (bearer via getAiPulse; EventSource can't carry it),
    // so an admin sees the full real compute pulse. Also the SSE-error fallback.
    const startPolling = (): void => {
      stop?.();
      stop = null;
      if (pollTimer) return;
      const tick = async (): Promise<void> => {
        try {
          const p = await getAiPulse();
          if (cancelled) return;
          setConn(p.state === 'live' ? 'live' : 'unavailable');
          setReason(p.reason);
          if (p.usage) {
            setUsage(p.usage);
            haveData = true;
            push(p.usage.requestsPerSec);
          }
          if (p.fleet) {
            setFleet(p.fleet);
            haveData = true;
          }
        } catch {
          if (cancelled) return;
          if (!haveData) {
            setConn('unavailable');
            setReason('telemetry unreachable');
          }
        }
      };
      void tick();
      pollTimer = setInterval(() => void tick(), POLL_MS);
    };

    if (authed) {
      startPolling();
    } else {
      // Signed out → the public SSE stream; a stream error drops to the poll snapshot.
      stop = streamAiPulse({
        onUsage: (u) => {
          if (cancelled) return;
          setUsage(u);
          haveData = true;
          push(u.requestsPerSec);
          setConn('live');
          setReason(undefined);
        },
        onFleet: (f) => {
          if (cancelled) return;
          setFleet(f);
          haveData = true;
        },
        onStatus: (state, r) => {
          if (cancelled) return;
          setConn((prev) =>
            state === 'live' ? 'live' : state === 'unavailable' ? 'unavailable' : prev,
          );
          if (state === 'unavailable') setReason(r);
        },
        onError: () => startPolling(),
      });
    }

    return () => {
      cancelled = true;
      stop?.();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [authed]);

  // ── state mapping (the vanilla render()'s honest gates) ────────────────────
  const hasData = !!usage || !!fleet;
  let state: PanelState = 'ready';
  let emptyText: string | undefined;
  let errorText: string | undefined;
  let loadingText: string | undefined;

  if (!authed) {
    // The inference plane is ORG-scoped: signed out can only ever be a zero-stub, so
    // gate honestly rather than paint a live grid of zeros (regardless of any stub).
    state = 'empty';
    emptyText = GATE_COPY;
  } else if (!hasData) {
    if (conn === 'unavailable') {
      state = 'error';
      errorText = reason || 'The inference plane is not reachable right now.';
    } else {
      state = 'loading';
      loadingText = 'Connecting…';
    }
  }

  // Live dot only when truly live (no jewelry when degraded); empty fragment otherwise.
  const live = state === 'ready' && conn === 'live';

  const win = usage?.window || '24h';
  const tiles: Array<{ value: string; label: string }> = [];
  if (usage) {
    tiles.push({ value: fmtCompact(usage.tokensPerSec), label: 'tokens / sec' });
    tiles.push({ value: fmtCompact(usage.requestsPerSec), label: 'requests / sec' });
    tiles.push({ value: fmtCompact(usage.tokens24h), label: `tokens / ${win}` });
    tiles.push({ value: fmtCompact(usage.requests24h), label: `requests / ${win}` });
    tiles.push({ value: fmtUsd(usage.spendCents), label: `spend / ${win}` });
  }
  if (fleet) {
    tiles.push({ value: fmtInt(fleet.gpus), label: 'GPUs' });
    tiles.push({
      value: `${fmtInt(fleet.machinesOnline)}/${fmtInt(fleet.machines)}`,
      label: 'machines online',
    });
    tiles.push({ value: fmtInt(fleet.modelsServed), label: 'models served' });
  }

  const models = (usage?.models ?? []).slice(0, 6);
  const maxReq = Math.max(...models.map((m) => m.requests24h), 1);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="AI Compute"
      state={state}
      emptyText={emptyText}
      errorText={errorText}
      loadingText={loadingText}
      actions={live ? <PanelLiveDot /> : <></>}
      sparkline={
        state === 'ready' && buffer.length >= 2 ? (
          <Sparkline data={buffer} width={240} height={32} />
        ) : undefined
      }
    >
      <YStack gap="$2.5">
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Hanzo inference plane{win ? ` · ${win}` : ''}
        </SizableText>

        <XStack flexWrap="wrap" gap="$1">
          {tiles.map((tile) => (
            <StatTile key={tile.label} value={tile.value} label={tile.label} />
          ))}
        </XStack>

        {models.length > 0 ? (
          <YStack gap="$1.5">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Top models
            </SizableText>
            {models.map((m) => (
              <ModelRow key={m.id || m.name} model={m} maxReq={maxReq} />
            ))}
          </YStack>
        ) : null}
      </YStack>
    </Panel>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of the vanilla `statTile()` HTML. */
function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <YStack minWidth={96} paddingVertical="$1.5" paddingHorizontal="$2" gap="$1">
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
    </YStack>
  );
}

/** A top-model row — name + requests, share bar (vanilla `shareBar()`), token sub. */
function ModelRow({ model, maxReq }: { model: AiModel; maxReq: number }): React.JSX.Element {
  const frac = Math.max(0, Math.min(1, model.requests24h / maxReq));
  return (
    <YStack gap="$1" paddingVertical="$1">
      <XStack justifyContent="space-between" alignItems="baseline" gap="$2">
        <SizableText size="$2" color="$color12" numberOfLines={1} flex={1}>
          {model.name}
        </SizableText>
        <XStack alignItems="baseline" gap="$1">
          <SizableText size="$2" color="$color11">
            {fmtCompact(model.requests24h)}
          </SizableText>
          <SizableText size="$1" color="$color9">
            req
          </SizableText>
        </XStack>
      </XStack>
      <XStack
        height={4}
        borderRadius={999}
        backgroundColor="rgba(255,255,255,0.08)"
        overflow="hidden"
      >
        <XStack width={`${(frac * 100).toFixed(1)}%`} backgroundColor="rgba(255,255,255,0.55)" />
      </XStack>
      <SizableText size="$1" color="$color9">
        {fmtCompact(model.tokens24h)} tokens · {(model.share * 100).toFixed(0)}% share
      </SizableText>
    </YStack>
  );
}
