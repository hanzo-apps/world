import { fetchArxivPapers, getArxivStatus, type ArxivPaper } from './arxiv';
import { QUANTUM_PLAYERS, type QuantumPlayer } from '@/config/quantum';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem } from './world-feed';

export interface QuantumData {
  papers: ArxivPaper[];
  players: QuantumPlayer[];
  insight: string;
  updatedAt: Date;
}

function topScale(players: QuantumPlayer[]): QuantumPlayer | null {
  return players
    .filter((p) => p.qubits !== null)
    .sort((a, b) => (b.qubits ?? 0) - (a.qubits ?? 0))[0] ?? null;
}

function computeInsight(papers: QuantumData['papers']): string {
  const leader = topScale(QUANTUM_PLAYERS);
  const scale = leader ? `${leader.qubits!.toLocaleString()} qubits (${leader.name})` : 'multiple architectures';
  const modalities = new Set(QUANTUM_PLAYERS.map((p) => p.modality)).size;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = papers.filter((p) => p.published.getTime() >= weekAgo).length;
  return `Max announced: ${scale} · ${modalities} modalities · ${recent} new quant-ph papers/wk`;
}

export async function getQuantumData(): Promise<QuantumData> {
  const papers = await fetchArxivPapers('quant-ph', 30);
  return {
    papers,
    players: QUANTUM_PLAYERS,
    insight: computeInsight(papers),
    updatedAt: new Date(),
  };
}

async function buildFeed(): Promise<WorldFeed> {
  const data = await getQuantumData();
  const paperItems: WorldFeedItem[] = data.papers.slice(0, 20).map((p) => ({
    id: `quantum:paper:${p.id}`,
    title: p.title,
    summary: p.summary.slice(0, 400),
    category: 'research',
    url: p.link,
    timestamp: p.published.toISOString(),
    tags: p.categories,
  }));
  const playerItems: WorldFeedItem[] = data.players.map((p) => ({
    id: `quantum:player:${p.id}`,
    title: p.name,
    summary: `${p.metric} — ${p.modality} (${p.city}, as of ${p.asOf})`,
    category: p.modality,
    url: p.url,
    lat: p.lat,
    lon: p.lon,
    tags: [p.country, p.modality],
    meta: { qubits: p.qubits, asOf: p.asOf, milestone: p.milestone },
  }));
  return {
    domain: 'quantum',
    label: 'Quantum Computing',
    updatedAt: data.updatedAt.toISOString(),
    source: 'arXiv quant-ph + curated hardware registry',
    live: data.papers.length > 0,
    insight: data.insight,
    items: [...paperItems, ...playerItems],
  };
}

export function getQuantumFeed(): Promise<WorldFeed> {
  return buildFeed();
}

export function getQuantumStatus(): string {
  return getArxivStatus('quant-ph');
}

registerWorldFeed('quantum', getQuantumFeed);
