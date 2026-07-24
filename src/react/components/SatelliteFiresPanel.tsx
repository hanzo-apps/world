import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchAllFires, computeRegionStats, type FireRegionStats } from '@/services/firms-satellite';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * SatelliteFiresPanel — the vanilla `SatelliteFiresPanel` (src/components/SatelliteFiresPanel.ts)
 * ported onto the React Panel chassis. NASA FIRMS VIIRS thermal detections aggregated per
 * monitored conflict region: fire count, high-intensity count, and total Fire Radiative
 * Power, with a totals footer and a "last updated" stamp.
 *
 * It REUSES the vanilla data layer VERBATIM — `fetchAllFires` (the SAME
 * /v1/world/firms-fires service the vanilla surface is fed by, which already degrades to
 * an honest empty payload and surfaces `skipped` when NASA_FIRMS_API_KEY is unset) and
 * `computeRegionStats` (the SAME region aggregation + fireCount sort). No fetch/aggregation
 * logic is re-authored; the FRP formatter and the `timeSince` helper are carried over
 * verbatim from the vanilla panel. The table, the totals row and the source/updated footer
 * are the vanilla render() expressed in @hanzo/gui longhand primitives against the chassis.
 *
 * The chassis owns the frame + the honest loading / empty / error states; this file maps
 * them to the vanilla behaviour — skipped ⇒ empty (config hint, as App.ts showConfigError),
 * zero fires ⇒ empty, an upstream throw ⇒ error, otherwise the region table.
 */

// The vanilla --threat-high / --threat-critical tints for high-intensity regions, and the
// monochrome --accent for the totals row (world.hanzo.ai accent = #fff).
const THREAT_HIGH = '#f97316';
const THREAT_CRITICAL = '#ef4444';
const ACCENT = '#fff';

// FRP formatter — carried over verbatim from the vanilla panel (k-suffix above 1000 MW).
function formatFrp(frp: number): string {
  return frp >= 1000 ? `${(frp / 1000).toFixed(1)}k` : Math.round(frp).toLocaleString();
}

// timeSince — carried over verbatim from the vanilla panel (i18n copy unchanged).
function timeSince(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return t('components.satelliteFires.time.justNow');
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t('components.satelliteFires.time.minutesAgo', { count: String(mins) });
  const hrs = Math.floor(mins / 60);
  return t('components.satelliteFires.time.hoursAgo', { count: String(hrs) });
}

export function SatelliteFiresPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [stats, setStats] = useState<FireRegionStats[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchAllFires(1);
        if (cancelled) return;
        // NASA_FIRMS_API_KEY not configured — the vanilla App.ts surfaces this via
        // showConfigError; here it is an honest empty state with the same hint.
        if (result.skipped) {
          setStats([]);
          setTotalCount(0);
          setEmptyText(result.reason ?? 'NASA_FIRMS_API_KEY not configured — add in Settings');
          setState('empty');
          return;
        }
        const nextStats = result.totalCount > 0 ? computeRegionStats(result.regions) : [];
        setStats(nextStats);
        setTotalCount(result.totalCount);
        setLastUpdated(new Date());
        if (nextStats.length === 0) {
          setEmptyText(undefined);
          setState('empty');
        } else {
          setState('ready');
        }
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

  const totalFrp = useMemo(() => stats.reduce((sum, s) => sum + s.totalFrp, 0), [stats]);
  const totalHigh = useMemo(() => stats.reduce((sum, s) => sum + s.highIntensityCount, 0), [stats]);
  const ago = lastUpdated ? timeSince(lastUpdated) : t('components.satelliteFires.never');

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.satelliteFires')}
      infoTooltip={t('components.satelliteFires.infoTooltip')}
      state={state}
      loadingText={t('common.scanningThermalData')}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        <YStack>
          <XStack
            paddingHorizontal="$1"
            paddingBottom="$1"
            borderBottomWidth={1}
            borderColor="rgba(255,255,255,0.10)"
          >
            <HeaderCell text={t('components.satelliteFires.region')} flex={1} />
            <HeaderCell text={t('components.satelliteFires.fires')} flexBasis={56} textAlign="right" />
            <HeaderCell text={t('components.satelliteFires.high')} flexBasis={48} textAlign="right" />
            <HeaderCell text="FRP" flexBasis={64} textAlign="right" />
          </XStack>

          {stats.map((s) => (
            <FireRow key={s.region} stat={s} />
          ))}

          <XStack
            paddingHorizontal="$1"
            paddingVertical="$1.5"
            alignItems="center"
            borderTopWidth={1}
            borderColor="rgba(255,255,255,0.16)"
          >
            <NumCell text={t('components.satelliteFires.total')} flex={1} color={ACCENT} align="left" bold />
            <NumCell text={String(totalCount)} flexBasis={56} color={ACCENT} bold />
            <NumCell text={String(totalHigh)} flexBasis={48} color={ACCENT} bold />
            <NumCell text={formatFrp(totalFrp)} flexBasis={64} color={ACCENT} bold />
          </XStack>
        </YStack>

        <XStack justifyContent="space-between" paddingTop="$1">
          <SizableText size="$1" color="$color8">
            NASA FIRMS (VIIRS SNPP)
          </SizableText>
          <SizableText size="$1" color="$color8">
            {ago}
          </SizableText>
        </XStack>
      </YStack>
    </Panel>
  );
}

function FireRow({ stat }: { stat: FireRegionStats }): React.JSX.Element {
  const high = stat.highIntensityCount > 0;
  return (
    <XStack
      paddingHorizontal="$1"
      paddingVertical="$1.5"
      alignItems="center"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
    >
      <SizableText
        size="$2"
        color={high ? THREAT_HIGH : '$color11'}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {stat.region}
      </SizableText>
      <NumCell text={String(stat.fireCount)} flexBasis={56} color="$color11" />
      <NumCell
        text={String(stat.highIntensityCount)}
        flexBasis={48}
        color={high ? THREAT_CRITICAL : '$color9'}
        bold={high}
      />
      <NumCell text={formatFrp(stat.totalFrp)} flexBasis={64} color="$color11" />
    </XStack>
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

function NumCell({
  text,
  flex,
  flexBasis,
  color,
  align = 'right',
  bold,
}: {
  text: string;
  flex?: number;
  flexBasis?: number;
  color: string;
  align?: 'left' | 'right';
  bold?: boolean;
}): React.JSX.Element {
  return (
    <SizableText
      size="$2"
      color={color}
      numberOfLines={1}
      style={{
        flex,
        flexBasis,
        flexShrink: 0,
        textAlign: align,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: bold ? '600' : '400',
      }}
    >
      {text}
    </SizableText>
  );
}
