// Automated Report Generation Service
// Generates intelligence reports from threat signals and analysis data
// Supports multiple formats: markdown, JSON, HTML, PDF-ready

import { ThreatSignal } from './threat-signals';

export interface IntelligenceReport {
  id: string;
  title: string;
  summary: string;
  sections: ReportSection[];
  metrics: ReportMetrics;
  generatedAt: Date;
  period: { start: Date; end: Date };
  format: 'daily' | 'weekly' | 'incident';
}

export interface ReportSection {
  title: string;
  content: string;
  type: 'summary' | 'analysis' | 'data' | 'recommendations';
  priority: 'high' | 'medium' | 'low';
}

export interface ReportMetrics {
  totalSignals: number;
  criticalSignals: number;
  highSignals: number;
  mediumSignals: number;
  lowSignals: number;
  topRegions: string[];
  topCategories: string[];
}

// Generate daily intelligence report
export async function generateDailyReport(
  signals: ThreatSignal[],
  date: Date = new Date()
): Promise<IntelligenceReport> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  // Filter signals for today
  const todaySignals = signals.filter(s => {
    const sigDate = new Date(s.timestamp);
    return sigDate >= startOfDay && sigDate <= endOfDay;
  });
  
  // Calculate metrics
  const metrics = calculateMetrics(todaySignals);
  
  // Generate sections
  const sections = generateSections(todaySignals, metrics);
  
  // Generate summary
  const summary = generateSummary(metrics);
  
  return {
    id: `daily-${date.toISOString().split('T')[0]}`,
    title: `Daily Intelligence Report - ${date.toLocaleDateString()}`,
    summary,
    sections,
    metrics,
    generatedAt: new Date(),
    period: { start: startOfDay, end: endOfDay },
    format: 'daily',
  };
}

// Generate weekly intelligence report
export async function generateWeeklyReport(
  signals: ThreatSignal[],
  endDate: Date = new Date()
): Promise<IntelligenceReport> {
  const startOfWeek = new Date(endDate);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  
  const weekSignals = signals.filter(s => {
    const sigDate = new Date(s.timestamp);
    return sigDate >= startOfWeek && sigDate <= endDate;
  });
  
  const metrics = calculateMetrics(weekSignals);
  const sections = generateSections(weekSignals, metrics, true);
  const summary = `Weekly intelligence summary covering ${startOfWeek.toLocaleDateString()} to ${endDate.toLocaleDateString()}. ${metrics.totalSignals} signals detected, ${metrics.criticalSignals} critical.`;
  
  return {
    id: `weekly-${endDate.toISOString().split('T')[0]}`,
    title: `Weekly Intelligence Report - Week of ${startOfWeek.toLocaleDateString()}`,
    summary,
    sections,
    metrics,
    generatedAt: new Date(),
    period: { start: startOfWeek, end: endDate },
    format: 'weekly',
  };
}

// Calculate report metrics from signals
function calculateMetrics(signals: ThreatSignal[]): ReportMetrics {
  const byRegion: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  
  let critical = 0, high = 0, medium = 0, low = 0;
  
  for (const signal of signals) {
    // Count by severity
    switch (signal.severity) {
      case 'critical': critical++; break;
      case 'high': high++; break;
      case 'medium': medium++; break;
      case 'low': low++; break;
    }
    
    // Count by region
    if (signal.region) {
      byRegion[signal.region] = (byRegion[signal.region] || 0) + 1;
    }
    
    // Count by category
    if (signal.type) {
      const category = signal.type.split('_')[0];
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
  }
  
  // Sort and get top 5
  const topRegions = Object.entries(byRegion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([region]) => region);
  
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat);
  
  return {
    totalSignals: signals.length,
    criticalSignals: critical,
    highSignals: high,
    mediumSignals: medium,
    lowSignals: low,
    topRegions,
    topCategories,
  };
}

// Generate report sections
function generateSections(
  signals: ThreatSignal[],
  metrics: ReportMetrics,
  isWeekly: boolean = false
): ReportSection[] {
  const sections: ReportSection[] = [];
  
  // Executive Summary
  sections.push({
    title: 'Executive Summary',
    content: generateSummary(metrics),
    type: 'summary',
    priority: 'high',
  });
  
  // Critical Items
  const criticalSignals = signals.filter(s => s.severity === 'critical');
  if (criticalSignals.length > 0) {
    sections.push({
      title: 'Critical Intelligence',
      content: criticalSignals.map(s => 
        `- **${s.title}** (${s.region || 'N/A'})\n  ${s.description}`
      ).join('\n\n'),
      type: 'analysis',
      priority: 'high',
    });
  }
  
  // Regional Analysis
  if (metrics.topRegions.length > 0) {
    sections.push({
      title: 'Regional Distribution',
      content: metrics.topRegions.map(region => {
        const count = signals.filter(s => s.region === region).length;
        return `- **${region}**: ${count} signals`;
      }).join('\n'),
      type: 'data',
      priority: 'medium',
    });
  }
  
  // Trend Analysis
  if (isWeekly) {
    sections.push({
      title: 'Weekly Trends',
      content: analyzeTrends(signals),
      type: 'analysis',
      priority: 'medium',
    });
  }
  
  // Recommendations
  sections.push({
    title: 'Recommended Actions',
    content: generateRecommendations(metrics),
    type: 'recommendations',
    priority: 'medium',
  });
  
  return sections;
}

