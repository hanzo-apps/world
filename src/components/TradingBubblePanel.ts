import * as d3 from 'd3';
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchMarketUniverse, type MarketDatum } from '@/services/market-universe';
import { ASSET_CLASS_LABELS, type AssetClass } from '@/config/market-universe';

// Markets Bubble — every asset class at once as a D3 circle-pack. Clusters per class
// (equities / commodities / FX / rates / crypto), one leaf circle per instrument:
// radius ∝ importance × how hard it's moving, fill = diverging green(↑)→red(↓) by
// percent move (flipped for vol gauges — VIX/MOVE up reads red). Hover any bubble for
// name / price / signed %. Fed by the ONE market-universe service, so there is no
// per-panel symbol duplication.
//
// Perf: built LAZILY on first visibility; the ~30s jittered live poll runs only while
// on-screen and re-binds with a smooth radius/colour tween (circles reused by id, never
// torn down). Re-packs on container resize via ResizeObserver.

type PackNode =
  | { kind: 'root'; children: PackNode[] }
  | { kind: 'class'; key: AssetClass; label: string; children: PackNode[] }
  | { kind: 'leaf'; datum: MarketDatum };

type CircleNode = d3.HierarchyCircularNode<PackNode>;

// Radius law: base = weight, grown up to +MOVE_BOOST× as |move| approaches MOVE_CAP,
// so big movers read visibly bigger without any single spike swallowing the pack.
const MOVE_CAP = 6;
const MOVE_BOOST = 1.4;
function leafValue(d: MarketDatum): number {
  const m = Math.min(Math.abs(d.changePct ?? 0), MOVE_CAP) / MOVE_CAP;
  return d.weight * (1 + m * MOVE_BOOST);
}

// Diverging colour: −cap → red, 0 → neutral grey, +cap → green; clamped. Inverse
// gauges (VIX/MOVE) negate the move so a spike (risk-off) reads red.
const COLOR_CAP = 4;
const colorScale = d3
  .scaleLinear<string>()
  .domain([-COLOR_CAP, 0, COLOR_CAP])
  .range(['#ff4d4d', '#54545c', '#3ddc84'])
  .clamp(true)
  .interpolate(d3.interpolateHcl);
function colorFor(d: MarketDatum): string {
  return colorScale((d.inverse ? -1 : 1) * (d.changePct ?? 0));
}

// Compact ticker from the join key: strip Yahoo's ^ prefix and =F/=X/.NYB noise.
function shortLabel(d: MarketDatum): string {
  return d.id
    .replace(/^\^/, '')
    .replace(/=[FX]$/, '')
    .replace(/-Y\.NYB$/, 'Y')
    .replace(/\.NYB$/, '');
}

