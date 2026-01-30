// Correlation Engine 2.0
// Multi-source correlation across time + space to find hidden connections
// Detects patterns, clusters, and temporal relationships between events

import { Story } from './story-data';

export interface CorrelationResult {
  id: string;
  type: 'temporal' | 'spatial' | 'thematic' | 'cascade';
  score: number;  // 0-100 confidence
  events: string[];
  description: string;
  significance: 'high' | 'medium' | 'low';
  timestamp: Date;
}

export interface CorrelationEvent {
  id: string;
  title: string;
  date: Date;
  lat?: number;
  lon?: number;
  region: string;
  keywords: string[];
  source: string;
  category: string;
}

export interface TemporalPattern {
  pattern: string;  // e.g., "every 48 hours", "weekend surge"
  frequency: number;  // hours
  confidence: number;
  recentHits: Date[];
}

export interface GeographicCluster {
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  eventCount: number;
  categories: string[];
  dateRange: { start: Date; end: Date };
}

// Time window for correlation (hours)
const CORRELATION_WINDOW = 72;  // 3 days
const SPATIAL_THRESHOLD_KM = 500;

// Find temporal correlations (events happening around same time)
export function findTemporalCorrelations(events: CorrelationEvent[]): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const e1 = events[i];
      const e2 = events[j];
      
      const timeDiff = Math.abs(e1.date.getTime() - e2.date.getTime()) / (1000 * 60 * 60);
      
      if (timeDiff <= CORRELATION_WINDOW) {
        // Check for shared keywords
        const sharedKeywords = e1.keywords.filter(k => e2.keywords.includes(k));
        
        if (sharedKeywords.length >= 2) {
          const score = Math.min(100, Math.round((1 - timeDiff / CORRELATION_WINDOW) * 100 + sharedKeywords.length * 10));
          
          results.push({
            id: `temp_${e1.id}_${e2.id}`,
            type: 'temporal',
            score,
            events: [e1.id, e2.id],
            description: `${e1.title} and ${e2.title} occurred within ${Math.round(timeDiff)} hours, sharing: ${sharedKeywords.join(', ')}`,
            significance: score > 70 ? 'high' : score > 50 ? 'medium' : 'low',
            timestamp: new Date(),
          });
        }
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// Find spatial correlations (events happening in same area)
export function findSpatialCorrelations(events: CorrelationEvent[]): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const e1 = events[i];
      const e2 = events[j];
      
      if (e1.lat && e1.lon && e2.lat && e2.lon) {
        const distance = haversineDistance(e1.lat, e1.lon, e2.lat, e2.lon);
        
        if (distance <= SPATIAL_THRESHOLD_KM) {
          const score = Math.min(100, Math.round((1 - distance / SPATIAL_THRESHOLD_KM) * 100));
          
          results.push({
            id: `spat_${e1.id}_${e2.id}`,
            type: 'spatial',
            score,
            events: [e1.id, e2.id],
            description: `${e1.title} and ${e2.title} occurred within ${Math.round(distance)}km of each other`,
            significance: distance < 100 ? 'high' : distance < 250 ? 'medium' : 'low',
            timestamp: new Date(),
          });
        }
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// Find thematic correlations (events with shared themes/keywords)
export function findThematicCorrelations(events: CorrelationEvent[]): CorrelationResult[] {
  const keywordToEvents: Record<string, string[]> = {};
  
  // Group events by keywords
  for (const event of events) {
    for (const keyword of event.keywords) {
      if (!keywordToEvents[keyword]) {
        keywordToEvents[keyword] = [];
      }
      keywordToEvents[keyword].push(event.id);
    }
  }
  
  const results: CorrelationResult[] = [];
  
  // Find keywords that connect 3+ events
  for (const [keyword, eventIds] of Object.entries(keywordToEvents)) {
    if (eventIds.length >= 3) {
      const eventsData = events.filter(e => eventIds.includes(e.id));
      const dateRange = Math.max(...eventsData.map(e => e.date.getTime())) - 
                        Math.min(...eventsData.map(e => e.date.getTime()));
      const daysRange = dateRange / (1000 * 60 * 60 * 24);
      
      results.push({
        id: `theme_${keyword}`,
        type: 'thematic',
        score: Math.min(100, Math.round(eventIds.length * 15)),
        events: eventIds,
        description: `${eventIds.length} events share "${keyword}" theme over ${Math.round(daysRange)} days`,
        significance: eventIds.length >= 5 ? 'high' : eventIds.length >= 3 ? 'medium' : 'low',
        timestamp: new Date(),
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// Detect cascade effects (A happens, then B happens)
export function detectCascades(events: CorrelationEvent[]): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  
  // Sort by date
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const e1 = sorted[i];
      const e2 = sorted[j];
      
      const hoursDiff = (e2.date.getTime() - e1.date.getTime()) / (1000 * 60 * 60);
      
      // Cascade: event within 6-48 hours, same region or shared keywords
      if (hoursDiff > 6 && hoursDiff < 48) {
        const sameRegion = e1.region === e2.region;
        const sharedKeywords = e1.keywords.filter(k => e2.keywords.includes(k));
        
        if (sameRegion || sharedKeywords.length >= 2) {
          const score = Math.min(100, Math.round((1 - hoursDiff / 48) * 100 + (sameRegion ? 20 : sharedKeywords.length * 10)));
          
          results.push({
            id: `cascade_${e1.id}_${e2.id}`,
            type: 'cascade',
            score,
            events: [e1.id, e2.id],
            description: `Possible cascade: ${e1.title} → ${e2.title} (${Math.round(hoursDiff)}h later)${sameRegion ? ' [same region]' : ''}`,
            significance: hoursDiff < 12 ? 'high' : 'medium',
            timestamp: new Date(),
          });
        }
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// Find temporal patterns (recurring events)
export function findTemporalPatterns(events: CorrelationEvent[]): TemporalPattern[] {
  const patterns: TemporalPattern[] = [];
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Group by region + keywords
  const groups: Record<string, Date[]> = {};
  
  for (const event of sorted) {
    const key = `${event.region}:${event.keywords.slice(0, 2).join(',')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event.date);
  }
  
  // Analyze each group for patterns
  for (const [key, dates] of Object.entries(groups)) {
    if (dates.length >= 3) {
      // Calculate average interval
      let totalInterval = 0;
      for (let i = 1; i < dates.length; i++) {
        totalInterval += dates[i].getTime() - dates[i-1].getTime();
      }
      const avgIntervalMs = totalInterval / (dates.length - 1);
      const avgIntervalHours = avgIntervalMs / (1000 * 60 * 60);
      
      // Check if pattern is consistent (within 20% variance)
      let consistent = true;
      for (let i = 1; i < dates.length; i++) {
        const interval = (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 60 * 60);
        if (Math.abs(interval - avgIntervalHours) / avgIntervalHours > 0.2) {
          consistent = false;
          break;
        }
      }
      
      if (consistent && avgIntervalHours < 168) {  // Less than a week
        patterns.push({
          pattern: `recurring every ${Math.round(avgIntervalHours)} hours`,
          frequency: avgIntervalHours,
          confidence: Math.min(100, Math.round(dates.length * 20)),
          recentHits: dates.slice(-5),
        });
      }
    }
  }
  
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

// Find geographic clusters
export function findGeographicClusters(events: CorrelationEvent[]): GeographicCluster[] {
  const clusters: GeographicCluster[] = [];
  const used = new Set<string>();
  
  for (const event of events) {
    if (!event.lat || !event.lon || used.has(event.id)) continue;
    
    const cluster: GeographicCluster = {
      centerLat: event.lat,
      centerLon: event.lon,
      radiusKm: 50,
      eventCount: 1,
      categories: [event.category],
      dateRange: { start: event.date, end: event.date },
    };
    
    // Find nearby events
    for (const other of events) {
      if (event.id === other.id || !other.lat || !other.lon) continue;
      
      const distance = haversineDistance(event.lat, event.lon, other.lat, other.lon);
      if (distance <= 100) {  // 100km radius for cluster
        cluster.eventCount++;
        cluster.radiusKm = Math.max(cluster.radiusKm, distance);
        if (!cluster.categories.includes(other.category)) {
          cluster.categories.push(other.category);
        }
        if (other.date < cluster.dateRange.start) cluster.dateRange.start = other.date;
        if (other.date > cluster.dateRange.end) cluster.dateRange.end = other.date;
        used.add(other.id);
      }
    }
    
    if (cluster.eventCount >= 2) {
      clusters.push(cluster);
    }
  }
  
  return clusters.sort((a, b) => b.eventCount - a.eventCount);
}

// Main correlation engine - run all analyses
export async function runCorrelationEngine(
  events: CorrelationEvent[]
): Promise<{
  temporal: CorrelationResult[];
  spatial: CorrelationResult[];
  thematic: CorrelationResult[];
  cascades: CorrelationResult[];
  patterns: TemporalPattern[];
  clusters: GeographicCluster[];
}> {
  const temporal = findTemporalCorrelations(events);
  const spatial = findSpatialCorrelations(events);
  const thematic = findThematicCorrelations(events);
  const cascades = detectCascades(events);
  const patterns = findTemporalPatterns(events);
  const clusters = findGeographicClusters(events);
  
  return { temporal, spatial, thematic, cascades, patterns, clusters };
}

// Convert correlations to threat signals
export function correlationsToThreatSignals(
  results: Awaited<ReturnType<typeof runCorrelationEngine>>
): object[] {
  const signals: object[] = [];
  
  // High-significance correlations only
  const all = [
    ...results.temporal.filter(r => r.significance === 'high'),
    ...results.spatial.filter(r => r.significance === 'high'),
    ...results.cascades.filter(r => r.significance === 'high'),
  ];
  
  for (const corr of all.slice(0, 5)) {
    signals.push({
      type: `correlation_${corr.type}`,
      title: `${corr.type.toUpperCase()} Correlation Detected`,
      description: corr.description,
      severity: corr.significance === 'high' ? 'medium' : 'low',
      score: corr.score,
      events: corr.events,
      timestamp: new Date(),
    });
  }
  
  return signals;
}

// Haversine distance between two points (km)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;  // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
