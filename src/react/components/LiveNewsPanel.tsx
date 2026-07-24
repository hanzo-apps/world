import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchLiveVideoId } from '@/services/live-news';
import { loadYouTubeAPI, type YouTubePlayer } from '@/services/youtube';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { liveChannels, EMPTY_CHANNEL, type LiveChannel } from '@/config/live-channels';
import { embedIframe } from '@/utils/embed';
import { t } from '@/services/i18n';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * LiveNewsPanel — the vanilla `LiveNewsPanel` (src/components/LiveNewsPanel.ts) ported
 * onto the React Panel chassis, the "other"-shape sibling of MarketsPanel: instead of a
 * data table it hosts a controllable YouTube live stream.
 *
 * It REUSES the vanilla data/embed layer VERBATIM — `fetchLiveVideoId` (the same
 * `/v1/world/youtube/live` fetcher, with its 5-minute cache), `loadYouTubeAPI` +
 * `YouTubePlayer` (the one-and-only IFrame API loader), the `liveChannels()` config (the
 * single channel source of truth, variant-aware), the `isDesktopRuntime` /
 * `getRemoteApiBaseUrl` runtime probes, and the `embedIframe` factory. No data or embed
 * logic is re-authored; this file owns only the React view + the imperative player
 * lifecycle, expressed through the chassis and @hanzo/gui LONGHAND primitives.
 *
 * The chassis owns the frame and the honest loading / empty / error states; this file
 * maps them faithfully to the vanilla behaviour:
 *   resolving the live video       →  state="loading"
 *   channel not live, no fallback  →  state="empty"   ("<name> is not currently live")
 *   YouTube refuses the embed      →  state="error"   ("… YouTube <code>")
 *   a resolved video               →  state="ready"   (the 16:9 player)
 * The channel switcher is the chassis tab bar; Live/Paused, mute and fullscreen are
 * header actions. All the hard-won vanilla behaviours are preserved: 153 → fallbackVideoId
 * retry, 153 → desktop cloud-bridge embed, pause when off-screen, and the 5-minute idle
 * pause that never tears down an actively-playing (or fullscreen) video.
 */

const IDLE_PAUSE_MS = 5 * 60 * 1000;

function resolveYouTubeOrigin(): string | null {
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  try {
    const { protocol, origin, host } = window.location;
    if (protocol === 'http:' || protocol === 'https:') {
      if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) return fallbackOrigin;
      return origin;
    }
    if (protocol === 'tauri:' || protocol === 'asset:') return fallbackOrigin;
  } catch {
    /* ignore invalid location */
  }
  return fallbackOrigin;
}

