// Internet Infrastructure Awareness Service
// Tracks internet infrastructure (IXPs, cables, data centers) for monitored regions
// Detects connectivity changes, outages, and infrastructure takeovers

export interface InfrastructureNode {
  id: string;
  type: 'ixp' | 'datacenter' | 'cable_landing' | 'gateway';
  name: string;
  lat: number;
  lon: number;
  country: string;
  capacity?: string;
  operator?: string;
  status: 'active' | 'degraded' | 'offline' | 'unknown';
  lastChecked: Date;
}

export interface InfrastructureChange {
  id: string;
  type: 'status_change' | 'new_node' | 'capacity_change' | 'ownership_change';
  nodeId: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: Date;
}

export interface InfrastructureReport {
  region: string;
  nodeCount: number;
  activeNodes: number;
  degradedNodes: number;
  offlineNodes: number;
  recentChanges: InfrastructureChange[];
  riskLevel: 'low' | 'medium' | 'high';
}

// Key internet infrastructure for monitored regions
const INFRASTRUCTURE_DB: InfrastructureNode[] = [
  // Ukraine
  { id: 'ua-ixp-1', type: 'ixp', name: 'UA-IX (Ukrainian Internet Exchange)', lat: 50.45, lon: 30.52, country: 'Ukraine', status: 'active' },
  { id: 'ua-dc-1', type: 'datacenter', name: 'Ukrainian DC', lat: 50.45, lon: 30.52, country: 'Ukraine', status: 'active' },
  
  // Russia
  { id: 'ru-ixp-1', type: 'ixp', name: 'MSK-IX (Moscow Internet Exchange)', lat: 55.75, lon: 37.62, country: 'Russia', status: 'active' },
  { id: 'ru-ixp-2', type: 'ixp', name: 'SPB-IX (St. Petersburg IX)', lat: 59.93, lon: 30.31, country: 'Russia', status: 'active' },
  { id: 'ru-cable-1', type: 'cable_landing', name: 'VKontakte Cable', lat: 44.72, lon: 37.77, country: 'Russia', status: 'active' },
  
  // Iran
  { id: 'ir-ixp-1', type: 'ixp', name: 'IR-IX (Iran Internet Exchange)', lat: 35.69, lon: 51.42, country: 'Iran', status: 'active' },
  { id: 'ir-gw-1', type: 'gateway', name: 'Telecom Gateway', lat: 35.69, lon: 51.42, country: 'Iran', status: 'degraded' },
  
  // Israel
  { id: 'il-ixp-1', type: 'ixp', name: 'IL-IX (Israel Internet Exchange)', lat: 32.08, lon: 34.76, country: 'Israel', status: 'active' },
  { id: 'il-cable-1', type: 'cable_landing', name: 'Mediterranean Cable', lat: 32.50, lon: 34.90, country: 'Israel', status: 'active' },
  
  // China
  { id: 'cn-ixp-1', type: 'ixp', name: 'CNIX (China Internet Exchange)', lat: 39.90, lon: 116.40, country: 'China', status: 'active' },
  { id: 'cn-ixp-2', type: 'ixp', name: 'SHIX (Shanghai IX)', lat: 31.23, lon: 121.47, country: 'China', status: 'active' },
  { id: 'cn-gw-1', type: 'gateway', name: 'Great Firewall Gateway', lat: 39.90, lon: 116.40, country: 'China', status: 'active' },
  
  // Turkey
  { id: 'tr-ixp-1', type: 'ixp', name: 'TR-IX (Turkey Internet Exchange)', lat: 41.01, lon: 28.98, country: 'Turkey', status: 'active' },
  { id: 'tr-cable-1', type: 'cable_landing', name: 'Mediterranean Landing', lat: 36.54, lon: 31.99, country: 'Turkey', status: 'active' },
  
  // Saudi Arabia
  { id: 'sa-ixp-1', type: 'ixp', name: 'STC IX', lat: 24.71, lon: 46.67, country: 'Saudi Arabia', status: 'active' },
  { id: 'sa-cable-1', type: 'cable_landing', name: 'Red Sea Cable', lat: 21.48, lon: 39.22, country: 'Saudi Arabia', status: 'active' },
  
  // Taiwan
  { id: 'tw-ixp-1', type: 'ixp', name: 'TWIX (Taiwan Internet Exchange)', lat: 25.03, lon: 121.56, country: 'Taiwan', status: 'active' },
  { id: 'tw-cable-1', type: 'cable_landing', name: 'Pacific Cable', lat: 25.13, lon: 121.74, country: 'Taiwan', status: 'active' },
  
  // United States (for comparison)
  { id: 'us-ixp-1', type: 'ixp', name: 'Equinix NYC', lat: 40.71, lon: -74.00, country: 'United States', status: 'active' },
  { id: 'us-ixp-2', type: 'ixp', name: 'Equinix LA', lat: 34.05, lon: -118.24, country: 'United States', status: 'active' },
];

