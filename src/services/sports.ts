import { createCircuitBreaker } from '@/utils';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem } from './world-feed';

// ESPN's public site API — free, no key, CORS-enabled. One league per path.
const LEAGUES: Array<{ sport: string; league: string; label: string }> = [
  { sport: 'football', league: 'nfl', label: 'NFL' },
  { sport: 'basketball', league: 'nba', label: 'NBA' },
  { sport: 'baseball', league: 'mlb', label: 'MLB' },
  { sport: 'hockey', league: 'nhl', label: 'NHL' },
  { sport: 'soccer', league: 'eng.1', label: 'Premier League' },
  { sport: 'soccer', league: 'uefa.champions', label: 'UCL' },
];

const ESPN = (sport: string, league: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;

export type SportState = 'pre' | 'in' | 'post';

export interface SportEvent {
  id: string;
  league: string;
  name: string;
  shortName: string;
  state: SportState;
  status: string;      // "Q3 5:20", "Final", scheduled time, ...
  date: Date;
  home: { name: string; score: string };
  away: { name: string; score: string };
  url?: string;
}

interface EspnCompetitor {
  homeAway?: string;
  team?: { displayName?: string; abbreviation?: string };
  score?: string;
}
interface EspnEvent {
  id?: string;
  date?: string;
  name?: string;
  shortName?: string;
  status?: { type?: { state?: string; shortDetail?: string; detail?: string } };
  competitions?: Array<{ competitors?: EspnCompetitor[] }>;
  links?: Array<{ href?: string }>;
}
interface EspnScoreboard {
  events?: EspnEvent[];
}

const breaker = createCircuitBreaker<SportEvent[]>({ name: 'ESPN Sports', cacheTtlMs: 60 * 1000 });

function toState(state: string | undefined): SportState {
  if (state === 'in') return 'in';
  if (state === 'post') return 'post';
  return 'pre';
}

function parseLeague(json: EspnScoreboard, label: string): SportEvent[] {
  const events = Array.isArray(json.events) ? json.events : [];
  const out: SportEvent[] = [];
  for (const e of events) {
    const comp = e.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
    if (!home || !away) continue;
    out.push({
      id: `${label}:${e.id ?? e.shortName ?? Math.random().toString(36).slice(2)}`,
      league: label,
      name: e.name ?? e.shortName ?? '',
      shortName: e.shortName ?? e.name ?? '',
      state: toState(e.status?.type?.state),
      status: e.status?.type?.shortDetail ?? e.status?.type?.detail ?? '',
      date: e.date ? new Date(e.date) : new Date(),
      home: { name: home.team?.displayName ?? home.team?.abbreviation ?? 'Home', score: home.score ?? '' },
      away: { name: away.team?.displayName ?? away.team?.abbreviation ?? 'Away', score: away.score ?? '' },
      url: e.links?.[0]?.href,
    });
  }
  return out;
}

export async function fetchSportsEvents(): Promise<SportEvent[]> {
  return breaker.execute(async () => {
    const results = await Promise.allSettled(
      LEAGUES.map(async ({ sport, league, label }) => {
        const res = await fetch(ESPN(sport, league), { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseLeague((await res.json()) as EspnScoreboard, label);
      })
    );
    const all: SportEvent[] = [];
    for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
    if (all.length === 0) throw new Error('no events from any league');
    // Live first, then scheduled soonest, then recently finished.
    const rank = (s: SportState) => (s === 'in' ? 0 : s === 'pre' ? 1 : 2);
    return all.sort((a, b) => rank(a.state) - rank(b.state) || a.date.getTime() - b.date.getTime());
  }, []);
}

export function sportsInsight(events: SportEvent[]): string {
  const live = events.filter((e) => e.state === 'in').length;
  const today = new Date().toDateString();
  const scheduled = events.filter((e) => e.state === 'pre' && e.date.toDateString() === today).length;
  const leagues = new Set(events.map((e) => e.league)).size;
  return `${live} live now · ${scheduled} scheduled today · ${leagues} leagues`;
}

async function buildFeed(): Promise<WorldFeed> {
  const events = await fetchSportsEvents();
  const items: WorldFeedItem[] = events.slice(0, 40).map((e) => ({
    id: `sports:${e.id}`,
    title: e.shortName || e.name,
    summary: e.state === 'pre'
      ? `${e.league} · ${e.status}`
      : `${e.league} · ${e.away.name} ${e.away.score} @ ${e.home.name} ${e.home.score} · ${e.status}`,
    category: e.league,
    url: e.url,
    timestamp: e.date.toISOString(),
    severity: e.state === 'in' ? 'elevated' : 'info',
    tags: [e.league, e.state],
  }));
  return {
    domain: 'sports',
    label: 'Sports & Events',
    updatedAt: new Date().toISOString(),
    source: 'ESPN public scoreboard API',
    live: events.some((e) => e.state === 'in'),
    insight: sportsInsight(events),
    items,
  };
}

export function getSportsFeed(): Promise<WorldFeed> {
  return buildFeed();
}

export function getSportsStatus(): string {
  return breaker.getStatus();
}

registerWorldFeed('sports', getSportsFeed);
