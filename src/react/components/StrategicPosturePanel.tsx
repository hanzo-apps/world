import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { fetchMilitaryVessels, isMilitaryVesselTrackingConfigured } from '@/services/military-vessels';
import { recalcPostureWithVessels, type TheaterPostureSummary } from '@/services/military-surge';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * StrategicPosturePanel — the vanilla `StrategicPosturePanel`
 * (src/components/StrategicPosturePanel.ts) ported onto the React Panel chassis.
 *
 * It REUSES the vanilla data layer verbatim: `fetchCachedTheaterPosture` (server
 * theater aircraft posture), `fetchMilitaryVessels` +
 * `isMilitaryVesselTrackingConfigured` (client-side AIS augmentation), and
 * `recalcPostureWithVessels` (the ONE posture-level recompute). No fetch or scoring
 * logic is re-authored — the effect mirrors the vanilla `fetchAndRender` /
 * `augmentWithVessels` flow exactly (clone cached postures, merge live vessels by
 * theater bounds, recompute levels), and the file owns only the view: which chassis
 * state to show and how each theater row is expressed in @hanzo/gui primitives.
 *
 * View-only: same data in, same info shown. The vanilla loading radar, the staged
 * 30/60/90/120s re-augment timers, the localStorage vessel-count cache, and the
 * click-to-fly-map handler are loading-UX / host-integration embellishments, not
 * displayed data; they collapse to the chassis loading state plus a single augment
 * on the 5-minute refresh cadence. Empty/error are honest (no fabricated theaters).
 */
const CRIT = '#ef4444';
const ELEV = '#f59e0b';
const NORM = '#22c55e';

function levelColor(level: TheaterPostureSummary['postureLevel']): string {
  return level === 'critical' ? CRIT : level === 'elevated' ? ELEV : NORM;
}

function postureRank(level: TheaterPostureSummary['postureLevel']): number {
  return level === 'critical' ? 0 : level === 'elevated' ? 1 : 2;
}

export function StrategicPosturePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [postures, setPostures] = useState<TheaterPostureSummary[]>([]);
  const [state, setState] = useState<PanelState>('loading');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla augmentWithVessels: merge live military vessels into the
    // cloned postures by theater bounds, then recompute posture levels. Mutates in
    // place exactly as the vanilla panel does.
    const augmentWithVessels = async (list: TheaterPostureSummary[]): Promise<void> => {
      if (!isMilitaryVesselTrackingConfigured()) return;
      try {
        const { vessels } = await fetchMilitaryVessels();
        if (vessels.length === 0) {
          recalcPostureWithVessels(list);
          return;
        }
        for (const posture of list) {
          if (!posture.bounds) continue;
          const b = posture.bounds;
          const theaterVessels = vessels.filter(
            (v) => v.lat >= b.south && v.lat <= b.north && v.lon >= b.west && v.lon <= b.east,
          );
          posture.destroyers = theaterVessels.filter((v) => v.vesselType === 'destroyer').length;
          posture.frigates = theaterVessels.filter((v) => v.vesselType === 'frigate').length;
          posture.carriers = theaterVessels.filter((v) => v.vesselType === 'carrier').length;
          posture.submarines = theaterVessels.filter((v) => v.vesselType === 'submarine').length;
          posture.patrol = theaterVessels.filter((v) => v.vesselType === 'patrol').length;
          posture.auxiliaryVessels = theaterVessels.filter(
            (v) =>
              v.vesselType === 'auxiliary' ||
              v.vesselType === 'special' ||
              v.vesselType === 'amphibious' ||
              v.vesselType === 'icebreaker' ||
              v.vesselType === 'research' ||
              v.vesselType === 'unknown',
          ).length;
          posture.totalVessels = theaterVessels.length;
          for (const v of theaterVessels) {
            const op = v.operator || 'unknown';
            posture.byOperator[op] = (posture.byOperator[op] || 0) + 1;
          }
        }
        recalcPostureWithVessels(list);
      } catch {
        recalcPostureWithVessels(list);
      }
    };

    const load = async (): Promise<void> => {
      try {
        const data = await fetchCachedTheaterPosture();
        if (cancelled) return;
        if (!data || data.postures.length === 0) {
          setState('empty');
          return;
        }
        // Deep clone to avoid mutating cached data (vanilla parity).
        const list = data.postures.map((p) => ({ ...p, byOperator: { ...p.byOperator } }));
        await augmentWithVessels(list);
        if (cancelled) return;
        setPostures(list);
        setStale(data.stale || false);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    // Same cadence spirit as the vanilla 5-minute auto-refresh.
    const id = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const sorted = [...postures].sort((a, b) => postureRank(a.postureLevel) - postureRank(b.postureLevel));

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.strategicPosture')}
      state={state}
      infoTooltip={t('components.strategicPosture.infoTooltip')}
      emptyText={t('components.strategicPosture.title') /* honest: theaters acquiring data */}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        {stale ? (
          <SizableText size="$1" color={ELEV}>
            ⚠️ Using cached data — live feed temporarily unavailable
          </SizableText>
        ) : null}
        {sorted.map((p) => (
          <TheaterRow key={p.theaterId} p={p} />
        ))}
      </YStack>
    </Panel>
  );
}

