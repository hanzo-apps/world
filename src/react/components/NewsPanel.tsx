import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchCategoryFeeds } from '@/services/rss';
import { analysisWorker, enrichWithVelocity } from '@/services';
import { THREAT_PRIORITY, getThreatColor } from '@/services/threat-classifier';
import { feedsFor, getSiteVariant } from '@/config';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import type { ClusteredEvent, NewsItem } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * NewsPanel — the vanilla `NewsPanel` (src/components/NewsPanel.ts) ported onto the
 * React Panel chassis. Shape: other (a clustered, threat-ranked headline feed).
 *
 * It REUSES the vanilla data + transform layer VERBATIM. Feeds come from the same
 * variant-aware `feedsFor(getSiteVariant())` set and are fetched by the same
 * `fetchCategoryFeeds` service (streaming partial batches via `onBatch`, exactly
 * like the vanilla `loadNewsCategory`). The dedup/merge transform is KEPT: raw
 * items are collapsed into multi-source clusters by `analysisWorker.clusterNews`
 * and annotated with keyword velocity via `enrichWithVelocity` — the same two
 * calls the vanilla `renderClustersAsync` makes for first paint. Ranking reuses the
 * vanilla `THREAT_PRIORITY` sort (threat level desc, then recency), and the row
 * time reuses the `formatTime` formatter. No fetch / cluster / format logic is
 * re-authored; this file owns only which state to show and the rows.
 *
 * Faithful omissions, mirroring the sibling ports:
 *   • `escapeHtml` is dropped — React escapes text children natively; URL safety is
 *     preserved via `sanitizeUrl` on the headline href, verbatim.
 *   • The background ML sentiment upgrade (`enrichWithVelocityML`, a ~65MB lazy
 *     model that must never gate first paint) is not wired here — the panel paints
 *     the fast keyword velocity, exactly the vanilla first-paint contract.
 *   • Globe-coupled affordances (related-asset hover focus, per-panel summarize,
 *     translate, activity-tracker "NEW" pulses) belong to the App shell, not this
 *     standalone card, and are left to their owners.
 *
 * The chassis owns the frame + loading/empty/error states. A failed fetch/cluster
 * maps to an honest error state, an empty cluster set to an honest empty state —
 * never fabricated data.
 */

/** Canonical world-news category — the vanilla `politics` panel ("World News"). */
const CATEGORY = 'politics';

export function NewsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [clusters, setClusters] = useState<ClusteredEvent[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;
    // Monotonic guard so a stale async cluster from an earlier batch never paints
    // over a newer one — the vanilla `renderRequestId` discipline.
    let reqId = 0;

    const cluster = async (items: NewsItem[]): Promise<void> => {
      const id = ++reqId;
      const raw = await analysisWorker.clusterNews(items);
      if (cancelled || id !== reqId) return;
      const enriched = enrichWithVelocity(raw);
      setClusters(sortByThreat(enriched));
      if (enriched.length) setState('ready');
    };

    const load = async (): Promise<void> => {
      try {
        const feeds = feedsFor(getSiteVariant())[CATEGORY] ?? [];
        const items = await fetchCategoryFeeds(feeds, {
          onBatch: (partial) => {
            if (!cancelled) void cluster(partial);
          },
        });
        if (cancelled) return;
        if (items.length === 0) {
          setClusters([]);
          setState('empty');
          return;
        }
        await cluster(items);
        if (!cancelled && reqId > 0) setState((s) => (s === 'loading' ? 'empty' : s));
      } catch (error) {
        console.error('[NewsPanel] Load error:', error);
        if (!cancelled) setState('error');
      }
    };

    void load();
    // Live surface: refresh on the same cadence spirit as the vanilla feed poller.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.politics')}
      state={state}
      emptyText={t('common.noNewsAvailable')}
      errorText={t('common.noNewsAvailable')}
      width={380}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1">
        {clusters.map((cluster) => (
          <ClusterRow key={cluster.id} cluster={cluster} />
        ))}
      </YStack>
    </Panel>
  );
}

/** Threat-priority sort — verbatim from the vanilla `renderClusters`. */
function sortByThreat(clusters: ClusteredEvent[]): ClusteredEvent[] {
  return [...clusters].sort((a, b) => {
    const pa = THREAT_PRIORITY[a.threat?.level ?? 'info'];
    const pb = THREAT_PRIORITY[b.threat?.level ?? 'info'];
    if (pb !== pa) return pb - pa;
    return b.lastUpdated.getTime() - a.lastUpdated.getTime();
  });
}

function ClusterRow({ cluster }: { cluster: ClusteredEvent }): React.JSX.Element {
  const safeUrl = sanitizeUrl(cluster.primaryLink);
  const velocity = cluster.velocity;
  const showVelocity = velocity && velocity.level !== 'normal' && cluster.sourceCount > 1;
  const cat = cluster.threat?.category;
  const catLabel = cat && cat !== 'general' ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
  const catColor = cluster.threat ? getThreatColor(cluster.threat.level) : '';
  const otherSources = cluster.topSources.filter((s) => s.name !== cluster.primarySource);

  return (
    <a href={safeUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
      <YStack
        gap="$1"
        paddingVertical="$1.5"
        paddingHorizontal="$1"
        borderBottomWidth={1}
        borderColor="rgba(255,255,255,0.06)"
        borderLeftWidth={cluster.monitorColor ? 2 : 0}
        borderLeftColor={cluster.monitorColor ?? 'transparent'}
        hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      >
        <XStack alignItems="center" gap="$1.5" flexWrap="wrap">
          <SizableText size="$1" color="$color9" numberOfLines={1}>
            {cluster.primarySource}
          </SizableText>
          {cluster.sourceCount > 1 ? (
            <SizableText size="$1" color="$color10">
              {t('components.newsPanel.sources', { count: String(cluster.sourceCount) })}
            </SizableText>
          ) : null}
          {showVelocity ? (
            <SizableText size="$1" color="#f59e0b">
              {velocity!.trend === 'rising' ? '↑' : ''}+{velocity!.sourcesPerHour}/hr
            </SizableText>
          ) : null}
          {cluster.isAlert ? (
            <SizableText size="$1" color="#ef4444" style={{ letterSpacing: 0.5 }}>
              ALERT
            </SizableText>
          ) : null}
          {catLabel ? (
            <SizableText
              size="$1"
              color="$color11"
              paddingHorizontal="$1.5"
              borderRadius="$2"
              borderWidth={1}
              borderColor={catColor ? `${catColor}66` : '$color6'}
              backgroundColor={catColor ? `${catColor}22` : 'transparent'}
            >
              {catLabel}
            </SizableText>
          ) : null}
        </XStack>
        <SizableText size="$3" color="$color12" numberOfLines={3}>
          {cluster.primaryTitle}
        </SizableText>
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          {otherSources.length > 0 ? (
            <SizableText size="$1" color="$color9" numberOfLines={1} flex={1}>
              Also: {otherSources.map((s) => s.name).join(', ')}
            </SizableText>
          ) : (
            <YStack flex={1} />
          )}
          <SizableText size="$1" color="$color9" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(cluster.lastUpdated)}
          </SizableText>
        </XStack>
      </YStack>
    </a>
  );
}
