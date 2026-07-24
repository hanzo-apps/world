import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  fetchClimateAnomalies,
  getSeverityColor,
  getSeverityIcon,
  formatDelta,
} from '@/services/climate';
import { getCSSColor } from '@/utils';
import { t } from '@/services/i18n';
import type { ClimateAnomaly } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * ClimateAnomalyPanel — the vanilla `ClimateAnomalyPanel`
 * (src/components/ClimateAnomalyPanel.ts) ported onto the React Panel chassis.
 * Shape: table (zone / temp Δ / precip Δ / severity). Temperature and precipitation
 * deviations from the 30-day baseline across ~15 conflict/disaster-prone zones.
 *
 * It REUSES the vanilla data + formatting layer VERBATIM — `fetchClimateAnomalies`
 * (the REAL /v1/world/climate-anomalies service, circuit-broken, which ALSO applies
 * the vanilla dedup transform: dropping every `severity === 'normal'` row), plus the
 * service's own `getSeverityIcon`, `getSeverityColor` and `formatDelta`, and the
 * exact severity ordering (extreme → moderate → normal) the vanilla panel sorts by.
 * No fetch, format, filter or sort logic is re-authored here; cell/badge colours
 * resolve the SAME brand tokens the vanilla CSS classes use, via `getCSSColor`.
 *
 * The chassis owns the frame + loading/empty/error states; this file owns only which
 * state to show and the rows, re-expressed in @hanzo/gui longhand primitives. When
 * the service returns `ok:false` (upstream failure / breaker open) it maps to an
 * honest error state, never fabricated or retained-stale data.
 *
 * View-only port: the vanilla panel's optional row → globe fly-to handler
 * (`setZoneClickHandler`) is a globe interaction, not data, and is omitted.
 */

const SEVERITY_ORDER: Record<string, number> = { extreme: 0, moderate: 1, normal: 2 };

export function ClimateAnomalyPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [anomalies, setAnomalies] = useState<ClimateAnomaly[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchClimateAnomalies();
        if (cancelled) return;
        if (!result.ok) {
          setAnomalies([]);
          setState('error');
          return;
        }
        setAnomalies(result.anomalies);
        setState(result.anomalies.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    // Live surface: refresh on the same cadence spirit as the vanilla poller.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // The vanilla panel's exact sort: extreme first, then moderate, then normal.
  const sorted = useMemo<ClimateAnomaly[]>(
    () =>
      [...anomalies].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2),
      ),
    [anomalies],
  );

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.climate')}
      state={state}
      loadingText={t('common.loadingClimateData')}
      emptyText={t('components.climate.noAnomalies')}
      infoTooltip={t('components.climate.infoTooltip')}
      width={380}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1">
        <XStack alignItems="center" paddingHorizontal="$1" paddingBottom="$1">
          <SizableText size="$1" color="$color9" style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('components.climate.zone')}
          </SizableText>
          <SizableText size="$1" color="$color9" style={{ flexBasis: 64, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('components.climate.temp')}
          </SizableText>
          <SizableText size="$1" color="$color9" style={{ flexBasis: 64, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('components.climate.precip')}
          </SizableText>
          <SizableText size="$1" color="$color9" style={{ flexBasis: 72, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('components.climate.severityLabel')}
          </SizableText>
        </XStack>
        {sorted.map((a) => (
          <ClimateRow key={`${a.zone}:${a.lat},${a.lon}`} anomaly={a} />
        ))}
      </YStack>
    </Panel>
  );
}

/** Cell tint mirrors the vanilla CSS classes, resolving the SAME brand tokens. */
function ClimateRow({ anomaly }: { anomaly: ClimateAnomaly }): React.JSX.Element {
  const tempColor = getCSSColor(anomaly.tempDelta > 0 ? '--semantic-high' : '--semantic-low');
  const precipColor = getCSSColor(anomaly.precipDelta > 0 ? '--semantic-low' : '--threat-high');
  const badgeColor = getSeverityColor(anomaly);
  const extreme = anomaly.severity === 'extreme';

  return (
    <XStack
      alignItems="center"
      paddingVertical="$1.5"
      paddingHorizontal="$1"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
      backgroundColor={extreme ? `${getCSSColor('--semantic-critical')}0d` : 'transparent'}
    >
      <XStack style={{ flex: 1 }} alignItems="center" gap="$1.5">
        <SizableText size="$3">{getSeverityIcon(anomaly)}</SizableText>
        <SizableText size="$2" color="$color12" numberOfLines={1}>
          {anomaly.zone}
        </SizableText>
      </XStack>
      <SizableText size="$2" color={tempColor} style={{ flexBasis: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatDelta(anomaly.tempDelta, '°C')}
      </SizableText>
      <SizableText size="$2" color={precipColor} style={{ flexBasis: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatDelta(anomaly.precipDelta, 'mm')}
      </SizableText>
      <XStack style={{ flexBasis: 72 }} justifyContent="flex-end">
        <XStack paddingHorizontal="$1.5" paddingVertical="$0.5" borderRadius="$2" backgroundColor={`${badgeColor}22`}>
          <SizableText size="$1" color={badgeColor} style={{ letterSpacing: 0.5 }}>
            {t(`components.climate.severity.${anomaly.severity}`)}
          </SizableText>
        </XStack>
      </XStack>
    </XStack>
  );
}
