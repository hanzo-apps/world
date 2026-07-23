import type { NewsItem, MapLayers, PredictionMarket, MarketData } from '@/types';
import { getSiteVariant } from '@/config';
import { t } from '@/services/i18n';
import { SearchModal, Panel, CIIPanel } from '@/components';
import type { SearchResult } from '@/components/SearchModal';
import type { MapContainer } from '@/components/MapContainer';
import { calculateCII, TIER1_COUNTRIES } from '@/services/country-instability';
import { INTEL_HOTSPOTS, CONFLICT_ZONES, MILITARY_BASES, UNDERSEA_CABLES, NUCLEAR_FACILITIES } from '@/config/geo';
import { PIPELINES } from '@/config/pipelines';
import { AI_DATA_CENTERS } from '@/config/ai-datacenters';
import { GAMMA_IRRADIATORS } from '@/config/irradiators';
import { TECH_COMPANIES } from '@/config/tech-companies';
import { AI_RESEARCH_LABS } from '@/config/ai-research-labs';
import { STARTUP_ECOSYSTEMS } from '@/config/startup-ecosystems';
import { TECH_HQS, ACCELERATORS } from '@/config/tech-geo';
import { STOCK_EXCHANGES, FINANCIAL_CENTERS, CENTRAL_BANKS, COMMODITY_HUBS } from '@/config/finance-geo';

/**
 * Minimal slice of App state the search surface needs. Accessors (not values)
 * so live reassignments of map / mapLayers / news / markets are always read
 * fresh — behavior identical to the god-object's direct field reads.
 */
export interface SearchControllerDeps {
  container: HTMLElement;
  getMap: () => MapContainer | null;
  getMapLayers: () => MapLayers;
  getPanels: () => Record<string, Panel>;
  getAllNews: () => NewsItem[];
  getLatestPredictions: () => PredictionMarket[];
  getLatestMarkets: () => MarketData[];
  openCountryBriefByCode: (code: string, country: string) => void;
}

/**
 * Owns the ⌘K search modal: source registration per site variant, result
 * routing (map fly-to / panel scroll / country brief), and the live search
 * index. Extracted verbatim from App.ts — same methods, same order, same
 * effects.
 */