// Get infrastructure for a specific region
export function getInfrastructureForRegion(region: string): InfrastructureNode[] {
  const regionMap: Record<string, string[]> = {
    'Ukraine': ['ua-'],
    'Russia': ['ru-'],
    'Iran': ['ir-'],
    'Israel': ['il-'],
    'China': ['cn-'],
    'Turkey': ['tr-'],
    'Saudi Arabia': ['sa-'],
    'Taiwan': ['tw-'],
    'United States': ['us-'],
  };
  
  const prefixes = regionMap[region] || [];
  return INFRASTRUCTURE_DB.filter(n => 
    prefixes.some(p => n.id.startsWith(p)) || n.country === region
  );
}

// Get all infrastructure
export function getAllInfrastructure(): InfrastructureNode[] {
  return INFRASTRUCTURE_DB;
}

// Generate demo infrastructure changes
export function getInfrastructureChanges(): InfrastructureChange[] {
  // Simulate some recent changes
  return [
    {
      id: 'change-1',
      type: 'status_change',
      nodeId: 'ir-gw-1',
      description: 'Iran gateway showing degraded performance',
      severity: 'warning',
      timestamp: new Date(Date.now() - 3600000),  // 1 hour ago
    },
    {
      id: 'change-2',
      type: 'new_node',
      nodeId: 'ru-cable-2',
      description: 'New cable landing detected in Sevastopol',
      severity: 'info',
      timestamp: new Date(Date.now() - 86400000),  // 1 day ago
    },
  ];
}

// Generate infrastructure report for a region
export function getInfrastructureReport(region: string): InfrastructureReport {
  const nodes = getInfrastructureForRegion(region);
  const changes = getInfrastructureChanges().filter(c => 
    nodes.some(n => n.id === c.nodeId)
  );
  
  const active = nodes.filter(n => n.status === 'active').length;
  const degraded = nodes.filter(n => n.status === 'degraded').length;
  const offline = nodes.filter(n => n.status === 'offline').length;
  
  let riskLevel: InfrastructureReport['riskLevel'] = 'low';
  if (degraded > 0 || offline > 0) riskLevel = 'medium';
  if (offline >= 2 || degraded >= 3) riskLevel = 'high';
  
  return {
    region,
    nodeCount: nodes.length,
    activeNodes: active,
    degradedNodes: degraded,
    offlineNodes: offline,
    recentChanges: changes,
    riskLevel,
  };
}

// Convert infrastructure to threat signals
export function infrastructureToThreatSignals(region: string): object[] {
  const report = getInfrastructureReport(region);
  const signals: object[] = [];
  
  if (report.riskLevel === 'high') {
    signals.push({
      type: 'infrastructure_critical',
      title: `Critical Infrastructure Alert: ${region}`,
      description: `${report.offlineNodes} offline, ${report.degradedNodes} degraded out of ${report.nodeCount} nodes`,
      severity: 'high',
      data: report,
      timestamp: new Date(),
    });
  } else if (report.riskLevel === 'medium') {
    signals.push({
      type: 'infrastructure_warning',
      title: `Infrastructure Warning: ${region}`,
      description: `${report.degradedNodes} degraded nodes detected`,
      severity: 'medium',
      data: report,
      timestamp: new Date(),
    });
  }
  
  return signals;
}

// Check for cable cut indicators (sudden latency changes would indicate this)
// In production, this would query real network monitoring APIs
export function checkCableIntegrity(): { healthy: boolean; concerns: string[] } {
  const concerns: string[] = [];
  
  // Check for regions with known cable vulnerabilities
  const redSeaNodes = INFRASTRUCTURE_DB.filter(n => 
    n.type === 'cable_landing' && (n.lat > 20 && n.lat < 30 && n.lon > 30 && n.lon < 45)
  );
  
  if (redSeaNodes.length > 0) {
    concerns.push('Red Sea cable infrastructure at risk (geopolitical tension)');
  }
  
  // Taiwan Strait cables
  const taiwanStrait = INFRASTRUCTURE_DB.filter(n => n.id.includes('tw-cable'));
  if (taiwanStrait.length > 0) {
    concerns.push('Taiwan Strait cables vulnerable to Taiwan-China tensions');
  }
  
  return {
    healthy: concerns.length === 0,
    concerns,
  };
}

// Health check
export function checkInfrastructureHealth(): { totalNodes: number; healthyNodes: number; issues: number } {
  const healthy = INFRASTRUCTURE_DB.filter(n => n.status === 'active').length;
  const issues = INFRASTRUCTURE_DB.filter(n => n.status !== 'active').length;
  
  return {
    totalNodes: INFRASTRUCTURE_DB.length,
    healthyNodes: healthy,
    issues,
  };
}
