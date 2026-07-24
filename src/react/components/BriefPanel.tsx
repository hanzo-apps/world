import { useEffect, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { mlWorker } from '@/services/ml-worker';
import { generateSummary } from '@/services/summarization';
import { parallelAnalysis, type AnalyzedHeadline } from '@/services/parallel-analysis';
import {
  signalAggregator,
  logSignalSummary,
  type RegionalConvergence,
  type SignalSummary,
} from '@/services/signal-aggregator';
import { focalPointDetector } from '@/services/focal-point-detector';
import { clusterNewsHybrid } from '@/services/clustering';
import { fetchCategoryFeeds } from '@/services/rss';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { getSiteVariant, feedsFor } from '@/config';
import { isMobileDevice } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import type { ClusteredEvent, FocalPoint, FocalPointSummary } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * BriefPanel — the vanilla `BriefPanel` (src/components/BriefPanel.ts) ported onto
 * the React Panel chassis. The AI world/tech brief: a Groq/OpenRouter summary over
 * the top-ranked breaking stories, per-story sentiment + velocity badges, a
 * sentiment overview bar, the coverage stats, and — in the `full` variant — the
 * geographic convergence zones + focal points that correlate news entities with map
 * signals.
 *
 * It REUSES the vanilla panel's data + analysis layer VERBATIM. The vanilla panel is
 * push-fed clusters by the App; the React surface has no such feed, so this port
 * sources them the ONE canonical way — the same `fetchCategoryFeeds(feedsFor(variant))`
 * the App feeds it from, then `clusterNewsHybrid` — and then runs the identical
 * analysis services: `parallelAnalysis`, `signalAggregator` / `focalPointDetector`
 * (full-variant geo context), `mlWorker.classifySentiment`, and `generateSummary`
 * (with the same 2-min cooldown + persistent-cache + render-deadline race). The
 * importance-scoring transform (`getImportanceScore` / `selectTopStories`) — the
 * panel's OWN ranking + source-diversity dedup — is preserved verbatim as the
 * module-level `selectTopStories` below. No data logic is re-authored; the port is
 * purely the view, in @hanzo/gui longhand primitives against the chassis, which owns
 * the frame + the loading / empty / error states. `escapeHtml` is unneeded (React
 * escapes text nodes); `sanitizeUrl` is kept for the headline hrefs.
 *
 * Deliberate scope: the cross-panel orchestration the vanilla `updateInsights` also
 * performs (ingestNewsForCII, the `focal-points-ready` dispatch, setMilitaryFlights /
 * theater-posture context) belongs to the App, not this view — in the React surface
 * the CII panel owns its own data path — so it is intentionally not re-driven here.
 */

const POSITIVE = '#22c55e';
const NEGATIVE = '#ef4444';
const NEUTRAL_BAR = 'rgba(255,255,255,0.28)';

const BRIEF_COOLDOWN_MS = 120000; // 2 min cooldown (API has limits)
const BRIEF_RENDER_TIMEOUT_MS = 12000; // render stories even if the AI brief stalls
const BRIEF_CACHE_KEY = 'summary:world-brief';
const REFRESH_MS = BRIEF_COOLDOWN_MS;

const INFO_TOOLTIP =
  'AI-powered analysis. World Brief: AI summary (Groq/OpenRouter). Sentiment: news tone. ' +
  'Velocity: fast-moving stories. Focal Points: correlates news entities with map signals ' +
  '(military, protests, outages). Desktop only.';

// ── The vanilla panel's ranking transform, verbatim ────────────────────────────

// High-priority military/conflict keywords (huge boost)
const MILITARY_KEYWORDS = [
  'war', 'armada', 'invasion', 'airstrike', 'strike', 'missile', 'troops',
  'deployed', 'offensive', 'artillery', 'bomb', 'combat', 'fleet', 'warship',
  'carrier', 'navy', 'airforce', 'deployment', 'mobilization', 'attack',
];

// Violence/casualty keywords (huge boost - human cost stories)
const VIOLENCE_KEYWORDS = [
  'killed', 'dead', 'death', 'shot', 'blood', 'massacre', 'slaughter',
  'fatalities', 'casualties', 'wounded', 'injured', 'murdered', 'execution',
  'crackdown', 'violent', 'clashes', 'gunfire', 'shooting',
];

// Civil unrest keywords (high boost)
const UNREST_KEYWORDS = [
  'protest', 'protests', 'uprising', 'revolt', 'revolution', 'riot', 'riots',
  'demonstration', 'unrest', 'dissent', 'rebellion', 'insurgent', 'overthrow',
  'coup', 'martial law', 'curfew', 'shutdown', 'blackout',
];

// Geopolitical flashpoints (major boost)
const FLASHPOINT_KEYWORDS = [
  'iran', 'tehran', 'russia', 'moscow', 'china', 'beijing', 'taiwan', 'ukraine', 'kyiv',
  'north korea', 'pyongyang', 'israel', 'gaza', 'west bank', 'syria', 'damascus',
  'yemen', 'hezbollah', 'hamas', 'kremlin', 'pentagon', 'nato', 'wagner',
];

// Crisis keywords (moderate boost)
const CRISIS_KEYWORDS = [
  'crisis', 'emergency', 'catastrophe', 'disaster', 'collapse', 'humanitarian',
  'sanctions', 'ultimatum', 'threat', 'retaliation', 'escalation', 'tensions',
  'breaking', 'urgent', 'developing', 'exclusive',
];

// Business/tech context that should REDUCE score (demote business news with military words)
const DEMOTE_KEYWORDS = [
  'ceo', 'earnings', 'stock', 'startup', 'data center', 'datacenter', 'revenue',
  'quarterly', 'profit', 'investor', 'ipo', 'funding', 'valuation',
];

function getImportanceScore(cluster: ClusteredEvent): number {
  let score = 0;
  const titleLower = cluster.primaryTitle.toLowerCase();

  // Source confirmation (base signal)
  score += cluster.sourceCount * 10;

  // Violence/casualty keywords: highest priority (+100 base, +25 per match)
  const violenceMatches = VIOLENCE_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (violenceMatches.length > 0) {
    score += 100 + violenceMatches.length * 25;
  }

  // Military keywords: highest priority (+80 base, +20 per match)
  const militaryMatches = MILITARY_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (militaryMatches.length > 0) {
    score += 80 + militaryMatches.length * 20;
  }

  // Civil unrest: high priority (+70 base, +18 per match)
  const unrestMatches = UNREST_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (unrestMatches.length > 0) {
    score += 70 + unrestMatches.length * 18;
  }

  // Flashpoint keywords: high priority (+60 base, +15 per match)
  const flashpointMatches = FLASHPOINT_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (flashpointMatches.length > 0) {
    score += 60 + flashpointMatches.length * 15;
  }

  // COMBO BONUS: Violence/unrest + flashpoint location = critical story
  if ((violenceMatches.length > 0 || unrestMatches.length > 0) && flashpointMatches.length > 0) {
    score *= 1.5;
  }

  // Crisis keywords: moderate priority (+30 base, +10 per match)
  const crisisMatches = CRISIS_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (crisisMatches.length > 0) {
    score += 30 + crisisMatches.length * 10;
  }

  // Demote business/tech news that happens to contain military words
  const demoteMatches = DEMOTE_KEYWORDS.filter((kw) => titleLower.includes(kw));
  if (demoteMatches.length > 0) {
    score *= 0.3;
  }

  // Velocity multiplier
  const velMultiplier: Record<string, number> = {
    viral: 3,
    spike: 2.5,
    elevated: 1.5,
    normal: 1,
  };
  score *= velMultiplier[cluster.velocity?.level ?? 'normal'] ?? 1;

  // Alert bonus
  if (cluster.isAlert) score += 50;

  // Recency bonus (decay over 12 hours)
  const ageMs = Date.now() - cluster.firstSeen.getTime();
  const ageHours = ageMs / 3600000;
  const recencyMultiplier = Math.max(0.5, 1 - ageHours / 12);
  score *= recencyMultiplier;

  return score;
}

function selectTopStories(clusters: ClusteredEvent[], maxCount: number): ClusteredEvent[] {
  const allScored = clusters.map((c) => ({ cluster: c, score: getImportanceScore(c) }));

  // High score (>100) means critical keywords matched — don't require multi-source
  const candidates = allScored.filter(
    ({ cluster: c, score }) =>
      c.sourceCount >= 2 ||
      c.isAlert ||
      (c.velocity && c.velocity.level !== 'normal') ||
      score > 100,
  );

  const scored = candidates.sort((a, b) => b.score - a.score);

  // Select with source diversity (max 3 from same primary source)
  const selected: ClusteredEvent[] = [];
  const sourceCount = new Map<string, number>();
  const MAX_PER_SOURCE = 3;

  for (const { cluster } of scored) {
    const source = cluster.primarySource;
    const count = sourceCount.get(source) || 0;
    if (count < MAX_PER_SOURCE) {
      selected.push(cluster);
      sourceCount.set(source, count + 1);
    }
    if (selected.length >= maxCount) break;
  }

  return selected;
}

// ── View ────────────────────────────────────────────────────────────────────────

type Sentiment = { label: string; score: number };

interface BriefView {
  clusters: ClusteredEvent[];
  sentiments: Sentiment[] | null;
  brief: string | null;
  briefLive: boolean;
  convergenceZones: RegionalConvergence[];
  focalPoints: FocalPoint[];
  missedStories: AnalyzedHeadline[];
}

const EMPTY_SIGNAL_SUMMARY: SignalSummary = {
  timestamp: new Date(),
  totalSignals: 0,
  byType: {} as Record<string, number>,
  convergenceZones: [],
  topCountries: [],
  aiContext: '',
};

const EMPTY_FOCAL_SUMMARY: FocalPointSummary = {
  focalPoints: [],
  aiContext: '',
  timestamp: new Date(),
  topCountries: [],
  topCompanies: [],
};

export function BriefPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const mobile = isMobileDevice();

  const [view, setView] = useState<BriefView | null>(null);
  const [state, setState] = useState<PanelState>(mobile ? 'empty' : 'loading');
  const [loadingText, setLoadingText] = useState<string>(t('common.loading'));
  const [emptyText, setEmptyText] = useState<string | undefined>(
    mobile ? 'Insights are available on desktop.' : undefined,
  );

  // Brief cooldown/cache mirror the vanilla instance fields.
  const cachedBrief = useRef<string | null>(null);
  const lastBriefUpdate = useRef(0);
  const loadedFromCache = useRef(false);

  useEffect(() => {
    if (mobile) return;
    let cancelled = false;

    const setProgress = (step: number, message: string): void => {
      if (cancelled) return;
      setLoadingText(`Step ${step}/4 — ${message}`);
    };

    const loadBriefFromCache = async (): Promise<boolean> => {
      if (cachedBrief.current || loadedFromCache.current) return false;
      loadedFromCache.current = true;
      const entry = await getPersistentCache<{ summary: string }>(BRIEF_CACHE_KEY);
      if (!entry?.data?.summary) return false;
      cachedBrief.current = entry.data.summary;
      lastBriefUpdate.current = entry.updatedAt;
      return true;
    };

    const load = async (): Promise<void> => {
      try {
        // Step 1: source + cluster the news the ONE canonical way, then rank.
        setProgress(1, 'Ranking important stories...');
        const feeds = Object.values(feedsFor(getSiteVariant())).flat();
        const news = await fetchCategoryFeeds(feeds);
        if (cancelled) return;
        const clusters = await clusterNewsHybrid(news);
        if (cancelled) return;

        if (clusters.length === 0) {
          if (!view) {
            setEmptyText('Waiting for news data...');
            setState('empty');
          }
          return;
        }

        const importantClusters = selectTopStories(clusters, 8);

        // Parallel multi-perspective analysis (background) — surfaces ML-detected
        // stories the keyword ranker missed.
        let missedStories: AnalyzedHeadline[] = [];
        const parallelPromise = parallelAnalysis
          .analyzeHeadlines(clusters)
          .then((report) => {
            missedStories = report.missedByKeywords;
          })
          .catch((err) => {
            console.warn('[BriefPanel] ParallelAnalysis error:', err);
          });

        // Geographic signal correlations — full variant only (geo context for the AI).
        let signalSummary: SignalSummary = EMPTY_SIGNAL_SUMMARY;
        let focalSummary: FocalPointSummary = EMPTY_FOCAL_SUMMARY;
        if (getSiteVariant() === 'full') {
          signalSummary = signalAggregator.getSummary();
          if (signalSummary.totalSignals > 0) logSignalSummary();
          focalSummary = focalPointDetector.analyze(clusters, signalSummary);
          if (focalSummary.focalPoints.length > 0) focalPointDetector.logSummary();
        }

        if (importantClusters.length === 0) {
          if (!view) {
            setEmptyText('No breaking or multi-source stories yet');
            setState('empty');
          }
          await parallelPromise;
          return;
        }

        const titles = importantClusters.map((c) => c.primaryTitle);

        // Step 2: sentiment (browser-based, fast).
        setProgress(2, 'Analyzing sentiment...');
        let sentiments: Sentiment[] | null = null;
        if (mlWorker.isAvailable) {
          sentiments = await mlWorker.classifySentiment(titles).catch(() => null);
        }
        if (cancelled) return;

        // Step 3: World Brief with cooldown + persistent cache + render-deadline race.
        const fromPersistent = await loadBriefFromCache();
        if (cancelled) return;
        let worldBrief = cachedBrief.current;
        const now = Date.now();
        let usedCachedBrief = fromPersistent;

        if (!worldBrief || now - lastBriefUpdate.current > BRIEF_COOLDOWN_MS) {
          setProgress(3, 'Generating world brief...');
          const geoContext =
            getSiteVariant() === 'full'
              ? focalSummary.aiContext || signalSummary.aiContext
              : '';

          let briefSettled = false;
          const result = await Promise.race([
            generateSummary(
              titles,
              (_step, _total, msg) => {
                if (!briefSettled) setProgress(3, `Generating brief: ${msg}`);
              },
              geoContext,
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), BRIEF_RENDER_TIMEOUT_MS)),
          ]);
          briefSettled = true;

          if (result) {
            worldBrief = result.summary;
            cachedBrief.current = worldBrief;
            lastBriefUpdate.current = now;
            usedCachedBrief = false;
            void setPersistentCache(BRIEF_CACHE_KEY, { summary: worldBrief });
          }
        } else {
          usedCachedBrief = true;
          setProgress(3, 'Using cached brief...');
        }
        if (cancelled) return;

        // Step 4: settle the parallel analysis, then commit the view.
        setProgress(4, 'Multi-perspective analysis...');
        await parallelPromise;
        if (cancelled) return;

        setView({
          clusters: importantClusters,
          sentiments,
          brief: worldBrief,
          briefLive: !!worldBrief && !usedCachedBrief,
          convergenceZones: signalSummary.convergenceZones,
          focalPoints: focalSummary.focalPoints,
          missedStories,
        });
        setState('ready');
      } catch (error) {
        console.error('[BriefPanel] Error:', error);
        if (!cancelled && !view) setState('error');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile]);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.insights')}
      state={state}
      loadingText={loadingText}
      emptyText={emptyText}
      errorText={t('common.noDataAvailable')}
      infoTooltip={INFO_TOOLTIP}
      actions={view?.briefLive ? <PanelLiveDot /> : <XStack />}
    >
      {view ? <BriefBody view={view} /> : null}
    </Panel>
  );
}

