import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchUcdpEvents } from '@/services/ucdp-events';
import { t } from '@/services/i18n';
import type { UcdpGeoEvent, UcdpEventType } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * UcdpEventsPanel — the vanilla `UcdpEventsPanel` (src/components/UcdpEventsPanel.ts)
 * ported onto the React Panel chassis. UCDP georeferenced conflict events, split by
 * violence type (state-based / non-state / one-sided), newest-first with per-event
 * death estimates.
 *
 * It REUSES the vanilla data layer verbatim — `fetchUcdpEvents` (the SAME
 * circuit-broken /v1/world/ucdp-events service the vanilla surface is fed by, which
 * already degrades to an honest empty payload on upstream failure) and the vanilla
 * i18n copy via `t`. No fetch/format logic is re-authored. The tab set, per-tab
 * counts, the 50-row cap and the total-deaths header are the vanilla renderContent()
 * expressed in @hanzo/gui longhand primitives against the chassis.
 *
 * View-only: the vanilla panel's row-click "fly to lat/lon on the globe" affordance
 * is a globe wiring the PanelGrid slot does not carry, so it is omitted here (same
 * data in, same info shown). The chassis owns the frame + loading/empty/error states
 * + the tab bar; this file owns only which state to show and the rows.
 */

// The vanilla per-type death-count tints (--semantic-critical/high/elevated).
const DEATH_COLOR: Record<UcdpEventType, string> = {
  'state-based': '#ef4444',
  'non-state': '#f97316',
  'one-sided': '#eab308',
};

const MAX_ROWS = 50;

export function UcdpEventsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [events, setEvents] = useState<UcdpGeoEvent[]>([]);
  const [activeTab, setActiveTab] = useState<UcdpEventType>('state-based');
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchUcdpEvents();
        if (cancelled) return;
        setEvents(result.data);
        setState(result.data.length === 0 ? 'empty' : 'ready');
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

  const tabCounts = useMemo(() => {
    const counts: Record<UcdpEventType, number> = {
      'state-based': 0,
      'non-state': 0,
      'one-sided': 0,
    };
    for (const e of events) counts[e.type_of_violence] += 1;
    return counts;
  }, [events]);

  const tabs: readonly PanelTab[] = useMemo(
    () => [
      { key: 'state-based', label: t('components.ucdpEvents.stateBased'), count: tabCounts['state-based'] },
      { key: 'non-state', label: t('components.ucdpEvents.nonState'), count: tabCounts['non-state'] },
      { key: 'one-sided', label: t('components.ucdpEvents.oneSided'), count: tabCounts['one-sided'] },
    ],
    [tabCounts],
  );

  const filtered = useMemo(
    () => events.filter((e) => e.type_of_violence === activeTab),
    [events, activeTab],
  );
  const displayed = filtered.slice(0, MAX_ROWS);
  const totalDeaths = filtered.reduce((sum, e) => sum + e.deaths_best, 0);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.ucdpEvents')}
      infoTooltip={t('components.ucdpEvents.infoTooltip')}
      state={state}
      loadingText={t('common.loadingUcdpEvents')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as UcdpEventType)}
      width={460}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        {totalDeaths > 0 ? (
          <XStack justifyContent="flex-end">
            <SizableText size="$1" color="#ef4444" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: '600' }}>
              {t('components.ucdpEvents.deathsCount', { count: totalDeaths.toLocaleString() })}
            </SizableText>
          </XStack>
        ) : null}

        {displayed.length === 0 ? (
          <SizableText size="$2" color="$color9" paddingVertical="$2">
            {t('common.noEventsInCategory')}
          </SizableText>
        ) : (
          <YStack>
            <XStack
              paddingHorizontal="$1"
              paddingBottom="$1"
              borderBottomWidth={1}
              borderColor="rgba(255,255,255,0.10)"
            >
              <HeaderCell text={t('components.ucdpEvents.country')} flexBasis={90} />
              <HeaderCell text={t('components.ucdpEvents.deaths')} flexBasis={80} textAlign="right" />
              <HeaderCell text={t('components.ucdpEvents.date')} flexBasis={80} />
              <HeaderCell text={t('components.ucdpEvents.actors')} flex={1} />
            </XStack>
            {displayed.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </YStack>
        )}

        {filtered.length > MAX_ROWS ? (
          <SizableText size="$1" color="$color8" paddingTop="$1">
            {t('components.ucdpEvents.moreNotShown', { count: filtered.length - MAX_ROWS })}
          </SizableText>
        ) : null}
      </YStack>
    </Panel>
  );
}

function HeaderCell({
  text,
  flex,
  flexBasis,
  textAlign,
}: {
  text: string;
  flex?: number;
  flexBasis?: number;
  textAlign?: 'left' | 'right';
}): React.JSX.Element {
  return (
    <SizableText
      size="$1"
      color="$color9"
      style={{
        flex,
        flexBasis,
        flexShrink: 0,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: '600',
        textAlign: textAlign ?? 'left',
      }}
    >
      {text}
    </SizableText>
  );
}

function EventRow({ event }: { event: UcdpGeoEvent }): React.JSX.Element {
  return (
    <XStack
      paddingHorizontal="$1"
      paddingVertical="$1.5"
      alignItems="center"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
    >
      <SizableText size="$2" color="$color11" numberOfLines={1} style={{ flexBasis: 90, flexShrink: 0 }}>
        {event.country}
      </SizableText>
      <XStack flexBasis={80} flexShrink={0} justifyContent="flex-end" alignItems="baseline" gap="$1">
        {event.deaths_best > 0 ? (
          <>
            <SizableText
              size="$2"
              color={DEATH_COLOR[event.type_of_violence]}
              style={{ fontVariantNumeric: 'tabular-nums', fontWeight: '600' }}
            >
              {event.deaths_best}
            </SizableText>
            <SizableText size="$1" color="$color8" style={{ fontVariantNumeric: 'tabular-nums' }}>
              ({event.deaths_low}-{event.deaths_high})
            </SizableText>
          </>
        ) : (
          <SizableText size="$2" color="$color8">
            0
          </SizableText>
        )}
      </XStack>
      <SizableText
        size="$1"
        color="$color9"
        numberOfLines={1}
        style={{ flexBasis: 80, flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {event.date_start}
      </SizableText>
      <SizableText size="$1" color="$color10" numberOfLines={1} style={{ flex: 1 }}>
        {event.side_a} vs {event.side_b}
      </SizableText>
    </XStack>
  );
}
