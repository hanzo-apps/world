// Curated registry of major quantum-computing players. Reference data — public
// primary sites, hardware modality, and best publicly-announced scale metric
// (with the year it was announced). NOT a live counter: scale figures are
// milestone snapshots, refreshed as vendors publish. Powers the Quantum map
// layer and the Quantum lens.

export type QuantumModality =
  | 'superconducting'
  | 'trapped-ion'
  | 'neutral-atom'
  | 'photonic'
  | 'silicon-spin'
  | 'annealing'
  | 'topological';

export interface QuantumPlayer {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  city: string;
  modality: QuantumModality;
  // Best publicly-announced scale. `qubits` is null when the vendor reports a
  // different figure of merit (e.g. IonQ #AQ, photonic modes).
  qubits: number | null;
  metric: string;       // human label, e.g. "1,121 qubits (Condor)"
  asOf: number;         // year of the metric
  milestone?: string;
  url?: string;
}

export const QUANTUM_PLAYERS: QuantumPlayer[] = [
  { id: 'ibm', name: 'IBM Quantum', lat: 41.2098, lon: -73.7937, country: 'USA', city: 'Yorktown Heights, NY', modality: 'superconducting', qubits: 1121, metric: '1,121 qubits (Condor)', asOf: 2023, milestone: 'Heron modular roadmap; 100k-qubit target by 2033', url: 'https://quantum.ibm.com' },
  { id: 'google', name: 'Google Quantum AI', lat: 34.4140, lon: -119.8489, country: 'USA', city: 'Santa Barbara, CA', modality: 'superconducting', qubits: 105, metric: '105 qubits (Willow)', asOf: 2024, milestone: 'Below-threshold error correction demonstrated', url: 'https://quantumai.google' },
  { id: 'atom-computing', name: 'Atom Computing', lat: 40.0150, lon: -105.2705, country: 'USA', city: 'Boulder, CO', modality: 'neutral-atom', qubits: 1180, metric: '1,180 qubits', asOf: 2023, milestone: 'First to cross 1,000 physical qubits', url: 'https://atom-computing.com' },
  { id: 'quantinuum', name: 'Quantinuum', lat: 39.9205, lon: -105.0866, country: 'USA', city: 'Broomfield, CO', modality: 'trapped-ion', qubits: 56, metric: '56 qubits (H2), record QV', asOf: 2024, milestone: 'Highest quantum volume; logical-qubit demos', url: 'https://quantinuum.com' },
  { id: 'ionq', name: 'IonQ', lat: 38.9897, lon: -76.9378, country: 'USA', city: 'College Park, MD', modality: 'trapped-ion', qubits: null, metric: '#AQ 64 (algorithmic qubits)', asOf: 2024, milestone: 'Forte / Tempo systems', url: 'https://ionq.com' },
  { id: 'psiquantum', name: 'PsiQuantum', lat: 37.4419, lon: -122.1430, country: 'USA', city: 'Palo Alto, CA', modality: 'photonic', qubits: null, metric: 'photonic, fault-tolerant target', asOf: 2024, milestone: 'Building 1M-qubit utility-scale machines (Brisbane, Chicago)', url: 'https://psiquantum.com' },
  { id: 'quera', name: 'QuEra Computing', lat: 42.3601, lon: -71.0589, country: 'USA', city: 'Boston, MA', modality: 'neutral-atom', qubits: 256, metric: '256 qubits (Aquila)', asOf: 2023, milestone: '48 logical qubits demonstrated with Harvard/MIT', url: 'https://quera.com' },
  { id: 'rigetti', name: 'Rigetti Computing', lat: 37.8716, lon: -122.2727, country: 'USA', city: 'Berkeley, CA', modality: 'superconducting', qubits: 84, metric: '84 qubits (Ankaa-3)', asOf: 2024, url: 'https://rigetti.com' },
  { id: 'dwave', name: 'D-Wave Quantum', lat: 49.2488, lon: -122.9805, country: 'Canada', city: 'Burnaby', modality: 'annealing', qubits: 5000, metric: '5,000+ qubits (Advantage)', asOf: 2024, milestone: 'Quantum annealing for optimization', url: 'https://dwavesys.com' },
  { id: 'xanadu', name: 'Xanadu', lat: 43.6532, lon: -79.3832, country: 'Canada', city: 'Toronto', modality: 'photonic', qubits: null, metric: 'photonic (Aurora)', asOf: 2025, milestone: 'Networked photonic quantum computing', url: 'https://xanadu.ai' },
  { id: 'pasqal', name: 'Pasqal', lat: 48.7304, lon: 2.2726, country: 'France', city: 'Massy', modality: 'neutral-atom', qubits: 100, metric: '~100+ atoms', asOf: 2024, milestone: 'Analog neutral-atom processors', url: 'https://pasqal.com' },
  { id: 'alice-bob', name: 'Alice & Bob', lat: 48.8566, lon: 2.3522, country: 'France', city: 'Paris', modality: 'superconducting', qubits: null, metric: 'cat-qubit error correction', asOf: 2024, url: 'https://alice-bob.com' },
  { id: 'origin', name: 'Origin Quantum', lat: 31.8206, lon: 117.2290, country: 'China', city: 'Hefei', modality: 'superconducting', qubits: 72, metric: '72 qubits (Wukong)', asOf: 2024, milestone: 'China domestic superconducting stack', url: 'https://originqc.com.cn' },
  { id: 'ustc', name: 'USTC (Jiuzhang / Zuchongzhi)', lat: 31.8390, lon: 117.2649, country: 'China', city: 'Hefei', modality: 'photonic', qubits: null, metric: 'photonic advantage (Jiuzhang)', asOf: 2023, milestone: 'Quantum computational advantage claims', url: 'https://ustc.edu.cn' },
  { id: 'intel', name: 'Intel', lat: 45.5399, lon: -122.9010, country: 'USA', city: 'Hillsboro, OR', modality: 'silicon-spin', qubits: 12, metric: 'silicon spin (Tunnel Falls)', asOf: 2023, url: 'https://intel.com' },
  { id: 'microsoft', name: 'Microsoft (Azure Quantum)', lat: 47.6740, lon: -122.1215, country: 'USA', city: 'Redmond, WA', modality: 'topological', qubits: null, metric: 'topological (Majorana 1)', asOf: 2025, milestone: 'Topological qubit device announced', url: 'https://azure.microsoft.com/quantum' },
];

export function quantumModalityColor(modality: QuantumModality): [number, number, number, number] {
  switch (modality) {
    case 'superconducting': return [120, 200, 255, 210];
    case 'trapped-ion': return [255, 190, 100, 210];
    case 'neutral-atom': return [130, 240, 180, 210];
    case 'photonic': return [255, 140, 220, 210];
    case 'silicon-spin': return [200, 200, 120, 200];
    case 'annealing': return [160, 160, 255, 200];
    case 'topological': return [220, 120, 255, 210];
    default: return [180, 190, 200, 190];
  }
}
