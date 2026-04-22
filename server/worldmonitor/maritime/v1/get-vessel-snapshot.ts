import type {
  ServerContext,
  GetVesselSnapshotRequest,
  GetVesselSnapshotResponse,
  VesselSnapshot,
  AisDensityZone,
  AisDisruption,
  AisDisruptionType,
  AisDisruptionSeverity,
  SnapshotCandidateReport,
} from '../../../../src/generated/server/worldmonitor/maritime/v1/service_server';

import { getRelayBaseUrl, getRelayHeaders } from '../../../_shared/relay';

// ========================================================================
// Helpers
// ========================================================================

const DISRUPTION_TYPE_MAP: Record<string, AisDisruptionType> = {
  gap_spike: 'AIS_DISRUPTION_TYPE_GAP_SPIKE',
  chokepoint_congestion: 'AIS_DISRUPTION_TYPE_CHOKEPOINT_CONGESTION',
};

const SEVERITY_MAP: Record<string, AisDisruptionSeverity> = {
  low: 'AIS_DISRUPTION_SEVERITY_LOW',
  elevated: 'AIS_DISRUPTION_SEVERITY_ELEVATED',
  high: 'AIS_DISRUPTION_SEVERITY_HIGH',
};

// Cache the two variants separately — candidate reports materially change
// payload size, and clients with no position callbacks should not have to
// wait on or pay for the heavier payload.
const SNAPSHOT_CACHE_TTL_MS = 300_000; // 5 min -- matches client poll interval

interface SnapshotCacheSlot {
  snapshot: VesselSnapshot | undefined;
  timestamp: number;
  inFlight: Promise<VesselSnapshot | undefined> | null;
}

const cache: Record<'with' | 'without', SnapshotCacheSlot> = {
  with: { snapshot: undefined, timestamp: 0, inFlight: null },
  without: { snapshot: undefined, timestamp: 0, inFlight: null },
};

async function fetchVesselSnapshot(includeCandidates: boolean): Promise<VesselSnapshot | undefined> {
  const slot = cache[includeCandidates ? 'with' : 'without'];
  const now = Date.now();
  if (slot.snapshot && (now - slot.timestamp) < SNAPSHOT_CACHE_TTL_MS) {
    return slot.snapshot;
  }

  if (slot.inFlight) {
    return slot.inFlight;
  }

  slot.inFlight = fetchVesselSnapshotFromRelay(includeCandidates);
  try {
    const result = await slot.inFlight;
    if (result) {
      slot.snapshot = result;
      slot.timestamp = Date.now();
    }
    return result ?? slot.snapshot; // serve stale on relay failure
  } finally {
    slot.inFlight = null;
  }
}

function toCandidateReport(raw: any): SnapshotCandidateReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const mmsi = String(raw.mmsi ?? '');
  if (!mmsi) return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    mmsi,
    name: String(raw.name ?? ''),
    lat,
    lon,
    shipType: Number.isFinite(Number(raw.shipType)) ? Number(raw.shipType) : 0,
    heading: Number.isFinite(Number(raw.heading)) ? Number(raw.heading) : 0,
    speed: Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 0,
    course: Number.isFinite(Number(raw.course)) ? Number(raw.course) : 0,
    timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : Date.now(),
  };
}

async function fetchVesselSnapshotFromRelay(includeCandidates: boolean): Promise<VesselSnapshot | undefined> {
  try {
    const relayBaseUrl = getRelayBaseUrl();
    if (!relayBaseUrl) return undefined;

    const response = await fetch(
      `${relayBaseUrl}/ais/snapshot?candidates=${includeCandidates ? 'true' : 'false'}`,
      {
        headers: getRelayHeaders(),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return undefined;

    const data = await response.json();
    if (!data || !Array.isArray(data.disruptions) || !Array.isArray(data.density)) {
      return undefined;
    }

    const densityZones: AisDensityZone[] = data.density.map((z: any): AisDensityZone => ({
      id: String(z.id || ''),
      name: String(z.name || ''),
      location: {
        latitude: Number(z.lat) || 0,
        longitude: Number(z.lon) || 0,
      },
      intensity: Number(z.intensity) || 0,
      deltaPct: Number(z.deltaPct) || 0,
      shipsPerDay: Number(z.shipsPerDay) || 0,
      note: String(z.note || ''),
    }));

    const disruptions: AisDisruption[] = data.disruptions.map((d: any): AisDisruption => ({
      id: String(d.id || ''),
      name: String(d.name || ''),
      type: DISRUPTION_TYPE_MAP[d.type] || 'AIS_DISRUPTION_TYPE_UNSPECIFIED',
      location: {
        latitude: Number(d.lat) || 0,
        longitude: Number(d.lon) || 0,
      },
      severity: SEVERITY_MAP[d.severity] || 'AIS_DISRUPTION_SEVERITY_UNSPECIFIED',
      changePct: Number(d.changePct) || 0,
      windowHours: Number(d.windowHours) || 0,
      darkShips: Number(d.darkShips) || 0,
      vesselCount: Number(d.vesselCount) || 0,
      region: String(d.region || ''),
      description: String(d.description || ''),
    }));

    const rawStatus = (data.status && typeof data.status === 'object') ? data.status : {};
    const candidateReports = (includeCandidates && Array.isArray(data.candidateReports))
      ? data.candidateReports.map(toCandidateReport).filter((r: SnapshotCandidateReport | null): r is SnapshotCandidateReport => r !== null)
      : [];

    return {
      snapshotAt: Date.now(),
      densityZones,
      disruptions,
      sequence: Number.isFinite(Number(data.sequence)) ? Number(data.sequence) : 0,
      status: {
        connected: Boolean(rawStatus.connected),
        vessels: Number.isFinite(Number(rawStatus.vessels)) ? Number(rawStatus.vessels) : 0,
        messages: Number.isFinite(Number(rawStatus.messages)) ? Number(rawStatus.messages) : 0,
      },
      candidateReports,
    };
  } catch {
    return undefined;
  }
}

// ========================================================================
// RPC handler
// ========================================================================

export async function getVesselSnapshot(
  _ctx: ServerContext,
  req: GetVesselSnapshotRequest,
): Promise<GetVesselSnapshotResponse> {
  try {
    const snapshot = await fetchVesselSnapshot(Boolean(req.includeCandidates));
    return { snapshot };
  } catch {
    return { snapshot: undefined };
  }
}
