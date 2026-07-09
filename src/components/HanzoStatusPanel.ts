import { Panel } from './Panel';

// Full Hanzo Cloud status page, embedded verbatim from status.hanzo.ai. The
// status page (Gatus behind a Next.js frontend) ships NO X-Frame-Options and NO
// CSP frame-ancestors, so it is embeddable in an iframe — we surface the WHOLE
// live component (every group + endpoint + uptime history) here in the Cloud
// dashboard, not just a summary badge. Static URL, no dynamic input to escape.
const STATUS_URL = 'https://status.hanzo.ai';

export class HanzoStatusPanel extends Panel {
  constructor() {
    super({ id: 'hanzo-status', title: 'Hanzo Status', showCount: false, className: 'panel-wide cloud-panel' });
    this.render();
  }

  private render(): void {
    this.setContent(`
      <div class="hanzo-status-embed" style="display:flex;flex-direction:column;gap:8px;height:100%;min-height:520px;">
        <div style="display:flex;justify-content:flex-end;">
          <a href="${STATUS_URL}" target="_blank" rel="noopener noreferrer"
             style="font-size:12px;opacity:0.75;text-decoration:none;">Open in new tab &#8599;</a>
        </div>
        <iframe
          src="${STATUS_URL}"
          title="Hanzo Status"
          loading="lazy"
          referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          style="flex:1;width:100%;min-height:480px;border:0;border-radius:8px;background:transparent;"></iframe>
      </div>
    `);
  }
}
