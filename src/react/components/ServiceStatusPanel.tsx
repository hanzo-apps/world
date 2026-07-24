import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { isDesktopRuntime } from '@/services/runtime';
import {
  getDesktopReadinessChecks,
  getKeyBackedAvailabilitySummary,
  getNonParityFeatures,
} from '@/services/desktop-readiness';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * ServiceStatusPanel — the vanilla `ServiceStatusPanel`
 * (src/components/ServiceStatusPanel.ts) ported onto the React Panel chassis.
 * Shape: fetch (with a category filter re-expressed as the chassis tab bar).
 *
 * It REUSES the vanilla data layer VERBATIM. The vanilla class has no `@/services/*`
 * fetcher module of its own — it fetches inline from the REAL `/v1/world/service-status`
 * endpoint — so the SAME request, the SAME `ServiceStatusResponse` shape, the SAME
 * `getFilteredServices` category filter, the SAME summary counts and the SAME
 * `getStatusIcon` glyphs are carried over unchanged. The desktop-only sections reuse
 * the SAME `@/services/desktop-readiness` helpers (`getDesktopReadinessChecks`,
 * `getKeyBackedAvailabilitySummary`, `getNonParityFeatures`) and the SAME
 * `isDesktopRuntime()` gate. No fetch / filter / readiness logic is re-authored.
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so names/labels render as safe text nodes — running
 * the HTML escaper over them would double-escape.
 *
 * The chassis owns the frame + loading/empty/error states + the tab bar; this file
 * owns only which state to show and the rows, re-expressed in @hanzo/gui longhand
 * primitives. A non-ok / unsuccessful fetch maps to an honest error state, an empty
 * service list to an honest empty state — never fabricated data. The vanilla error
 * "Retry" button folds into the chassis error state + the 60s auto-refresh (same
 * cadence as the vanilla poller), so there is one way to recover.
 */

interface ServiceStatus {
  id: string;
  name: string;
  category: string;
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  description: string;
}

interface LocalBackendStatus {
  enabled?: boolean;
  mode?: string;
  port?: number;
  remoteBase?: string;
}

interface ServiceStatusResponse {
  success: boolean;
  timestamp: string;
  summary: {
    operational: number;
    degraded: number;
    outage: number;
    unknown: number;
  };
  services: ServiceStatus[];
  local?: LocalBackendStatus;
}

type CategoryFilter = 'all' | 'cloud' | 'dev' | 'comm' | 'ai' | 'saas';

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  cloud: 'Cloud',
  dev: 'Dev Tools',
  comm: 'Comms',
  ai: 'AI',
  saas: 'SaaS',
};

/** The vanilla `getFilteredServices`, verbatim. */
function getFilteredServices(services: ServiceStatus[], filter: CategoryFilter): ServiceStatus[] {
  if (filter === 'all') return services;
  return services.filter((s) => s.category === filter);
}

/** The vanilla `getStatusIcon`, verbatim. */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'operational':
      return '●';
    case 'degraded':
      return '◐';
    case 'outage':
      return '○';
    default:
      return '?';
  }
}

const STATUS_COLOR: Record<ServiceStatus['status'], string> = {
  operational: '#22c55e',
  degraded: '#f59e0b',
  outage: '#ef4444',
  unknown: '#9ca3af',
};

export function ServiceStatusPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [localBackend, setLocalBackend] = useState<LocalBackendStatus | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/service-status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: ServiceStatusResponse = await res.json();
        if (!data.success) throw new Error('Failed to load status');
        if (cancelled) return;

        setServices(data.services);
        setLocalBackend(data.local ?? null);
        setState(data.services.length === 0 ? 'empty' : 'ready');
      } catch (err) {
        if (!cancelled) setState('error');
        console.error('[ServiceStatus] Fetch error:', err);
      }
    };

    void load();
    // Live surface: refresh on the same cadence spirit as the vanilla poller.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => getFilteredServices(services, filter), [services, filter]);
  const issues = useMemo(() => filtered.filter((s) => s.status !== 'operational'), [filtered]);

  // Category tabs carry a per-category count chip, computed from the same services.
  const tabs = useMemo<readonly PanelTab[]>(
    () =>
      (Object.entries(CATEGORY_LABELS) as [CategoryFilter, string][]).map(([key, label]) => ({
        key,
        label,
        count: key === 'all' ? services.length : services.filter((s) => s.category === key).length,
      })),
    [services],
  );

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.serviceStatus')}
      state={state}
      loadingText="Checking services..."
      tabs={tabs}
      activeTab={filter}
      onTabChange={(key) => setFilter(key as CategoryFilter)}
      width={360}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$3">
        <BackendStatus local={localBackend} />
        <DesktopReadiness local={localBackend} />
        <SummaryRow services={filtered} />

        <YStack gap="$1">
          {filtered.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </YStack>

        {issues.length === 0 && filtered.length > 0 ? (
          <SizableText size="$2" color="#22c55e">
            All services operational
          </SizableText>
        ) : null}
      </YStack>
    </Panel>
  );
}

