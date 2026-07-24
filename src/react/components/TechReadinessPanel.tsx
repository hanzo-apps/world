import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { getTechReadinessRankings, type TechReadinessScore } from '@/services/worldbank';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * TechReadinessPanel — the vanilla `TechReadinessPanel` (src/components/TechReadinessPanel.ts)
 * ported onto the React Panel chassis. Shape: fetch.
 *
 * It REUSES the existing data layer VERBATIM — `getTechReadinessRankings` (the same
 * World Bank service the vanilla panel is fed by) and the `t` i18n service. No fetch
 * or scoring logic is re-authored; that all lives in the service. This file owns only
 * the rows and which of the chassis' four states to show. The vanilla `escapeHtml`
 * is dropped by design: React escapes text children, so no HTML string is built.
 *
 * View helpers that were pure presentation in the vanilla panel (flag lookup, score
 * banding colour, component rounding) are re-expressed here as local view code —
 * they were never part of the data layer.
 */

const COUNTRY_FLAGS: Record<string, string> = {
  USA: '🇺🇸', CHN: '🇨🇳', JPN: '🇯🇵', DEU: '🇩🇪', KOR: '🇰🇷',
  GBR: '🇬🇧', IND: '🇮🇳', ISR: '🇮🇱', SGP: '🇸🇬', TWN: '🇹🇼',
  FRA: '🇫🇷', CAN: '🇨🇦', SWE: '🇸🇪', NLD: '🇳🇱', CHE: '🇨🇭',
  FIN: '🇫🇮', IRL: '🇮🇪', AUS: '🇦🇺', BRA: '🇧🇷', IDN: '🇮🇩',
  ESP: '🇪🇸', ITA: '🇮🇹', MEX: '🇲🇽', RUS: '🇷🇺', TUR: '🇹🇷',
  SAU: '🇸🇦', ARE: '🇦🇪', POL: '🇵🇱', THA: '🇹🇭', MYS: '🇲🇾',
  VNM: '🇻🇳', PHL: '🇵🇭', NZL: '🇳🇿', AUT: '🇦🇹', BEL: '🇧🇪',
  DNK: '🇩🇰', NOR: '🇳🇴', PRT: '🇵🇹', CZE: '🇨🇿', ZAF: '🇿🇦',
  NGA: '🇳🇬', KEN: '🇰🇪', EGY: '🇪🇬', ARG: '🇦🇷', CHL: '🇨🇱',
  COL: '🇨🇴', PAK: '🇵🇰', BGD: '🇧🇩', UKR: '🇺🇦', ROU: '🇷🇴',
  EST: '🇪🇪', LVA: '🇱🇻', LTU: '🇱🇹', HUN: '🇭🇺', GRC: '🇬🇷',
  QAT: '🇶🇦', BHR: '🇧🇭', KWT: '🇰🇼', OMN: '🇴🇲', JOR: '🇯🇴',
};

const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours — matches the vanilla poller.

function flagFor(code: string): string {
  return COUNTRY_FLAGS[code] || '🌐';
}

/** Score banding — the vanilla high/medium/low classes, as token colours. */
function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

function formatComponent(value: number | null): string {
  if (value === null) return '—';
  return Math.round(value).toString();
}

export function TechReadinessPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rankings, setRankings] = useState<TechReadinessScore[]>([]);
  const [state, setState] = useState<PanelState>('loading');
  const [lastFetch, setLastFetch] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const data = await getTechReadinessRankings();
        if (cancelled) return;
        setRankings(data);
        setLastFetch(Date.now());
        setState(data.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const top = rankings.slice(0, 25);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.techReadiness')}
      state={state}
      errorText={t('common.failedTechReadiness')}
      emptyText={t('common.noDataAvailable')}
      infoTooltip={t('components.techReadiness.infoTooltip')}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1.5">
        {top.map((country) => (
          <ReadinessRow key={country.country} country={country} />
        ))}
        {lastFetch > 0 ? (
          <XStack justifyContent="space-between" alignItems="center" paddingTop="$2">
            <SizableText size="$1" color="$color9">
              Source: World Bank
            </SizableText>
            <SizableText size="$1" color="$color9">
              Updated: {new Date(lastFetch).toLocaleDateString()}
            </SizableText>
          </XStack>
        ) : null}
      </YStack>
    </Panel>
  );
}

function ReadinessRow({ country }: { country: TechReadinessScore }): React.JSX.Element {
  const color = scoreColor(country.score);
  return (
    <XStack justifyContent="space-between" alignItems="center" gap="$2" paddingVertical="$1">
      <XStack alignItems="center" gap="$2" flex={1}>
        <SizableText size="$1" color="$color9" style={{ minWidth: 32 }}>
          #{country.rank}
        </SizableText>
        <SizableText size="$3">{flagFor(country.country)}</SizableText>
        <YStack flex={1}>
          <SizableText size="$3" color="$color12" numberOfLines={1}>
            {country.countryName}
          </SizableText>
          <XStack gap="$2">
            <SizableText size="$1" color="$color9">
              🌐{formatComponent(country.components.internet)}
            </SizableText>
            <SizableText size="$1" color="$color9">
              📱{formatComponent(country.components.mobile)}
            </SizableText>
            <SizableText size="$1" color="$color9">
              🔬{formatComponent(country.components.rdSpend)}
            </SizableText>
          </XStack>
        </YStack>
      </XStack>
      <SizableText size="$4" color={color} style={{ minWidth: 40, textAlign: 'right' }}>
        {country.score}
      </SizableText>
    </XStack>
  );
}
