import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import {
  fetchFredData,
  getChangeClass,
  formatChange,
  type FredSeries,
} from '@/services/fred';
import {
  fetchOilAnalytics,
  formatOilValue,
  getTrendIndicator,
  getTrendColor,
  type OilAnalytics,
  type OilMetric,
} from '@/services/oil-analytics';
import {
  fetchRecentAwards,
  formatAwardAmount,
  getAwardTypeIcon,
  type SpendingSummary,
} from '@/services/usa-spending';
import {
  fetchChinaMacro,
  type ChinaMacroSnapshot,
  type ChinaMacroIndicator,
  type ChinaReleaseEvent,
} from '@/services/china-macro';
import {
  chinaSummaryState,
  toObservedDate,
  type ChinaCountrySummarySignal,
} from '@/app/china-summary-state';
import { isFeatureAvailable } from '@/services/runtime-config';
import { canConfigureKeys } from '@/services/runtime';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * EconomicPanel — the vanilla `EconomicPanel` (src/components/EconomicPanel.ts)
 * ported onto the React Panel chassis. Shape: tabbed (indicators / oil / gov /
 * china), each tab appearing only when its source has data — the same dynamic tab
 * set the vanilla panel builds.
 *
 * It REUSES the existing data + formatting layer VERBATIM. The four fetchers the
 * vanilla App feeds this panel with are called directly here — `fetchFredData`
 * (with its WALCL scaling + change/percent transforms), `fetchOilAnalytics`,
 * `fetchRecentAwards({ daysBack: 7, limit: 15 })` and `fetchChinaMacro` — and every
 * formatter/helper is imported unchanged: `getChangeClass` / `formatChange`,
 * `formatOilValue` / `getTrendIndicator` / `getTrendColor`, `formatAwardAmount` /
 * `getAwardTypeIcon`, and the pure `chinaSummaryState` / `toObservedDate` four-state
 * contract. No data logic is re-authored. The per-tab view transforms are kept
 * exactly (oil `filter(Boolean)`, awards `.slice(0, 8)`, China required-signal
 * filter + upcoming-release `>= today` `.slice(0, 8)`).
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so names/ids/descriptions render as safe text
 * nodes and running the escaper over them would double-escape.
 *
 * The chassis owns the frame + the four decomplected states + the tab bar; this file
 * owns only which state to show and the rows, in @hanzo/gui longhand primitives. FRED
 * drives the panel state (loading → ready, hard failure → error); a missing key or an
 * empty FRED response is the SAME quiet degraded note the vanilla `showDegraded` shows,
 * rendered inline on the indicators tab while the other tabs keep their own data.
 */

type TabId = 'indicators' | 'oil' | 'spending' | 'china';

const POS = '#22c55e';
const NEG = '#ef4444';

export function EconomicPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [fredData, setFredData] = useState<FredSeries[]>([]);
  const [oilData, setOilData] = useState<OilAnalytics | null>(null);
  const [spendingData, setSpendingData] = useState<SpendingSummary | null>(null);
  const [chinaData, setChinaData] = useState<ChinaMacroSnapshot | null>(null);
  const [indicatorsNote, setIndicatorsNote] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [activeTab, setActiveTab] = useState<TabId>('indicators');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      // FRED drives the panel state; the other three sources feed their own tabs
      // and never fail the whole panel (settled-independent, honest per source).
      try {
        const data = await fetchFredData();
        if (cancelled) return;
        if (data.length === 0) {
          // Quiet degraded state — a missing key or empty response is NOT a hard
          // runtime error; render the calm note on the indicators tab (vanilla
          // `showDegraded`), not the red error state.
          const reason = isFeatureAvailable('economicFred')
            ? 'FRED data temporarily unavailable — will retry'
            : canConfigureKeys()
              ? 'FRED_API_KEY not configured — add in Settings'
              : t('common.noDataAvailable');
          setIndicatorsNote(reason);
          setFredData([]);
        } else {
          setIndicatorsNote(null);
          setFredData(data);
        }
        setLastUpdate(new Date());
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }

      const [oil, spending, china] = await Promise.allSettled([
        fetchOilAnalytics(),
        fetchRecentAwards({ daysBack: 7, limit: 15 }),
        fetchChinaMacro(),
      ]);
      if (cancelled) return;
      if (oil.status === 'fulfilled') setOilData(oil.value);
      if (spending.status === 'fulfilled') setSpendingData(spending.value);
      if (china.status === 'fulfilled') setChinaData(china.value);
    };

    void load();
    // Live surface: refresh on the same cadence spirit as the vanilla poller.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const hasOil = !!(oilData && (oilData.wtiPrice || oilData.brentPrice));
  const hasSpending = !!(spendingData && spendingData.awards.length > 0);
  const hasChina = !!chinaData;

  const tabs = useMemo<PanelTab[]>(() => {
    const list: PanelTab[] = [
      { key: 'indicators', label: `📊 ${t('components.economic.indicators')}` },
    ];
    if (hasOil) list.push({ key: 'oil', label: `🛢️ ${t('components.economic.oil')}` });
    if (hasSpending) list.push({ key: 'spending', label: `🏛️ ${t('components.economic.gov')}` });
    if (hasChina) list.push({ key: 'china', label: `🇨🇳 ${t('components.economic.china.tab')}` });
    return list;
  }, [hasOil, hasSpending, hasChina]);

  // If the active tab's source dropped out, fall back to the always-present tab.
  const tab: TabId = tabs.some((x) => x.key === activeTab) ? activeTab : 'indicators';

  const sourceLabel =
    tab === 'indicators' ? 'FRED'
      : tab === 'oil' ? 'EIA'
        : tab === 'spending' ? 'USASpending.gov'
          : 'OECD · FRED · NBS · PBoC';

  const updateTime = lastUpdate
    ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.economic')}
      state={state}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(k) => setActiveTab(k as TabId)}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2">
        {tab === 'indicators' ? (
          <Indicators data={fredData} note={indicatorsNote} />
        ) : tab === 'oil' ? (
          <Oil data={oilData} />
        ) : tab === 'spending' ? (
          <Spending data={spendingData} />
        ) : (
          <China snap={chinaData} />
        )}
        <XStack paddingTop="$1">
          <SizableText size="$1" color="$color9">
            {sourceLabel}
            {updateTime ? ` • ${updateTime}` : ''}
          </SizableText>
        </XStack>
      </YStack>
    </Panel>
  );
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <SizableText size="$2" color="$color9" paddingVertical="$2">
      {text}
    </SizableText>
  );
}

