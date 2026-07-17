import { getSnapshotTimestamps, getSnapshotAt, type DashboardSnapshot } from '@/services/storage';
import { t } from '@/services/i18n';

export class PlaybackControl {
  private element: HTMLElement;
  private isPlaybackMode = false;
  private timestamps: number[] = [];
  private currentIndex = 0;
  private onSnapshotChange: ((snapshot: DashboardSnapshot | null) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'playback-control';
    this.element.innerHTML = `
      <button class="playback-toggle" title="${t('components.playback.toggleMode')}" aria-label="${t('components.playback.historicalPlayback')}">
        <span class="playback-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg></span>
      </button>
      <div class="playback-panel hidden">
        <div class="playback-header">
          <span>${t('components.playback.historicalPlayback')}</span>
          <button class="playback-close">×</button>
        </div>
        <div class="playback-slider-container">
          <input type="range" class="playback-slider" min="0" max="100" value="100">
          <div class="playback-time">${t('components.playback.live')}</div>
        </div>
        <div class="playback-controls">
          <button class="playback-btn" data-action="start" title="Start" aria-label="Start"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg></button>
          <button class="playback-btn" data-action="prev" title="Previous" aria-label="Previous"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
          <button class="playback-btn playback-live" data-action="live">${t('components.playback.live')}</button>
          <button class="playback-btn" data-action="next" title="Next" aria-label="Next"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
          <button class="playback-btn" data-action="end" title="End" aria-label="End"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></button>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const toggle = this.element.querySelector('.playback-toggle')!;
    const panel = this.element.querySelector('.playback-panel')!;
    const closeBtn = this.element.querySelector('.playback-close')!;
    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;

    toggle.addEventListener('click', async () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        await this.loadTimestamps();
      }
    });

    closeBtn.addEventListener('click', () => {
      panel.classList.add('hidden');
      this.goLive();
    });

    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value);
      this.currentIndex = idx;
      this.loadSnapshot(idx);
    });

    this.element.querySelectorAll('.playback-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        this.handleAction(action!);
      });
    });
  }

  private async loadTimestamps(): Promise<void> {
    this.timestamps = await getSnapshotTimestamps();
    this.timestamps.sort((a, b) => a - b);

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    slider.max = String(Math.max(0, this.timestamps.length - 1));
    slider.value = slider.max;
    this.currentIndex = this.timestamps.length - 1;

    this.updateTimeDisplay();
  }

  private async loadSnapshot(index: number): Promise<void> {
    if (index < 0 || index >= this.timestamps.length) {
      this.goLive();
      return;
    }

    const timestamp = this.timestamps[index];
    if (!timestamp) {
      this.goLive();
      return;
    }

    this.isPlaybackMode = true;
    this.updateTimeDisplay();

    const snapshot = await getSnapshotAt(timestamp);
    this.onSnapshotChange?.(snapshot);

    document.body.classList.add('playback-mode');
    this.element.querySelector('.playback-live')?.classList.remove('active');
  }

  private goLive(): void {
    this.isPlaybackMode = false;
    this.currentIndex = this.timestamps.length - 1;

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    slider.value = slider.max;

    this.updateTimeDisplay();
    this.onSnapshotChange?.(null);

    document.body.classList.remove('playback-mode');
    this.element.querySelector('.playback-live')?.classList.add('active');
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'start':
        this.currentIndex = 0;
        break;
      case 'prev':
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        break;
      case 'next':
        this.currentIndex = Math.min(this.timestamps.length - 1, this.currentIndex + 1);
        break;
      case 'end':
        this.currentIndex = this.timestamps.length - 1;
        break;
      case 'live':
        this.goLive();
        return;
    }

    const slider = this.element.querySelector('.playback-slider') as HTMLInputElement;
    slider.value = String(this.currentIndex);
    this.loadSnapshot(this.currentIndex);
  }

  private updateTimeDisplay(): void {
    const display = this.element.querySelector('.playback-time')!;

    if (!this.isPlaybackMode || this.timestamps.length === 0) {
      display.textContent = t('components.playback.live');
      display.classList.remove('historical');
      return;
    }

    const timestamp = this.timestamps[this.currentIndex];
    if (timestamp) {
      const date = new Date(timestamp);
      display.textContent = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      display.classList.add('historical');
    }
  }

  public onSnapshot(callback: (snapshot: DashboardSnapshot | null) => void): void {
    this.onSnapshotChange = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public isInPlaybackMode(): boolean {
    return this.isPlaybackMode;
  }
}
