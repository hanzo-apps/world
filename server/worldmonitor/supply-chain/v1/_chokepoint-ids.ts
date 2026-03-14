export interface CanonicalChokepoint {
  id: string;
  relayName: string;
  portwatchName: string;
  corridorRiskName: string | null;
}

export const CANONICAL_CHOKEPOINTS: readonly CanonicalChokepoint[] = [
  { id: 'suez', relayName: 'Suez Canal', portwatchName: 'Suez Canal', corridorRiskName: 'Suez' },
  { id: 'malacca_strait', relayName: 'Strait of Malacca', portwatchName: 'Strait of Malacca', corridorRiskName: 'Malacca' },
  { id: 'hormuz_strait', relayName: 'Strait of Hormuz', portwatchName: 'Strait of Hormuz', corridorRiskName: 'Hormuz' },
  { id: 'bab_el_mandeb', relayName: 'Bab el-Mandeb', portwatchName: 'Bab el-Mandeb', corridorRiskName: 'Bab el-Mandeb' },
  { id: 'panama', relayName: 'Panama Canal', portwatchName: 'Panama Canal', corridorRiskName: 'Panama' },
  { id: 'taiwan_strait', relayName: 'Taiwan Strait', portwatchName: 'Taiwan Strait', corridorRiskName: 'Taiwan' },
  { id: 'cape_of_good_hope', relayName: 'Cape of Good Hope', portwatchName: 'Cape of Good Hope', corridorRiskName: 'Cape of Good Hope' },
  { id: 'gibraltar', relayName: 'Strait of Gibraltar', portwatchName: 'Strait of Gibraltar', corridorRiskName: null },
  { id: 'bosphorus', relayName: 'Bosphorus Strait', portwatchName: 'Bosphorus', corridorRiskName: null },
  { id: 'dardanelles', relayName: 'Dardanelles', portwatchName: 'Dardanelles', corridorRiskName: null },
];

export function relayNameToId(relayName: string): string | undefined {
  return CANONICAL_CHOKEPOINTS.find(c => c.relayName === relayName)?.id;
}

export function portwatchNameToId(portwatchName: string): string | undefined {
  return CANONICAL_CHOKEPOINTS.find(c => c.portwatchName.toLowerCase() === portwatchName.toLowerCase())?.id;
}

export function corridorRiskNameToId(crName: string): string | undefined {
  return CANONICAL_CHOKEPOINTS.find(c => c.corridorRiskName?.toLowerCase() === crName.toLowerCase())?.id;
}
