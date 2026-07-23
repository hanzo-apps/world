import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '../utils/sanitize';
import { embedIframe } from '../utils/embed';
import { watchQueue, type QueueItem } from '../services/watch-queue';

// WatchQueuePanel — the view over the one WatchQueue. It plays the current
// item (a non-live video clip, an AI-surfaced image, or a news story) and lists
// the rest so you can step through them, mark them finished, and go fullscreen.
// It owns NO state: every mutation goes through watchQueue, and the panel just
// re-renders on its change events. That keeps "what's queued / what's watched"
// in exactly one place regardless of how many views (panel, immersive) show it.
export class WatchQueuePanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private stage: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor() {
    super({ id: 'watch', title: 'Watch Queue', className: 'watch-queue-panel', showCount: true });
    this.buildSkeleton();
    this.unsubscribe = watchQueue.subscribe(() => this.render());
    this.render();
  }

  private buildSkeleton(): void {
    this.content.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'wq-stage';
    const list = document.createElement('div');
    list.className = 'wq-list';
    this.content.appendChild(stage);
    this.content.appendChild(list);
    this.stage = stage;
    this.listEl = list;

    // Event delegation: one listener each, not one per row. Actions are declared
    // in data-attributes so the render step stays pure string-building.
    list.addEventListener('click', (e) => this.onListClick(e));
    stage.addEventListener('click', (e) => this.onStageClick(e));
  }

  private render(): void {
    const items = watchQueue.list();
    const current = watchQueue.current();
    this.setCount(watchQueue.unwatchedCount());
    this.renderStage(current);
    this.renderList(items, current?.id ?? null);
  }

  private renderStage(item: QueueItem | null): void {
    if (!this.stage) return;
    if (!item) {
      this.stage.innerHTML = this.emptyStateHtml(
        'Nothing queued yet. Videos, AI-surfaced media and stories you monitor collect here to watch through.',
      );
      return;
    }
    const media = this.renderMedia(item);
    this.stage.innerHTML = `
      <div class="wq-player" data-kind="${item.kind}">${media}</div>
      <div class="wq-stage-bar">
        <div class="wq-stage-meta">
          <span class="wq-src">${escapeHtml(item.source)}</span>
          <span class="wq-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        </div>
        <div class="wq-controls">
          <button class="wq-btn" data-act="prev" title="Previous">◀</button>
          <button class="wq-btn wq-finish" data-act="finish" title="Mark watched &amp; next">Finish ▶</button>
          <button class="wq-btn" data-act="fullscreen" title="Fullscreen">⤢</button>
        </div>
      </div>`;
  }

  // The media element for the stage. Each kind renders exactly one way.
  private renderMedia(item: QueueItem): string {
    if (item.kind === 'video') {
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.ref)}`
        + `?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`;
      // .outerHTML serialization escapes the title attribute for us.
      return embedIframe({ className: 'wq-frame', src, title: item.title }).outerHTML;
    }
    if (item.kind === 'image') {
      const url = sanitizeUrl(item.ref);
      return `<img class="wq-img" src="${escapeHtml(url)}" alt="${escapeHtml(item.title)}" loading="lazy">`;
    }
    // story: thumbnail (if any) over a headline that links out.
    const link = item.link ? sanitizeUrl(item.link) : '';
    const thumb = item.thumbnail
      ? `<img class="wq-img" src="${escapeHtml(sanitizeUrl(item.thumbnail))}" alt="${escapeHtml(item.title)}" loading="lazy">`
      : '<div class="wq-story-blank"></div>';
    const headline = link
      ? `<a class="wq-story-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
      : `<span class="wq-story-link">${escapeHtml(item.title)}</span>`;
    return `<div class="wq-story">${thumb}<div class="wq-story-head">${headline}</div></div>`;
  }

  private renderList(items: QueueItem[], currentId: string | null): void {
    if (!this.listEl) return;
    if (items.length === 0) {
      this.listEl.innerHTML = '';
      return;
    }
    const icon = { video: '▶', image: '▦', story: '❏' } as const;
    this.listEl.innerHTML = items
      .map((it) => {
        const isCurrent = it.id === currentId;
        const cls = `wq-row ${it.status}${isCurrent ? ' current' : ''}`;
        return `<div class="${cls}" data-id="${escapeHtml(it.id)}">
          <span class="wq-row-icon">${icon[it.kind]}</span>
          <span class="wq-row-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</span>
          <span class="wq-row-src">${escapeHtml(it.source)}</span>
          <button class="wq-row-x" data-act="remove" title="Remove">×</button>
        </div>`;
      })
      .join('');
  }

  private onStageClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'prev') watchQueue.prev();
    else if (act === 'finish') watchQueue.next();
    else if (act === 'fullscreen') this.enterFullscreen();
  }

  private onListClick(e: Event): void {
    const target = e.target as HTMLElement;
    const row = target.closest('.wq-row');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (!id) return;
    if (target.closest('[data-act="remove"]')) {
      watchQueue.remove(id);
      return;
    }
    watchQueue.select(id);
  }

  private enterFullscreen(): void {
    const el = this.stage?.querySelector('.wq-player') as HTMLElement | null;
    const target = el ?? this.stage ?? this.getElement();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* ignore */ });
    } else {
      void target.requestFullscreen?.().catch(() => { /* ignore */ });
    }
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}
