import type { NewsItem, ClusteredEvent, PredictionMarket, InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryFlightCluster, MilitaryVessel, MilitaryVesselCluster, Earthquake } from '@/types';
import type { CountryBriefSignals } from '@/App';
import type { MapContainer } from '@/components/MapContainer';
import type { AnalystHost } from '@/services/analyst-actions';
import type { Panel, StrategicPosturePanel } from '@/components';
import { CountryBriefPage } from '@/components/CountryBriefPage';
import { CountryTimeline, type TimelineEvent } from '@/components/CountryTimeline';
import { TIER1_COUNTRIES, calculateCII, getCountryData } from '@/services/country-instability';
import { signalAggregator } from '@/services/signal-aggregator';
import { collectStoryData } from '@/services/story-data';
import { renderStoryToCanvas } from '@/services/story-renderer';
import { openStoryModal } from '@/components/StoryModal';
import { getCountryAtCoordinates, hasCountryGeometry, isCoordinateInCountry } from '@/services/country-geometry';
import { reverseGeocode } from '@/utils/reverse-geocode';
import { fetchCountryMarkets } from '@/services/polymarket';
import { dataFreshness } from '@/services/data-freshness';
import { mlWorker } from '@/services/ml-worker';
import { BETA_MODE } from '@/config/beta';

type IntlDisplayNamesCtor = new (
  locales: string | string[],
  options: { type: 'region' }
) => { of: (code: string) => string | undefined };

/** The slice of App's intelligenceCache the country brief/timeline/signals read. */
export interface IntelligenceCacheSlice {
  outages?: InternetOutage[];
  protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
  military?: { flights: MilitaryFlight[]; flightClusters: MilitaryFlightCluster[]; vessels: MilitaryVessel[]; vesselClusters: MilitaryVesselCluster[] };
  earthquakes?: Earthquake[];
}

/**
 * Deps the country-intel surface reads from App. Accessors (not values) so
 * live reassignments (map / news / clusters / predictions / intelligenceCache)
 * read fresh — identical to the god-object's direct field reads. getShareUrl
 * and buildAnalystHost stay App methods (used elsewhere) and are called back.
 */
export interface CountryIntelDeps {
  getMap: () => MapContainer | null;
  getPanels: () => Record<string, Panel>;
  getAllNews: () => NewsItem[];
  getLatestClusters: () => ClusteredEvent[];
  getLatestPredictions: () => PredictionMarket[];
  getIntelligenceCache: () => IntelligenceCacheSlice;
  getShareUrl: () => string | null;
  buildAnalystHost: () => AnalystHost;
}

/**
 * Owns the fullscreen country view: the CountryBriefPage lifecycle, the map
 * country-click wiring, brief generation (local CII + server intel + ML
 * fallback), the seven-day timeline, per-country signal counts, the shareable
 * story modal, and the country-name/geo static helpers. Extracted verbatim from
 * App.ts — same methods, same order, same effects.
 */
export class CountryIntelController {
  private countryBriefPage: CountryBriefPage | null = null;
  private countryTimeline: CountryTimeline | null = null;
  private briefRequestToken = 0;

  constructor(private readonly deps: CountryIntelDeps) {}

  /** True when the fullscreen country view is showing (App reads this for the
   *  findings badge suppression + share-URL country param). */
  isBriefVisible(): boolean {
    return this.countryBriefPage?.isVisible() ?? false;
  }

  /** The code of the country currently shown, or null. */
  getBriefCode(): string | null {
    return this.countryBriefPage?.getCode() ?? null;
  }

  /** The live CountryBriefPage instance (null until setup()) — App re-exposes it
   *  as window.__app.countryBriefPage for the e2e boot-readiness hook. */
  getBriefPage(): CountryBriefPage | null {
    return this.countryBriefPage;
  }

