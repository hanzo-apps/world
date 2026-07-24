import { useEffect, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCSSColor } from '@/utils';
import { t } from '@/services/i18n';
import {
  calculateStrategicRiskOverview,
  getRecentAlerts,
  getAlertCount,
  type StrategicRiskOverview,
  type UnifiedAlert,
  type AlertPriority,
} from '@/services/cross-module-integration';
import { detectConvergence } from '@/services/geo-convergence';
import { dataFreshness, type DataFreshnessSummary } from '@/services/data-freshness';
import { getLearningProgress } from '@/services/country-instability';
import { fetchCachedRiskScores } from '@/services/cached-risk-scores';
import { getGlobeInstance } from '../hooks/globe-instance';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * StrategicRiskPanel — the vanilla `StrategicRiskPanel`
 * (src/components/StrategicRiskPanel.ts) ported onto the React Panel chassis, the
 * "other"-shape sibling of MarketsPanel.
 *
 * It REUSES the vanilla data + scoring layer VERBATIM: `detectConvergence` +
 * `calculateStrategicRiskOverview` (the ONE composite-risk computation),
 * `getRecentAlerts` / `getAlertCount` (the unified alert store), `dataFreshness`
 * (the shared freshness tracker), `getLearningProgress` +
 * `fetchCachedRiskScores` (the learning-mode / cached-score gate). No scoring is
 * re-authored — the effect mirrors the vanilla `refresh()` flow exactly (read
 * freshness → detect convergence → compute overview → pull recent alerts → in
 * learning mode try the backend cache), and the file owns only the view: which
 * chassis state to show and how the gauge / metrics / risks / alerts are expressed
 * in @hanzo/gui longhand primitives. The colour + emoji helpers are the vanilla
 * panel's own, copied unchanged.
 *
 * View-only: same data in, same info shown. The vanilla `dataFreshness.subscribe`
 * debounce, the enable-source affordances of the insufficient-data view, and the
 * `makeActivatable` click wiring are host-integration / loading-UX embellishments,
 * not displayed data — they collapse to the chassis states plus the shared globe
 * seam (`getGlobeInstance().setCenter`) for the one displayed interaction
 * (click a located risk / alert to fly the globe). Empty is honest: when zero
 * sources are active after the 60s grace, risk cannot be assessed.
 */

// Vanilla score → semantic-token colour (getScoreColor), copied unchanged.
function scoreColor(score: number): string {
  if (score >= 70) return getCSSColor('--semantic-critical');
  if (score >= 50) return getCSSColor('--semantic-high');
  if (score >= 30) return getCSSColor('--semantic-elevated');
  return getCSSColor('--semantic-normal');
}

function scoreLevel(score: number): string {
  if (score >= 70) return 'Critical';
  if (score >= 50) return 'Elevated';
  if (score >= 30) return 'Moderate';
  return 'Low';
}

function trendEmoji(trend: string): string {
  if (trend === 'escalating') return '📈';
  if (trend === 'de-escalating') return '📉';
  return '➡️';
}

function trendColor(trend: string): string {
  if (trend === 'escalating') return getCSSColor('--semantic-critical');
  if (trend === 'de-escalating') return getCSSColor('--semantic-normal');
  return getCSSColor('--text-dim');
}

function priorityColor(priority: AlertPriority): string {
  switch (priority) {
    case 'critical':
      return getCSSColor('--semantic-critical');
    case 'high':
      return getCSSColor('--semantic-high');
    case 'medium':
      return getCSSColor('--semantic-elevated');
    case 'low':
      return getCSSColor('--semantic-normal');
  }
}

function priorityEmoji(priority: AlertPriority): string {
  switch (priority) {
    case 'critical':
      return '🔴';
    case 'high':
      return '🟠';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
  }
}

function typeEmoji(type: string): string {
  switch (type) {
    case 'convergence':
      return '🎯';
    case 'cii_spike':
      return '📊';
    case 'cascade':
      return '🔗';
    case 'composite':
      return '⚠️';
    default:
      return '📍';
  }
}

// Vanilla formatTime, copied unchanged.
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

