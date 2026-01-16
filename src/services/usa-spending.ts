/**
 * USASpending.gov API Service
 * Tracks federal government contracts and awards
 * Free API - no key required
 */

import { dataFreshness } from './data-freshness';

export interface GovernmentAward {
  id: string;
  recipientName: string;
  amount: number;
  agency: string;
  description: string;
  startDate: string;
  awardType: 'contract' | 'grant' | 'loan' | 'other';
}

export interface SpendingSummary {
  awards: GovernmentAward[];
  totalAmount: number;
  periodStart: string;
  periodEnd: string;
  fetchedAt: Date;
}

const API_BASE = 'https://api.usaspending.gov/api/v2';

// Award type code mapping
const AWARD_TYPE_MAP: Record<string, GovernmentAward['awardType']> = {
  'A': 'contract', 'B': 'contract', 'C': 'contract', 'D': 'contract',
  '02': 'grant', '03': 'grant', '04': 'grant', '05': 'grant',
  '06': 'grant', '10': 'grant',
  '07': 'loan', '08': 'loan',
};

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0]!;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]!;
}

/**
 * Fetch recent government awards/contracts
 */
export async function fetchRecentAwards(options: {
  daysBack?: number;
  limit?: number;
  awardTypes?: ('contract' | 'grant' | 'loan')[];
} = {}): Promise<SpendingSummary> {
  const { daysBack = 7, limit = 15, awardTypes = ['contract'] } = options;

  const periodStart = getDateDaysAgo(daysBack);
  const periodEnd = getToday();

  // Map award types to codes
  const awardTypeCodes: string[] = [];
  if (awardTypes.includes('contract')) awardTypeCodes.push('A', 'B', 'C', 'D');
  if (awardTypes.includes('grant')) awardTypeCodes.push('02', '03', '04', '05', '06', '10');
  if (awardTypes.includes('loan')) awardTypeCodes.push('07', '08');

  try {
    const response = await fetch(`${API_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          time_period: [{ start_date: periodStart, end_date: periodEnd }],
          award_type_codes: awardTypeCodes,
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Award Amount',
          'Awarding Agency',
          'Description',
          'Start Date',
          'Award Type',
        ],
        limit,
        order: 'desc',
        sort: 'Award Amount',
      }),
    });

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    const awards: GovernmentAward[] = results.map((r: Record<string, unknown>) => ({
      id: String(r['Award ID'] || ''),
      recipientName: String(r['Recipient Name'] || 'Unknown'),
      amount: Number(r['Award Amount']) || 0,
      agency: String(r['Awarding Agency'] || 'Unknown'),
      description: String(r['Description'] || '').slice(0, 200),
      startDate: String(r['Start Date'] || ''),
      awardType: AWARD_TYPE_MAP[String(r['Award Type'] || '')] || 'other',
    }));

    const totalAmount = awards.reduce((sum, a) => sum + a.amount, 0);

    // Record data freshness
    if (awards.length > 0) {
      dataFreshness.recordUpdate('economic', awards.length);
    }

    return {
      awards,
      totalAmount,
      periodStart,
      periodEnd,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error('[USASpending] Fetch failed:', error);
    dataFreshness.recordError('economic', error instanceof Error ? error.message : 'Unknown error');
    return {
      awards: [],
      totalAmount: 0,
      periodStart,
      periodEnd,
      fetchedAt: new Date(),
    };
  }
}

/**
 * Format currency for display
 */
export function formatAwardAmount(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Get award type emoji
 */
export function getAwardTypeIcon(type: GovernmentAward['awardType']): string {
  switch (type) {
    case 'contract': return '📄';
    case 'grant': return '🎁';
    case 'loan': return '💰';
    default: return '📋';
  }
}
