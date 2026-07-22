// Immersive layout controller.
//
// One layout toggle promotes the map to a FIXED full-viewport background and lets
// the panel grid float above it in translucent, still-draggable/resizable cards.
// A single "background slot" chooses what fills that background: the map (2D or 3D,
// whatever mode is active) OR a muted live-news video. State is persisted and also
// reflected in the ?layout=immersive URL param so a reload restores it.
//
// The controller owns ONLY body-level classes/attributes + the lazily-mounted video
// element; all visual layout lives in CSS keyed off `body.immersive` and
// `body[data-immersive-bg]`. Everything downstream (map, panels, drag) is untouched.

import { getDefaultLiveChannel } from '@/config/live-channels';
import { fetchLiveVideoId } from '@/services/live-news';
import { getSiteVariant } from '@/config/variant';

export type ImmersiveBackground = 'map' | 'video';

const LAYOUT_PARAM = 'layout';
const IMMERSIVE_VALUE = 'immersive';
const BG_KEY = 'hanzo-world-immersive-bg';
const ENABLED_KEY = 'hanzo-world-layout'; // stores 'immersive' | 'grid'
const COLLAPSED_KEY = 'hanzo-world-immersive-collapsed';

export interface ImmersiveState {
  enabled: boolean;
  background: ImmersiveBackground;
  collapsed: boolean;
}

export interface ImmersiveOptions {
  // Where the fixed video background mounts. Must share the panel grid's stacking
  // context so it layers correctly (behind the panels, over/instead of the map).
  getBackgroundHost: () => HTMLElement | null;
  // Called after every state change so the host can react (e.g. re-render the map
  // once its box has resized, or repaint the toggle chrome).
  onChange?: (state: ImmersiveState) => void;
}

export class ImmersiveController {
  private enabled: boolean;
  private background: ImmersiveBackground;
  private collapsed: boolean;
  private videoEl: HTMLElement | null = null;
  private readonly opts: ImmersiveOptions;

  constructor(opts: ImmersiveOptions) {
    this.opts = opts;
    // URL wins on first load (shareable deep link), else the persisted preference.
    const url = new URL(window.location.href);
    const urlLayout = url.searchParams.get(LAYOUT_PARAM);
    const stored = this.readEnabled();
    this.enabled = urlLayout === IMMERSIVE_VALUE || (urlLayout === null && stored);
    this.background = this.readBackground();
    this.collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
  }

  private readEnabled(): boolean {
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      if (raw === IMMERSIVE_VALUE) return true;
      if (raw === 'grid') return false; // an explicit choice always wins
      // Never chosen: the flagship Cloud view opens on the immersive globe — the
      // full-viewport 3D dot map is the hero, panels float over it — instead of
      // demoting it to a corner tile in the grid. Other variants still default to grid.
      return getSiteVariant() === 'cloud';
    } catch { return false; }
  }

  private readBackground(): ImmersiveBackground {
    try { return localStorage.getItem(BG_KEY) === 'video' ? 'video' : 'map'; } catch { return 'map'; }
  }

  getState(): ImmersiveState {
    return { enabled: this.enabled, background: this.background, collapsed: this.collapsed };
  }

  /** Apply the current state to the DOM. Call once after layout mounts. */
  apply(): void {
    document.body.classList.toggle('immersive', this.enabled);
    document.body.classList.toggle('immersive-collapsed', this.enabled && this.collapsed);
    document.body.dataset.immersiveBg = this.enabled ? this.background : '';
    this.syncVideo();
    this.opts.onChange?.(this.getState());
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    try { localStorage.setItem(ENABLED_KEY, on ? IMMERSIVE_VALUE : 'grid'); } catch { /* ignore */ }
    this.syncUrl();
    this.apply();
  }

  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  setBackground(bg: ImmersiveBackground): void {
    if (this.background === bg) return;
    this.background = bg;
    try { localStorage.setItem(BG_KEY, bg); } catch { /* ignore */ }
    this.apply();
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
    this.apply();
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
  }

  private syncUrl(): void {
    const url = new URL(window.location.href);
    if (this.enabled) url.searchParams.set(LAYOUT_PARAM, IMMERSIVE_VALUE);
    else url.searchParams.delete(LAYOUT_PARAM);
    window.history.replaceState(null, '', url.toString());
  }

  // Mount the video background only when immersive + bg=video; tear it down otherwise
  // so no hidden iframe keeps a stream alive in the normal grid or map background.
  private syncVideo(): void {
    const wantVideo = this.enabled && this.background === 'video';
    if (!wantVideo) {
      this.videoEl?.remove();
      this.videoEl = null;
      return;
    }
    if (this.videoEl) return;
    const host = this.opts.getBackgroundHost();
    if (!host) return;

    const el = document.createElement('div');
    el.className = 'immersive-video-bg';
    host.appendChild(el);
    this.videoEl = el;

    const ch = getDefaultLiveChannel();
    const mount = (videoId: string): void => {
      if (this.videoEl !== el || !videoId) return; // torn down or no id
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
        + `?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(videoId)}`
        + `&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3`;
      el.innerHTML = `<iframe class="immersive-video-frame" src="${src}" title="${ch.name} live" `
        + `frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    };
    // Show the fallback immediately, then upgrade to the detected live stream if the
    // backend resolves one — same source of truth the live-news panel uses.
    mount(ch.videoId);
    if (ch.handle) {
      void fetchLiveVideoId(ch.handle).then((live) => { if (live) mount(live); }).catch(() => { /* keep fallback */ });
    }
  }
}
