// Curated Post-Quantum readiness reference data.
//
// Tracks the migration to quantum-resistant cryptography: NIST PQC standards,
// the NSA CNSA 2.0 timeline, and public deployment status across governments,
// clouds, browsers, messengers, and chains. Reference data (published facts),
// not a live feed. Lux/Hanzo are post-quantum-native — included as the
// reference implementation of a PQ-from-genesis stack.

export type PQStandardKind = 'kem' | 'signature' | 'hash-signature';
export type PQStandardStatus = 'standardized' | 'draft' | 'selected';

export interface PQStandard {
  id: string;          // FIPS number
  name: string;        // ML-KEM, ML-DSA, ...
  basedOn: string;     // Kyber, Dilithium, ...
  kind: PQStandardKind;
  status: PQStandardStatus;
  year: number;
  note: string;
}

// NIST post-quantum standards (FIPS 203/204/205 finalized Aug 2024).
export const PQC_STANDARDS: PQStandard[] = [
  { id: 'FIPS 203', name: 'ML-KEM', basedOn: 'CRYSTALS-Kyber', kind: 'kem', status: 'standardized', year: 2024, note: 'Module-lattice key encapsulation — the primary PQ KEM.' },
  { id: 'FIPS 204', name: 'ML-DSA', basedOn: 'CRYSTALS-Dilithium', kind: 'signature', status: 'standardized', year: 2024, note: 'Module-lattice signatures — the primary PQ signature.' },
  { id: 'FIPS 205', name: 'SLH-DSA', basedOn: 'SPHINCS+', kind: 'hash-signature', status: 'standardized', year: 2024, note: 'Stateless hash-based signatures — conservative backup.' },
  { id: 'FIPS 206', name: 'FN-DSA', basedOn: 'Falcon', kind: 'signature', status: 'draft', year: 2025, note: 'Compact lattice signatures — draft in progress.' },
  { id: 'HQC', name: 'HQC-KEM', basedOn: 'HQC (code-based)', kind: 'kem', status: 'selected', year: 2025, note: 'Selected as a code-based KEM backup to ML-KEM.' },
];

// NSA CNSA 2.0 migration timeline (target years for US National Security Systems).
export interface CNSAMilestone {
  year: number;
  milestone: string;
}

export const CNSA2_TIMELINE: CNSAMilestone[] = [
  { year: 2025, milestone: 'PQC support required in new software/firmware signing.' },
  { year: 2027, milestone: 'PQC becomes default for new networking equipment.' },
  { year: 2030, milestone: 'PQC default across most NSS deployments.' },
  { year: 2033, milestone: 'Exclusive PQC; classical (RSA/ECC) deprecated for NSS.' },
];

export type PQOrgType = 'government' | 'cloud' | 'browser' | 'messaging' | 'blockchain' | 'standard';
// pq-native = built PQ from the start; deployed = shipping in production;
// in-progress = rolling out; planned = committed; lagging = no public plan.
export type PQReadinessStatus = 'pq-native' | 'deployed' | 'in-progress' | 'planned' | 'lagging';

export interface PQReadiness {
  id: string;
  org: string;
  type: PQOrgType;
  status: PQReadinessStatus;
  algorithms: string[];
  detail: string;
  asOf: number;
}

export const PQ_READINESS: PQReadiness[] = [
  { id: 'lux', org: 'Lux Network', type: 'blockchain', status: 'pq-native', algorithms: ['ML-DSA-65', 'Pulsar (Ring-LWE)', 'BLS'], detail: 'Post-quantum from genesis: Quasar consensus triple-seals with BLS + Pulsar threshold + ML-DSA-65. No harvest-now-decrypt-later exposure.', asOf: 2026 },
  { id: 'hanzo', org: 'Hanzo AI', type: 'blockchain', status: 'pq-native', algorithms: ['ML-DSA-65', 'ML-KEM'], detail: 'PQ-native infrastructure and identity; ships quantum-resistant primitives across the stack.', asOf: 2026 },
  { id: 'nsa-cnsa2', org: 'US Government (NSA CNSA 2.0)', type: 'government', status: 'in-progress', algorithms: ['ML-KEM', 'ML-DSA', 'SLH-DSA'], detail: 'CNSA 2.0 mandates PQC across National Security Systems by 2033.', asOf: 2025 },
  { id: 'cloudflare', org: 'Cloudflare', type: 'cloud', status: 'deployed', algorithms: ['X25519+ML-KEM'], detail: 'Hybrid post-quantum key agreement live for a large share of TLS traffic.', asOf: 2024 },
  { id: 'google-chrome', org: 'Google Chrome', type: 'browser', status: 'deployed', algorithms: ['X25519+ML-KEM'], detail: 'Hybrid ML-KEM enabled by default in TLS.', asOf: 2024 },
  { id: 'apple-imessage', org: 'Apple iMessage (PQ3)', type: 'messaging', status: 'deployed', algorithms: ['ML-KEM'], detail: 'PQ3 protocol brings level-3 post-quantum security with ongoing rekeying.', asOf: 2024 },
  { id: 'signal', org: 'Signal (PQXDH)', type: 'messaging', status: 'deployed', algorithms: ['X25519+ML-KEM'], detail: 'PQXDH adds post-quantum protection to the initial key exchange.', asOf: 2023 },
  { id: 'aws', org: 'AWS', type: 'cloud', status: 'in-progress', algorithms: ['ML-KEM'], detail: 'Hybrid PQ TLS across KMS/ACM and s2n-tls endpoints.', asOf: 2024 },
  { id: 'microsoft', org: 'Microsoft', type: 'cloud', status: 'in-progress', algorithms: ['ML-KEM', 'ML-DSA'], detail: 'SymCrypt PQC and Windows/TLS integration rolling out.', asOf: 2025 },
  { id: 'nist', org: 'NIST', type: 'standard', status: 'deployed', algorithms: ['ML-KEM', 'ML-DSA', 'SLH-DSA'], detail: 'Published FIPS 203/204/205; FN-DSA + HQC in the pipeline.', asOf: 2024 },
];

// The core threat driving urgency: encrypted data captured today can be
// decrypted once a cryptographically-relevant quantum computer exists.
export const HARVEST_NOW_DECRYPT_LATER =
  'Adversaries harvest encrypted traffic today to decrypt once a cryptographically-relevant quantum computer arrives. Data with a long secrecy lifetime must migrate to PQC now.';

export function pqReadinessRank(status: PQReadinessStatus): number {
  switch (status) {
    case 'pq-native': return 5;
    case 'deployed': return 4;
    case 'in-progress': return 3;
    case 'planned': return 2;
    case 'lagging': return 1;
    default: return 0;
  }
}
