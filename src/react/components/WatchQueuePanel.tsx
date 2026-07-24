import { useEffect, useReducer, useRef, type ComponentRef, type Ref } from 'react';
import type { ReactNode } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { YOUTUBE_EMBED_ALLOW, YOUTUBE_EMBED_SANDBOX } from '@/utils/embed';
import { sanitizeUrl } from '@/utils/sanitize';
import { watchQueue, type QueueItem } from '@/services/watch-queue';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * WatchQueuePanel — the vanilla `WatchQueuePanel` (src/components/WatchQueuePanel.ts,
 * "shape other") ported onto the React Panel chassis.
 *
 * It owns NO data of its own: exactly like the vanilla panel it is a pure VIEW over
 * the one `watchQueue` singleton (src/services/watch-queue.ts) — every mutation
 * (select / next / prev / remove) goes through that store and the panel just
 * re-renders on its `subscribe` change events. The queue's dedup-on-id enqueue,
 * the "at most one watching / leaving marks watched" invariant, persistence and the
 * `current()` cursor all stay in the store, reused verbatim; nothing is re-authored
 * here. The player permission strings (`YOUTUBE_EMBED_ALLOW` / `_SANDBOX`) and the
 * `sanitizeUrl` protocol gate are the vanilla utils, reused as-is.
 *
 * The chassis owns the frame + the loading / empty / error states. Because the queue
 * is a synchronous local store (localStorage), there is no fetch that can be pending
 * or fail — so the only honest chassis states are "empty" (nothing queued at all) and
 * "ready"; when items exist but the cursor has fallen off the end (all watched) the
 * stage shows its own inline "nothing playing" note while the list stays visible.
 */
export function WatchQueuePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  // Re-render on any queue mutation — the store is the single source of truth, we
  // just read it fresh each render (same contract as the vanilla panel's subscribe).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => watchQueue.subscribe(bump), []);

  const items = watchQueue.list();
  const current = watchQueue.current();
  const unwatched = watchQueue.unwatchedCount();
  const state: PanelState = items.length === 0 ? 'empty' : 'ready';

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Watch Queue"
      state={state}
      emptyText="Nothing queued yet. Videos, AI-surfaced media and stories you monitor collect here to watch through."
      actions={<CountBadge count={unwatched} />}
    >
      <YStack gap="$2">
        <Stage item={current} />
        <QueueList items={items} currentId={current?.id ?? null} />
      </YStack>
    </Panel>
  );
}

/** Unwatched-backlog count — the vanilla header's `showCount` badge. */
function CountBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <XStack
      minWidth={18}
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius={999}
      alignItems="center"
      justifyContent="center"
      backgroundColor="rgba(255,255,255,0.12)"
    >
      <SizableText size="$1" color="$color11">
        {count}
      </SizableText>
    </XStack>
  );
}

/** The stage: the current item's media + the transport controls. */
function Stage({ item }: { item: QueueItem | null }): React.JSX.Element {
  const playerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = (): void => {
    const el = playerRef.current;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el?.requestFullscreen?.().catch(() => {});
    }
  };

  if (!item) {
    return (
      <SizableText size="$2" color="$color9" paddingVertical="$1">
        Nothing playing — everything queued has been watched.
      </SizableText>
    );
  }

  return (
    <YStack gap="$2">
      <YStack ref={playerRef as unknown as Ref<ComponentRef<typeof YStack>>} borderRadius="$3" overflow="hidden" backgroundColor="rgba(0,0,0,0.35)">
        <Media item={item} />
      </YStack>
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <YStack flex={1}>
          <SizableText size="$1" color="$color9" numberOfLines={1}>
            {item.source}
          </SizableText>
          <SizableText size="$3" color="$color12" numberOfLines={1}>
            {item.title}
          </SizableText>
        </YStack>
        <XStack gap="$1" alignItems="center">
          <ControlButton label="◀" title="Previous" onPress={() => watchQueue.prev()} />
          <ControlButton label="Finish ▶" title="Mark watched & next" onPress={() => watchQueue.next()} />
          <ControlButton label="⤢" title="Fullscreen" onPress={toggleFullscreen} />
        </XStack>
      </XStack>
    </YStack>
  );
}

/**
 * The stage media, one branch per kind — the same three renderings as the vanilla
 * `renderMedia`. Video is a YouTube-nocookie embed with the shared player allow /
 * sandbox; image and story URLs pass the `sanitizeUrl` protocol gate (rejected URLs
 * drop to a blank), with React itself escaping the attribute value.
 */