/** Vanilla `renderBackendStatus` — desktop-only, verbatim copy/messaging. */
function BackendStatus({ local }: { local: LocalBackendStatus | null }): React.JSX.Element | null {
  if (!isDesktopRuntime()) return null;

  if (!local?.enabled) {
    return (
      <SizableText size="$1" color="#f59e0b">
        Desktop local backend unavailable. Falling back to cloud API.
      </SizableText>
    );
  }

  const port = local.port ?? 46123;
  const remote = local.remoteBase ?? '';

  return (
    <SizableText size="$1" color="$color10">
      Local backend active on 127.0.0.1:{port} · cloud fallback: {remote}
    </SizableText>
  );
}

/** Vanilla `renderDesktopReadiness` — desktop-only, same helper data, verbatim. */
function DesktopReadiness({ local }: { local: LocalBackendStatus | null }): React.JSX.Element | null {
  if (!isDesktopRuntime()) return null;

  const checks = getDesktopReadinessChecks(Boolean(local?.enabled));
  const keySummary = getKeyBackedAvailabilitySummary();
  const nonParity = getNonParityFeatures();
  const readyCount = checks.filter((check) => check.ready).length;

  return (
    <YStack
      gap="$1.5"
      paddingVertical="$2"
      paddingHorizontal="$2"
      borderRadius="$3"
      backgroundColor="rgba(255,255,255,0.04)"
    >
      <SizableText size="$2" color="$color12">
        Desktop readiness
      </SizableText>
      <SizableText size="$1" color="$color9">
        Acceptance checks: {readyCount}/{checks.length} ready · key-backed features{' '}
        {keySummary.available}/{keySummary.total}
      </SizableText>
      <YStack gap="$0.5">
        {checks.map((check) => (
          <SizableText key={check.id} size="$1" color="$color10">
            {check.ready ? '✅' : '⚠️'} {check.label}
          </SizableText>
        ))}
      </YStack>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>
          Non-parity fallbacks ({nonParity.length})
        </summary>
        <YStack gap="$0.5" paddingTop="$1">
          {nonParity.map((feature) => (
            <SizableText key={feature.id} size="$1" color="$color9">
              {feature.panel}: {feature.fallback}
            </SizableText>
          ))}
        </YStack>
      </details>
    </YStack>
  );
}

/** Vanilla `renderSummary` — the OK / Degraded / Outage tallies, verbatim counts. */
function SummaryRow({ services }: { services: ServiceStatus[] }): React.JSX.Element {
  const operational = services.filter((s) => s.status === 'operational').length;
  const degraded = services.filter((s) => s.status === 'degraded').length;
  const outage = services.filter((s) => s.status === 'outage').length;

  return (
    <XStack gap="$3" alignItems="center">
      <SummaryItem count={operational} label="OK" color={STATUS_COLOR.operational} />
      <SummaryItem count={degraded} label="Degraded" color={STATUS_COLOR.degraded} />
      <SummaryItem count={outage} label="Outage" color={STATUS_COLOR.outage} />
    </XStack>
  );
}

function SummaryItem({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}): React.JSX.Element {
  return (
    <XStack alignItems="baseline" gap="$1">
      <SizableText size="$5" color={color} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {label}
      </SizableText>
    </XStack>
  );
}

/** Vanilla `renderServices` row — icon · name · status badge, verbatim mapping. */
function ServiceRow({ service }: { service: ServiceStatus }): React.JSX.Element {
  const color = STATUS_COLOR[service.status];
  return (
    <XStack
      alignItems="center"
      gap="$2"
      paddingVertical="$1"
      paddingHorizontal="$1"
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
    >
      <SizableText size="$3" color={color}>
        {getStatusIcon(service.status)}
      </SizableText>
      <SizableText size="$3" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
        {service.name}
      </SizableText>
      <SizableText size="$1" color={color} style={{ letterSpacing: 0.5 }}>
        {service.status.toUpperCase()}
      </SizableText>
    </XStack>
  );
}