function signedPct(pct: number | null, digits = 2): string {
  const v = pct ?? 0;
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
function fmtPrice(price: number, digits: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const TWEEN_MS = 650;
// ~30s jittered live poll. Under the e2e harness (VITE_E2E=1) it runs on a short
// cadence so a re-poll is observable within a test's lifetime; never in production.
const E2E = import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true';
const POLL_MIN_MS = E2E ? 1000 : 25_000;
const POLL_JITTER_MS = E2E ? 400 : 10_000;

export class TradingBubblePanel extends Panel {
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;
  private visible = false;

  private container: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private gClasses: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private gLeaves: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  private data: MarketDatum[] = [];

  constructor() {
    super({ id: 'trading-bubble', title: 'Markets Bubble', showCount: true });
    this.content.className = 'panel-content trading-bubble-content';
    this.setupObservers();
  }

  private setupObservers(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          this.visible = e.isIntersecting;
          if (e.isIntersecting) void this.onVisible();
          else this.stopPolling();
        }
      },
      { threshold: 0.01 },
    );
    this.observer.observe(this.element);
  }

  private async onVisible(): Promise<void> {
    await this.ensureMounted();
    this.startPolling();
  }

  private async ensureMounted(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;
    this.buildScaffold();
    await this.refresh(false);
  }

  // Build the SVG scaffold once; the data join fills it. gClasses (rings + labels)
  // paints under gLeaves (the instrument bubbles).
  private buildScaffold(): void {
    this.content.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'trading-bubble';

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'trading-bubble-svg');
    container.appendChild(svgEl);

    const tooltip = document.createElement('div');
    tooltip.className = 'trading-bubble-tooltip';
    container.appendChild(tooltip);

    this.content.appendChild(container);

    this.container = container;
    this.tooltip = tooltip;
    this.svg = d3.select(svgEl);
    this.gClasses = this.svg.append('g').attr('class', 'tb-classes');
    this.gLeaves = this.svg.append('g').attr('class', 'tb-leaves');

    this.resizeObserver = new ResizeObserver(() => this.render(false));
    this.resizeObserver.observe(container);
  }

  private startPolling(): void {
    this.stopPolling();
    const loop = async (): Promise<void> => {
      if (!this.visible) return;
      await this.refresh(true);
      this.timer = setTimeout(() => void loop(), POLL_MIN_MS + Math.random() * POLL_JITTER_MS);
    };
    this.timer = setTimeout(() => void loop(), POLL_MIN_MS + Math.random() * POLL_JITTER_MS);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async refresh(animate: boolean): Promise<void> {
    let data: MarketDatum[];
    try {
      data = await fetchMarketUniverse();
    } catch {
      if (!this.data.length) this.showError('Markets unavailable.');
      return;
    }
    this.data = data;
    if (data.length) this.setDataBadge('live');
    else this.clearDataBadge();
    this.setCount(data.length);
    this.render(animate);
  }

  // Group the flat data by class into the pack hierarchy (only classes that have live
  // rows appear as clusters).
  private buildRoot(): PackNode {
    const byClass = new Map<AssetClass, MarketDatum[]>();
    for (const d of this.data) {
      const list = byClass.get(d.cls);
      if (list) list.push(d);
      else byClass.set(d.cls, [d]);
    }
    const classes: PackNode[] = [];
    for (const [key, rows] of byClass) {
      classes.push({
        kind: 'class',
        key,
        label: ASSET_CLASS_LABELS[key],
        children: rows.map((datum) => ({ kind: 'leaf', datum })),
      });
    }
    return { kind: 'root', children: classes };
  }

  private render(animate: boolean): void {
    if (!this.svg || !this.container || !this.gClasses || !this.gLeaves) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 2 || h < 2 || !this.data.length) return;

    this.svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);

    const hierarchy = d3
      .hierarchy<PackNode>(this.buildRoot(), (d) => (d.kind === 'leaf' ? null : d.children))
      .sum((d) => (d.kind === 'leaf' ? leafValue(d.datum) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const root = d3.pack<PackNode>().size([w, h]).padding(6)(hierarchy);
    const classNodes = (root.children ?? []) as CircleNode[];
    const leafNodes = root.leaves().filter((n) => n.data.kind === 'leaf');

    const t = this.svg.transition().duration(animate ? TWEEN_MS : 0).ease(d3.easeCubicOut);

    this.drawClasses(classNodes, t);
    this.drawLeaves(leafNodes, t);
  }

  private drawClasses(
    nodes: CircleNode[],
    t: d3.Transition<SVGSVGElement, unknown, null, undefined>,
  ): void {
    const key = (n: CircleNode): string => (n.data.kind === 'class' ? n.data.key : '');

    this.gClasses!.selectAll<SVGGElement, CircleNode>('g.tb-class')
      .data(nodes, key)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'tb-class');
          g.append('circle')
            .attr('class', 'tb-class-ring')
            .attr('cx', (d) => d.x)
            .attr('cy', (d) => d.y)
            .attr('r', (d) => d.r);
          g.append('text')
            .attr('class', 'tb-class-label')
            .attr('x', (d) => d.x)
            .attr('y', (d) => d.y - d.r + 13)
            .text((d) => (d.data.kind === 'class' ? d.data.label.toUpperCase() : ''));
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      )
      .each(function (d) {
        const g = d3.select(this);
        g.select<SVGCircleElement>('circle.tb-class-ring')
          .transition(t as never)
          .attr('cx', d.x)
          .attr('cy', d.y)
          .attr('r', d.r);
        g.select<SVGTextElement>('text.tb-class-label')
          .transition(t as never)
          .attr('x', d.x)
          .attr('y', d.y - d.r + 13);
      });
  }

  private drawLeaves(
    nodes: CircleNode[],
    t: d3.Transition<SVGSVGElement, unknown, null, undefined>,
  ): void {
    const key = (n: CircleNode): string => (n.data.kind === 'leaf' ? n.data.datum.id : '');
    const self = this;

    this.gLeaves!.selectAll<SVGGElement, CircleNode>('g.tb-leaf')
      .data(nodes, key)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', 'tb-leaf')
            .attr('transform', (d) => `translate(${d.x},${d.y})`);
          g.append('circle')
            .attr('class', 'tb-leaf-circle')
            .attr('r', (d) => d.r)
            .attr('fill', (d) => (d.data.kind === 'leaf' ? colorFor(d.data.datum) : 'none'))
            .on('pointerenter', (event: PointerEvent, d) => self.showTooltip(event, d))
            .on('pointermove', (event: PointerEvent, d) => self.showTooltip(event, d))
            .on('pointerleave', () => self.hideTooltip());
          g.append('text').attr('class', 'tb-leaf-ticker').attr('dy', '-0.15em');
          g.append('text').attr('class', 'tb-leaf-pct').attr('dy', '1em');
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      )
      .each(function (d) {
        if (d.data.kind !== 'leaf') return;
        const datum = d.data.datum;
        const g = d3.select(this);
        g.transition(t as never).attr('transform', `translate(${d.x},${d.y})`);
        g.select<SVGCircleElement>('circle.tb-leaf-circle')
          .transition(t as never)
          .attr('r', d.r)
          .attr('fill', colorFor(datum));

        const showTicker = d.r >= 15;
        const showPct = d.r >= 22;
        g.select<SVGTextElement>('text.tb-leaf-ticker')
          .attr('display', showTicker ? null : 'none')
          .style('font-size', `${Math.min(13, Math.max(8, d.r * 0.42)).toFixed(1)}px`)
          .text(showTicker ? shortLabel(datum) : '');
        g.select<SVGTextElement>('text.tb-leaf-pct')
          .attr('display', showPct ? null : 'none')
          .text(showPct ? signedPct(datum.changePct, 1) : '');
      });
  }

  private showTooltip(event: PointerEvent, node: CircleNode): void {
    if (!this.tooltip || !this.container || node.data.kind !== 'leaf') return;
    const d = node.data.datum;
    const dir = (d.inverse ? -1 : 1) * (d.changePct ?? 0);
    const cls = dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat';
    this.tooltip.innerHTML =
      `<div class="tb-tt-name">${escapeHtml(d.name)}<span class="tb-tt-sub">${escapeHtml(shortLabel(d))}</span></div>` +
      `<div class="tb-tt-row"><span class="tb-tt-price">${escapeHtml(fmtPrice(d.price ?? 0, d.digits))}</span>` +
      `<span class="tb-tt-chg ${cls}">${escapeHtml(signedPct(d.changePct))}</span></div>`;

    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    const left = Math.max(4, Math.min(x + 12, rect.width - tw - 4));
    const top = Math.max(4, Math.min(y + 12, rect.height - th - 4));
    this.tooltip.style.transform = `translate(${left}px, ${top}px)`;
    this.tooltip.classList.add('visible');
  }

  private hideTooltip(): void {
    this.tooltip?.classList.remove('visible');
  }

  public destroy(): void {
    this.stopPolling();
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.tooltip?.remove();
    this.tooltip = null;
    super.destroy();
  }
}