function BriefBody({ view }: { view: BriefView }): React.JSX.Element {
  const { clusters, sentiments, brief, convergenceZones, focalPoints, missedStories } = view;
  const tech = getSiteVariant() === 'tech';

  const multiSource = clusters.filter((c) => c.sourceCount >= 2).length;
  const fastMoving = clusters.filter((c) => c.velocity && c.velocity.level !== 'normal').length;
  const alerts = clusters.filter((c) => c.isAlert).length;

  return (
    <YStack gap="$3">
      {brief ? (
        <YStack gap="$1.5">
          <SectionTitle>{tech ? '🚀 TECH BRIEF' : '🌍 WORLD BRIEF'}</SectionTitle>
          <SizableText size="$3" color="$color12" style={{ lineHeight: 20 }}>
            {brief}
          </SizableText>
        </YStack>
      ) : null}

      <FocalPoints points={focalPoints} />
      <ConvergenceZones zones={convergenceZones} />
      <SentimentOverview sentiments={sentiments} />

      {/* Coverage stats */}
      <XStack gap="$2" flexWrap="wrap">
        <StatTile value={multiSource} label="Multi-source" />
        <StatTile value={fastMoving} label="Fast-moving" />
        {alerts > 0 ? <StatTile value={alerts} label="Alerts" tone={NEGATIVE} /> : null}
      </XStack>

      {/* Breaking & confirmed */}
      <YStack gap="$1.5">
        <SectionTitle>BREAKING & CONFIRMED</SectionTitle>
        {clusters.map((cluster, i) => (
          <StoryRow key={cluster.id} cluster={cluster} sentiment={sentiments?.[i]} />
        ))}
      </YStack>

      <MissedStories stories={missedStories} />
    </YStack>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
      {children}
    </SizableText>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={92}
      flex={1}
    >
      <SizableText size="$6" color={tone ?? '$color12'}>
        {String(value)}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
    </YStack>
  );
}

