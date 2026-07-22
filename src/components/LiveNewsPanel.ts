import { Panel } from './Panel';
import { fetchLiveVideoId } from '@/services/live-news';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { t } from '../services/i18n';
import { loadYouTubeAPI, type YouTubePlayer } from '@/services/youtube';
import { liveChannels, EMPTY_CHANNEL, type LiveChannel } from '@/config/live-channels';

export class LiveNewsPanel extends Panel {
  private activeChannel: LiveChannel = liveChannels()[0] ?? EMPTY_CHANNEL;
  private channelSwitcher: HTMLElement | null = null;
  // Pause the embed while the panel is off-screen (hidden by a variant switch, or
  // scrolled away) so it stops decoding — mirrors LiveWebcamsPanel. Starts true so
  // a panel that is never observed still plays.
  private observer: IntersectionObserver | null = null;
  private isIntersecting = true;
  private isMuted = true;
  private isPlaying = true;
  private wasPlayingBeforeIdle = true;
  private muteBtn: HTMLButtonElement | null = null;
  private liveBtn: HTMLButtonElement | null = null;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly IDLE_PAUSE_MS = 5 * 60 * 1000; // 5 minutes
  private boundVisibilityHandler!: () => void;
  private boundIdleResetHandler!: () => void;

  // YouTube Player API state
  private player: YouTubePlayer | null = null;
  private playerContainer: HTMLDivElement | null = null;
  private playerElement: HTMLDivElement | null = null;
  private playerElementId: string;
  private isPlayerReady = false;
  private currentVideoId: string | null = null;
  private readonly youtubeOrigin: string | null;
  private forceFallbackVideoForNextInit = false;

  // Desktop fallback: embed via cloud bridge page to avoid YouTube 153.
  // Starts false — try native JS API first; switches to true on Error 153.
  private useDesktopEmbedProxy = false;
  private desktopEmbedIframe: HTMLIFrameElement | null = null;
  private desktopEmbedRenderToken = 0;
  private boundMessageHandler!: (e: MessageEvent) => void;

  constructor() {
    super({ id: 'live-news', title: t('panels.liveNews') });
    this.youtubeOrigin = LiveNewsPanel.resolveYouTubeOrigin();
    this.playerElementId = `live-news-player-${Date.now()}`;
    // The panel-content / player layout CSS is keyed on `#live-news` (padding:0 +
    // flex-column so the 16:9 video fills the panel edge-to-edge at any width).
    // data-panel alone never matched it, leaving the video under the generic 8px
    // padding — set the id so the intended fill CSS actually applies.
    this.element.id = 'live-news';
    this.element.classList.add('panel-wide');
    this.createLiveButton();
    this.createMuteButton();
    this.createFullscreenButton();
    this.createChannelSwitcher();
    this.setupBridgeMessageListener();
    this.renderPlayer();
    this.setupIdleDetection();
    this.setupIntersectionObserver();
  }

