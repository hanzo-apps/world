import { Panel } from './Panel';
import { fetchLiveVideoId } from '@/services/live-news';
import { loadYouTubeAPI, type YouTubePlayer } from '@/services/youtube';
import { liveChannels, type LiveChannel } from '@/config/live-channels';

// StationsWallPanel — EVERY live news channel at once, in a grid of controllable
// YouTube players. All tiles play muted; hovering a tile gives it AUDIO FOCUS (unmutes
// it, mutes the rest), so you scan the whole wall and listen to any station without a
// click. Reuses the ONE YouTube IFrame API loader (services/youtube) and the ONE channel
// list (config/live-channels) that LiveNewsPanel uses — no duplicated data or loader.
//
// Perf: the grid (N simultaneous players) is built LAZILY the first time the wall scrolls
// into view, and every player pauses when the wall leaves the viewport (Intersection
// Observer) — so N live video decodes never run while the wall is hidden.

interface StationTile {
  channel: LiveChannel;
  cell: HTMLElement;
  playerHost: HTMLElement;
  player: YouTubePlayer | null;
  videoId: string | null;
}

export class StationsWallPanel extends Panel {
  private tiles: StationTile[] = [];
  private observer: IntersectionObserver | null = null;
  private mounted = false;
  private activeAudioId: string | null = null; // the channel currently unmuted (one at a time)

  constructor() {
    super({ id: 'stations-wall', title: 'News Wall', className: 'panel-wide' });
    this.setupIntersectionObserver();
    this.content.className = 'panel-content stations-content';
    this.content.innerHTML = '<div class="stations-placeholder">Scroll into view to load the wall…</div>';
  }

  // Lazily build on first visibility; pause/resume all players as the wall enters/leaves
  // the viewport (matches LiveNewsPanel/LiveWebcamsPanel — no decoding a hidden wall).
  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void this.ensureMounted();
            this.resumeAll();
          } else {
            this.pauseAll();
          }
        }
      },
      { threshold: 0.01 },
    );
    this.observer.observe(this.element);
  }

  private async ensureMounted(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;
    await this.build();
  }

  private async build(): Promise<void> {
    const channels = liveChannels();
    this.content.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'stations-grid';
    // Pointer leaving the wall entirely = no tile focused → mute everything.
    grid.addEventListener('mouseleave', () => this.focusAudio(null));

    this.tiles = channels.map((channel) => {
      const cell = document.createElement('div');
      cell.className = 'stations-tile';
      cell.dataset.channel = channel.id;

      const playerHost = document.createElement('div');
      playerHost.className = 'stations-player';

      const label = document.createElement('div');
      label.className = 'stations-label';
      label.innerHTML =
        '<span class="stations-live-dot"></span>' +
        `<span class="stations-name">${channel.name}</span>` +
        '<span class="stations-audio" aria-hidden="true">🔇</span>';

      cell.append(playerHost, label);
      // Hover (or keyboard focus) = audio focus.
      cell.addEventListener('mouseenter', () => this.focusAudio(channel.id));
      cell.addEventListener('focusin', () => this.focusAudio(channel.id));
      cell.tabIndex = 0;
      grid.appendChild(cell);

      return { channel, cell, playerHost, player: null, videoId: null };
    });

    this.content.appendChild(grid);
    this.setCount(this.tiles.length);

    // One API load for the whole wall; then resolve each channel's live video + create
    // its (muted, autoplaying) player. Failures degrade that one tile to an offline card.
    await loadYouTubeAPI();
    await Promise.all(this.tiles.map((tile) => this.mountTile(tile)));
  }

  private async mountTile(tile: StationTile): Promise<void> {
    const { channel } = tile;
    let videoId = channel.fallbackVideoId ?? null;
    if (!channel.useFallbackOnly) {
      const live = await fetchLiveVideoId(channel.handle).catch(() => null);
      if (live) videoId = live;
    }
    tile.videoId = videoId;

    if (!videoId || !window.YT?.Player) {
      tile.cell.classList.add('stations-offline');
      return;
    }

    const el = document.createElement('div');
    tile.playerHost.appendChild(el);
    tile.player = new window.YT.Player(el, {
      host: 'https://www.youtube-nocookie.com',
      videoId,
      playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: () => {
          // Start muted always; only the focused tile is later unmuted.
          tile.player?.mute();
          tile.player?.playVideo();
        },
        onError: () => tile.cell.classList.add('stations-offline'),
      },
    });
  }

  // Give exactly ONE tile audio (unmute it, mute every other). null → mute all. Idempotent.
  private focusAudio(channelId: string | null): void {
    if (this.activeAudioId === channelId) return;
    this.activeAudioId = channelId;
    for (const tile of this.tiles) {
      const on = tile.channel.id === channelId;
      tile.cell.classList.toggle('stations-audio-on', on);
      const badge = tile.cell.querySelector('.stations-audio');
      if (badge) badge.textContent = on ? '🔊' : '🔇';
      if (!tile.player) continue;
      if (on) {
        tile.player.unMute();
        tile.player.playVideo();
      } else {
        tile.player.mute();
      }
    }
  }

  private pauseAll(): void {
    for (const tile of this.tiles) tile.player?.pauseVideo?.();
  }

  private resumeAll(): void {
    for (const tile of this.tiles) tile.player?.playVideo?.();
  }

  public destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const tile of this.tiles) tile.player?.destroy?.();
    this.tiles = [];
    super.destroy();
  }
}
