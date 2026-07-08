import {
  PQC_STANDARDS,
  CNSA2_TIMELINE,
  PQ_READINESS,
  HARVEST_NOW_DECRYPT_LATER,
  pqReadinessRank,
  type PQStandard,
  type PQReadiness,
  type CNSAMilestone,
} from '@/config/post-quantum';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem, type WorldFeedSeverity } from './world-feed';

export interface PostQuantumData {
  standards: PQStandard[];
  timeline: CNSAMilestone[];
  readiness: PQReadiness[];
  harvestNote: string;
  insight: string;
  updatedAt: Date;
}

function computeInsight(readiness: PQReadiness[]): string {
  const ready = readiness.filter((r) => r.status === 'pq-native' || r.status === 'deployed').length;
  const standardized = PQC_STANDARDS.filter((s) => s.status === 'standardized').length;
  const nowYear = new Date().getFullYear();
  const nextMilestone = CNSA2_TIMELINE.find((m) => m.year >= nowYear);
  const countdown = nextMilestone ? `CNSA 2.0 ${nextMilestone.year} (${nextMilestone.year - nowYear}y)` : 'CNSA 2.0 complete';
  return `${standardized} NIST standards live · ${ready}/${readiness.length} orgs PQ-ready · next ${countdown}`;
}

export function getPostQuantumData(): PostQuantumData {
  const readiness = [...PQ_READINESS].sort((a, b) => pqReadinessRank(b.status) - pqReadinessRank(a.status));
  return {
    standards: PQC_STANDARDS,
    timeline: CNSA2_TIMELINE,
    readiness,
    harvestNote: HARVEST_NOW_DECRYPT_LATER,
    insight: computeInsight(readiness),
    updatedAt: new Date(),
  };
}

function readinessSeverity(r: PQReadiness): WorldFeedSeverity {
  switch (r.status) {
    case 'pq-native': return 'info';
    case 'deployed': return 'low';
    case 'in-progress': return 'elevated';
    case 'planned': return 'high';
    default: return 'critical';
  }
}

async function buildFeed(): Promise<WorldFeed> {
  const data = getPostQuantumData();
  const standardItems: WorldFeedItem[] = data.standards.map((s) => ({
    id: `pq:standard:${s.id}`,
    title: `${s.id} · ${s.name} (${s.basedOn})`,
    summary: s.note,
    category: 'standard',
    tags: [s.kind, s.status],
    meta: { year: s.year },
  }));
  const readinessItems: WorldFeedItem[] = data.readiness.map((r) => ({
    id: `pq:readiness:${r.id}`,
    title: `${r.org} — ${r.status}`,
    summary: r.detail,
    category: r.type,
    severity: readinessSeverity(r),
    tags: r.algorithms,
    meta: { asOf: r.asOf },
  }));
  const timelineItems: WorldFeedItem[] = data.timeline.map((m) => ({
    id: `pq:cnsa2:${m.year}`,
    title: `CNSA 2.0 · ${m.year}`,
    summary: m.milestone,
    category: 'timeline',
    timestamp: new Date(Date.UTC(m.year, 0, 1)).toISOString(),
  }));
  return {
    domain: 'post-quantum',
    label: 'Post-Quantum Readiness',
    updatedAt: data.updatedAt.toISOString(),
    source: 'NIST PQC (FIPS 203/204/205) + NSA CNSA 2.0 + curated deployment tracker',
    live: false,
    insight: data.insight,
    items: [...standardItems, ...readinessItems, ...timelineItems],
  };
}

export function getPostQuantumFeed(): Promise<WorldFeed> {
  return buildFeed();
}

registerWorldFeed('post-quantum', getPostQuantumFeed);