  // Pause playback when the panel isn't intersecting the viewport, resume when it
  // is. Same approach as LiveWebcamsPanel — it doesn't touch isPlaying (the user's
  // intent); syncPlayerState honors that intent when the panel returns to view.
  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        const wasIntersecting = this.isIntersecting;
        this.isIntersecting = entries.some((e) => e.isIntersecting);
        if (this.isIntersecting && !wasIntersecting) {
          this.syncPlayerState();
        } else if (!this.isIntersecting && wasIntersecting) {
          this.player?.pauseVideo?.();
          if (this.useDesktopEmbedProxy) this.postToEmbed({ type: 'pause' });
        }
      },
      { threshold: 0.1 },
    );
    this.observer.observe(this.element);
  }

  private get embedOrigin(): string {
    try { return new URL(getRemoteApiBaseUrl()).origin; } catch { return (typeof window !== 'undefined' ? window.location.origin : ''); }
  }

  private setupBridgeMessageListener(): void {
    this.boundMessageHandler = (e: MessageEvent) => {
      if (e.source !== this.desktopEmbedIframe?.contentWindow) return;
      const expected = this.embedOrigin;
      if (e.origin !== expected && e.origin !== 'http://127.0.0.1:46123') return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object' || !msg.type) return;
      if (msg.type === 'yt-ready') {
        this.isPlayerReady = true;
        this.syncDesktopEmbedState();
      } else if (msg.type === 'yt-error') {
        const code = Number(msg.code ?? 0);
        if (code === 153 && this.activeChannel.fallbackVideoId &&
          this.activeChannel.videoId !== this.activeChannel.fallbackVideoId) {
          this.activeChannel.videoId = this.activeChannel.fallbackVideoId;
          this.renderDesktopEmbed(true);
        } else {
          this.showEmbedError(this.activeChannel, code);
        }
      }
    };
    window.addEventListener('message', this.boundMessageHandler);
  }

  private static resolveYouTubeOrigin(): string | null {
    const fallbackOrigin = (typeof window !== 'undefined' ? window.location.origin : '');

    try {
      const { protocol, origin, host } = window.location;
      if (protocol === 'http:' || protocol === 'https:') {
        // Desktop webviews commonly run from tauri.localhost which can trigger
        // YouTube embed restrictions. Use canonical public origin instead.
        if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) {
          return fallbackOrigin;
        }
        return origin;
      }
      if (protocol === 'tauri:' || protocol === 'asset:') {
        return fallbackOrigin;
      }
    } catch {
      // Ignore invalid location values.
    }
    return fallbackOrigin;
  }

  private setupIdleDetection(): void {
    // Suspend idle timer when hidden, resume when visible
    this.boundVisibilityHandler = () => {
      if (document.hidden) {
        // Suspend idle timer so background playback isn't killed
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
      } else {
        this.resumeFromIdle();
        this.boundIdleResetHandler();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    // Track user activity to detect idle (pauses after 5 min inactivity)
    this.boundIdleResetHandler = () => {
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      this.idleTimeout = setTimeout(() => this.pauseForIdle(), this.IDLE_PAUSE_MS);
    };

    // fullscreenchange counts as activity: entering/exiting fullscreen the player is
    // the user actively engaging with it (fullscreen video swallows mouse/keyboard,
    // so those idle-reset events never fire while watching — the "exited fullscreen
    // and stopped it" bug).
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'fullscreenchange'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler, { passive: true });
    });

    // Start the idle timer
    this.boundIdleResetHandler();
  }

  private pauseForIdle(): void {
    // A visible, actively-playing video means the user IS watching — passive
    // viewing fires no mousedown/keydown/scroll, so the input-idle heuristic
    // must never tear it down (that was the "video disappears after a few
    // minutes" bug). Reschedule instead; the visibilitychange handler already
    // covers the genuine "tab hidden / walked away" case.
    //
    // Fullscreen is the strongest "actively watching" signal: fullscreen video
    // captures input so no idle-reset event fires, and tearing down the player
    // element FORCES an exit from fullscreen AND stops playback — the exact
    // "listening fullscreen and it exited + stopped" report. Never idle-kill it.
    const el = document.fullscreenElement;
    const playerFullscreen = !!el && !!this.playerContainer &&
      (el === this.playerContainer || this.playerContainer.contains(el) || el.contains(this.playerContainer));
    if ((this.isPlaying || playerFullscreen) && !document.hidden) {
      this.boundIdleResetHandler();
      return;
    }
    if (this.isPlaying) {
      this.wasPlayingBeforeIdle = true;
      this.isPlaying = false;
      this.updateLiveIndicator();
    }
    this.destroyPlayer();
  }

  private destroyPlayer(): void {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    this.desktopEmbedIframe = null;
    this.desktopEmbedRenderToken += 1;
    this.isPlayerReady = false;
    this.currentVideoId = null;

    // Clear the container to remove player/iframe
    if (this.playerContainer) {
      this.playerContainer.innerHTML = '';

      if (!this.useDesktopEmbedProxy) {
        // Recreate player element for JS API mode
        this.playerElement = document.createElement('div');
        this.playerElement.id = this.playerElementId;
        this.playerContainer.appendChild(this.playerElement);
      } else {
        this.playerElement = null;
      }
    }
  }

  private resumeFromIdle(): void {
    if (this.wasPlayingBeforeIdle && !this.isPlaying) {
      this.isPlaying = true;
      this.updateLiveIndicator();
      void this.initializePlayer();
    }
  }

  private createLiveButton(): void {
    this.liveBtn = document.createElement('button');
    this.liveBtn.className = 'live-indicator-btn';
    this.liveBtn.title = 'Toggle playback';
    this.updateLiveIndicator();
    this.liveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlayback();
    });

    const header = this.element.querySelector('.panel-header');
    header?.appendChild(this.liveBtn);
  }

  private updateLiveIndicator(): void {
    if (!this.liveBtn) return;
    this.liveBtn.innerHTML = this.isPlaying
      ? '<span class="live-dot"></span>Live'
      : '<span class="live-dot paused"></span>Paused';
    this.liveBtn.classList.toggle('paused', !this.isPlaying);
  }

  private togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    this.wasPlayingBeforeIdle = this.isPlaying;
    this.updateLiveIndicator();
    this.syncPlayerState();
  }

  private createMuteButton(): void {
    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'live-mute-btn';
    this.muteBtn.title = 'Toggle sound';
    this.updateMuteIcon();
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
    });

    const header = this.element.querySelector('.panel-header');
    header?.appendChild(this.muteBtn);
  }

  // Enlarge the video to true fullscreen. Targets the player container (the
  // iframe's parent) so the YouTube embed fills the screen; the header controls
  // go along with it. Falls back to a no-op if the browser denies the request.
  private createFullscreenButton(): void {
    const btn = document.createElement('button');
    btn.className = 'live-fullscreen-btn';
    btn.title = 'Fullscreen';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = this.playerContainer ?? this.element;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => { /* ignore */ });
      } else {
        void target.requestFullscreen?.().catch(() => { /* ignore */ });
      }
    });
    const header = this.element.querySelector('.panel-header');
    header?.appendChild(btn);
  }

  private updateMuteIcon(): void {
    if (!this.muteBtn) return;
    this.muteBtn.innerHTML = this.isMuted
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    this.muteBtn.classList.toggle('unmuted', !this.isMuted);
  }

  private toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.updateMuteIcon();
    this.syncPlayerState();
  }

  private createChannelSwitcher(): void {
    this.channelSwitcher = document.createElement('div');
    this.channelSwitcher.className = 'live-news-switcher';

    liveChannels().forEach(channel => {
      const btn = document.createElement('button');
      btn.className = `live-channel-btn ${channel.id === this.activeChannel.id ? 'active' : ''}`;
      btn.dataset.channelId = channel.id;
      btn.textContent = channel.name;
      btn.addEventListener('click', () => this.switchChannel(channel));
      this.channelSwitcher!.appendChild(btn);
    });

    this.element.insertBefore(this.channelSwitcher, this.content);
  }

  private async resolveChannelVideo(channel: LiveChannel, forceFallback = false): Promise<void> {
    const useFallbackVideo = channel.useFallbackOnly || forceFallback;
    const liveVideoId = useFallbackVideo ? null : await fetchLiveVideoId(channel.handle);
    channel.videoId = liveVideoId || channel.fallbackVideoId;
    channel.isLive = !!liveVideoId;
  }

  private async switchChannel(channel: LiveChannel): Promise<void> {
    if (channel.id === this.activeChannel.id) return;

    this.activeChannel = channel;

    this.channelSwitcher?.querySelectorAll('.live-channel-btn').forEach(btn => {
      const btnEl = btn as HTMLElement;
      btnEl.classList.toggle('active', btnEl.dataset.channelId === channel.id);
      if (btnEl.dataset.channelId === channel.id) {
        btnEl.classList.add('loading');
      }
    });

    await this.resolveChannelVideo(channel);

    this.channelSwitcher?.querySelectorAll('.live-channel-btn').forEach(btn => {
      const btnEl = btn as HTMLElement;
      btnEl.classList.remove('loading');
      if (btnEl.dataset.channelId === channel.id && !channel.videoId) {
        btnEl.classList.add('offline');
      }
    });

    if (!channel.videoId) {
      this.showOfflineMessage(channel);
      return;
    }

    if (this.useDesktopEmbedProxy) {
      this.renderDesktopEmbed(true);
      return;
    }

    if (!this.player) {
      this.ensurePlayerContainer();
      void this.initializePlayer();
      return;
    }

    this.syncPlayerState();
  }

  private showOfflineMessage(channel: LiveChannel): void {
    this.content.innerHTML = `
      <div class="live-offline">
        <div class="offline-icon">📺</div>
        <div class="offline-text">${channel.name} is not currently live</div>
        <button class="offline-retry" onclick="this.closest('.panel').querySelector('.live-channel-btn.active')?.click()">Retry</button>
      </div>
    `;
  }

  private showEmbedError(channel: LiveChannel, errorCode: number): void {
    const watchUrl = channel.videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(channel.videoId)}`
      : `https://www.youtube.com/${channel.handle}`;

    this.content.innerHTML = `
      <div class="live-offline">
        <div class="offline-icon">!</div>
        <div class="offline-text">${channel.name} cannot be embedded in this app (YouTube ${errorCode})</div>
        <a class="offline-retry" href="${watchUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
      </div>
    `;
  }

  private renderPlayer(): void {
    this.ensurePlayerContainer();
    void this.initializePlayer();
  }

  private ensurePlayerContainer(): void {
    this.content.innerHTML = '';
    this.playerContainer = document.createElement('div');
    this.playerContainer.className = 'live-news-player';

    if (!this.useDesktopEmbedProxy) {
      this.playerElement = document.createElement('div');
      this.playerElement.id = this.playerElementId;
      this.playerContainer.appendChild(this.playerElement);
    } else {
      this.playerElement = null;
    }

    this.content.appendChild(this.playerContainer);
  }

  private buildDesktopEmbedPath(videoId: string, origin?: string): string {
    const params = new URLSearchParams({
      videoId,
      autoplay: this.isPlaying ? '1' : '0',
      mute: this.isMuted ? '1' : '0',
    });
    if (origin) params.set('origin', origin);
    return `/v1/world/youtube/embed?${params.toString()}`;
  }



  private postToEmbed(msg: Record<string, unknown>): void {
    if (!this.desktopEmbedIframe?.contentWindow) return;
    this.desktopEmbedIframe.contentWindow.postMessage(msg, this.embedOrigin);
  }

  private syncDesktopEmbedState(): void {
    this.postToEmbed({ type: this.isPlaying ? 'play' : 'pause' });
    this.postToEmbed({ type: this.isMuted ? 'mute' : 'unmute' });
  }

  private renderDesktopEmbed(force = false): void {
    if (!this.useDesktopEmbedProxy) return;
    void this.renderDesktopEmbedAsync(force);
  }

  private async renderDesktopEmbedAsync(force = false): Promise<void> {
    const videoId = this.activeChannel.videoId;
    if (!videoId) {
      this.showOfflineMessage(this.activeChannel);
      return;
    }

    // Only recreate iframe when video ID changes (not for play/mute toggling).
    if (!force && this.currentVideoId === videoId && this.desktopEmbedIframe) {
      this.syncDesktopEmbedState();
      return;
    }

    const renderToken = ++this.desktopEmbedRenderToken;
    this.currentVideoId = videoId;
    this.isPlayerReady = true;

    // Always recreate if container was removed from DOM (e.g. showEmbedError replaced content).
    if (!this.playerContainer || !this.playerContainer.parentElement) {
      this.ensurePlayerContainer();
    }

    if (!this.playerContainer) {
      return;
    }

    this.playerContainer.innerHTML = '';

    // Always use cloud URL for iframe embeds — the local sidecar requires
    // an Authorization header that iframe src requests cannot carry.
    const remoteBase = getRemoteApiBaseUrl();
    const embedUrl = `${remoteBase}${this.buildDesktopEmbedPath(videoId)}`;

    if (renderToken !== this.desktopEmbedRenderToken) {
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'live-news-embed-frame';
    iframe.src = embedUrl;
    iframe.title = `${this.activeChannel.name} live feed`;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    iframe.setAttribute('loading', 'eager');

    this.playerContainer.appendChild(iframe);
    this.desktopEmbedIframe = iframe;
  }

  private async initializePlayer(): Promise<void> {
    if (!this.useDesktopEmbedProxy && this.player) return;

    const useFallbackVideo = this.activeChannel.useFallbackOnly || this.forceFallbackVideoForNextInit;
    this.forceFallbackVideoForNextInit = false;
    await this.resolveChannelVideo(this.activeChannel, useFallbackVideo);

    if (!this.activeChannel.videoId) {
      this.showOfflineMessage(this.activeChannel);
      return;
    }

    if (this.useDesktopEmbedProxy) {
      this.renderDesktopEmbed(true);
      return;
    }

    await loadYouTubeAPI();
    if (this.player || !this.playerElement || !window.YT?.Player) return;

    this.player = new window.YT!.Player(this.playerElement, {
      host: 'https://www.youtube-nocookie.com',
      videoId: this.activeChannel.videoId,
      playerVars: {
        autoplay: this.isPlaying ? 1 : 0,
        mute: this.isMuted ? 1 : 0,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        ...(this.youtubeOrigin
          ? {
            origin: this.youtubeOrigin,
            widget_referrer: this.youtubeOrigin,
          }
          : {}),
      },
      events: {
        onReady: () => {
          this.isPlayerReady = true;
          this.currentVideoId = this.activeChannel.videoId || null;
          const iframe = this.player?.getIframe?.();
          if (iframe) iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          this.syncPlayerState();
        },
        onError: (event) => {
          const errorCode = Number(event?.data ?? 0);

          // Retry once with known fallback stream.
          if (
            errorCode === 153 &&
            this.activeChannel.fallbackVideoId &&
            this.activeChannel.videoId !== this.activeChannel.fallbackVideoId
          ) {
            this.destroyPlayer();
            this.forceFallbackVideoForNextInit = true;
            this.ensurePlayerContainer();
            void this.initializePlayer();
            return;
          }

          // Desktop-specific last resort: switch to cloud bridge embed.
          if (errorCode === 153 && isDesktopRuntime()) {
            this.useDesktopEmbedProxy = true;
            this.destroyPlayer();
            this.ensurePlayerContainer();
            this.renderDesktopEmbed(true);
            return;
          }

          this.destroyPlayer();
          this.showEmbedError(this.activeChannel, errorCode);
        },
      },
    });
  }

  private syncPlayerState(): void {
    if (this.useDesktopEmbedProxy) {
      const videoId = this.activeChannel.videoId;
      if (videoId && this.currentVideoId !== videoId) {
        this.renderDesktopEmbed(true);
      } else {
        this.syncDesktopEmbedState();
      }
      return;
    }

    if (!this.player || !this.isPlayerReady) return;

    const videoId = this.activeChannel.videoId;
    if (!videoId) return;

    // Handle channel switch
    const isNewVideo = this.currentVideoId !== videoId;
    if (isNewVideo) {
      this.currentVideoId = videoId;
      if (!this.playerElement || !document.getElementById(this.playerElementId)) {
        this.ensurePlayerContainer();
        void this.initializePlayer();
        return;
      }
      if (this.isPlaying) {
        this.player.loadVideoById(videoId);
      } else {
        this.player.cueVideoById(videoId);
      }
    }

    if (this.isMuted) {
      this.player.mute?.();
    } else {
      this.player.unMute?.();
    }

    if (this.isPlaying) {
      if (isNewVideo) {
        // WKWebView loses user gesture context after await.
        // Pause then play after a delay — mimics the manual workaround.
        this.player.pauseVideo();
        setTimeout(() => {
          if (this.player && this.isPlaying) {
            this.player.mute?.();
            this.player.playVideo?.();
            // Restore mute state after play starts
            if (!this.isMuted) {
              setTimeout(() => { this.player?.unMute?.(); }, 500);
            }
          }
        }, 800);
      } else {
        this.player.playVideo?.();
      }
    } else {
      this.player.pauseVideo?.();
    }
  }

  public refresh(): void {
    this.syncPlayerState();
  }

  public destroy(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    window.removeEventListener('message', this.boundMessageHandler);
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.removeEventListener(event, this.boundIdleResetHandler);
    });

    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    this.desktopEmbedIframe = null;
    this.isPlayerReady = false;
    this.playerContainer = null;
    this.playerElement = null;

    super.destroy();
  }
}