export class SearchController {
  private searchModal: SearchModal | null = null;
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly deps: SearchControllerDeps) {}

  setup(): void {
    const searchOptions = getSiteVariant() === 'tech' || getSiteVariant() === 'ai'
      ? {
        placeholder: t('modals.search.placeholderTech'),
        hint: t('modals.search.hintTech'),
      }
      : getSiteVariant() === 'finance' || getSiteVariant() === 'crypto'
        ? {
          placeholder: t('modals.search.placeholderFinance'),
          hint: t('modals.search.hintFinance'),
        }
        : {
          placeholder: t('modals.search.placeholder'),
          hint: t('modals.search.hint'),
        };
    this.searchModal = new SearchModal(this.deps.container, searchOptions);

    if (getSiteVariant() === 'tech' || getSiteVariant() === 'ai') {
      // Tech/AI variants: tech-specific sources
      this.searchModal.registerSource('techcompany', TECH_COMPANIES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.sector} ${c.city} ${c.keyProducts?.join(' ') || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('ailab', AI_RESEARCH_LABS.map(l => ({
        id: l.id,
        title: l.name,
        subtitle: `${l.type} ${l.city} ${l.focusAreas?.join(' ') || ''}`.trim(),
        data: l,
      })));

      this.searchModal.registerSource('startup', STARTUP_ECOSYSTEMS.map(s => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.ecosystemTier} ${s.topSectors?.join(' ') || ''} ${s.notableStartups?.join(' ') || ''}`.trim(),
        data: s,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major internet backbone' : 'Undersea cable',
        data: c,
      })));

      // Register Tech HQs (unicorns, FAANG, public companies from map)
      this.searchModal.registerSource('techhq', TECH_HQS.map(h => ({
        id: h.id,
        title: h.company,
        subtitle: `${h.type === 'faang' ? 'Big Tech' : h.type === 'unicorn' ? 'Unicorn' : 'Public'} • ${h.city}, ${h.country}`,
        data: h,
      })));

      // Register Accelerators
      this.searchModal.registerSource('accelerator', ACCELERATORS.map(a => ({
        id: a.id,
        title: a.name,
        subtitle: `${a.type} • ${a.city}, ${a.country}${a.notable ? ` • ${a.notable.slice(0, 2).join(', ')}` : ''}`,
        data: a,
      })));
    } else {
      // Full variant: geopolitical sources
      this.searchModal.registerSource('hotspot', INTEL_HOTSPOTS.map(h => ({
        id: h.id,
        title: h.name,
        subtitle: `${h.subtext || ''} ${h.keywords?.join(' ') || ''} ${h.description || ''}`.trim(),
        data: h,
      })));

      this.searchModal.registerSource('conflict', CONFLICT_ZONES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.parties?.join(' ') || ''} ${c.keywords?.join(' ') || ''} ${c.description || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('base', MILITARY_BASES.map(b => ({
        id: b.id,
        title: b.name,
        subtitle: `${b.type} ${b.description || ''}`.trim(),
        data: b,
      })));

      this.searchModal.registerSource('pipeline', PIPELINES.map(p => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.type} ${p.operator || ''} ${p.countries?.join(' ') || ''}`.trim(),
        data: p,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major cable' : '',
        data: c,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('nuclear', NUCLEAR_FACILITIES.map(n => ({
        id: n.id,
        title: n.name,
        subtitle: `${n.type} ${n.operator || ''}`.trim(),
        data: n,
      })));

      this.searchModal.registerSource('irradiator', GAMMA_IRRADIATORS.map(g => ({
        id: g.id,
        title: `${g.city}, ${g.country}`,
        subtitle: g.organization || '',
        data: g,
      })));
    }

    if (getSiteVariant() === 'finance' || getSiteVariant() === 'crypto') {
      // Finance/Crypto variants: market-specific sources
      this.searchModal.registerSource('exchange', STOCK_EXCHANGES.map(e => ({
        id: e.id,
        title: `${e.shortName} - ${e.name}`,
        subtitle: `${e.tier} • ${e.city}, ${e.country}${e.marketCap ? ` • $${e.marketCap}T` : ''}`,
        data: e,
      })));

      this.searchModal.registerSource('financialcenter', FINANCIAL_CENTERS.map(f => ({
        id: f.id,
        title: f.name,
        subtitle: `${f.type} financial center${f.gfciRank ? ` • GFCI #${f.gfciRank}` : ''}${f.specialties ? ` • ${f.specialties.slice(0, 3).join(', ')}` : ''}`,
        data: f,
      })));

      this.searchModal.registerSource('centralbank', CENTRAL_BANKS.map(b => ({
        id: b.id,
        title: `${b.shortName} - ${b.name}`,
        subtitle: `${b.type}${b.currency ? ` • ${b.currency}` : ''} • ${b.city}, ${b.country}`,
        data: b,
      })));

      this.searchModal.registerSource('commodityhub', COMMODITY_HUBS.map(h => ({
        id: h.id,
        title: h.name,
        subtitle: `${h.type} • ${h.city}, ${h.country}${h.commodities ? ` • ${h.commodities.slice(0, 3).join(', ')}` : ''}`,
        data: h,
      })));
    }

    // Register countries for all variants
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Handle result selection
    this.searchModal.setOnSelect((result) => this.handleSearchResult(result));

    // Global keyboard shortcut
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (this.searchModal?.isOpen()) {
          this.searchModal.close();
        } else {
          // Update search index with latest data before opening
          this.updateSearchIndex();
          this.searchModal?.open();
        }
      }
    };
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  isOpen(): boolean {
    return this.searchModal?.isOpen() ?? false;
  }

  open(query?: string): void {
    this.searchModal?.open(query);
  }

  runSearch(query: string): boolean {
    if (!this.searchModal || !query.trim()) return false;
    this.searchModal.open(query);
    return true;
  }

  registerTechEvents(mapEvents: { id: string; title: string; location: string; startDate: string }[]): void {
    // Register tech events as searchable source
    if (getSiteVariant() === 'tech' && this.searchModal) {
      this.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
        id: e.id,
        title: e.title,
        subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        data: e,
      })));
    }
  }

  destroy(): void {
    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
      this.boundKeydownHandler = null;
    }
  }

  private handleSearchResult(result: SearchResult): void {
    switch (result.type) {
      case 'news': {
        // Find and scroll to the news panel containing this item
        const item = result.data as NewsItem;
        this.scrollToPanel('politics');
        this.highlightNewsItem(item.link);
        break;
      }
      case 'hotspot': {
        // Trigger map popup for hotspot
        const hotspot = result.data as typeof INTEL_HOTSPOTS[0];
        this.deps.getMap()?.setView('global');
        setTimeout(() => {
          this.deps.getMap()?.triggerHotspotClick(hotspot.id);
        }, 300);
        break;
      }
      case 'conflict': {
        const conflict = result.data as typeof CONFLICT_ZONES[0];
        this.deps.getMap()?.setView('global');
        setTimeout(() => {
          this.deps.getMap()?.triggerConflictClick(conflict.id);
        }, 300);
        break;
      }
      case 'market': {
        this.scrollToPanel('markets');
        break;
      }
      case 'prediction': {
        this.scrollToPanel('polymarket');
        break;
      }
      case 'base': {
        const base = result.data as typeof MILITARY_BASES[0];
        this.deps.getMap()?.setView('global');
        setTimeout(() => {
          this.deps.getMap()?.triggerBaseClick(base.id);
        }, 300);
        break;
      }
      case 'pipeline': {
        const pipeline = result.data as typeof PIPELINES[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('pipelines');
        this.deps.getMapLayers().pipelines = true;
        setTimeout(() => {
          this.deps.getMap()?.triggerPipelineClick(pipeline.id);
        }, 300);
        break;
      }
      case 'cable': {
        const cable = result.data as typeof UNDERSEA_CABLES[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('cables');
        this.deps.getMapLayers().cables = true;
        setTimeout(() => {
          this.deps.getMap()?.triggerCableClick(cable.id);
        }, 300);
        break;
      }
      case 'datacenter': {
        const dc = result.data as typeof AI_DATA_CENTERS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('datacenters');
        this.deps.getMapLayers().datacenters = true;
        setTimeout(() => {
          this.deps.getMap()?.triggerDatacenterClick(dc.id);
        }, 300);
        break;
      }
      case 'nuclear': {
        const nuc = result.data as typeof NUCLEAR_FACILITIES[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('nuclear');
        this.deps.getMapLayers().nuclear = true;
        setTimeout(() => {
          this.deps.getMap()?.triggerNuclearClick(nuc.id);
        }, 300);
        break;
      }
      case 'irradiator': {
        const irr = result.data as typeof GAMMA_IRRADIATORS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('irradiators');
        this.deps.getMapLayers().irradiators = true;
        setTimeout(() => {
          this.deps.getMap()?.triggerIrradiatorClick(irr.id);
        }, 300);
        break;
      }
      case 'earthquake':
      case 'outage':
        // These are dynamic, just switch to map view
        this.deps.getMap()?.setView('global');
        break;
      case 'techcompany': {
        const company = result.data as typeof TECH_COMPANIES[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('techHQs');
        this.deps.getMapLayers().techHQs = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(company.lat, company.lon, 4);
        }, 300);
        break;
      }
      case 'ailab': {
        const lab = result.data as typeof AI_RESEARCH_LABS[0];
        this.deps.getMap()?.setView('global');
        setTimeout(() => {
          this.deps.getMap()?.setCenter(lab.lat, lab.lon, 4);
        }, 300);
        break;
      }
      case 'startup': {
        const ecosystem = result.data as typeof STARTUP_ECOSYSTEMS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('startupHubs');
        this.deps.getMapLayers().startupHubs = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(ecosystem.lat, ecosystem.lon, 4);
        }, 300);
        break;
      }
      case 'techevent':
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('techEvents');
        this.deps.getMapLayers().techEvents = true;
        break;
      case 'techhq': {
        const hq = result.data as typeof TECH_HQS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('techHQs');
        this.deps.getMapLayers().techHQs = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(hq.lat, hq.lon, 4);
        }, 300);
        break;
      }
      case 'accelerator': {
        const acc = result.data as typeof ACCELERATORS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('accelerators');
        this.deps.getMapLayers().accelerators = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(acc.lat, acc.lon, 4);
        }, 300);
        break;
      }
      case 'exchange': {
        const exchange = result.data as typeof STOCK_EXCHANGES[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('stockExchanges');
        this.deps.getMapLayers().stockExchanges = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(exchange.lat, exchange.lon, 4);
        }, 300);
        break;
      }
      case 'financialcenter': {
        const fc = result.data as typeof FINANCIAL_CENTERS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('financialCenters');
        this.deps.getMapLayers().financialCenters = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(fc.lat, fc.lon, 4);
        }, 300);
        break;
      }
      case 'centralbank': {
        const bank = result.data as typeof CENTRAL_BANKS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('centralBanks');
        this.deps.getMapLayers().centralBanks = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(bank.lat, bank.lon, 4);
        }, 300);
        break;
      }
      case 'commodityhub': {
        const hub = result.data as typeof COMMODITY_HUBS[0];
        this.deps.getMap()?.setView('global');
        this.deps.getMap()?.enableLayer('commodityHubs');
        this.deps.getMapLayers().commodityHubs = true;
        setTimeout(() => {
          this.deps.getMap()?.setCenter(hub.lat, hub.lon, 4);
        }, 300);
        break;
      }
      case 'country': {
        const { code, name } = result.data as { code: string; name: string };
        this.deps.openCountryBriefByCode(code, name);
        break;
      }
    }
  }

  private scrollToPanel(panelId: string): void {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('flash-highlight');
      setTimeout(() => panel.classList.remove('flash-highlight'), 1500);
    }
  }

  private highlightNewsItem(itemId: string): void {
    setTimeout(() => {
      const item = document.querySelector(`[data-news-id="${itemId}"]`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.classList.add('flash-highlight');
        setTimeout(() => item.classList.remove('flash-highlight'), 1500);
      }
    }, 100);
  }

  updateSearchIndex(): void {
    if (!this.searchModal) return;

    // Keep country CII labels fresh with latest ingested signals.
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Update news sources (use link as unique id) - index up to 500 items for better search coverage
    const newsItems = this.deps.getAllNews().slice(0, 500).map(n => ({
      id: n.link,
      title: n.title,
      subtitle: n.source,
      data: n,
    }));
    console.log(`[Search] Indexing ${newsItems.length} news items (allNews total: ${this.deps.getAllNews().length})`);
    this.searchModal.registerSource('news', newsItems);

    // Update predictions if available
    if (this.deps.getLatestPredictions().length > 0) {
      this.searchModal.registerSource('prediction', this.deps.getLatestPredictions().map(p => ({
        id: p.title,
        title: p.title,
        subtitle: `${(p.yesPrice * 100).toFixed(0)}% probability`,
        data: p,
      })));
    }

    // Update markets if available
    if (this.deps.getLatestMarkets().length > 0) {
      this.searchModal.registerSource('market', this.deps.getLatestMarkets().map(m => ({
        id: m.symbol,
        title: `${m.symbol} - ${m.name}`,
        subtitle: `$${m.price?.toFixed(2) || 'N/A'}`,
        data: m,
      })));
    }
  }

  private buildCountrySearchItems(): { id: string; title: string; subtitle: string; data: { code: string; name: string } }[] {
    const panelScores = (this.deps.getPanels()['cii'] as CIIPanel | undefined)?.getScores() ?? [];
    const scores = panelScores.length > 0 ? panelScores : calculateCII();
    const ciiByCode = new Map(scores.map((score) => [score.code, score]));
    return Object.entries(TIER1_COUNTRIES).map(([code, name]) => {
      const score = ciiByCode.get(code);
      return {
        id: code,
        title: `${SearchController.toFlagEmoji(code)} ${name}`,
        subtitle: score ? `CII: ${score.score}/100 • ${score.level}` : 'Country Brief',
        data: { code, name },
      };
    });
  }

  private static toFlagEmoji(code: string): string {
    const upperCode = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upperCode)) return '🏳️';
    return upperCode
      .split('')
      .map((char) => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
      .join('');
  }
}
