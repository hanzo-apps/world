import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText, Spinner } from '@hanzo/gui';
import { getSiteVariant } from '@/config';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * StatusPanel — the vanilla `StatusPanel` (src/components/StatusPanel.ts) ported
 * onto the React Panel chassis. Shape: "other" — the global System Status widget
 * (Data Feeds · API Status · Storage), not a per-sector data fetch.
 *
 * It REUSES the vanilla data layer VERBATIM. The vanilla class has no `@/services/*`
 * fetcher of its own — it is a passive surface fed imperatively by `App` via
 * `updateFeed`/`updateApi`, seeded by `initDefaultStatuses` from a variant-aware
 * allowlist, with a per-section storage read. So the SAME `TECH_*`/`WORLD_*`
 * allowlist Sets, the SAME variant transform (`tech ? TECH : WORLD`), the SAME
 * disabled-seed, the SAME `navigator.storage.estimate()` MB math + "unavailable"
 * fallback, and the SAME private `formatTime` are carried over unchanged. No data
 * logic is re-authored. (The only shift: the variant is read from the config layer's
 * runtime accessor `getSiteVariant()` — the ONE source the rest of the React surface
 * switches on — instead of the boot-time `SITE_VARIANT` snapshot, so the allowlist
 * re-derives when the surface changes variant. The transform itself is verbatim.)
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so names/counts render as safe text nodes.
 *
 * The chassis owns the frame; this file owns the rows. This panel has no wholesale
 * fetch that can fail or come back empty — feeds/apis are synchronous allowlist
 * content (seeded `disabled` until a feeder reports in, exactly as the vanilla base),
 * so the panel is honestly `ready` and never fabricates liveness. The one async read,
 * storage estimate, carries its OWN honest loading → value → unavailable sub-state
 * inside the Storage section, mirroring the vanilla `updateStorageInfo` verbatim.
 * Style props are LONGHAND-only per the @hanzo/gui typecheck contract.
 */

type StatusLevel = 'ok' | 'warning' | 'error' | 'disabled';

interface FeedStatus {
  name: string;
  lastUpdate: Date | null;
  status: StatusLevel;
  itemCount: number;
  errorMessage?: string;
}

interface ApiStatus {
  name: string;
  status: StatusLevel;
  latency?: number;
}

// Allowlists for each variant — verbatim from the vanilla StatusPanel.
const TECH_FEEDS = new Set([
  'Tech', 'Ai', 'Startups', 'Vcblogs', 'RegionalStartups',
  'Unicorns', 'Accelerators', 'Security', 'Policy', 'Layoffs',
  'Finance', 'Hardware', 'Cloud', 'Dev', 'Tech Events', 'Crypto',
  'Markets', 'Events', 'Producthunt', 'Funding', 'Polymarket',
  'Cyber Threats',
]);
const TECH_APIS = new Set([
  'RSS Proxy', 'Finnhub', 'CoinGecko', 'Tech Events API', 'Service Status', 'Polymarket',
  'Cyber Threats API',
]);

const WORLD_FEEDS = new Set([
  'Politics', 'Middleeast', 'Tech', 'Ai', 'Finance',
  'Gov', 'Intel', 'Layoffs', 'Thinktanks', 'Energy',
  'Polymarket', 'Weather', 'NetBlocks', 'Shipping', 'Military',
  'Cyber Threats',
]);
const WORLD_APIS = new Set([
  'RSS2JSON', 'Finnhub', 'CoinGecko', 'Polymarket', 'USGS', 'FRED',
  'AISStream', 'GDELT Doc', 'EIA', 'USASpending', 'PizzINT', 'FIRMS',
  'Cyber Threats API',
]);

const STATUS_COLOR: Record<StatusLevel, string> = {
  ok: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  disabled: '#6b7280',
};

/** The vanilla StatusPanel's private `formatTime`, verbatim. */
function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

type StorageState =
  | { kind: 'loading' }
  | { kind: 'available'; used: string; quota: string }
  | { kind: 'unavailable' };