function Media({ item }: { item: QueueItem }): React.JSX.Element {
  if (item.kind === 'video') {
    const src =
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.ref)}` +
      `?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`;
    return (
      <iframe
        title={item.title}
        src={src}
        allow={YOUTUBE_EMBED_ALLOW}
        sandbox={YOUTUBE_EMBED_SANDBOX}
        allowFullScreen
        style={{ width: '100%', aspectRatio: '16 / 9', border: 0, display: 'block' }}
      />
    );
  }

  if (item.kind === 'image') {
    const url = okUrl(item.ref);
    return url ? (
      <img
        src={url}
        alt={item.title}
        loading="lazy"
        style={{ width: '100%', display: 'block', objectFit: 'cover' }}
      />
    ) : (
      <StoryBlank />
    );
  }

  // story: optional thumbnail over a headline that links out.
  const link = okUrl(item.link);
  const thumb = okUrl(item.thumbnail);
  const headline = (
    <SizableText size="$3" color="$color12" numberOfLines={3}>
      {item.title}
    </SizableText>
  );
  return (
    <YStack>
      {thumb ? (
        <img
          src={thumb}
          alt={item.title}
          loading="lazy"
          style={{ width: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : (
        <StoryBlank />
      )}
      <YStack paddingHorizontal="$2.5" paddingVertical="$2">
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            {headline}
          </a>
        ) : (
          headline
        )}
      </YStack>
    </YStack>
  );
}

function StoryBlank(): React.JSX.Element {
  return <YStack width="100%" height={120} backgroundColor="rgba(255,255,255,0.05)" />;
}

/** The up-next list: click a row to play it, ✕ to remove it. */
function QueueList({ items, currentId }: { items: QueueItem[]; currentId: string | null }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <YStack gap="$0.5">
      {items.map((it) => (
        <QueueRow key={it.id} item={it} isCurrent={it.id === currentId} />
      ))}
    </YStack>
  );
}

const KIND_ICON: Record<QueueItem['kind'], string> = { video: '▶', image: '▦', story: '❏' };

function QueueRow({ item, isCurrent }: { item: QueueItem; isCurrent: boolean }): React.JSX.Element {
  return (
    <XStack
      alignItems="center"
      gap="$2"
      paddingHorizontal="$2"
      paddingVertical="$1"
      borderRadius="$2"
      cursor="pointer"
      opacity={item.status === 'watched' ? 0.5 : 1}
      backgroundColor={isCurrent ? 'rgba(255,255,255,0.10)' : 'transparent'}
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
      pressStyle={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
      onPress={() => watchQueue.select(item.id)}
    >
      <SizableText size="$1" color="$color9">
        {KIND_ICON[item.kind]}
      </SizableText>
      <SizableText size="$2" color="$color12" numberOfLines={1} flex={1}>
        {item.title}
      </SizableText>
      <SizableText size="$1" color="$color9" numberOfLines={1}>
        {item.source}
      </SizableText>
      <XStack
        cursor="pointer"
        paddingHorizontal="$1"
        hoverStyle={{ opacity: 0.7 }}
        onPress={(e: { stopPropagation?: () => void }) => {
          e.stopPropagation?.();
          watchQueue.remove(item.id);
        }}
      >
        <SizableText size="$2" color="$color9">
          ×
        </SizableText>
      </XStack>
    </XStack>
  );
}

function ControlButton({
  label,
  title,
  onPress,
}: {
  label: ReactNode;
  title: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <XStack
      role="button"
      aria-label={title}
      cursor="pointer"
      alignItems="center"
      paddingHorizontal="$2"
      paddingVertical="$1"
      borderRadius="$2"
      backgroundColor="rgba(255,255,255,0.08)"
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
      pressStyle={{ backgroundColor: 'rgba(255,255,255,0.20)' }}
      onPress={onPress}
    >
      <SizableText size="$2" color="$color11">
        {label}
      </SizableText>
    </XStack>
  );
}

/** Reuse the vanilla `sanitizeUrl` protocol gate as a predicate: keep the ORIGINAL
 *  url when it passes (React escapes the attribute itself), drop to '' when rejected. */
function okUrl(url: string | undefined): string {
  return url && sanitizeUrl(url) ? url : '';
}