function Badge({ level }: { level: TheaterPostureSummary['postureLevel'] }): React.JSX.Element {
  const label = level === 'critical' ? 'CRIT' : level === 'elevated' ? 'ELEV' : 'NORM';
  const color = levelColor(level);
  return (
    <XStack
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius="$2"
      borderWidth={1}
      borderColor={color}
    >
      <SizableText size="$1" color={color} style={{ letterSpacing: 1 }}>
        {label}
      </SizableText>
    </XStack>
  );
}

function Chip({ text }: { text: string }): React.JSX.Element {
  return (
    <XStack
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius="$2"
      backgroundColor="rgba(255,255,255,0.06)"
    >
      <SizableText size="$1" color="$color11">
        {text}
      </SizableText>
    </XStack>
  );
}

/** Air/naval breakdown chips for an expanded (elevated/critical) theater. */
function forceChips(p: TheaterPostureSummary): { air: string[]; naval: string[] } {
  const air: string[] = [];
  if (p.fighters > 0) air.push(`✈️ ${p.fighters}`);
  if (p.tankers > 0) air.push(`⛽ ${p.tankers}`);
  if (p.awacs > 0) air.push(`📡 ${p.awacs}`);
  if (p.reconnaissance > 0) air.push(`🔍 ${p.reconnaissance}`);
  if (p.transport > 0) air.push(`📦 ${p.transport}`);
  if (p.bombers > 0) air.push(`💣 ${p.bombers}`);
  if (p.drones > 0) air.push(`🛸 ${p.drones}`);
  if (air.length === 0 && p.totalAircraft > 0) air.push(`✈️ ${p.totalAircraft}`);

  const naval: string[] = [];
  if (p.carriers > 0) naval.push(`🚢 ${p.carriers}`);
  if (p.destroyers > 0) naval.push(`⚓ ${p.destroyers}`);
  if (p.frigates > 0) naval.push(`🛥️ ${p.frigates}`);
  if (p.submarines > 0) naval.push(`🦈 ${p.submarines}`);
  if (p.patrol > 0) naval.push(`🚤 ${p.patrol}`);
  if (p.auxiliaryVessels > 0) naval.push(`⚓ ${p.auxiliaryVessels}`);
  if (naval.length === 0 && p.totalVessels > 0) naval.push(`⚓ ${p.totalVessels}`);

  return { air, naval };
}

function trendLabel(trend: TheaterPostureSummary['trend'], change: number): { text: string; color: string } {
  if (trend === 'increasing') return { text: `↗ +${change}%`, color: CRIT };
  if (trend === 'decreasing') return { text: `↘ ${change}%`, color: NORM };
  return { text: '→ stable', color: '$color9' };
}

function TheaterRow({ p }: { p: TheaterPostureSummary }): React.JSX.Element {
  const expanded = p.postureLevel !== 'normal';

  if (!expanded) {
    // Compact single-line view for normal theaters.
    return (
      <XStack alignItems="center" justifyContent="space-between" paddingVertical="$1" gap="$2">
        <SizableText size="$2" color="$color11" numberOfLines={1}>
          {p.shortName}
        </SizableText>
        <XStack alignItems="center" gap="$1.5">
          {p.totalAircraft > 0 ? <Chip text={`✈️ ${p.totalAircraft}`} /> : null}
          {p.totalVessels > 0 ? <Chip text={`⚓ ${p.totalVessels}`} /> : null}
          <Badge level={p.postureLevel} />
        </XStack>
      </XStack>
    );
  }

  const { air, naval } = forceChips(p);
  const trend = trendLabel(p.trend, p.changePercent);
  const color = levelColor(p.postureLevel);

  return (
    <YStack
      gap="$1.5"
      paddingHorizontal="$2"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor={color}
      backgroundColor="rgba(255,255,255,0.03)"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$3" color="$color12" numberOfLines={1}>
          {p.theaterName}
        </SizableText>
        <Badge level={p.postureLevel} />
      </XStack>

      {air.length > 0 ? (
        <XStack alignItems="center" gap="$1.5" flexWrap="wrap">
          <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
            AIR
          </SizableText>
          {air.map((c, i) => (
            <Chip key={`air-${i}`} text={c} />
          ))}
        </XStack>
      ) : null}

      {naval.length > 0 ? (
        <XStack alignItems="center" gap="$1.5" flexWrap="wrap">
          <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
            SEA
          </SizableText>
          {naval.map((c, i) => (
            <Chip key={`sea-${i}`} text={c} />
          ))}
        </XStack>
      ) : null}

      <XStack alignItems="center" gap="$2" flexWrap="wrap">
        {p.strikeCapable ? (
          <SizableText size="$1" color={CRIT}>
            ⚡ STRIKE
          </SizableText>
        ) : null}
        <SizableText size="$1" color={trend.color}>
          {trend.text}
        </SizableText>
        {p.targetNation ? (
          <SizableText size="$1" color="$color10">
            → {p.targetNation}
          </SizableText>
        ) : null}
      </XStack>
    </YStack>
  );
}