export function LiveNewsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const channels = useMemo<LiveChannel[]>(() => liveChannels(), []);
  const [activeId, setActiveId] = useState<string>(channels[0]?.id ?? EMPTY_CHANNEL.id);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();
  const [emptyText, setEmptyText] = useState<string | undefined>();
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  // Bumped to force a fresh resolve + re-init (153 fallback retry, desktop-proxy switch).
  const [reinitTick, setReinitTick] = useState(0);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeId) ?? channels[0] ?? EMPTY_CHANNEL,
    [channels, activeId],
  );

  // Imperative player state — refs so the event/observer/idle callbacks always read
  // the live values without re-subscribing.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerElRef = useRef<HTMLDivElement | null>(null);
  const playerReadyRef = useRef(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const desktopProxyRef = useRef(false);
  const desktopIframeRef = useRef<HTMLIFrameElement | null>(null);
  const forceFallbackRef = useRef(false);
  const playingRef = useRef(true);
  const mutedRef = useRef(true);
  const youtubeOrigin = useRef<string | null>(resolveYouTubeOrigin());
  const lifecycleRef = useRef<{ mount: () => void; unmount: () => void }>({ mount: () => {}, unmount: () => {} });

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  const showEmbedError = useCallback((channel: LiveChannel, code: number) => {
    setErrorText(`${channel.name} cannot be embedded in this app (YouTube ${code})`);
    setState('error');
  }, []);

  const destroyPlayer = useCallback(() => {
    playerRef.current?.destroy();
    playerRef.current = null;
    desktopIframeRef.current = null;
    playerReadyRef.current = false;
    currentVideoIdRef.current = null;
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      if (!desktopProxyRef.current) {
        const el = document.createElement('div');
        el.style.width = '100%';
        el.style.height = '100%';
        containerRef.current.appendChild(el);
        playerElRef.current = el;
      } else {
        playerElRef.current = null;
      }
    }
  }, []);

  // Desktop cloud-bridge embed (avoids YouTube 153 in the Tauri webview) — always the
  // remote URL, since the iframe src cannot carry the local sidecar's Authorization.
  const renderDesktopEmbed = useCallback((videoId: string) => {
    if (!containerRef.current) return;
    currentVideoIdRef.current = videoId;
    playerReadyRef.current = true;
    containerRef.current.innerHTML = '';
    const params = new URLSearchParams({
      videoId,
      autoplay: playingRef.current ? '1' : '0',
      mute: mutedRef.current ? '1' : '0',
      origin: window.location.origin,
    });
    const iframe = embedIframe({
      className: 'live-news-embed-frame',
      src: `${getRemoteApiBaseUrl()}/v1/world/youtube/embed?${params.toString()}`,
      title: `${activeChannel.name} live feed`,
      referrerPolicy: 'strict-origin-when-cross-origin',
      loading: 'eager',
    });
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    containerRef.current.appendChild(iframe);
    desktopIframeRef.current = iframe;
  }, [activeChannel.name]);

  // Push play/mute intent at whichever backend is live (JS player or bridge iframe).
  const syncPlayerState = useCallback(() => {
    const videoId = activeChannel.videoId;
    if (!videoId) return;
    if (desktopProxyRef.current) {
      if (currentVideoIdRef.current !== videoId) renderDesktopEmbed(videoId);
      return;
    }
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;

    if (currentVideoIdRef.current !== videoId) {
      currentVideoIdRef.current = videoId;
      if (playingRef.current) player.loadVideoById(videoId);
      else player.cueVideoById(videoId);
    }
    if (mutedRef.current) player.mute?.();
    else player.unMute?.();
    if (playingRef.current) player.playVideo?.();
    else player.pauseVideo?.();
  }, [activeChannel.videoId, renderDesktopEmbed]);

  // Stand up the JS IFrame player (or the desktop bridge) into the mounted container.
  // The video was already resolved by the orchestration effect below.
  const initPlayer = useCallback(async () => {
    const channel = activeChannel;
    if (!channel.videoId) return;

    if (desktopProxyRef.current) {
      renderDesktopEmbed(channel.videoId);
      return;
    }

    await loadYouTubeAPI();
    if (playerRef.current || !playerElRef.current || !window.YT?.Player) return;

    playerRef.current = new window.YT.Player(playerElRef.current, {
      host: 'https://www.youtube-nocookie.com',
      videoId: channel.videoId,
      playerVars: {
        autoplay: playingRef.current ? 1 : 0,
        mute: mutedRef.current ? 1 : 0,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        ...(youtubeOrigin.current
          ? { origin: youtubeOrigin.current, widget_referrer: youtubeOrigin.current }
          : {}),
      },
      events: {
        onReady: () => {
          playerReadyRef.current = true;
          currentVideoIdRef.current = channel.videoId ?? null;
          const iframe = playerRef.current?.getIframe?.();
          if (iframe) iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          syncPlayerState();
        },
        onError: (event: { data: number }) => {
          const code = Number(event?.data ?? 0);
          // Retry once with the known fallback stream.
          if (code === 153 && channel.fallbackVideoId && channel.videoId !== channel.fallbackVideoId) {
            destroyPlayer();
            forceFallbackRef.current = true;
            setReinitTick((n) => n + 1);
            return;
          }
          // Desktop last resort: cloud bridge embed.
          if (code === 153 && isDesktopRuntime()) {
            desktopProxyRef.current = true;
            destroyPlayer();
            setReinitTick((n) => n + 1);
            return;
          }
          destroyPlayer();
          showEmbedError(channel, code);
        },
      },
    });
  }, [activeChannel, renderDesktopEmbed, syncPlayerState, destroyPlayer, showEmbedError]);

  // Keep the container ref-callback stable (a changing identity would spuriously
  // tear down + re-init the player); route to the latest closures via lifecycleRef.
  useEffect(() => {
    lifecycleRef.current = {
      mount: () => {
        if (!containerRef.current) return;
        if (!desktopProxyRef.current) {
          const el = document.createElement('div');
          el.style.width = '100%';
          el.style.height = '100%';
          containerRef.current.appendChild(el);
          playerElRef.current = el;
        }
        void initPlayer();
      },
      unmount: destroyPlayer,
    };
  });

  const onContainer = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      containerRef.current = node;
      lifecycleRef.current.mount();
    } else {
      lifecycleRef.current.unmount();
      containerRef.current = null;
    }
  }, []);

  // Orchestration: resolve the active channel's live video (fetcher reused verbatim),
  // pick the honest chassis state, and — if the player is already mounted — switch it
  // to the newly-resolved stream. Mirrors vanilla resolveChannelVideo + switchChannel.
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const channel = activeChannel;

    void (async () => {
      const useFallback = channel.useFallbackOnly || forceFallbackRef.current;
      forceFallbackRef.current = false;
      const liveId = useFallback ? null : await fetchLiveVideoId(channel.handle);
      if (cancelled) return;
      channel.videoId = liveId || channel.fallbackVideoId;
      channel.isLive = !!liveId;

      if (!channel.videoId) {
        setEmptyText(`${channel.name} is not currently live`);
        setState('empty');
        return;
      }
      setState('ready');
      // If the player is already mounted (channel switch / proxy re-init), drive it;
      // on first mount the container ref-callback runs initPlayer instead.
      if (desktopProxyRef.current) renderDesktopEmbed(channel.videoId);
      else if (playerRef.current) syncPlayerState();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, reinitTick]);

  // Re-apply play/mute intent whenever it changes.
  useEffect(() => {
    if (state === 'ready') syncPlayerState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isMuted]);

  // Pause playback while the panel is off-screen; resume (honoring intent) on return.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let wasIntersecting = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const nowIntersecting = entries.some((e) => e.isIntersecting);
        if (nowIntersecting && !wasIntersecting) syncPlayerState();
        else if (!nowIntersecting && wasIntersecting) playerRef.current?.pauseVideo?.();
        wasIntersecting = nowIntersecting;
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state, syncPlayerState]);

  // 5-minute idle pause. A visible, actively-playing (or fullscreen) video means the
  // user IS watching — passive viewing fires no input, so never tear it down; only
  // reschedule. Genuine "walked away" is covered by the tab going hidden.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const reset = (): void => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(onIdle, IDLE_PAUSE_MS);
    };
    const onIdle = (): void => {
      const fsEl = document.fullscreenElement;
      const playerFullscreen = !!fsEl && !!containerRef.current &&
        (fsEl === containerRef.current || containerRef.current.contains(fsEl) || fsEl.contains(containerRef.current));
      if ((playingRef.current || playerFullscreen) && !document.hidden) {
        reset();
        return;
      }
      playerRef.current?.pauseVideo?.();
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        if (timeout) clearTimeout(timeout);
      } else reset();
    };
    const events: (keyof DocumentEventMap)[] = ['mousedown', 'keydown', 'scroll', 'touchstart', 'fullscreenchange'];
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    reset();
    return () => {
      if (timeout) clearTimeout(timeout);
      events.forEach((e) => document.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);
  const enterFullscreen = useCallback(() => {
    const target = containerRef.current;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void target?.requestFullscreen?.().catch(() => {});
  }, []);

  const tabs = useMemo(
    () => channels.map((c) => ({ key: c.id, label: c.name })),
    [channels],
  );

  const actions = (
    <XStack alignItems="center" gap="$1.5">
      <HeaderAction onPress={togglePlay} label="Toggle playback">
        <XStack alignItems="center" gap="$1">
          <XStack width={6} height={6} borderRadius={999} backgroundColor={isPlaying ? '#ef4444' : '#888'} />
          <SizableText size="$1" color="$color11">
            {isPlaying ? 'Live' : 'Paused'}
          </SizableText>
        </XStack>
      </HeaderAction>
      <HeaderAction onPress={toggleMute} label="Toggle sound">
        <SizableText size="$2" color="$color11">
          {isMuted ? '🔇' : '🔊'}
        </SizableText>
      </HeaderAction>
      <HeaderAction onPress={enterFullscreen} label="Fullscreen">
        <SizableText size="$2" color="$color11">
          ⛶
        </SizableText>
      </HeaderAction>
    </XStack>
  );

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.liveNews')}
      state={state}
      emptyText={emptyText}
      errorText={errorText}
      actions={actions}
      tabs={tabs}
      activeTab={activeId}
      onTabChange={setActiveId}
      scroll={false}
    >
      <YStack width="100%" aspectRatio={16 / 9} backgroundColor="#000" borderRadius="$2" overflow="hidden">
        <div ref={onContainer} style={{ width: '100%', height: '100%' }} />
      </YStack>
    </Panel>
  );
}

function HeaderAction({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <XStack
      role="button"
      aria-label={label}
      tabIndex={0}
      cursor="pointer"
      alignItems="center"
      paddingHorizontal="$1.5"
      paddingVertical="$1"
      borderRadius="$3"
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
      onPress={onPress}
    >
      {children}
    </XStack>
  );
}