function sentimentColor(label?: string): string {
  if (label === 'negative') return NEGATIVE;
  if (label === 'positive') return POSITIVE;
  return NEUTRAL_BAR;
}

function StoryRow({
  cluster,
  sentiment,
}: {
  cluster: ClusteredEvent;
  sentiment?: Sentiment;
}): React.JSX.Element {
  const title = cluster.primaryTitle.slice(0, 100) + (cluster.primaryTitle.length > 100 ? '...' : '');

  const badges: React.JSX.Element[] = [];
  if (cluster.sourceCount >= 3) {
    badges.push(<Badge key="src" tone={POSITIVE}>{`✓ ${cluster.sourceCount} sources`}</Badge>);
  } else if (cluster.sourceCount >= 2) {
    badges.push(<Badge key="src">{`${cluster.sourceCount} sources`}</Badge>);
  }
  if (cluster.velocity && cluster.velocity.level !== 'normal') {
    const arrow = cluster.velocity.trend === 'rising' ? '↑' : '';
    badges.push(
      <Badge key="vel" tone="#f59e0b">{`${arrow}+${cluster.velocity.sourcesPerHour}/hr`}</Badge>,
    );
  }
  if (cluster.isAlert) {
    badges.push(<Badge key="alert" tone={NEGATIVE}>⚠ ALERT</Badge>);
  }

  return (
    <YStack gap="$1" paddingVertical="$1">
      <XStack gap="$2" alignItems="flex-start">
        <XStack
          width={7}
          height={7}
          borderRadius={999}
          backgroundColor={sentimentColor(sentiment?.label)}
          marginTop="$1"
        />
        <SizableText size="$3" color="$color12" flex={1}>
          {title}
        </SizableText>
      </XStack>
      {badges.length > 0 ? (
        <XStack gap="$1.5" flexWrap="wrap" paddingLeft="$3">
          {badges}
        </XStack>
      ) : null}
    </YStack>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }): React.JSX.Element {
  return (
    <XStack
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius="$2"
      backgroundColor="rgba(255,255,255,0.06)"
    >
      <SizableText size="$1" color={tone ?? '$color10'}>
        {children}
      </SizableText>
    </XStack>
  );
}