interface RiskView {
  overview: StrategicRiskOverview;
  alerts: UnifiedAlert[];
  alertCounts: { critical: number; high: number; medium: number; low: number };
  freshness: DataFreshnessSummary;
  showLearning: boolean;
  remainingMinutes: number;
  progress: number;
}

function flyTo(lat: number, lon: number): void {
  getGlobeInstance()?.setCenter(lat, lon);
}

export function StrategicRiskPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [view, setView] = useState<RiskView | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const mountedAt = useRef<number>(performance.now());

  useEffect(() => {
    let cancelled = false;

    // Mirror of the vanilla refresh(): read freshness, detect convergence, compute
    // the composite overview, pull the recent alerts, and (in learning mode only)
    // try the backend cache. No scoring is re-authored here.
    const refresh = async (): Promise<void> => {
      try {
        const freshness = dataFreshness.getSummary();
        const convergence = detectConvergence();
        const overview = calculateStrategicRiskOverview(convergence);
        const alerts = getRecentAlerts(24);
        const alertCounts = getAlertCount();

        const { inLearning, remainingMinutes, progress } = getLearningProgress();
        let usedCachedScores = false;
        if (inLearning) {
          const cached = await fetchCachedRiskScores();
          if (cached && cached.strategicRisk) usedCachedScores = true;
        }
        if (cancelled) return;

        setView({
          overview,
          alerts,
          alertCounts,
          freshness,
          showLearning: inLearning && !usedCachedScores,
          remainingMinutes,
          progress,
        });

        // Honest empty: zero active sources, or a genuine insufficient verdict once
        // past the 60s warm-up (vanilla renderInsufficientData gate). Otherwise the
        // composite is meaningful even on partial data (CII baselines cover it).
        const uptime = performance.now() - mountedAt.current;
        const insufficient =
          freshness.activeSources === 0 ||
          (freshness.overallStatus === 'insufficient' && uptime > 60_000);
        setState(insufficient ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void refresh();
    // Same cadence spirit as the vanilla 5-minute auto-refresh.
    const id = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.strategicRisk')}
      state={state}
      infoTooltip={t('components.strategicRisk.infoTooltip')}
      emptyText="Insufficient data — enable data sources to begin monitoring"
      actions={<PanelLiveDot />}
    >
      {view ? <RiskBody view={view} /> : null}
    </Panel>
  );
}

function RiskBody({ view }: { view: RiskView }): React.JSX.Element {
  const { overview, alerts, alertCounts } = view;
  const score = overview.compositeScore;
  const color = scoreColor(score);
  const level = scoreLevel(score);
  // Vanilla renders a 270° sweep gauge; keep the same mapping.
  const sweep = Math.round((score / 100) * 270);
  const topZone = overview.topConvergenceZones[0];
  const displayAlerts = alerts.slice(0, 5);

  return (
    <YStack gap="$2.5">
      {view.showLearning ? (
        <YStack
          gap="$1"
          paddingHorizontal="$2"
          paddingVertical="$1.5"
          borderRadius="$3"
          backgroundColor="rgba(255,255,255,0.04)"
        >
          <SizableText size="$1" color="$color10">
            📊 Learning Mode — {view.remainingMinutes}m until reliable
          </SizableText>
          <XStack height={3} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)">
            <XStack
              height={3}
              borderRadius={999}
              backgroundColor="#60a5fa"
              style={{ width: `${view.progress}%` }}
            />
          </XStack>
        </YStack>
      ) : null}

      {/* Gauge — composite score ring + trend. */}
      <XStack alignItems="center" gap="$3" paddingVertical="$1">
        <YStack
          width={84}
          height={84}
          borderRadius={999}
          alignItems="center"
          justifyContent="center"
          style={{
            background: `conic-gradient(from 225deg, ${color} 0deg ${sweep}deg, rgba(255,255,255,0.08) ${sweep}deg 270deg, transparent 270deg 360deg)`,
          }}
        >
          <YStack
            width={64}
            height={64}
            borderRadius={999}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(12,12,14,0.92)"
          >
            <SizableText size="$6" color={color} style={{ fontWeight: '700', lineHeight: 26 }}>
              {score}
            </SizableText>
            <SizableText size="$1" color={color} style={{ letterSpacing: 0.5 }}>
              {level}
            </SizableText>
          </YStack>
        </YStack>
        <YStack gap="$1">
          <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
            TREND
          </SizableText>
          <SizableText size="$3" color={trendColor(overview.trend)}>
            {trendEmoji(overview.trend)} {overview.trend.charAt(0).toUpperCase() + overview.trend.slice(1)}
          </SizableText>
        </YStack>
      </XStack>

      {/* Metrics — the vanilla four-tile row. */}
      <XStack gap="$1.5" flexWrap="wrap">
        <Metric value={String(overview.convergenceAlerts)} label="Convergence" />
        <Metric value={overview.avgCIIDeviation.toFixed(1)} label="CII Deviation" />
        <Metric value={String(overview.infrastructureIncidents)} label="Infra Events" />
        <Metric value={String(alertCounts.critical + alertCounts.high)} label="High Alerts" />
      </XStack>

      {/* Top Risks. */}
      <YStack gap="$1.5">
        <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
          TOP RISKS
        </SizableText>
        {overview.topRisks.length === 0 ? (
          <SizableText size="$2" color="$color9">
            {t('components.strategicRisk.noRisks')}
          </SizableText>
        ) : (
          overview.topRisks.map((risk, i) => {
            const clickable = i === 0 && risk.startsWith('Convergence:') && !!topZone;
            return (
              <XStack
                key={`risk-${i}`}
                alignItems="center"
                gap="$1.5"
                paddingVertical="$0.5"
                cursor={clickable ? 'pointer' : undefined}
                onPress={clickable ? () => flyTo(topZone.lat, topZone.lon) : undefined}
              >
                <SizableText size="$2" color="$color9">
                  {i + 1}.
                </SizableText>
                <SizableText size="$2" color="$color11" style={{ flex: 1 }}>
                  {risk}
                </SizableText>
                {clickable ? (
                  <SizableText size="$2" color="$color9">
                    ↗
                  </SizableText>
                ) : null}
              </XStack>
            );
          })
        )}
      </YStack>

      {/* Recent Alerts — up to 5 (vanilla slice). */}
      {displayAlerts.length > 0 ? (
        <YStack gap="$1.5">
          <SizableText size="$1" color="$color9" style={{ letterSpacing: 1 }}>
            RECENT ALERTS ({alerts.length})
          </SizableText>
          {displayAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </YStack>
      ) : null}
    </YStack>
  );
}

function Metric({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <YStack
      flex={1}
      minWidth={64}
      gap="$0.5"
      paddingHorizontal="$2"
      paddingVertical="$1.5"
      borderRadius="$3"
      backgroundColor="rgba(255,255,255,0.04)"
      alignItems="center"
    >
      <SizableText size="$4" color="$color12" style={{ fontWeight: '600' }}>
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9" numberOfLines={1}>
        {label}
      </SizableText>
    </YStack>
  );
}

function AlertRow({ alert }: { alert: UnifiedAlert }): React.JSX.Element {
  const loc = alert.location;
  const clickable = !!(loc && loc.lat && loc.lon);
  return (
    <YStack
      gap="$0.5"
      paddingLeft="$2"
      paddingVertical="$1"
      borderLeftWidth={3}
      borderColor={priorityColor(alert.priority)}
      cursor={clickable ? 'pointer' : undefined}
      onPress={clickable ? () => flyTo(loc!.lat, loc!.lon) : undefined}
    >
      <XStack alignItems="center" gap="$1">
        <SizableText size="$1">{typeEmoji(alert.type)}</SizableText>
        <SizableText size="$1">{priorityEmoji(alert.priority)}</SizableText>
        <SizableText size="$2" color="$color12" style={{ flex: 1 }} numberOfLines={1}>
          {alert.title}
        </SizableText>
        {clickable ? (
          <SizableText size="$2" color="$color9">
            ↗
          </SizableText>
        ) : null}
      </XStack>
      <SizableText size="$1" color="$color10" numberOfLines={2}>
        {alert.summary}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {formatTime(alert.timestamp)}
      </SizableText>
    </YStack>
  );
}