  setup(): void {
    if (!this.deps.getMap()) return;
    this.countryBriefPage = new CountryBriefPage();
    // [country-view] Dock the analyst chat inside the fullscreen country view —
    // same capability port the dashboard analyst uses (reused by composition).
    this.countryBriefPage.setAnalystHost(this.deps.buildAnalystHost());
    this.countryBriefPage.setShareStoryHandler((code, name) => {
      this.countryBriefPage?.hide();
      this.openCountryStory(code, name);
    });
    this.countryBriefPage.setExportImageHandler(async (code, name) => {
      try {
        const signals = this.getCountrySignals(code, name);
        const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
        const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
        const convergence = cluster ? {
          score: cluster.convergenceScore,
          signalTypes: [...cluster.signalTypes],
          regionalDescriptions: regional.map(r => r.description),
        } : null;
        const posturePanel = this.deps.getPanels()['strategic-posture'] as StrategicPosturePanel | undefined;
        const postures = posturePanel?.getPostures() || [];
        const data = collectStoryData(code, name, this.deps.getLatestClusters(), postures, this.deps.getLatestPredictions(), signals, convergence);
        const canvas = await renderStoryToCanvas(data);
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `country-brief-${code.toLowerCase()}-${Date.now()}.png`;
        a.click();
      } catch (err) {
        console.error('[CountryBrief] Image export failed:', err);
      }
    });

    this.deps.getMap()!.onCountryClicked(async (countryClick) => {
      if (countryClick.code && countryClick.name) {
        this.openCountryBriefByCode(countryClick.code, countryClick.name);
      } else {
        this.openCountryBrief(countryClick.lat, countryClick.lon);
      }
    });

    this.countryBriefPage.onClose(() => {
      this.briefRequestToken++; // invalidate any in-flight reverse-geocode
      this.deps.getMap()?.clearCountryHighlight();
      this.deps.getMap()?.setRenderPaused(false);
      this.countryTimeline?.destroy();
      this.countryTimeline = null;
      // Force URL rewrite to drop ?country= immediately
      const shareUrl = this.deps.getShareUrl();
      if (shareUrl) history.replaceState(null, '', shareUrl);
    });

    // [country-view] Browser Back closes the fullscreen view (it was opened with
    // pushState); Forward re-opens it. Closing via ✕/Escape drops ?country= via
    // onClose's replaceState, so a plain replace here would never fire — popstate
    // only runs on real history navigation.
    window.addEventListener('popstate', () => {
      const country = new URLSearchParams(window.location.search).get('country');
      const visible = this.countryBriefPage?.isVisible() ?? false;
      if (!country && visible) {
        this.countryBriefPage?.hide();
      } else if (country && !visible && dataFreshness.hasSufficientData()) {
        const code = country.toUpperCase();
        void this.openCountryBriefByCode(code, CountryIntelController.resolveCountryName(code));
      }
    });
  }

  async openCountryBrief(lat: number, lon: number): Promise<void> {
    if (!this.countryBriefPage) return;
    const token = ++this.briefRequestToken;
    this.countryBriefPage.showLoading();
    this.deps.getMap()?.setRenderPaused(true);

    const localGeo = getCountryAtCoordinates(lat, lon);
    if (localGeo) {
      if (token !== this.briefRequestToken) return; // superseded by newer click
      this.openCountryBriefByCode(localGeo.code, localGeo.name);
      return;
    }

    const geo = await reverseGeocode(lat, lon);
    if (token !== this.briefRequestToken) return; // superseded by newer click
    if (!geo) {
      this.countryBriefPage.hide();
      this.deps.getMap()?.setRenderPaused(false);
      return;
    }

    this.openCountryBriefByCode(geo.code, geo.country);
  }

