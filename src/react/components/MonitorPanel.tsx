import { useCallback, useEffect, useState } from 'react';
import { YStack, XStack, SizableText, Input, Button } from '@hanzo/gui';
import { loadMonitors, saveMonitors, fetchMonitorMatches, type MonitorMatch } from '@/services/monitors';
import { MONITOR_COLORS, STORAGE_KEYS } from '@/config';
import { generateId, getCSSColor, formatTime, loadFromStorage } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import type { Monitor, NewsItem } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * MonitorPanel — the vanilla `MonitorPanel` (src/components/MonitorPanel.ts) ported
 * onto the React Panel chassis. Shape: other. Unlike a data panel it is a CONTROL
 * surface — the analyst's keyword watchlist — so its body is always shown (the input
 * + tag list mirror the vanilla `.monitor-input-container` + `.monitor-tag` markup);
 * the contextual "add keywords" / "no matches" / match-count copy lives INSIDE the
 * results area exactly as the vanilla panel renders it, not as a chassis empty state.
 *
 * The data layer is REUSED verbatim, not re-authored:
 *   • `@/services/monitors` — `loadMonitors` (server list when signed in, else the
 *     localStorage mirror), `saveMonitors` (localStorage + Go backend), and
 *     `fetchMonitorMatches` (lake-wide server matching; null when signed out). The
 *     panel seeds synchronously from `loadFromStorage(STORAGE_KEYS.monitors)` so it
 *     paints on first frame just like the vanilla constructor's `initialMonitors`.
 *   • The add path reuses `generateId` + `MONITOR_COLORS` (cycled by list length,
 *     `getCSSColor('--status-live')` fallback) — the SAME construction as the vanilla
 *     `addMonitor`, and the SAME `keywords.split(',').map(trim().toLowerCase())`.
 *   • The signed-out match path is the vanilla `renderResults` logic carried over
 *     verbatim: word-boundary keyword regex over `title + description`, then the
 *     dedup-by-`link` transform, then `.slice(0, 10)`. It runs over the React news
 *     store; that store is not wired yet (App's `getAllNews` resolves to `[]`, as in
 *     useSearch/useCountryIntel), so the local path currently yields the honest
 *     no-news state and lights up unchanged the moment a React news store lands.
 *   • `formatTime` + `@/utils/sanitize`'s `sanitizeUrl` format the rows. React escapes
 *     text nodes, so the vanilla `escapeHtml` calls fall away (sanitizeUrl stays — it
 *     guards the `href`, an escaping React does NOT do).
 *
 * The port is purely the view, in @hanzo/gui LONGHAND primitives against the chassis,
 * which owns the frame plus the loading / error placeholder states.
 */

/** A matched news row, normalized from either match source into one render shape. */
interface ResultRow {
  color?: string;
  source: string;
  title: string;
  link: string;
  when: Date;
}

/**
 * The vanilla `renderResults` matcher + dedup, carried over verbatim as a pure
 * function. Word-boundary regex avoids false positives ("ai" in "train"); dedup is
 * by `link`; the 10-row cap is applied by the caller (mirroring `.slice(0, 10)`).
 */
