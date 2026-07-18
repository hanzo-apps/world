// Shared fleet renderer — ONE source of truth for the "machines by provider/region
// + BYO GPU workers" markup, used by FleetPanel (admin platform fleet + your-fleet)
// (flagship "Fleet & GPUs"). Real visor data only: every machine and BYO worker is
// a real row with its real region, GPU model, VRAM, vCPU and capabilities — no demo.
import { escapeHtml } from './sanitize';
import { fmtInt, statTile } from './cloud-format';
import { icon } from './icons';
import type { CloudFleet, FleetMachineRow, FleetProviderGroup, FleetWorker } from '@/services/cloud-admin';

const dotClass = (s: string): string =>
  s === 'online' || s === 'active' || s === 'running' || s === 'ready' || s === 'healthy' ? 'online' : 'degraded';

/** Headline totals tiles (machines online/total, GPUs, providers, regions). */
export function fleetTiles(t: CloudFleet['totals']): string {
  return [
    statTile(`${fmtInt(t.online)}/${fmtInt(t.machines)}`, 'machines online'),
    statTile(fmtInt(t.gpus), 'GPUs'),
    statTile(fmtInt(t.providers), 'providers'),
    statTile(fmtInt(t.regions), 'regions'),
  ].join('');
}

/** One machine's spec line: GPUs · VRAM · vCPU · OS (only the parts that are real). */
function machineSpec(m: FleetMachineRow): string {
  const parts: string[] = [];
  parts.push(m.gpus ? `${fmtInt(m.gpus)}× ${escapeHtml(m.gpuModel || 'GPU')}` : escapeHtml(m.gpuModel || '—'));
  if (m.vram) parts.push(escapeHtml(m.vram));
  if (m.vcpu) parts.push(`${fmtInt(m.vcpu)} vCPU`);
  if (m.os) parts.push(escapeHtml(m.os));
  return parts.join(' · ');
}

/** Every machine, grouped by PROVIDER (DO / GCP / AWS / BYO) then REGION. */
export function fleetProviders(providers: FleetProviderGroup[]): string {
  return providers.map((p) => {
    const regions = p.regions.map((rg) => {
      const machines = rg.machines.map((m) => `<div class="cloud-machine-row">
        <span class="cloud-status-dot ${dotClass(m.status)}"></span>
        <span class="cloud-machine-name">${escapeHtml(m.name)}<span class="cloud-machine-type">${escapeHtml(m.type || '')}</span></span>
        <span class="cloud-machine-gpu">${machineSpec(m)}</span>
      </div>`).join('');
      return `<div class="cloud-region-group">
        <div class="cloud-region-head">${icon('network', 11)} ${escapeHtml(rg.region)} <span class="cloud-region-meta">${fmtInt(rg.machines.length)} nodes · ${fmtInt(rg.gpus)} GPU</span></div>
        ${machines}
      </div>`;
    }).join('');
    return `<div class="cloud-provider-group">
      <div class="cloud-provider-head">
        <span class="cloud-provider-name">${escapeHtml(p.provider)}</span>
        <span class="cloud-provider-meta">${fmtInt(p.online)}/${fmtInt(p.machines)} online · ${fmtInt(p.gpus)} GPU</span>
      </div>
      ${regions}
    </div>`;
  }).join('');
}

/** BYO GPU workers (your Spark / Evo / dbc boxes): hostname + GPU + VRAM + caps. */
export function fleetWorkers(workers: FleetWorker[]): string {
  if (!workers.length) return '';
  return `<div class="cloud-fleet-workers">
    <div class="cloud-subhead">${icon('cpu', 12)} BYO GPU workers</div>
    ${workers.map((wk) => `<div class="cloud-worker-row">
      <span class="cloud-status-dot ${wk.status === 'online' ? 'online' : 'offline'}"></span>
      <span class="cloud-worker-name">${escapeHtml(wk.hostname || wk.id)}${wk.location ? `<span class="cloud-machine-type">${escapeHtml(wk.location)}</span>` : ''}</span>
      <span class="cloud-worker-gpu">${escapeHtml(wk.gpu || '—')}${wk.vram ? ` · ${escapeHtml(wk.vram)}` : ''}${wk.version ? ` · v${escapeHtml(wk.version)}` : ''}</span>
      <span class="cloud-worker-caps">${escapeHtml((wk.capabilities || []).join(', '))}</span>
    </div>`).join('')}
  </div>`;
}