function SentimentOverview({ sentiments }: { sentiments: Sentiment[] | null }): React.JSX.Element | null {
  if (!sentiments || sentiments.length === 0) return null;

  const negative = sentiments.filter((s) => s.label === 'negative').length;
  const positive = sentiments.filter((s) => s.label === 'positive').length;
  const neutral = sentiments.length - negative - positive;

  const total = sentiments.length;
  const negPct = Math.round((negative / total) * 100);
  const neuPct = Math.round((neutral / total) * 100);
  const posPct = 100 - negPct - neuPct;

  let toneLabel = 'Mixed';
  let toneColor = '$color11';
  if (negative > positive + neutral) {
    toneLabel = 'Negative';
    toneColor = NEGATIVE;
  } else if (positive > negative + neutral) {
    toneLabel = 'Positive';
    toneColor = POSITIVE;
  }

  return (
    <YStack gap="$1">
      <XStack height={6} borderRadius={999} overflow="hidden" backgroundColor="rgba(255,255,255,0.08)">
        <XStack width={`${negPct}%`} height="100%" backgroundColor={NEGATIVE} />
        <XStack width={`${neuPct}%`} height="100%" backgroundColor={NEUTRAL_BAR} />
        <XStack width={`${posPct}%`} height="100%" backgroundColor={POSITIVE} />
      </XStack>
      <XStack justifyContent="space-between" alignItems="center">
        <XStack gap="$2">
          <SizableText size="$1" color={NEGATIVE}>{String(negative)}</SizableText>
          <SizableText size="$1" color="$color10">{String(neutral)}</SizableText>
          <SizableText size="$1" color={POSITIVE}>{String(positive)}</SizableText>
        </XStack>
        <SizableText size="$1" color={toneColor}>{`Overall: ${toneLabel}`}</SizableText>
      </XStack>
    </YStack>
  );
}

