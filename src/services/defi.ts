// DeFi dashboard data — same-origin /v1/world/defi/* feeds behind the crypto→DeFi
// variant. Sovereign Lux data: the bridge-supported chain universe merged with
// live per-chain metrics from explorer.lux.network. Every fetch is best-effort and
// resolves to null on any HTTP/network/parse error so a panel keeps its last good
// state instead of throwing. USD figures the explorer does not populate arrive as
// null — the UI shows "—", never a fabricated number (tvlProvenance says which).

export interface DefiChainRow {
  slug: string;
  name: string;
  symbol: string;
  logo: string; // '' for our own chains → the UI renders a symbol initial-chip
  explorer?: string;
  chainId?: number;
  native: boolean; // one of our sovereign L1s (Lux/Zoo/Hanzo/…)
  bridge: boolean; // bridge-supported
  live: boolean;
  blockHeight: number | null;
  txns: number | null;
  addresses: number | null;
  tps: number | null;
  blockTime: number | null;
  tvlUsd: number | null;
  status?: string;
  tags?: string[];
}

export interface DefiChainsData {
  updatedAt: string;
  chainCount: number;
  nativeCount: number;
  bridgeCount: number;
  liveCount: number;
  metricsSource: string;
  tvlProvenance: string; // 'explorer-amm' | 'unavailable'
  chains: DefiChainRow[];
}

export interface DefiTopChain {
  slug: string;
  name: string;
  symbol: string;
  txns: number;
  tps: number | null;
  tvlUsd: number | null;
  live: boolean;
}

export interface DefiOverview {
  updatedAt: string;
  chainCount: number;
  nativeCount: number;
  bridgeCount: number;
  liveCount: number;
  totalTxns: number;
  totalBlocks: number;
  totalAddresses: number;
  aggregateTps: number | null;
  totalTvlUsd: number | null;
  volume24hUsd: number | null;
  metricsSource: string;
  tvlProvenance: string;
  topChains: DefiTopChain[];
}

export interface DefiFlow {
  fromSlug: string;
  toSlug: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  weight: number;
  label: string;
  realFlow: boolean;
}

export interface DefiFlowsData {
  updatedAt: string;
  modeled: boolean;
  hubSlug: string;
  flows: DefiFlow[];
}

export interface DefiPool {
  chain: string;
  pair: string;
  token0: string;
  token1: string;
  tvlUsd: number | null;
  volUsd: number | null;
}

export interface DefiProtocolsData {
  updatedAt: string;
  metricsSource: string;
  poolCount: number;
  pools: DefiPool[];
}

/** GET a same-origin JSON path. Resolves to null on any HTTP/network/parse error. */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function getDefiOverview(): Promise<DefiOverview | null> {
  return getJson<DefiOverview>('/v1/world/defi/overview');
}

export function getDefiChains(): Promise<DefiChainsData | null> {
  return getJson<DefiChainsData>('/v1/world/defi/chains');
}

export function getDefiFlows(): Promise<DefiFlowsData | null> {
  return getJson<DefiFlowsData>('/v1/world/defi/flows');
}

export function getDefiProtocols(): Promise<DefiProtocolsData | null> {
  return getJson<DefiProtocolsData>('/v1/world/defi/protocols');
}
