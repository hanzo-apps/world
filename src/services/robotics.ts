import { fetchArxivPapers, getArxivStatus, type ArxivPaper } from './arxiv';
import { ROBOTICS_ORGS, type RoboticsOrg } from '@/config/robotics';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem } from './world-feed';

export interface RoboticsData {
  papers: ArxivPaper[];
  orgs: RoboticsOrg[];
  insight: string;
  updatedAt: Date;
}

const HUMANOID_TERMS = ['humanoid', 'bipedal', 'manipulation', 'dexterous', 'locomotion', 'whole-body'];

function computeInsight(papers: ArxivPaper[]): string {
  if (papers.length === 0) return `${ROBOTICS_ORGS.length} labs tracked · research feed unavailable`;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = papers.filter((p) => p.published.getTime() >= weekAgo).length;
  const humanoid = papers.filter((p) => {
    const t = `${p.title} ${p.summary}`.toLowerCase();
    return HUMANOID_TERMS.some((term) => t.includes(term));
  }).length;
  const humanoidOrgs = ROBOTICS_ORGS.filter((o) => o.category === 'humanoid').length;
  return `${recent} new papers this week · ${humanoid}/${papers.length} on embodied/humanoid · ${humanoidOrgs} humanoid labs`;
}

export async function getRoboticsData(): Promise<RoboticsData> {
  const papers = await fetchArxivPapers('cs.RO', 30);
  return {
    papers,
    orgs: ROBOTICS_ORGS,
    insight: computeInsight(papers),
    updatedAt: new Date(),
  };
}

async function buildFeed(): Promise<WorldFeed> {
  const data = await getRoboticsData();
  const paperItems: WorldFeedItem[] = data.papers.slice(0, 20).map((p) => ({
    id: `robotics:paper:${p.id}`,
    title: p.title,
    summary: p.summary.slice(0, 400),
    category: 'research',
    url: p.link,
    timestamp: p.published.toISOString(),
    tags: p.categories,
  }));
  const orgItems: WorldFeedItem[] = data.orgs.map((o) => ({
    id: `robotics:org:${o.id}`,
    title: o.name,
    summary: o.focus,
    category: o.category,
    url: o.url,
    lat: o.lat,
    lon: o.lon,
    tags: [o.country, o.category],
  }));
  return {
    domain: 'robotics',
    label: 'Robotics',
    updatedAt: data.updatedAt.toISOString(),
    source: 'arXiv cs.RO + curated robotics registry',
    live: data.papers.length > 0,
    insight: data.insight,
    items: [...paperItems, ...orgItems],
  };
}

export function getRoboticsFeed(): Promise<WorldFeed> {
  return buildFeed();
}

export function getRoboticsStatus(): string {
  return getArxivStatus('cs.RO');
}

registerWorldFeed('robotics', getRoboticsFeed);
