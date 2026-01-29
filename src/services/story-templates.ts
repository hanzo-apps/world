import type { StoryData } from './story-data';

// Story Template Types
export type StoryTemplate = 
  | 'ciianalysis'      // Full country analysis (default)
  | 'crisisalert'      // Crisis-focused
  | 'dailybrief'       // AI summary + top stories
  | 'marketfocus'      // Prediction markets focus
  | 'compare'          // Two-country comparison
  | 'trend';           // 7-day trend chart

// Template configuration
export interface StoryTemplateConfig {
  id: StoryTemplate;
  name: string;
  description: string;
  icon: string;
  sections: StorySection[];
}

interface StorySection {
  id: string;
  title: string;
  height: number; // percentage of canvas
}

// Template definitions with section layouts
export const STORY_TEMPLATES: Record<StoryTemplate, StoryTemplateConfig> = {
  ciianalysis: {
    id: 'ciianalysis',
    name: 'Country Analysis',
    description: 'Complete intelligence snapshot with all metrics',
    icon: '📊',
    sections: [
      { id: 'header', title: 'Header', height: 8 },
      { id: 'cii', title: 'CII Score', height: 15 },
      { id: 'signals', title: 'Active Signals', height: 12 },
      { id: 'convergence', title: 'Convergence', height: 12 },
      { id: 'news', title: 'Top Headlines', height: 25 },
      { id: 'theater', title: 'Military Posture', height: 15 },
      { id: 'markets', title: 'Prediction Markets', height: 10 },
      { id: 'footer', title: 'Footer', height: 3 },
    ],
  },
  crisisalert: {
    id: 'crisisalert',
    name: 'Crisis Alert',
    description: 'Focused on active threats and convergence',
    icon: '🚨',
    sections: [
      { id: 'header', title: 'Header', height: 6 },
      { id: 'cii', title: 'CII Score', height: 10 },
      { id: 'convergence', title: 'Convergence Alert', height: 20 },
      { id: 'threats', title: 'Threat Breakdown', height: 15 },
      { id: 'signals', title: 'Active Signals', height: 15 },
      { id: 'news', title: 'Critical Headlines', height: 20 },
      { id: 'footer', title: 'Footer', height: 4 },
    ],
  },
  dailybrief: {
    id: 'dailybrief',
    name: 'Daily Brief',
    description: 'AI-synthesized summary of top developments',
    icon: '📰',
    sections: [
      { id: 'header', title: 'Header', height: 6 },
      { id: 'ai_summary', title: 'AI Summary', height: 25 },
      { id: 'top_news', title: 'Top 3 Stories', height: 35 },
      { id: 'cii', title: 'Watch Countries', height: 15 },
      { id: 'markets', title: 'Key Markets', height: 12 },
      { id: 'footer', title: 'Footer', height: 7 },
    ],
  },
  marketfocus: {
    id: 'marketfocus',
    name: 'Markets Focus',
    description: 'Prediction markets and economic indicators',
    icon: '🎯',
    sections: [
      { id: 'header', title: 'Header', height: 6 },
      { id: 'cii', title: 'Country Risk', height: 10 },
      { id: 'markets', title: 'Prediction Markets', height: 40 },
      { id: 'economic', title: 'Economic Data', height: 20 },
      { id: 'news', title: 'Market News', height: 17 },
      { id: 'footer', title: 'Footer', height: 7 },
    ],
  },
  compare: {
    id: 'compare',
    name: 'Country Comparison',
    description: 'Side-by-side comparison of two countries',
    icon: '⚖️',
    sections: [
      { id: 'header', title: 'Header', height: 5 },
      { id: 'country1', title: 'Country 1', height: 22 },
      { id: 'country2', title: 'Country 2', height: 22 },
      { id: 'comparison', title: 'Comparison Table', height: 30 },
      { id: 'markets', title: 'Related Markets', height: 14 },
      { id: 'footer', title: 'Footer', height: 7 },
    ],
  },
  trend: {
    id: 'trend',
    name: 'Trend Analysis',
    description: '7-day instability index trend chart',
    icon: '📈',
    sections: [
      { id: 'header', title: 'Header', height: 5 },
      { id: 'current_cii', title: 'Current CII', height: 12 },
      { id: 'trend_chart', title: '7-Day Trend', height: 40 },
      { id: 'components', title: 'Component Breakdown', height: 20 },
      { id: 'comparison', title: 'vs Neighbors', height: 15 },
      { id: 'footer', title: 'Footer', height: 8 },
    ],
  },
};

// Template selector helper
export function getTemplateOptions(): Array<{ value: StoryTemplate; label: string; icon: string }> {
  return Object.values(STORY_TEMPLATES).map(t => ({
    value: t.id,
    label: t.name,
    icon: t.icon,
  }));
}

// Get template by ID
export function getTemplate(id: StoryTemplate): StoryTemplateConfig {
  return STORY_TEMPLATES[id] || STORY_TEMPLATES.ciianalysis;
}

// Validate template can be rendered with available data
export function validateTemplateForData(template: StoryTemplate, data: StoryData): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  switch (template) {
    case 'crisisalert':
      if (!data.convergence || data.convergence.score === 0) missing.push('convergence data');
      if (data.threats.critical === 0 && data.threats.high === 0) missing.push('high-priority threats');
      break;
    case 'marketfocus':
      if (data.markets.length === 0) missing.push('prediction markets');
      break;
    case 'compare':
      // Requires two country data objects
      break;
    case 'trend':
      // Requires historical CII data
      break;
  }
  
  return { valid: missing.length === 0, missing };
}

// Template descriptions for UI
export const TEMPLATE_DESCRIPTIONS: Record<StoryTemplate, string> = {
  ciianalysis: 'Complete country intelligence snapshot with CII, signals, convergence, news, and markets',
  crisisalert: 'Crisis-focused briefing highlighting convergence, threats, and active alerts',
  dailybrief: 'AI-synthesized daily briefing of top global developments',
  marketfocus: 'Prediction market probabilities and economic indicators',
  compare: 'Side-by-side comparison of two countries (requires additional data)',
  trend: '7-day CII trend visualization with component breakdown',
};

// Color schemes per template
export const TEMPLATE_COLORS: Record<StoryTemplate, Record<string, string>> = {
  ciianalysis: {
    primary: '#3b82f6',
    background: '#0a0a0a',
    accent: '#22c55e',
    warning: '#eab308',
    danger: '#ef4444',
  },
  crisisalert: {
    primary: '#ef4444',
    background: '#1a0a0a',
    accent: '#f97316',
    warning: '#eab308',
    danger: '#ef4444',
  },
  dailybrief: {
    primary: '#8b5cf6',
    background: '#0a0a0a',
    accent: '#3b82f6',
    warning: '#eab308',
    danger: '#ef4444',
  },
  marketfocus: {
    primary: '#22c55e',
    background: '#0a1a0a',
    accent: '#3b82f6',
    warning: '#eab308',
    danger: '#ef4444',
  },
  compare: {
    primary: '#6366f1',
    background: '#0a0a0a',
    accent: '#ec4899',
    warning: '#eab308',
    danger: '#ef4444',
  },
  trend: {
    primary: '#06b6d4',
    background: '#0a0a1a',
    accent: '#22c55e',
    warning: '#eab308',
    danger: '#ef4444',
  },
};
