import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCSSColor } from '@/utils';
import { calculateCII, type CountryScore } from '@/services/country-instability';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * CIIPanel — the vanilla `CIIPanel` (src/components/CIIPanel.ts) ported onto the
 * React Panel chassis. It shows the Country Instability Index: per-country score
 * (0–100), severity level, 24h trend, and the four component sub-scores
 * (Unrest / Conflict / Security / Information).
 *
 * It REUSES the vanilla data layer VERBATIM — `calculateCII()` (the exact scoring
 * engine fed by the ingest* functions in src/services/country-instability.ts) and
 * `getCSSColor` for the `--semantic-*` level palette. No scoring, formatting or
 * level logic is re-authored here; the port is purely the view, expressed in
 * @hanzo/gui longhand primitives against the chassis.
 *
 * The chassis owns the frame + loading/empty/error states; this file owns only
 * which state to show and the rows. View-only: it filters to countries with a
 * signal (`score > 0`) exactly like the vanilla panel, and shows an honest empty
 * state ("No instability signals detected") when none — never fabricated data.
 *
 * Two vanilla behaviours are intentionally omitted as orchestration/interaction,
 * not data: (1) the external `focalPointsReady` gate the vanilla App toggles via
 * `refresh(forceLocal)` — here the panel simply recomputes on its own cadence and
 * renders whatever signals have been ingested; (2) `setShareStoryHandler` / the
 * per-row share button, a globe-story interaction (mirrors DisplacementPanel
 * dropping `setCountryClickHandler`). The vanilla HTML-escaping (`escapeHtml`) is
 * obviated by JSX's automatic escaping, so it is not imported.
 */

function getLevelColor(level: CountryScore['level']): string {
  switch (level) {
    case 'critical': return getCSSColor('--semantic-critical');
    case 'high': return getCSSColor('--semantic-high');
    case 'elevated': return getCSSColor('--semantic-elevated');
    case 'normal': return getCSSColor('--semantic-normal');
    case 'low': return getCSSColor('--semantic-low');
  }
}

function getLevelEmoji(level: CountryScore['level']): string {
  switch (level) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'elevated': return '🟡';
    case 'normal': return '🟢';
    case 'low': return '⚪';
  }
}

export function CIIPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [scores, setScores] = useState<CountryScore[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = (): void => {
      try {
        const withData = calculateCII().filter((s) => s.score > 0);
        if (cancelled) return;
        setScores(withData);
        setState(withData.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    load();
    // Live surface: recompute on the same cadence spirit as the vanilla poller.
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.cii')}
      state={state}
      loadingText={t('common.loading')}
      emptyText="No instability signals detected"
      errorText={t('common.failedCII')}
      infoTooltip={t('components.cii.infoTooltip')}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        {scores.map((c) => (
          <CIIRow key={c.code} country={c} />
        ))}
      </YStack>
    </Panel>
  );
}

function CIIRow({ country }: { country: CountryScore }): React.JSX.Element {
  const color = getLevelColor(country.level);
  const emoji = getLevelEmoji(country.level);
  const trend =
    country.trend === 'rising'
      ? { glyph: `↑${country.change24h > 0 ? country.change24h : ''}`, color: '#ef4444' }
      : country.trend === 'falling'
        ? { glyph: `↓${Math.abs(country.change24h)}`, color: '#22c55e' }
        : { glyph: '→', color: '$color9' };

  return (
    <YStack
      gap="$1.5"
      paddingVertical="$1.5"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
    >
      <XStack alignItems="center" gap="$2">
        <SizableText size="$2">{emoji}</SizableText>
        <SizableText size="$3" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
          {country.name}
        </SizableText>
        <SizableText
          size="$3"
          color="$color12"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {country.score}
        </SizableText>
        <SizableText size="$2" color={trend.color} style={{ minWidth: 28, textAlign: 'right' }}>
          {trend.glyph}
        </SizableText>
      </XStack>

      <XStack
        height={6}
        borderRadius={999}
        backgroundColor="rgba(255,255,255,0.08)"
        overflow="hidden"
      >
        <XStack width={`${country.score}%`} backgroundColor={color} borderRadius={999} />
      </XStack>

      <XStack gap="$3">
        <SizableText size="$1" color="$color9" aria-label={t('common.unrest')}>
          U:{country.components.unrest}
        </SizableText>
        <SizableText size="$1" color="$color9" aria-label={t('common.conflict')}>
          C:{country.components.conflict}
        </SizableText>
        <SizableText size="$1" color="$color9" aria-label={t('common.security')}>
          S:{country.components.security}
        </SizableText>
        <SizableText size="$1" color="$color9" aria-label={t('common.information')}>
          I:{country.components.information}
        </SizableText>
      </XStack>
    </YStack>
  );
}
