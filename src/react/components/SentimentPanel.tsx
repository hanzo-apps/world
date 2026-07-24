import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * SentimentPanel — the vanilla `SentimentPanel` (src/components/SentimentPanel.ts)
 * ported onto the React Panel chassis. Realtime news-sentiment index from GDELT
 * global article tone: a global gauge, per-topic readings and per-region bars,
 * all on the 0-100 sentiment scale with 24h sparklines and velocity.
 *
 * REUSES the vanilla panel's data layer VERBATIM — the same raw `/v1/world/sentiment`
 * poll the vanilla panel is fed by (the panel has no `@/services/*` fetcher; the fetch
 * IS its data layer), on the same ~2-min cadence, plus the vanilla `sparkline()` util
 * via <Sparkline>. No fetch/format logic is re-authored; this file owns only the rows
 * and which chassis state to show. The chassis owns the frame + loading/empty/error.
 * The `escapeHtml` the vanilla panel needs for string interpolation is unnecessary
 * here — React escapes text nodes — so labels are rendered as plain children.
 */

// Payload shapes, verbatim from the vanilla panel.
interface Reading {
  tone: number | null;
  index: number | null;
  label: string;
  velocity: number | null;
  sparkline: number[];
}

interface Region extends Reading {
  code: string;
  name: string;
}

interface SentimentData {
  timestamp: string;
  status?: string;
  global: Reading;
  topics: Record<string, Reading>;
  regions: Region[];
  coverage?: { queried: number; resolved: number };
}

// Same topic set + labels the vanilla panel renders.
const TOPIC_LABELS: Record<string, string> = {
  markets: 'Markets',
  conflict: 'Conflict',
  energy: 'Energy',
  tech: 'Tech',
};

const INFO_TOOLTIP =
  'Realtime news-sentiment index from GDELT global article tone. Index = clamp(50 + tone·5, 0-100): 50 neutral, higher = more positive coverage. Velocity is the recent tone change. Updates ~2 min.';

// Sentiment tint — the primitive-native analogue of the vanilla .sent-* CSS classes.
// Same threshold ladder as the vanilla `sentClass()`; expressed as paint tokens.
function sentColor(index: number | null): string {
  if (index === null) return '$color9'; // unknown → dim
  if (index >= 60) return '#22c55e'; // positive
  if (index >= 53) return '#84cc16'; // mild
  if (index > 47) return '$color11'; // neutral
  if (index >= 40) return '#f59e0b'; // cautious
  return '#ef4444'; // negative
}

/** Velocity chip — the ▲/▼ arrow + magnitude, the analogue of the vanilla `velArrow`. */
function Velocity({ v }: { v: number | null }): React.JSX.Element {
  if (v === null || Math.abs(v) < 0.05) {
    return (
      <SizableText size="$1" color="$color9">
        ±0.0
      </SizableText>
    );
  }
  const up = v > 0;
  return (
    <SizableText size="$1" color={up ? '#22c55e' : '#ef4444'}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(2)}
    </SizableText>
  );
}

/** Sentiment label pill — the .sent-pill analogue. */
function Pill({ label, index }: { label: string; index: number | null }): React.JSX.Element {
  return (
    <XStack
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius="$2"
      backgroundColor="rgba(255,255,255,0.06)"
    >
      <SizableText size="$1" color={sentColor(index)}>
        {label}
      </SizableText>
    </XStack>
  );
}

export function SentimentPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<SentimentData | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // Vanilla `fetchData()`, verbatim — the panel's own data layer.
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/sentiment');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SentimentData = await res.json();
        if (cancelled) return;
        setData(json);
        setErrorText(undefined);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : t('common.noDataShort'));
        setState('error');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 2 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const g = data?.global;
  const warming = data?.status === 'warming' || g?.index == null;

  const topics = data
    ? Object.keys(TOPIC_LABELS)
        .map((k) => ({ key: k, label: TOPIC_LABELS[k] ?? k, r: data.topics?.[k] }))
        .filter((x): x is { key: string; label: string; r: Reading } => !!x.r)
    : [];

  const regions = data
    ? data.regions
        .slice()
        .sort((a, b) => (b.index ?? -1) - (a.index ?? -1))
    : [];

  const cov = data?.coverage
    ? `${data.coverage.resolved}/${data.coverage.queried} sources`
    : '';
  const footText =
    (warming ? 'Computing — GDELT paced fetch in progress' : 'GDELT tone · 24h') +
    (cov ? ` · ${cov}` : '');

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.sentiment')}
      state={state}
      errorText={errorText}
      infoTooltip={INFO_TOOLTIP}
      actions={warming ? null : <PanelLiveDot />}
      sparkline={
        g && g.sparkline.length >= 2 ? (
          <SizableText color={sentColor(g.index)} style={{ lineHeight: 0 }}>
            <Sparkline data={g.sparkline} width={160} height={34} />
          </SizableText>
        ) : null
      }
    >
      {g ? (
        <YStack gap="$3">
          {/* Global gauge — big index value + label pill + velocity. */}
          <YStack gap="$1">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Global news sentiment
            </SizableText>
            <XStack alignItems="baseline" gap="$2.5">
              <SizableText size="$9" color={sentColor(g.index)}>
                {g.index === null ? '—' : String(g.index)}
              </SizableText>
              <Pill label={g.label} index={g.index} />
              <Velocity v={g.velocity} />
            </XStack>
          </YStack>

          {/* Topics */}
          <YStack gap="$1.5">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Topics
            </SizableText>
            {topics.length ? (
              topics.map(({ key, label, r }) => (
                <XStack key={key} justifyContent="space-between" alignItems="center" paddingVertical="$0.5">
                  <XStack gap="$2" alignItems="baseline">
                    <SizableText size="$3" color="$color12">
                      {label}
                    </SizableText>
                    <Pill label={r.label} index={r.index} />
                  </XStack>
                  <XStack gap="$2.5" alignItems="center">
                    <SizableText color={sentColor(r.index)} style={{ lineHeight: 0 }}>
                      <Sparkline data={r.sparkline} width={90} height={20} />
                    </SizableText>
                    <SizableText size="$3" color={sentColor(r.index)} style={{ minWidth: 28, textAlign: 'right' }}>
                      {r.index === null ? '—' : String(r.index)}
                    </SizableText>
                    <Velocity v={r.velocity} />
                  </XStack>
                </XStack>
              ))
            ) : (
              <SizableText size="$2" color="$color9">
                warming…
              </SizableText>
            )}
          </YStack>

          {/* Regions — horizontal index bars. */}
          <YStack gap="$1.5">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Regions
            </SizableText>
            {regions.length ? (
              regions.map((r) => {
                const pct = r.index === null ? 0 : Math.max(0, Math.min(100, r.index));
                return (
                  <XStack key={r.code} alignItems="center" gap="$2" paddingVertical="$0.5">
                    <SizableText size="$2" color="$color11" style={{ minWidth: 96 }} numberOfLines={1}>
                      {r.name}
                    </SizableText>
                    <XStack flex={1} height={6} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
                      <XStack width={`${pct}%`} height="100%" backgroundColor={sentColor(r.index)} />
                    </XStack>
                    <SizableText size="$2" color={sentColor(r.index)} style={{ minWidth: 28, textAlign: 'right' }}>
                      {r.index === null ? '—' : String(r.index)}
                    </SizableText>
                  </XStack>
                );
              })
            ) : (
              <SizableText size="$2" color="$color9">
                warming…
              </SizableText>
            )}
          </YStack>

          <SizableText size="$1" color="$color9">
            {footText}
          </SizableText>
        </YStack>
      ) : null}
    </Panel>
  );
}
