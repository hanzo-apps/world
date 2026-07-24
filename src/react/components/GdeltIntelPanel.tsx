import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { sanitizeUrl } from '@/utils/sanitize';
import {
  getIntelTopics,
  fetchTopicIntelligence,
  formatArticleDate,
  extractDomain,
  type GdeltArticle,
  type IntelTopic,
} from '@/services/gdelt-intel';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * GdeltIntelPanel — the vanilla `GdeltIntelPanel` (src/components/GdeltIntelPanel.ts)
 * ported onto the React Panel chassis. Shape: tabbed — one tab per intel topic
 * (military / cyber / nuclear / sanctions / intelligence / maritime), each tab a
 * GDELT DOC feed of the latest articles for that topic.
 *
 * It REUSES the vanilla data layer VERBATIM: the topic set from `getIntelTopics()`
 * and the per-topic fetch `fetchTopicIntelligence()` (the same `/v1/world/gdelt-doc`
 * service, same 5-minute cache in `@/services/gdelt-intel`), plus the vanilla
 * formatters `formatArticleDate` and `extractDomain`. No fetch / format logic is
 * re-authored — this file owns only which state to show and the rows, in @hanzo/gui
 * longhand primitives.
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so source / time / title render as safe text nodes.
 * URL safety is preserved via `sanitizeUrl` on the article href, verbatim.
 *
 * The chassis owns the frame + loading/empty/error states + the tab bar. A failed
 * fetch maps to an honest error state, an empty article list to an honest empty
 * state — never fabricated data.
 */

/** Tone tint, the vanilla `tone-negative` / `tone-positive` classes as row color. */
function toneColor(tone: number | undefined): string {
  if (tone == null) return '$color12';
  if (tone < -2) return '#ef4444';
  if (tone > 2) return '#22c55e';
  return '$color12';
}

export function GdeltIntelPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  // Topic set is derived once (i18n-resolved names/descriptions), like the vanilla ctor.
  const topics = useMemo<IntelTopic[]>(() => getIntelTopics(), []);
  const [activeId, setActiveId] = useState<string>(() => topics[0]!.id);
  const [articles, setArticles] = useState<GdeltArticle[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === activeId) ?? topics[0]!,
    [topics, activeId],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setState('loading');
      try {
        const data = await fetchTopicIntelligence(activeTopic);
        if (cancelled) return;
        setArticles(data.articles);
        setState(data.articles.length === 0 ? 'empty' : 'ready');
      } catch (error) {
        console.error('[GdeltIntelPanel] Load error:', error);
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
  }, [activeTopic]);

  const tabs = useMemo<PanelTab[]>(
    () =>
      topics.map((topic) => ({
        key: topic.id,
        label: `${topic.icon} ${topic.name}`,
        count: topic.id === activeId ? articles.length : undefined,
      })),
    [topics, activeId, articles.length],
  );

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.gdeltIntel')}
      infoTooltip={t('components.gdeltIntel.infoTooltip')}
      state={state}
      emptyText={t('components.gdelt.empty')}
      errorText={t('common.failedIntelFeed')}
      tabs={tabs}
      activeTab={activeId}
      onTabChange={setActiveId}
      width={380}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1">
        {articles.map((article, i) => (
          <ArticleRow key={`${article.url}:${i}`} article={article} />
        ))}
      </YStack>
    </Panel>
  );
}

function ArticleRow({ article }: { article: GdeltArticle }): React.JSX.Element {
  const domain = article.source || extractDomain(article.url);
  const timeAgo = formatArticleDate(article.date);
  const safeUrl = sanitizeUrl(article.url);

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener"
      style={{ textDecoration: 'none' }}
    >
      <YStack
        gap="$1"
        paddingVertical="$1.5"
        paddingHorizontal="$1"
        borderBottomWidth={1}
        borderColor="rgba(255,255,255,0.06)"
        hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      >
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          <SizableText size="$1" color="$color9" numberOfLines={1}>
            {domain}
          </SizableText>
          {timeAgo ? (
            <SizableText size="$1" color="$color9" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {timeAgo}
            </SizableText>
          ) : null}
        </XStack>
        <SizableText size="$3" color={toneColor(article.tone)} numberOfLines={3}>
          {article.title}
        </SizableText>
      </YStack>
    </a>
  );
}