const CONVERGENCE_ICONS: Record<string, string> = {
  internet_outage: '🌐',
  military_flight: '✈️',
  military_vessel: '🚢',
  protest: '🪧',
  ais_disruption: '⚓',
};

function ConvergenceZones({ zones }: { zones: RegionalConvergence[] }): React.JSX.Element | null {
  if (zones.length === 0) return null;
  return (
    <YStack gap="$1.5">
      <SectionTitle>📍 GEOGRAPHIC CONVERGENCE</SectionTitle>
      {zones.slice(0, 3).map((zone) => {
        const icons = zone.signalTypes.map((s) => CONVERGENCE_ICONS[s] || '📍').join('');
        return (
          <YStack
            key={zone.region}
            gap="$0.5"
            paddingHorizontal="$2.5"
            paddingVertical="$2"
            borderRadius="$3"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.10)"
            backgroundColor="rgba(255,255,255,0.03)"
          >
            <SizableText size="$3" color="$color12">{`${icons} ${zone.region}`}</SizableText>
            <SizableText size="$2" color="$color11">{zone.description}</SizableText>
            <SizableText size="$1" color="$color9">
              {`${zone.signalTypes.length} signal types • ${zone.totalSignals} events`}
            </SizableText>
          </YStack>
        );
      })}
    </YStack>
  );
}