export function StatusPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  // Variant transform, verbatim (tech ? TECH : WORLD), read from the runtime accessor.
  const { feeds, apis } = useMemo<{ feeds: FeedStatus[]; apis: ApiStatus[] }>(() => {
    const variant = getSiteVariant();
    const allowedFeeds = variant === 'tech' ? TECH_FEEDS : WORLD_FEEDS;
    const allowedApis = variant === 'tech' ? TECH_APIS : WORLD_APIS;
    // initDefaultStatuses: seed every allowed feed/API disabled until a feeder reports.
    return {
      feeds: [...allowedFeeds].map((name) => ({
        name,
        lastUpdate: null,
        status: 'disabled' as const,
        itemCount: 0,
      })),
      apis: [...allowedApis].map((name) => ({ name, status: 'disabled' as const })),
    };
  }, []);

  const [storage, setStorage] = useState<StorageState>({ kind: 'loading' });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    // updateStorageInfo — verbatim MB math + unavailable fallback.
    void (async () => {
      try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          const estimate = await navigator.storage.estimate();
          if (cancelled) return;
          const used = estimate.usage ? (estimate.usage / 1024 / 1024).toFixed(2) : '0';
          const quota = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(0) : 'N/A';
          setStorage({ kind: 'available', used, quota });
        } else {
          setStorage({ kind: 'unavailable' });
        }
      } catch {
        if (!cancelled) setStorage({ kind: 'unavailable' });
      } finally {
        if (!cancelled) setCheckedAt(new Date());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.status')}
      state="ready"
      actions={<PanelLiveDot />}
    >
      <YStack gap="$3">
        <StatusSection title={t('components.status.dataFeeds')}>
          {feeds.map((feed) => (
            <FeedRow key={feed.name} feed={feed} />
          ))}
        </StatusSection>

        <StatusSection title={t('components.status.apiStatus')}>
          {apis.map((api) => (
            <ApiRow key={api.name} api={api} />
          ))}
        </StatusSection>

        <StatusSection title={t('components.status.storage')}>
          <StorageInfo storage={storage} />
        </StatusSection>

        <SizableText size="$1" color="$color9">
          {checkedAt
            ? t('components.status.updatedAt', { time: formatTime(checkedAt) })
            : t('components.status.updatedJustNow')}
        </SizableText>
      </YStack>
    </Panel>
  );
}

function StatusSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <YStack gap="$1.5">
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </SizableText>
      <YStack gap="$0.5">{children}</YStack>
    </YStack>
  );
}

function StatusDot({ status }: { status: StatusLevel }): React.JSX.Element {
  return (
    <XStack
      width={7}
      height={7}
      borderRadius={999}
      backgroundColor={STATUS_COLOR[status]}
      opacity={status === 'disabled' ? 0.5 : 1}
    />
  );
}

function FeedRow({ feed }: { feed: FeedStatus }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$1">
      <StatusDot status={feed.status} />
      <SizableText size="$2" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
        {feed.name}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {feed.itemCount} items
      </SizableText>
      <SizableText size="$1" color="$color9" style={{ minWidth: 56, textAlign: 'right' }}>
        {feed.lastUpdate ? formatTime(feed.lastUpdate) : 'Never'}
      </SizableText>
    </XStack>
  );
}

function ApiRow({ api }: { api: ApiStatus }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$1">
      <StatusDot status={api.status} />
      <SizableText size="$2" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
        {api.name}
      </SizableText>
      {api.latency != null ? (
        <SizableText size="$1" color="$color9">
          {api.latency}ms
        </SizableText>
      ) : null}
    </XStack>
  );
}

function StorageInfo({ storage }: { storage: StorageState }): React.JSX.Element {
  if (storage.kind === 'loading') {
    return (
      <XStack alignItems="center" gap="$2" paddingVertical="$1">
        <Spinner size="small" color="$color9" />
        <SizableText size="$2" color="$color9">
          {t('common.loading')}
        </SizableText>
      </XStack>
    );
  }

  if (storage.kind === 'unavailable') {
    return (
      <SizableText size="$2" color="$color9" paddingVertical="$1">
        {t('components.status.storageUnavailable')}
      </SizableText>
    );
  }

  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$1">
      <SizableText size="$2" color="$color12" style={{ flex: 1 }}>
        IndexedDB
      </SizableText>
      <SizableText size="$1" color="$color9">
        {storage.used} MB / {storage.quota} MB
      </SizableText>
    </XStack>
  );
}