// Generate executive summary
function generateSummary(metrics: ReportMetrics): string {
  let summary = `Intelligence monitoring detected **${metrics.totalSignals} signals** in the reporting period.`;
  
  if (metrics.criticalSignals > 0) {
    summary += ` **${metrics.criticalSignals} critical** items require immediate attention.`;
  }
  
  if (metrics.topRegions.length > 0) {
    summary += ` Most active regions: ${metrics.topRegions.slice(0, 3).join(', ')}.`;
  }
  
  return summary;
}

// Analyze trends in signals
function analyzeTrends(signals: ThreatSignal[]): string {
  const trends: string[] = [];
  
  // Check for increasing/decreasing patterns by day
  const byDay: Record<string, number> = {};
  for (const signal of signals) {
    const day = new Date(signal.timestamp).toLocaleDateString();
    byDay[day] = (byDay[day] || 0) + 1;
  }
  
  const days = Object.keys(byDay).sort();
  if (days.length >= 2) {
    const first = byDay[days[0]];
    const last = byDay[days[days.length - 1]];
    const change = ((last - first) / Math.max(1, first) * 100).toFixed(0);
    
    if (Math.abs(parseInt(change)) > 20) {
      trends.push(`Signal volume ${parseInt(change) > 0 ? 'increased' : 'decreased'} by ${Math.abs(parseInt(change))}% over the week`);
    }
  }
  
  // Check for severity trends
  const criticalCount = signals.filter(s => s.severity === 'critical').length;
  if (criticalCount > 3) {
    trends.push(`Elevated critical activity (${criticalCount} critical signals)`);
  }
  
  return trends.length > 0 
    ? trends.join('\n') 
    : 'No significant trends detected. Signal volume remained stable.';
}

// Generate recommendations based on metrics
function generateRecommendations(metrics: ReportMetrics): string[] {
  const recommendations: string[] = [];
  
  if (metrics.criticalSignals > 0) {
    recommendations.push(`🔴 **Immediate**: Review ${metrics.criticalSignals} critical signals and coordinate response`);
  }
  
  if (metrics.topRegions.length > 0) {
    recommendations.push(`📍 **Focus**: Monitor ${metrics.topRegions[0]} closely (highest activity)`);
  }
  
  if (metrics.highSignals > 5) {
    recommendations.push(`⚠️ **Elevated**: ${metrics.highSignals} high-priority items require follow-up`);
  }
  
  if (metrics.totalSignals === 0) {
    recommendations.push('✅ **Status**: No intelligence signals detected. Continue normal monitoring.');
  } else {
    recommendations.push('📊 **Action**: Export detailed data for further analysis');
  }
  
  return recommendations;
}

// Convert report to markdown
export function reportToMarkdown(report: IntelligenceReport): string {
  let md = `# ${report.title}\n\n`;
  md += `**Generated:** ${report.generatedAt.toISOString()}\n`;
  md += `**Period:** ${report.period.start.toLocaleDateString()} - ${report.period.end.toLocaleDateString()}\n\n`;
  
  md += `## Summary\n\n${report.summary}\n\n`;
  md += `## Metrics\n\n`;
  md += `- Total Signals: ${report.metrics.totalSignals}\n`;
  md += `- Critical: ${report.metrics.criticalSignals}\n`;
  md += `- High: ${report.metrics.highSignals}\n`;
  md += `- Medium: ${report.metrics.mediumSignals}\n`;
  md += `- Low: ${report.metrics.lowSignals}\n\n`;
  
  for (const section of report.sections) {
    const priorityIcon = section.priority === 'high' ? '🔴' : section.priority === 'medium' ? '🟡' : '🟢';
    md += `## ${priorityIcon} ${section.title}\n\n${section.content}\n\n`;
  }
  
  return md;
}

// Convert report to JSON
export function reportToJSON(report: IntelligenceReport): string {
  return JSON.stringify(report, null, 2);
}

// Quick report generation for dashboard
export async function generateQuickReport(
  signals: ThreatSignal[]
): Promise<{ summary: string; metrics: ReportMetrics }> {
  const metrics = calculateMetrics(signals);
  return {
    summary: generateSummary(metrics),
    metrics,
  };
}

// Health check
export function checkReportGenerationHealth(): { configured: boolean; formats: string[] } {
  return {
    configured: true,
    formats: ['markdown', 'json'],
  };
}
