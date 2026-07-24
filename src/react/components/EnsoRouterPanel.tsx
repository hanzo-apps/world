import { useEffect, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getRouterPreference,
  setRouterPreference,
  type RouterPreference,
} from '@/services/router-preference';
import { getJudgePanel, type JudgePanel } from '@/services/judge-panel';
import { fmtInt, fmtPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * EnsoRouterPanel — the vanilla `EnsoRouterPanel` (src/components/EnsoRouterPanel.ts)
 * ported onto the React Panel chassis. Two sections:
 *
 *   A. the Savings ↔ Quality slider — the org cost/quality bias (0..1) wired to the
 *      org-preference proxy. Reads on load, debounced-saves on change, shows a tiny
 *      "saved" confirmation; when the endpoint isn't live it stays interactive as a
 *      read-only preview with an honest note (never an error).
 *   B. the Mean-Field Judge Panel — a diverse set of judge models each with a
 *      reliability weight, a calibrated mean and n scores seen, plus the published
 *      rank-corr-with-ground-truth benchmark. Honest "warming up" when unavailable.
 *
 * It REUSES the vanilla data layer verbatim — `getRouterPreference` /
 * `setRouterPreference` / `getJudgePanel` (each degrades to an honest empty shape,
 * never throws) and the `fmtInt` / `fmtPct` formatters. No fetch/format logic is
 * re-authored; the HTML view helpers (statTile / shareBar) are re-expressed as
 * @hanzo/gui longhand primitives (as the sibling EnsoTrainingPanel does), and JSX
 * escaping replaces the vanilla `escapeHtml`. The chassis owns the frame + the
 * loading / empty / error states; this file owns only the rows.
 */

const POLL_MS = 30_000;

const COPY =
  'Tune Enso for your product: slide toward Savings to route to the cheapest model ' +
  'that clears your quality bar, or Quality to always pick the best. Enso learns ' +
  'your preferred models over time.';

const INFO =
  "Enso Router — set your org's cost↔quality bias and watch the diverse judge panel " +
  'that scores routing quality. Savings routes to the cheapest model that clears your ' +
  'quality bar; Quality always picks the best. The mean-field judge panel weights each ' +
  'judge by reliability; its consensus tracks ground truth far better than any single ' +
  'judge (published rank-corr benchmark). Preference is org-scoped; the panel aggregate ' +
  'is platform-wide.';

/** Verbatim from the vanilla panel — trivial view helpers, not data logic. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Human label for a bias knob (0 = savings … 1 = quality). */
function biasLabel(b: number): string {
  if (b <= 0.12) return 'max savings';
  if (b < 0.42) return 'savings-leaning';
  if (b <= 0.58) return 'balanced';
  if (b < 0.88) return 'quality-leaning';
  return 'max quality';
}

/** sampleRate may arrive as a 0..1 fraction OR an already-scaled percent → 0..100. */
function ratePct(v: number): number {
  return v > 0 && v <= 1 ? v * 100 : v;
}

type SavedStatus = 'idle' | 'ok' | 'warn';

export function EnsoRouterPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [pref, setPref] = useState<RouterPreference | null>(null);
  const [judge, setJudge] = useState<JudgePanel | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bias, setBias] = useState(0.5);
  const [saved, setSaved] = useState<SavedStatus>('idle');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load: both services degrade to honest empty shapes, so a missing
  // backend yields disabled/warming states rather than an error.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, j] = await Promise.all([getRouterPreference(), getJudgePanel()]);
      if (cancelled) return;
      setPref(p);
      setJudge(j);
      setBias(clamp01(p.bias));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only the judge panel polls — the preference is user-driven, set once.
  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        const j = await getJudgePanel();
        setJudge(j);
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const onSlide = (next: number): void => {
    const b = clamp01(next);
    setBias(b);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const res = await setRouterPreference(b);
        setSaved(res.available ? 'ok' : 'warn');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved('idle'), 1800);
      })();
    }, 450);
  };

  const state: PanelState = loaded ? 'ready' : 'loading';
  const live = judge?.enabled === true;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Enso Router"
      state={state}
      loadingText="Loading Enso router…"
      infoTooltip={INFO}
      actions={live ? <PanelLiveDot /> : undefined}
    >
      {loaded ? (
        <YStack gap="$2.5">
          <XStack alignItems="center" justifyContent="space-between" gap="$2">
            <SizableText
              size="$1"
              color="$color9"
              style={{ textTransform: 'uppercase', letterSpacing: 1 }}
            >
              Enso router · cost ↔ quality
            </SizableText>
            {pref?.available ? (
              <SizableText size="$1" color="$color9">
                org preference
              </SizableText>
            ) : null}
          </XStack>

          <PrefSection
            pref={pref}
            bias={bias}
            saved={saved}
            onSlide={onSlide}
          />

          <JudgeSection judge={judge} />
        </YStack>
      ) : null}
    </Panel>
  );
}