const FOCAL_ICONS: Record<string, string> = {
  internet_outage: '🌐',
  military_flight: '✈️',
  military_vessel: '⚓',
  protest: '📢',
  ais_disruption: '🚢',
};

function FocalPoints({ points }: { points: FocalPoint[] }): React.JSX.Element | null {
  // Only true correlations — both news AND signals present.
  const correlated = points.filter((fp) => fp.newsMentions > 0 && fp.signalCount > 0).slice(0, 5);
  if (correlated.length === 0) return null;

  return (
    <YStack gap="$1.5">
      <SectionTitle>🎯 FOCAL POINTS</SectionTitle>
      {correlated.map((fp) => {
        const icons = fp.signalTypes.map((s) => FOCAL_ICONS[s] || '').join(' ');
        const top = fp.topHeadlines[0];
        const headline = top?.title?.slice(0, 60) || '';
        const url = sanitizeUrl(top?.url || '');
        const urgencyColor =
          fp.urgency === 'critical' ? NEGATIVE : fp.urgency === 'elevated' ? '#f59e0b' : '$color10';
        return (
          <YStack
            key={fp.id}
            gap="$0.5"
            paddingHorizontal="$2.5"
            paddingVertical="$2"
            borderRadius="$3"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.10)"
            backgroundColor="rgba(255,255,255,0.03)"
          >
            <XStack justifyContent="space-between" alignItems="center" gap="$2">
              <SizableText size="$3" color="$color12">{fp.displayName}</SizableText>
              <SizableText size="$1" color={urgencyColor}>{fp.urgency.toUpperCase()}</SizableText>
            </XStack>
            {icons ? <SizableText size="$2" color="$color11">{icons}</SizableText> : null}
            <SizableText size="$1" color="$color9">
              {`${fp.newsMentions} news • ${fp.signalCount} signals`}
            </SizableText>
            {headline && url ? (
              <a href={url} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
                <SizableText size="$2" color="$color10">
                  {`"${headline}..."`}
                </SizableText>
              </a>
            ) : null}
          </YStack>
        );
      })}
    </YStack>
  );
}

function MissedStories({ stories }: { stories: AnalyzedHeadline[] }): React.JSX.Element | null {
  if (stories.length === 0) return null;
  return (
    <YStack gap="$1.5">
      <SectionTitle>🎯 ML DETECTED</SectionTitle>
      {stories.slice(0, 3).map((story) => {
        const top = story.perspectives
          .filter((p) => p.name !== 'keywords')
          .sort((a, b) => b.score - a.score)[0];
        const name = top?.name ?? 'ml';
        const pct = ((top?.score ?? 0) * 100).toFixed(0);
        const title = story.title.slice(0, 80) + (story.title.length > 80 ? '...' : '');
        return (
          <YStack key={story.id} gap="$1" paddingVertical="$1">
            <XStack gap="$2" alignItems="flex-start">
              <XStack width={7} height={7} borderRadius={999} backgroundColor="#a855f7" marginTop="$1" />
              <SizableText size="$3" color="$color12" flex={1}>{title}</SizableText>
            </XStack>
            <XStack paddingLeft="$3">
              <Badge tone="#a855f7">{`🔬 ${name}: ${pct}%`}</Badge>
            </XStack>
          </YStack>
        );
      })}
    </YStack>
  );
}