function Indicators({ data, note }: { data: FredSeries[]; note: string | null }): React.JSX.Element {
  if (data.length === 0) {
    return <Empty text={note ?? t('components.economic.noIndicatorData')} />;
  }
  return (
    <YStack gap="$1.5">
      {data.map((series) => {
        const changeClass = getChangeClass(series.change);
        const changeColor = changeClass === 'positive' ? POS : changeClass === 'negative' ? NEG : '$color10';
        const arrow = series.change !== null
          ? series.change > 0 ? '▲' : series.change < 0 ? '▼' : '–'
          : '';
        return (
          <YStack key={series.id} paddingVertical="$1" gap="$1">
            <XStack justifyContent="space-between" alignItems="center">
              <SizableText size="$3" color="$color12">{series.name}</SizableText>
              <SizableText size="$1" color="$color9">{series.id}</SizableText>
            </XStack>
            <XStack justifyContent="space-between" alignItems="center">
              <SizableText size="$3" color="$color12">
                {series.value !== null ? series.value : 'N/A'}{series.unit}
              </SizableText>
              <SizableText size="$2" color={changeColor}>
                {arrow} {formatChange(series.change, series.unit)}
              </SizableText>
            </XStack>
            <SizableText size="$1" color="$color9">{series.date}</SizableText>
          </YStack>
        );
      })}
    </YStack>
  );
}

function Oil({ data }: { data: OilAnalytics | null }): React.JSX.Element {
  if (!data) return <Empty text={t('components.economic.noOilDataRetry')} />;
  const metrics = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(
    (m): m is OilMetric => Boolean(m),
  );
  if (metrics.length === 0) return <Empty text={t('components.economic.noOilMetrics')} />;
  return (
    <YStack gap="$1.5">
      {metrics.map((metric) => {
        const trendColor = getTrendColor(metric.trend, metric.name.includes('Production'));
        return (
          <YStack key={metric.id} paddingVertical="$1" gap="$1">
            <SizableText size="$3" color="$color12">{metric.name}</SizableText>
            <XStack justifyContent="space-between" alignItems="center">
              <SizableText size="$3" color="$color12">
                {formatOilValue(metric.current, metric.unit)} {metric.unit}
              </SizableText>
              <SizableText size="$2" style={{ color: trendColor }}>
                {getTrendIndicator(metric.trend)} {metric.changePct > 0 ? '+' : ''}{metric.changePct}%
              </SizableText>
            </XStack>
            <SizableText size="$1" color="$color9">{t('components.economic.vsPreviousWeek')}</SizableText>
          </YStack>
        );
      })}
    </YStack>
  );
}

function Spending({ data }: { data: SpendingSummary | null }): React.JSX.Element {
  if (!data || data.awards.length === 0) return <Empty text={t('components.economic.noSpending')} />;
  const { awards, totalAmount, periodStart, periodEnd } = data;
  return (
    <YStack gap="$2">
      <YStack gap="$0.5">
        <SizableText size="$3" color="$color12">
          {formatAwardAmount(totalAmount)} {t('components.economic.in')} {awards.length} {t('components.economic.awards')}
        </SizableText>
        <SizableText size="$1" color="$color9">{periodStart} – {periodEnd}</SizableText>
      </YStack>
      <YStack gap="$1.5">
        {awards.slice(0, 8).map((award) => (
          <YStack key={award.id} paddingVertical="$1" gap="$0.5">
            <XStack alignItems="center" gap="$2">
              <SizableText size="$2">{getAwardTypeIcon(award.awardType)}</SizableText>
              <SizableText size="$3" color="$color12">{formatAwardAmount(award.amount)}</SizableText>
            </XStack>
            <SizableText size="$2" color="$color11" numberOfLines={1}>{award.recipientName}</SizableText>
            <SizableText size="$1" color="$color9" numberOfLines={1}>{award.agency}</SizableText>
            {award.description ? (
              <SizableText size="$1" color="$color9" numberOfLines={2}>
                {award.description.slice(0, 100)}{award.description.length > 100 ? '...' : ''}
              </SizableText>
            ) : null}
          </YStack>
        ))}
      </YStack>
    </YStack>
  );
}

