import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { sanitizeUrl } from '@/utils/sanitize';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * TechEventsPanel — the vanilla `TechEventsPanel`
 * (src/components/TechEventsPanel.ts) ported onto the React Panel chassis.
 * Shape: tabbed (upcoming / conferences / earnings / all). Techmeme-sourced tech
 * calendar: conferences, earnings, IPOs, with dates, locations and map pins.
 *
 * It REUSES the vanilla data layer VERBATIM. This panel has no `@/services/*`
 * module — the vanilla class fetches inline from the REAL `/v1/world/tech-events`
 * endpoint — so the SAME request (`days=180&limit=100`), the SAME `TechEventsResponse`
 * shape, the SAME `getFilteredEvents` window/slice filters and the SAME per-event
 * date derivation are carried over unchanged. `sanitizeUrl` is reused verbatim to
 * guard the event href. No fetch / filter / URL logic is re-authored.
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so titles/locations render as safe text nodes —
 * running the HTML escaper over them would double-escape. URL safety is preserved
 * via `sanitizeUrl`.
 *
 * The chassis owns the frame + loading/empty/error states + the tab bar; this file
 * owns only which state to show and the rows, re-expressed in @hanzo/gui longhand
 * primitives. A failed / unsuccessful fetch maps to an honest error state, an empty
 * filtered list to an honest empty state — never fabricated data.
 *
 * View-only port: the vanilla row → globe pan (`panToLocation`) is a one-line
 * `window` CustomEvent the map already listens for; it is preserved verbatim on the
 * map-pin button since it is the panel's own behaviour, not re-authored data logic.
 */

interface TechEventCoords {
  lat: number;
  lng: number;
  country: string;
  original: string;
  virtual?: boolean;
}

interface TechEvent {
  id: string;
  title: string;
  type: 'conference' | 'earnings' | 'ipo' | 'other';
  location: string | null;
  coords: TechEventCoords | null;
  startDate: string;
  endDate: string;
  url: string | null;
}

interface TechEventsResponse {
  success: boolean;
  count: number;
  conferenceCount: number;
  mappableCount: number;
  lastUpdated: string;
  events: TechEvent[];
  error?: string;
}

type ViewMode = 'upcoming' | 'conferences' | 'earnings' | 'all';

const TABS: readonly PanelTab[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'conferences', label: 'Conferences' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'all', label: 'All' },
];

const TYPE_ICONS: Record<TechEvent['type'], string> = {
  conference: '🎤',
  earnings: '📊',
  ipo: '🔔',
  other: '📌',
};

/** The vanilla `getFilteredEvents` — same windows, same slices, verbatim. */
function getFilteredEvents(events: TechEvent[], viewMode: ViewMode): TechEvent[] {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  switch (viewMode) {
    case 'upcoming':
      return events
        .filter((e) => {
          const start = new Date(e.startDate);
          return start >= now && start <= thirtyDaysFromNow;
        })
        .slice(0, 20);
    case 'conferences':
      return events
        .filter((e) => e.type === 'conference' && new Date(e.startDate) >= now)
        .slice(0, 30);
    case 'earnings':
      return events
        .filter((e) => e.type === 'earnings' && new Date(e.startDate) >= now)
        .slice(0, 30);
    case 'all':
      return events.filter((e) => new Date(e.startDate) >= now).slice(0, 50);
    default:
      return [];
  }
}

/** Dispatch event for the map to handle — the vanilla `panToLocation`, verbatim. */
function panToLocation(lat: number, lng: number): void {
  window.dispatchEvent(new CustomEvent('tech-event-location', { detail: { lat, lng, zoom: 10 } }));
}