  async openCountryBriefByCode(code: string, country: string): Promise<void> {
    if (!this.countryBriefPage) return;
    const wasVisible = this.countryBriefPage.isVisible(); // [country-view] push vs replace
    this.deps.getMap()?.setRenderPaused(true);

    // Normalize to canonical name (GeoJSON may use "United States of America" etc.)
    const canonicalName = TIER1_COUNTRIES[code] || CountryIntelController.resolveCountryName(code);
    if (canonicalName !== code) country = canonicalName;

    const scores = calculateCII();
    const score = scores.find((s) => s.code === code) ?? null;
    const signals = this.getCountrySignals(code, country);

    this.countryBriefPage.show(country, code, score, signals);
    this.deps.getMap()?.highlightCountry(code);

    // [country-view] Reflect the view in the URL. A fresh open from a gesture
    // PUSHES a history entry so browser Back closes the view; switching country
    // while open, or restoring a ?country= deep link, REPLACES (no phantom entry).
    const shareUrl = this.deps.getShareUrl();
    if (shareUrl) {
      const already = new URLSearchParams(window.location.search).get('country');
      if (!wasVisible && already?.toUpperCase() !== code.toUpperCase()) {
        history.pushState(null, '', shareUrl);
      } else {
        history.replaceState(null, '', shareUrl);
      }
    }

    const stockPromise = fetch(`/v1/world/stock-index?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .catch(() => ({ available: false }));

    stockPromise.then((stock) => {
      if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateStock(stock);
    });

    fetchCountryMarkets(country)
      .then((markets) => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets(markets);
      })
      .catch(() => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets([]);
      });

    // Pass evidence headlines
    const searchTerms = CountryIntelController.getCountrySearchTerms(country, code);
    const otherCountryTerms = CountryIntelController.getOtherCountryTerms(code);
    const matchingNews = this.deps.getAllNews().filter((n) => {
      const t = n.title.toLowerCase();
      return searchTerms.some((term) => t.includes(term));
    });
    const filteredNews = matchingNews.filter((n) => {
      const t = n.title.toLowerCase();
      const ourPos = CountryIntelController.firstMentionPosition(t, searchTerms);
      const otherPos = CountryIntelController.firstMentionPosition(t, otherCountryTerms);
      return ourPos !== Infinity && (otherPos === Infinity || ourPos <= otherPos);
    });
    if (filteredNews.length > 0) {
      this.countryBriefPage.updateNews(filteredNews.slice(0, 8));
    }

    // Infrastructure exposure
    this.countryBriefPage.updateInfrastructure(code);

    // Timeline
    this.mountCountryTimeline(code, country);

    try {
      const context: Record<string, unknown> = {};
      if (score) {
        context.score = score.score;
        context.level = score.level;
        context.trend = score.trend;
        context.components = score.components;
        context.change24h = score.change24h;
      }
      Object.assign(context, signals);

      const countryCluster = signalAggregator.getCountryClusters().find((c) => c.country === code);
      if (countryCluster) {
        context.convergenceScore = countryCluster.convergenceScore;
        context.signalTypes = [...countryCluster.signalTypes];
      }

      const convergences = signalAggregator.getRegionalConvergence()
        .filter((r) => r.countries.includes(code));
      if (convergences.length) {
        context.regionalConvergence = convergences.map((r) => r.description);
      }

      const headlines = filteredNews.slice(0, 15).map((n) => n.title);
      if (headlines.length) context.headlines = headlines;

      const stockData = await stockPromise;
      if (stockData.available) {
        const pct = parseFloat(stockData.weekChangePercent);
        context.stockIndex = `${stockData.indexName}: ${stockData.price} (${pct >= 0 ? '+' : ''}${stockData.weekChangePercent}% week)`;
      }

      let data: Record<string, unknown> | null = null;
      try {
        const res = await fetch('/v1/world/country-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, code, context }),
        });
        data = await res.json();
      } catch { /* server unreachable */ }

      if (data && data.brief && !data.skipped) {
        this.countryBriefPage!.updateBrief({ ...data, code } as Parameters<CountryBriefPage['updateBrief']>[0]); // [country-view] typeof-this → class index (stable under new imports)
      } else {
        const briefHeadlines = (context.headlines as string[] | undefined) || [];
        let fallbackBrief = '';
        const sumModelId = BETA_MODE ? 'summarization-beta' : 'summarization';
        if (briefHeadlines.length >= 2 && mlWorker.isAvailable && mlWorker.isModelLoaded(sumModelId)) {
          try {
            const prompt = `Summarize the current situation in ${country} based on these headlines: ${briefHeadlines.slice(0, 8).join('. ')}`;
            const [summary] = await mlWorker.summarize([prompt], BETA_MODE ? 'summarization-beta' : undefined);
            if (summary && summary.length > 20) fallbackBrief = summary;
          } catch { /* T5 failed */ }
        }

        if (fallbackBrief) {
          this.countryBriefPage!.updateBrief({ brief: fallbackBrief, country, code, fallback: true });
        } else {
          const lines: string[] = [];
          if (score) lines.push(`**Instability Index: ${score.score}/100** (${score.level}, ${score.trend})`);
          if (signals.protests > 0) lines.push(`${signals.protests} active protests detected`);
          if (signals.militaryFlights > 0) lines.push(`${signals.militaryFlights} military aircraft tracked`);
          if (signals.militaryVessels > 0) lines.push(`${signals.militaryVessels} military vessels tracked`);
          if (signals.outages > 0) lines.push(`${signals.outages} internet outages`);
          if (signals.earthquakes > 0) lines.push(`${signals.earthquakes} recent earthquakes`);
          if (context.stockIndex) lines.push(`Stock index: ${context.stockIndex}`);
          if (briefHeadlines.length > 0) {
            lines.push('', '**Recent headlines:**');
            briefHeadlines.slice(0, 5).forEach(h => lines.push(`• ${h}`));
          }
          if (lines.length > 0) {
            this.countryBriefPage!.updateBrief({ brief: lines.join('\n'), country, code, fallback: true });
          } else {
            this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'No AI service available. Configure GROQ_API_KEY in Settings for full briefs.' });
          }
        }
      }
    } catch (err) {
      console.error('[CountryBrief] fetch error:', err);
      this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'Failed to generate brief' });
    }
  }

  private mountCountryTimeline(code: string, country: string): void {
    this.countryTimeline?.destroy();
    this.countryTimeline = null;

    const mount = this.countryBriefPage?.getTimelineMount();
    if (!mount) return;

    const events: TimelineEvent[] = [];
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!CountryIntelController.COUNTRY_BOUNDS[code];
    const inCountry = (lat: number, lon: number) => hasGeoShape && this.isInCountry(lat, lon, code);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const cache = this.deps.getIntelligenceCache();
    if (cache.protests?.events) {
      for (const e of cache.protests.events) {
        if (e.country?.toLowerCase() === countryLower || inCountry(e.lat, e.lon)) {
          events.push({
            timestamp: new Date(e.time).getTime(),
            lane: 'protest',
            label: e.title || `${e.eventType} in ${e.city || e.country}`,
            severity: e.severity === 'high' ? 'high' : e.severity === 'medium' ? 'medium' : 'low',
          });
        }
      }
    }

    if (cache.earthquakes) {
      for (const eq of cache.earthquakes) {
        if (inCountry(eq.lat, eq.lon) || eq.place?.toLowerCase().includes(countryLower)) {
          events.push({
            timestamp: new Date(eq.time).getTime(),
            lane: 'natural',
            label: `M${eq.magnitude.toFixed(1)} ${eq.place}`,
            severity: eq.magnitude >= 6 ? 'critical' : eq.magnitude >= 5 ? 'high' : eq.magnitude >= 4 ? 'medium' : 'low',
          });
        }
      }
    }

    if (cache.military) {
      for (const f of cache.military.flights) {
        if (hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(f.lastSeen).getTime(),
            lane: 'military',
            label: `${f.callsign} (${f.aircraftModel || f.aircraftType})`,
            severity: f.isInteresting ? 'high' : 'low',
          });
        }
      }
      for (const v of cache.military.vessels) {
        if (hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(v.lastAisUpdate).getTime(),
            lane: 'military',
            label: `${v.name} (${v.vesselType})`,
            severity: v.isDark ? 'high' : 'low',
          });
        }
      }
    }

    const ciiData = getCountryData(code);
    if (ciiData?.conflicts) {
      for (const c of ciiData.conflicts) {
        events.push({
          timestamp: new Date(c.time).getTime(),
          lane: 'conflict',
          label: `${c.eventType}: ${c.location || c.country}`,
          severity: c.fatalities > 0 ? 'critical' : 'high',
        });
      }
    }

    this.countryTimeline = new CountryTimeline(mount);
    this.countryTimeline.render(events.filter(e => e.timestamp >= sevenDaysAgo));
  }

  private static COUNTRY_BOUNDS: Record<string, { n: number; s: number; e: number; w: number }> = {
    IR: { n: 40, s: 25, e: 63, w: 44 }, IL: { n: 33.3, s: 29.5, e: 35.9, w: 34.3 },
    SA: { n: 32, s: 16, e: 55, w: 35 }, AE: { n: 26.1, s: 22.6, e: 56.4, w: 51.6 },
    IQ: { n: 37.4, s: 29.1, e: 48.6, w: 38.8 }, SY: { n: 37.3, s: 32.3, e: 42.4, w: 35.7 },
    YE: { n: 19, s: 12, e: 54.5, w: 42 }, LB: { n: 34.7, s: 33.1, e: 36.6, w: 35.1 },
    CN: { n: 53.6, s: 18.2, e: 134.8, w: 73.5 }, TW: { n: 25.3, s: 21.9, e: 122, w: 120 },
    JP: { n: 45.5, s: 24.2, e: 153.9, w: 122.9 }, KR: { n: 38.6, s: 33.1, e: 131.9, w: 124.6 },
    KP: { n: 43.0, s: 37.7, e: 130.7, w: 124.2 }, IN: { n: 35.5, s: 6.7, e: 97.4, w: 68.2 },
    PK: { n: 37, s: 24, e: 77, w: 61 }, AF: { n: 38.5, s: 29.4, e: 74.9, w: 60.5 },
    UA: { n: 52.4, s: 44.4, e: 40.2, w: 22.1 }, RU: { n: 82, s: 41.2, e: 180, w: 19.6 },
    BY: { n: 56.2, s: 51.3, e: 32.8, w: 23.2 }, PL: { n: 54.8, s: 49, e: 24.1, w: 14.1 },
    EG: { n: 31.7, s: 22, e: 36.9, w: 25 }, LY: { n: 33, s: 19.5, e: 25, w: 9.4 },
    SD: { n: 22, s: 8.7, e: 38.6, w: 21.8 }, US: { n: 49, s: 24.5, e: -66.9, w: -125 },
    GB: { n: 58.7, s: 49.9, e: 1.8, w: -8.2 }, DE: { n: 55.1, s: 47.3, e: 15.0, w: 5.9 },
    FR: { n: 51.1, s: 41.3, e: 9.6, w: -5.1 }, TR: { n: 42.1, s: 36, e: 44.8, w: 26 },
    BR: { n: 5.3, s: -33.8, e: -34.8, w: -73.9 },
  };

  private static COUNTRY_ALIASES: Record<string, string[]> = {
    IL: ['israel', 'israeli', 'gaza', 'hamas', 'hezbollah', 'netanyahu', 'idf', 'west bank', 'tel aviv', 'jerusalem'],
    IR: ['iran', 'iranian', 'tehran', 'persian', 'irgc', 'khamenei'],
    RU: ['russia', 'russian', 'moscow', 'kremlin', 'putin', 'ukraine war'],
    UA: ['ukraine', 'ukrainian', 'kyiv', 'zelensky', 'zelenskyy'],
    CN: ['china', 'chinese', 'beijing', 'taiwan strait', 'south china sea', 'xi jinping'],
    TW: ['taiwan', 'taiwanese', 'taipei'],
    KP: ['north korea', 'pyongyang', 'kim jong'],
    KR: ['south korea', 'seoul'],
    SA: ['saudi', 'riyadh', 'mbs'],
    SY: ['syria', 'syrian', 'damascus', 'assad'],
    YE: ['yemen', 'houthi', 'sanaa'],
    IQ: ['iraq', 'iraqi', 'baghdad'],
    AF: ['afghanistan', 'afghan', 'kabul', 'taliban'],
    PK: ['pakistan', 'pakistani', 'islamabad'],
    IN: ['india', 'indian', 'new delhi', 'modi'],
    EG: ['egypt', 'egyptian', 'cairo', 'suez'],
    LB: ['lebanon', 'lebanese', 'beirut'],
    TR: ['turkey', 'turkish', 'ankara', 'erdogan', 'türkiye'],
    US: ['united states', 'american', 'washington', 'pentagon', 'white house'],
    GB: ['united kingdom', 'british', 'london', 'uk '],
    BR: ['brazil', 'brazilian', 'brasilia', 'lula', 'bolsonaro'],
    AE: ['united arab emirates', 'uae', 'emirati', 'dubai', 'abu dhabi'],
  };

  private static otherCountryTermsCache: Map<string, string[]> = new Map();

  private static firstMentionPosition(text: string, terms: string[]): number {
    let earliest = Infinity;
    for (const term of terms) {
      const idx = text.indexOf(term);
      if (idx !== -1 && idx < earliest) earliest = idx;
    }
    return earliest;
  }

  private static getOtherCountryTerms(code: string): string[] {
    const cached = CountryIntelController.otherCountryTermsCache.get(code);
    if (cached) return cached;

    const dedup = new Set<string>();
    Object.entries(CountryIntelController.COUNTRY_ALIASES).forEach(([countryCode, aliases]) => {
      if (countryCode === code) return;
      aliases.forEach((alias) => {
        const normalized = alias.toLowerCase();
        if (normalized.trim().length > 0) dedup.add(normalized);
      });
    });

    const terms = [...dedup];
    CountryIntelController.otherCountryTermsCache.set(code, terms);
    return terms;
  }

  static resolveCountryName(code: string): string {
    if (TIER1_COUNTRIES[code]) return TIER1_COUNTRIES[code];

    try {
      const displayNamesCtor = (Intl as unknown as { DisplayNames?: IntlDisplayNamesCtor }).DisplayNames;
      if (!displayNamesCtor) return code;
      const displayNames = new displayNamesCtor(['en'], { type: 'region' });
      const resolved = displayNames.of(code);
      if (resolved && resolved.toUpperCase() !== code) return resolved;
    } catch {
      // Intl.DisplayNames unavailable in older runtimes.
    }

    return code;
  }

  private static getCountrySearchTerms(country: string, code: string): string[] {
    const aliases = CountryIntelController.COUNTRY_ALIASES[code];
    if (aliases) return aliases;
    if (/^[A-Z]{2}$/i.test(country.trim())) return [];
    return [country.toLowerCase()];
  }

  private isInCountry(lat: number, lon: number, code: string): boolean {
    const precise = isCoordinateInCountry(lat, lon, code);
    if (precise != null) return precise;
    const b = CountryIntelController.COUNTRY_BOUNDS[code];
    if (!b) return false;
    return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
  }

  private getCountrySignals(code: string, country: string): CountryBriefSignals {
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!CountryIntelController.COUNTRY_BOUNDS[code];

    const cache = this.deps.getIntelligenceCache();
    let protests = 0;
    if (cache.protests?.events) {
      protests = cache.protests.events.filter((e) =>
        e.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(e.lat, e.lon, code))
      ).length;
    }

    let militaryFlights = 0;
    let militaryVessels = 0;
    if (cache.military) {
      militaryFlights = cache.military.flights.filter((f) =>
        hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code
      ).length;
      militaryVessels = cache.military.vessels.filter((v) =>
        hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code
      ).length;
    }

    let outages = 0;
    if (cache.outages) {
      outages = cache.outages.filter((o) =>
        o.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(o.lat, o.lon, code))
      ).length;
    }

    let earthquakes = 0;
    if (cache.earthquakes) {
      earthquakes = cache.earthquakes.filter((eq) => {
        if (hasGeoShape) return this.isInCountry(eq.lat, eq.lon, code);
        return eq.place?.toLowerCase().includes(countryLower);
      }).length;
    }

    const ciiData = getCountryData(code);
    const isTier1 = !!TIER1_COUNTRIES[code];

    return {
      protests,
      militaryFlights,
      militaryVessels,
      outages,
      earthquakes,
      displacementOutflow: ciiData?.displacementOutflow ?? 0,
      climateStress: ciiData?.climateStress ?? 0,
      conflictEvents: ciiData?.conflicts?.length ?? 0,
      isTier1,
    };
  }

  openCountryStory(code: string, name: string): void {
    if (!dataFreshness.hasSufficientData() || this.deps.getLatestClusters().length === 0) {
      this.showToast('Data still loading — try again in a moment');
      return;
    }
    const posturePanel = this.deps.getPanels()['strategic-posture'] as StrategicPosturePanel | undefined;
    const postures = posturePanel?.getPostures() || [];
    const signals = this.getCountrySignals(code, name);
    const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
    const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
    const convergence = cluster ? {
      score: cluster.convergenceScore,
      signalTypes: [...cluster.signalTypes],
      regionalDescriptions: regional.map(r => r.description),
    } : null;
    const data = collectStoryData(code, name, this.deps.getLatestClusters(), postures, this.deps.getLatestPredictions(), signals, convergence);
    openStoryModal(data);
  }

  private showToast(msg: string): void {
    document.querySelector('.toast-notification')?.remove();
    const el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 3000);
  }
}