function China({ snap }: { snap: ChinaMacroSnapshot | null }): React.JSX.Element {
  if (!snap || (snap.indicators.length === 0 && snap.releaseEvents.length === 0)) {
    return <Empty text={t('components.economic.china.noData')} />;
  }

  // Panel state is derived from the required (non-context) indicators that carry a
  // value, via the ported four-state contract — verbatim.
  const requiredSignals: ChinaCountrySummarySignal[] = snap.indicators
    .filter((ind) => !ind.contextOnly && ind.value !== null)
    .map((ind) => ({ stale: ind.stale }));
  const summary = chinaSummaryState(requiredSignals, 4);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = snap.releaseEvents.filter((ev) => ev.releaseDate >= today).slice(0, 8);

  const statusColor =
    summary === 'available' ? POS
      : summary === 'partial' ? '#f59e0b'
        : summary === 'stale' ? '#f59e0b'
          : '$color9';

  return (
    <YStack gap="$2">
      <XStack>
        <SizableText size="$2" style={{ color: statusColor }}>
          {t('components.economic.china.status.' + summary)}
        </SizableText>
      </XStack>
      <YStack gap="$1.5">
        {snap.indicators.map((ind) => (
          <ChinaIndicator key={ind.id} ind={ind} />
        ))}
      </YStack>
      <YStack gap="$1">
        <SizableText size="$2" color="$color11">{t('components.economic.china.releases')}</SizableText>
        {upcoming.length === 0 ? (
          <Empty text={t('components.economic.china.noReleases')} />
        ) : (
          upcoming.map((ev) => <ChinaRelease key={ev.id} ev={ev} />)
        )}
      </YStack>
    </YStack>
  );
}

function ChinaIndicator({ ind }: { ind: ChinaMacroIndicator }): React.JSX.Element {
  const hasValue = ind.value !== null && Number.isFinite(ind.value);
  const valueStr = hasValue ? `${ind.value}${ind.unit ? ' ' + ind.unit : ''}` : '—';
  const reasonLabel =
    ind.unavailableReason === 'not_configured'
      ? t('components.economic.china.notConfigured')
      : t('components.economic.china.sourceUnavailable');
  return (
    <YStack paddingVertical="$1" gap="$1">
      <XStack alignItems="center" gap="$1.5" flexWrap="wrap">
        <SizableText size="$3" color="$color12">{ind.label}</SizableText>
        {ind.contextOnly ? (
          <SizableText size="$1" color="$color9">{t('components.economic.china.context')}</SizableText>
        ) : null}
        {ind.stale ? (
          <SizableText size="$1" color="#f59e0b">{t('components.economic.china.status.stale')}</SizableText>
        ) : null}
      </XStack>
      <XStack alignItems="center" gap="$2" flexWrap="wrap">
        <SizableText size="$3" color="$color12">{valueStr}</SizableText>
        {hasValue && ind.priorValue !== null && Number.isFinite(ind.priorValue) ? (
          <SizableText size="$1" color="$color9">
            {t('components.economic.china.prior')} {ind.priorValue}
          </SizableText>
        ) : null}
        {!hasValue && ind.unavailableReason ? (
          <SizableText size="$1" color="$color9" aria-label={ind.unavailableReason}>{reasonLabel}</SizableText>
        ) : null}
      </XStack>
      <SizableText size="$1" color="$color9">
        {ind.observationDate ? `${t('components.economic.china.observed')} ${toObservedDate(ind.observationDate)}` : ''}
        {ind.observationDate && ind.source ? ' · ' : ''}
        {ind.source}
      </SizableText>
    </YStack>
  );
}

function ChinaRelease({ ev }: { ev: ChinaReleaseEvent }): React.JSX.Element {
  const statusLabel = t('components.economic.china.eventStatus.' + ev.status, { defaultValue: ev.status });
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$0.5" flexWrap="wrap">
      <SizableText size="$1" color="$color9" style={{ fontVariantNumeric: 'tabular-nums' }}>{ev.releaseDate}</SizableText>
      <SizableText size="$2" color="$color11" style={{ flex: 1 }} numberOfLines={1}>{ev.event}</SizableText>
      <SizableText size="$1" color="$color9">{statusLabel}</SizableText>
    </XStack>
  );
}