// ── Section A: the Savings ↔ Quality slider ──────────────────────────────────
function PrefSection({
  pref,
  bias,
  saved,
  onSlide,
}: {
  pref: RouterPreference | null;
  bias: number;
  saved: SavedStatus;
  onSlide: (v: number) => void;
}): React.JSX.Element {
  const available = pref?.available === true;
  const note = available
    ? ''
    : "Preview only — the router-preference API isn't deployed yet, so changes won't be saved. The control goes live once the gateway route ships.";

  return (
    <YStack gap="$1.5">
      <Subhead>Cost / quality preference</Subhead>
      <SizableText size="$1" color="$color9">
        {COPY}
      </SizableText>
      <XStack alignItems="center" gap="$2">
        <SizableText size="$1" color="$color9">
          Savings
        </SizableText>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={bias}
          aria-label="Cost versus quality preference"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(bias.toFixed(2))}
          onChange={(e) => onSlide(parseFloat(e.target.value))}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        />
        <SizableText size="$1" color="$color9">
          Quality
        </SizableText>
      </XStack>
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$2" color="$color12">
          {`${biasLabel(bias)} · ${bias.toFixed(2)}`}
        </SizableText>
        {saved !== 'idle' ? (
          <SizableText size="$1" color={saved === 'ok' ? '#22c55e' : '#f59e0b'}>
            {saved === 'ok' ? 'saved' : "couldn't save"}
          </SizableText>
        ) : null}
      </XStack>
      {note ? (
        <SizableText size="$1" color="$color8">
          {note}
        </SizableText>
      ) : null}
    </YStack>
  );
}

// ── Section B: the mean-field judge panel ────────────────────────────────────
function JudgeSection({ judge }: { judge: JudgePanel | null }): React.JSX.Element {
  if (!judge || !judge.available) {
    return (
      <YStack gap="$1">
        <Subhead>Mean-field judge panel</Subhead>
        <SizableText size="$1" color="$color9">
          Judge panel warming up — diverse judges calibrate as traffic is scored.
        </SizableText>
      </YStack>
    );
  }

  const rate = ratePct(judge.sampleRate);
  const count = judge.judges.length || judge.models.length || 0;

  return (
    <YStack gap="$2">
      <Subhead>{`Mean-field judge panel${judge.enabled ? '' : ' · idle'}`}</Subhead>

      <XStack gap="$2" flexWrap="wrap">
        <StatTile value={String(count)} label="diverse judges" sub="consensus panel" />
        <StatTile
          value={rate > 0 ? fmtPct(rate, rate < 10 ? 1 : 0) : '—'}
          label="of traffic scored"
          sub="sample rate"
        />
        <StatTile value={judge.enabled ? 'on' : 'idle'} label="panel scoring" />
      </XStack>

      {judge.judges.length > 0 ? (
        <YStack gap="$1.5">
          <Subhead>Judges · reliability weight</Subhead>
          {judge.judges.map((jd) => {
            const w = clamp01(jd.weight);
            return (
              <YStack key={jd.model} gap="$0.5">
                <XStack alignItems="center" justifyContent="space-between" gap="$2">
                  <SizableText size="$2" color="$color12">
                    {jd.model}
                  </SizableText>
                  <SizableText size="$2" color="$color11">
                    {`${w.toFixed(2)} weight`}
                  </SizableText>
                </XStack>
                <ShareBar fraction={w} />
                <SizableText size="$1" color="$color8">
                  {`calibrated mean ${jd.mean.toFixed(3)} · n=${fmtInt(jd.n)}`}
                </SizableText>
              </YStack>
            );
          })}
        </YStack>
      ) : (
        <SizableText size="$1" color="$color9">
          Diverse judges calibrate as traffic is scored — weights appear as scores
          accumulate.
        </SizableText>
      )}

      {judge.benchmark ? (
        <YStack gap="$1.5">
          <Subhead>Published benchmark · rank-corr w/ ground truth</Subhead>
          <XStack gap="$2" flexWrap="wrap">
            <StatTile value={judge.benchmark.mfjp.toFixed(3)} label="mean-field panel" sub="MFJP" />
            <StatTile value={judge.benchmark.naiveMean.toFixed(3)} label="naive mean" />
            <StatTile value={judge.benchmark.singleNoisy.toFixed(3)} label="single noisy judge" />
            <StatTile value={judge.benchmark.singleAdversary.toFixed(3)} label="single adversary" />
          </XStack>
          <SizableText size="$1" color="$color9">
            {`Mean-Field panel ${judge.benchmark.mfjp.toFixed(3)} vs single-judge ${judge.benchmark.singleAdversary.toFixed(3)} — published rank-corr w/ ground truth.`}
          </SizableText>
        </YStack>
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

function StatTile({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: string;
}): React.JSX.Element {
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

/** The `shareBar()` HTML helper re-expressed as a primitive — a 0..1 fill track. */
function ShareBar({ fraction }: { fraction: number }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <XStack
      height={4}
      borderRadius={999}
      backgroundColor="rgba(255,255,255,0.10)"
      overflow="hidden"
    >
      <XStack width={`${pct.toFixed(1)}%`} backgroundColor="rgba(255,255,255,0.7)" />
    </XStack>
  );
}