export function TechEventsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [events, setEvents] = useState<TechEvent[]>([]);
  const [tab, setTab] = useState<string>('upcoming');
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/tech-events?days=180&limit=100');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: TechEventsResponse = await res.json();
        if (!data.success) throw new Error(data.error || 'Unknown error');
        if (cancelled) return;

        setEvents(data.events);
        setState(data.events.length === 0 ? 'empty' : 'ready');
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

  const viewMode = tab as ViewMode;

  const filteredEvents = useMemo(() => getFilteredEvents(events, viewMode), [events, viewMode]);

  const upcomingConferences = useMemo(
    () => events.filter((e) => e.type === 'conference' && new Date(e.startDate) >= new Date()),
    [events],
  );
  const mappableCount = upcomingConferences.filter((e) => e.coords && !e.coords.virtual).length;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.events')}
      state={state}
      loadingText={t('components.techEvents.loading')}
      emptyText={t('components.techEvents.noEvents')}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      width={380}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$3">
        <XStack flexWrap="wrap" alignItems="center" gap="$3">
          <SizableText size="$2" color="$color11">
            📅 {upcomingConferences.length} conferences
          </SizableText>
          <SizableText size="$2" color="$color11">
            📍 {mappableCount} on map
          </SizableText>
          <a
            href="https://www.techmeme.com/events"
            target="_blank"
            rel="noopener"
            style={{ marginLeft: 'auto', textDecoration: 'none' }}
          >
            <SizableText size="$1" color="$color9">
              Techmeme Events ↗
            </SizableText>
          </a>
        </XStack>

        {filteredEvents.length === 0 ? (
          <SizableText size="$2" color="$color9">
            {t('components.techEvents.noEvents')}
          </SizableText>
        ) : (
          <YStack gap="$1">
            {filteredEvents.map((event) => (
              <TechEventRow key={event.id} event={event} />
            ))}
          </YStack>
        )}
      </YStack>
    </Panel>
  );
}

function TechEventRow({ event }: { event: TechEvent }): React.JSX.Element {
  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  const now = new Date();

  const isToday = startDate.toDateString() === now.toDateString();
  const isSoon = !isToday && startDate <= new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDateStr =
    endDate > startDate && endDate.toDateString() !== startDate.toDateString()
      ? ` - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';

  const month = startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = startDate.getDate();

  const safeEventUrl = sanitizeUrl(event.url || '');
  const showMapPin = event.coords && !event.coords.virtual;

  return (
    <XStack
      alignItems="flex-start"
      gap="$2.5"
      paddingVertical="$1.5"
      paddingHorizontal="$1"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
    >
      {/* Date badge */}
      <YStack alignItems="center" minWidth={40}>
        <SizableText size="$1" color="$color9" style={{ letterSpacing: 0.5 }}>
          {month}
        </SizableText>
        <SizableText size="$5" color="$color12" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {day}
        </SizableText>
        {isToday ? (
          <SizableText size="$1" color="#22c55e" style={{ letterSpacing: 0.5 }}>
            TODAY
          </SizableText>
        ) : isSoon ? (
          <SizableText size="$1" color="#f59e0b" style={{ letterSpacing: 0.5 }}>
            SOON
          </SizableText>
        ) : null}
      </YStack>

      {/* Content */}
      <YStack flex={1} gap="$1">
        <XStack alignItems="center" gap="$1.5">
          <SizableText size="$2">{TYPE_ICONS[event.type]}</SizableText>
          <SizableText size="$3" color="$color12" numberOfLines={2} style={{ flex: 1 }}>
            {event.title}
          </SizableText>
          {safeEventUrl ? (
            <a
              href={safeEventUrl}
              target="_blank"
              rel="noopener"
              aria-label={t('components.techEvents.moreInfo')}
              style={{ textDecoration: 'none' }}
            >
              <SizableText size="$2" color="$color9">
                ↗
              </SizableText>
            </a>
          ) : null}
        </XStack>
        <XStack alignItems="center" gap="$2" flexWrap="wrap">
          <SizableText size="$1" color="$color10" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dateStr}
            {endDateStr}
          </SizableText>
          {event.location ? (
            <SizableText size="$1" color="$color9" numberOfLines={1}>
              {event.location}
            </SizableText>
          ) : null}
          {showMapPin && event.coords ? (
            <XStack
              role="button"
              tabIndex={0}
              cursor="pointer"
              alignItems="center"
              aria-label={t('components.techEvents.showOnMap')}
              hoverStyle={{ opacity: 0.7 }}
              onPress={() => panToLocation(event.coords!.lat, event.coords!.lng)}
            >
              <SizableText size="$1" color="$color9">
                📍
              </SizableText>
            </XStack>
          ) : null}
        </XStack>
      </YStack>
    </XStack>
  );
}
