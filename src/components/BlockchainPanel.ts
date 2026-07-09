import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getChainNodes, type ChainNodesData } from '@/services/cloud-map';

// Chains — text-driven blockchain widget for the cloud / world map. One row per
// network from the same-origin /v1/world/cloud/chain-nodes feed: name, block
// height (mono, flashes on increment via the global live-flash observer), peers
// and a live/down status dot. While the network set is unchanged, block height
// and peers are updated in place so live-flash bumps only the changed numbers;
// the panel degrades to a quiet "chain data unavailable" line and never throws.
export class BlockchainPanel extends Panel {
  private data: ChainNodesData | null = null;
  private loaded = false;
  private renderedKey = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'chains', title: 'Chains', showCount: true, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 15_000);
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    const data = await getChainNodes();
    if (data) this.data = data;
    this.loaded = true;
    this.render();
  }

  private render(): void {
    const nets = this.data?.networks ?? [];
    if (!this.data || nets.length === 0) {
      this.clearDataBadge();
      this.renderedKey = '';
      if (this.loaded) {
        this.setContent('<div class="chains-empty" style="color:#888;padding:8px 0;">chain data unavailable</div>');
      } else {
        this.showLoading('Loading chains…');
      }
      return;
    }

    this.setCount(nets.length);
    this.setDataBadge('live');
    const modeled = this.data.positionsModeled;
    const key = nets.map((n) => `${n.id}:${n.live ? 1 : 0}`).join('|');

    // Same network set as last render → surgically update the numeric leaves so
    // the global live-flash observer bumps block height / peers on change.
    if (key === this.renderedKey) {
      nets.forEach((n, i) => {
        const block = this.content.querySelector<HTMLElement>(`[data-net-block="${i}"]`);
        if (block) block.textContent = n.blockHeight.toLocaleString();
        const peers = this.content.querySelector<HTMLElement>(`[data-net-peers="${i}"]`);
        if (peers) peers.textContent = String(n.peers);
      });
      return;
    }
    this.renderedKey = key;

    const rows = nets.map((n, i) => {
      const dot = n.live ? '#ededed' : '#3a3a3a';
      const sub = `chain ${escapeHtml(String(n.chainId))}${modeled ? ' · positions modeled' : ''}`;
      return `
        <div class="chains-row" style="padding:6px 0;border-bottom:1px solid #1f1f1f;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:${dot};font-size:9px;line-height:1;">&#9679;</span>
            <span style="flex:1;color:#ededed;font-weight:500;">${escapeHtml(n.name)}</span>
            <span data-net-block="${i}" style="font-family:var(--font-mono);color:#ededed;">${n.blockHeight.toLocaleString()}</span>
            <span style="color:#555;">·</span>
            <span data-net-peers="${i}" style="font-family:var(--font-mono);color:#888;min-width:2.5em;text-align:right;">${n.peers}</span>
            <span style="color:#888;">peers</span>
          </div>
          <div style="color:#888;font-size:11px;padding-left:17px;">${sub}</div>
        </div>`;
    }).join('');

    this.setContent(`<div class="chains-list">${rows}</div>`);
  }
}