function matchNews(news: NewsItem[], monitors: Monitor[]): NewsItem[] {
  const matchedItems: NewsItem[] = [];
  news.forEach((item) => {
    monitors.forEach((monitor) => {
      // Search both title and description for better coverage.
      const searchText = `${item.title} ${(item as unknown as { description?: string }).description || ''}`.toLowerCase();
      const matched = monitor.keywords.some((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        return regex.test(searchText);
      });
      if (matched) matchedItems.push({ ...item, monitorColor: monitor.color });
    });
  });

  // Dedupe by link.
  const seen = new Set<string>();
  return matchedItems.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

export function MonitorPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  // Seed synchronously from the localStorage mirror so the list paints on first
  // frame (the vanilla `initialMonitors` behaviour), then reconcile with the server.
  const [monitors, setMonitors] = useState<Monitor[]>(() =>
    loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []),
  );
  const [keywords, setKeywords] = useState('');
  const [serverMatches, setServerMatches] = useState<MonitorMatch[] | null>(null);
  const [state, setState] = useState<PanelState>('ready');

  // The React news store is not wired yet (App's getAllNews → []); the local
  // matcher activates unchanged once it lands.
  const news: NewsItem[] = [];

  // Adopt the signed-in user's server-side monitors once identity resolves, so a
  // second device shows the monitors made on the first (vanilla syncMonitorsFromServer).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadMonitors();
        if (!cancelled) setMonitors(loaded);
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recompute results whenever the monitor list changes: the Go backend matches the
  // whole lake when signed in, else we fall back to the local matcher (vanilla
  // updateMonitorResults).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const matches = await fetchMonitorMatches();
        if (!cancelled) setServerMatches(matches);
      } catch {
        if (!cancelled) setServerMatches(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monitors]);

  const addMonitor = useCallback(() => {
    const raw = keywords.trim();
    if (!raw) return;
    setMonitors((prev) => {
      const monitor: Monitor = {
        id: generateId(),
        keywords: raw.split(',').map((k) => k.trim().toLowerCase()),
        color: MONITOR_COLORS[prev.length % MONITOR_COLORS.length] ?? getCSSColor('--status-live'),
      };
      const next = [...prev, monitor];
      void saveMonitors(next); // localStorage + the Go backend when signed in
      return next;
    });
    setKeywords('');
  }, [keywords]);

  const removeMonitor = useCallback((id: string) => {
    setMonitors((prev) => {
      const next = prev.filter((m) => m.id !== id);
      void saveMonitors(next);
      return next;
    });
  }, []);

  // Normalize whichever match source is live into one row shape. Signed in → the
  // lake matches (no dedup, as in vanilla renderServerMatches). Signed out → the
  // local matcher + dedup, then the 10-row cap.
  const rows: ResultRow[] =
    serverMatches !== null
      ? serverMatches.map((m) => ({
          color: m.color,
          source: m.source,
          title: m.title,
          link: m.link,
          when: new Date(m.ts),
        }))
      : matchNews(news, monitors).map((item) => ({
          color: item.monitorColor,
          source: item.source,
          title: item.title,
          link: item.link,
          when: item.pubDate,
        }));

  const total = rows.length;
  const countText =
    total > 10
      ? t('components.monitor.showingMatches', { count: '10', total: String(total) })
      : `${total} ${total === 1 ? t('components.monitor.match') : t('components.monitor.matches')}`;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.monitors')}
      state={state}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$2.5">
        {/* Input row — the vanilla `.monitor-input-container` (Enter or the button adds). */}
        <XStack gap="$2" alignItems="center">
          <Input
            flex={1}
            size="$2"
            value={keywords}
            onChangeText={setKeywords}
            onSubmitEditing={addMonitor}
            placeholder={t('components.monitor.placeholder')}
          />
          <Button size="$2" onPress={addMonitor}>
            {t('components.monitor.add')}
          </Button>
        </XStack>

        {/* Tag list — the vanilla `.monitor-tag` chips with the color swatch + ✕. */}
        {monitors.length > 0 ? (
          <XStack gap="$1.5" flexWrap="wrap">
            {monitors.map((m) => (
              <XStack
                key={m.id}
                alignItems="center"
                gap="$1.5"
                paddingHorizontal="$2"
                paddingVertical="$1"
                borderRadius="$3"
                backgroundColor="rgba(255,255,255,0.08)"
              >
                <XStack width={8} height={8} borderRadius={999} backgroundColor={m.color} />
                <SizableText size="$2" color="$color12">
                  {m.keywords.join(', ')}
                </SizableText>
                <SizableText
                  size="$2"
                  color="$color9"
                  cursor="pointer"
                  hoverStyle={{ color: '$color12' }}
                  onPress={() => removeMonitor(m.id)}
                  aria-label="Remove monitor"
                >
                  ×
                </SizableText>
              </XStack>
            ))}
          </XStack>
        ) : null}

        {/* Results — the vanilla `#monitorsResults`: contextual hint, or matched rows. */}
        {monitors.length === 0 ? (
          <SizableText size="$1" color="$color9" paddingTop="$1">
            {t('components.monitor.addKeywords')}
          </SizableText>
        ) : total === 0 ? (
          <SizableText size="$1" color="$color9" paddingTop="$1">
            {t('components.monitor.noMatches', { count: String(news.length) })}
          </SizableText>
        ) : (
          <YStack gap="$2">
            <SizableText size="$1" color="$color9">
              {countText}
            </SizableText>
            {rows.slice(0, 10).map((row) => (
              <MonitorResultRow key={row.link} row={row} />
            ))}
          </YStack>
        )}
      </YStack>
    </Panel>
  );
}

function MonitorResultRow({ row }: { row: ResultRow }): React.JSX.Element {
  const href = sanitizeUrl(row.link);
  // sanitizeUrl gates the href to http(s)/relative just as the vanilla panel does;
  // the native <a> keeps link semantics that a SizableText tag cannot express.
  return (
    <a href={href} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
      <YStack
        paddingLeft="$2"
        borderLeftWidth={2}
        borderColor={row.color || 'rgba(255,255,255,0.12)'}
        gap="$0.5"
      >
        <SizableText size="$1" color="$color9">
          {row.source}
        </SizableText>
        <SizableText size="$2" color="$color12">
          {row.title}
        </SizableText>
        <SizableText size="$1" color="$color8">
          {formatTime(row.when)}
        </SizableText>
      </YStack>
    </a>
  );
}
