import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { UcdpGeoEvent, UcdpEventType } from '@/types';

export class UcdpEventsPanel extends Panel {
  private events: UcdpGeoEvent[] = [];
  private activeTab: UcdpEventType = 'state-based';
  private onEventClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'ucdp-events',
      title: 'UCDP Conflict Events',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>UCDP Georeferenced Events</strong>
        Event-level conflict data from Uppsala University.
        <ul>
          <li><strong>State-Based</strong>: Government vs rebel group</li>
          <li><strong>Non-State</strong>: Armed group vs armed group</li>
          <li><strong>One-Sided</strong>: Violence against civilians</li>
        </ul>
        Deaths shown as best estimate (low-high range).
        ACLED duplicates are filtered out automatically.`,
    });
    this.showLoading('Loading UCDP events');
  }

  public setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onEventClick = handler;
  }

  public setEvents(events: UcdpGeoEvent[]): void {
    this.events = events;
    this.setCount(events.length);
    this.renderContent();
  }

  public getEvents(): UcdpGeoEvent[] {
    return this.events;
  }

  private getTypeColor(type: UcdpEventType): string {
    switch (type) {
      case 'state-based': return '#ff4444';
      case 'non-state': return '#ff8800';
      case 'one-sided': return '#ffcc00';
    }
  }

  private renderContent(): void {
    const filtered = this.events.filter(e => e.type_of_violence === this.activeTab);
    const tabs = [
      { key: 'state-based' as UcdpEventType, label: 'State-Based' },
      { key: 'non-state' as UcdpEventType, label: 'Non-State' },
      { key: 'one-sided' as UcdpEventType, label: 'One-Sided' },
    ];

    const tabCounts = {
      'state-based': this.events.filter(e => e.type_of_violence === 'state-based').length,
      'non-state': this.events.filter(e => e.type_of_violence === 'non-state').length,
      'one-sided': this.events.filter(e => e.type_of_violence === 'one-sided').length,
    };

    const tabsHtml = tabs.map(t =>
      `<button class="panel-tab ${t.key === this.activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label} (${tabCounts[t.key]})</button>`
    ).join('');

    const displayed = filtered.slice(0, 50);
    const eventsHtml = displayed.length === 0
      ? '<div class="panel-empty">No events in this category</div>'
      : displayed.map(e => {
        const deathsBadge = e.deaths_best > 0
          ? `<span class="ucdp-deaths" style="color:${this.getTypeColor(e.type_of_violence)}">${e.deaths_best} <small>(${e.deaths_low}-${e.deaths_high})</small></span>`
          : '<span class="ucdp-deaths dim">0</span>';

        return `
          <div class="ucdp-event" data-lat="${e.latitude}" data-lon="${e.longitude}">
            <div class="ucdp-event-header">
              <span class="ucdp-location">${escapeHtml(e.country)}</span>
              <span class="ucdp-date">${e.date_start}</span>
              ${deathsBadge}
            </div>
            <div class="ucdp-actors">
              <span class="ucdp-side-a">${escapeHtml(e.side_a.substring(0, 60))}</span>
              <span class="ucdp-vs">vs</span>
              <span class="ucdp-side-b">${escapeHtml(e.side_b.substring(0, 60))}</span>
            </div>
          </div>`;
      }).join('');

    const moreHtml = filtered.length > 50
      ? `<div class="panel-more">${filtered.length - 50} more events not shown</div>`
      : '';

    this.setContent(`
      <div class="ucdp-tabs">${tabsHtml}</div>
      <div class="ucdp-events-list">${eventsHtml}${moreHtml}</div>
    `);

    this.content.querySelectorAll('.panel-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as UcdpEventType;
        this.renderContent();
      });
    });

    this.content.querySelectorAll('.ucdp-event').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onEventClick?.(lat, lon);
      });
    });
  }
}
