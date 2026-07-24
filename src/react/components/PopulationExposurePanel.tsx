import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { enrichEventsWithExposure, formatPopulation } from '@/services/population-exposure';
import { fetchUcdpEvents } from '@/services/ucdp-events';
import { fetchProtestEvents } from '@/services/protests';
import { t } from '@/services/i18n';
import type { PopulationExposure } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * PopulationExposurePanel — the vanilla `PopulationExposurePanel`
 * (src/components/PopulationExposurePanel.ts) ported onto the React Panel chassis.
 * Estimated population inside each event's impact radius, ranked most-exposed-first,
 * with a total-affected header.
 *
 * It REUSES the vanilla data layer verbatim. The estimate math is NOT re-authored:
 * `enrichEventsWithExposure` (the SAME circuit-broken /v1/world/worldpop-exposure
 * service, which fans out per-event WorldPop density lookups, drops failures and
 * sorts the survivors by exposedPopulation) and `formatPopulation` are imported as-is
 * from @/services/population-exposure. The vanilla base panel is a pure sink fed by
 * App.ts (App.ts:4139-4151): App merges the protest set + the UCDP set into the event
 * list, then enriches it. That upstream merge is the panel's true data source, so the
 * port reproduces it faithfully here — fetch UCDP + protests, take the same first-10
 * slices with the same field mapping, enrich. Protests are fetched defensively (a
 * protest-feed failure must not blank the panel — the vanilla protestsTask degrades to
 * []), matching UcdpEventsPanel. The chassis owns the frame + loading/empty/error
 * states; this file owns only the summary, the rows, and which state to show. Style
 * props are LONGHAND-only per the @hanzo/gui typecheck contract.
 */

// The vanilla --threat-critical / --accent tokens (styles/main.css): critical is red,
// accent is the bright foreground ($color12 on the dark card).
const CRITICAL = '#ef4444';
const POP_MILLION = 1_000_000;
const MAX_CARDS = 30;

// The vanilla event → mapped event shape App.ts feeds enrichEventsWithExposure.
type EventForExposure = { id: string; lat: number; lon: number; type: string; name: string };

export function PopulationExposurePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [exposures, setExposures] = useState<PopulationExposure[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        // Reproduce App.ts:4140-4147 — the protest set (first 10, typed 'conflict')
        // then the UCDP set (first 10, keyed by violence type, actor-pair name) form
        // the event list. Same slices, same field mapping, no re-authoring.
        const [ucdpResult, protestData] = await Promise.all([
          fetchUcdpEvents(),
          fetchProtestEvents().catch(() => null),
        ]);
        if (cancelled) return;

        const events: EventForExposure[] = [
          ...(protestData?.events ?? []).slice(0, 10).map((e) => ({
            id: e.id,
            lat: e.lat,
            lon: e.lon,
            type: 'conflict',
            name: e.title || 'Protest',
          })),
          ...ucdpResult.data.slice(0, 10).map((e) => ({
            id: e.id,
            lat: e.latitude,
            lon: e.longitude,
            type: e.type_of_violence as string,
            name: `${e.side_a} vs ${e.side_b}`,
          })),
        ];

        if (events.length === 0) {
          setExposures([]);
          setState('empty');
          return;
        }

        const enriched = await enrichEventsWithExposure(events);
        if (cancelled) return;
        setExposures(enriched);
        setState(enriched.length === 0 ? 'empty' : 'ready');
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

  const totalAffected = useMemo(
    () => exposures.reduce((sum, e) => sum + e.exposedPopulation, 0),
    [exposures],
  );
  const cards = useMemo(() => exposures.slice(0, MAX_CARDS), [exposures]);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.populationExposure')}
      infoTooltip={t('components.populationExposure.infoTooltip')}
      state={state}
      loadingText={t('common.calculatingExposure')}
      emptyText={t('common.noDataAvailable')}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="$2.5"
          paddingVertical="$2"
          borderRadius="$3"
          borderLeftWidth={3}
          borderColor={CRITICAL}
          backgroundColor="rgba(239,68,68,0.08)"
        >
          <SizableText
            size="$1"
            color="$color9"
            style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            {t('components.populationExposure.totalAffected')}
          </SizableText>
          <SizableText
            size="$5"
            color="$color12"
            style={{ fontVariantNumeric: 'tabular-nums', fontWeight: '700' }}
          >
            {formatPopulation(totalAffected)}
          </SizableText>
        </XStack>

        <YStack>
          {cards.map((e) => (
            <ExposureCard key={e.eventId} exposure={e} />
          ))}
        </YStack>
      </YStack>
    </Panel>
  );
}

function typeIcon(type: string): string {
  switch (type) {
    case 'state-based':
    case 'non-state':
    case 'one-sided':
    case 'conflict':
    case 'battle':
      return '⚔️';
    case 'earthquake':
      return '🌍';
    case 'flood':
      return '🌊';
    case 'fire':
    case 'wildfire':
      return '🔥';
    default:
      return '📍';
  }
}

function ExposureCard({ exposure }: { exposure: PopulationExposure }): React.JSX.Element {
  const large = exposure.exposedPopulation >= POP_MILLION;
  return (
    <YStack
      paddingHorizontal="$2.5"
      paddingVertical="$1.5"
      gap="$1"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <SizableText size="$2" color="$color12" style={{ wordBreak: 'break-word', lineHeight: 17 }}>
        {typeIcon(exposure.eventType)} {exposure.eventName}
      </SizableText>
      <XStack alignItems="center" justifyContent="space-between">
        <SizableText
          size="$1"
          color={large ? '$color12' : CRITICAL}
          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: large ? '700' : '500' }}
        >
          {t('components.populationExposure.affectedCount', {
            count: formatPopulation(exposure.exposedPopulation),
          })}
        </SizableText>
        <SizableText size="$1" color="$color9" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {t('components.populationExposure.radiusKm', { km: String(exposure.exposureRadiusKm) })}
        </SizableText>
      </XStack>
    </YStack>
  );
}
