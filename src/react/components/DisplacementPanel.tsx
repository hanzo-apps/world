import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  fetchUnhcrPopulation,
  formatPopulation,
  getOriginCountries,
  getHostCountries,
} from '@/services/unhcr';
import { t } from '@/services/i18n';
import type { UnhcrSummary, CountryDisplacement } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * DisplacementPanel — the vanilla `DisplacementPanel`
 * (src/components/DisplacementPanel.ts) ported onto the React Panel chassis.
 * Shape: tabbed (origins / hosts). UNHCR global forced-displacement: refugees,
 * asylum seekers, IDPs and totals, plus the top origin / host countries.
 *
 * It REUSES the vanilla data layer VERBATIM — `fetchUnhcrPopulation` (the REAL
 * /v1/world/unhcr-population service, circuit-broken) plus the service's own
 * `formatPopulation` formatter and the `getOriginCountries` / `getHostCountries`
 * filter+sort helpers (the exact ranking the vanilla panel performs). No fetch,
 * format, filter or sort logic is re-authored here.
 *
 * The chassis owns the frame + loading/empty/error states + the tab bar; this
 * file owns only which state to show and the rows, re-expressed in @hanzo/gui
 * longhand primitives. When the service returns `ok:false` (upstream failure /
 * breaker open) it maps to an honest error/empty state, never fabricated data.
 *
 * View-only port: the vanilla panel's optional row → globe fly-to handler
 * (`setCountryClickHandler`) is a globe interaction, not data, and is omitted.
 */

const TABS: readonly PanelTab[] = [
  { key: 'origins', label: t('components.displacement.origins') },
  { key: 'hosts', label: t('components.displacement.hosts') },
];

type DisplacementTab = 'origins' | 'hosts';

export function DisplacementPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<UnhcrSummary | null>(null);
  const [tab, setTab] = useState<string>('origins');
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchUnhcrPopulation();
        if (cancelled) return;
        if (!result.ok) {
          setData(null);
          setState('error');
          return;
        }
        setData(result.data);
        setState(result.data.countries.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
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

  const active = tab as DisplacementTab;

  const countries = useMemo<CountryDisplacement[]>(() => {
    if (!data) return [];
    return (active === 'origins' ? getOriginCountries(data) : getHostCountries(data)).slice(0, 30);
  }, [data, active]);

  const g = data?.globalTotals;
  const stats = g
    ? [
        { label: t('components.displacement.refugees'), value: formatPopulation(g.refugees), color: '#ef4444' },
        { label: t('components.displacement.asylumSeekers'), value: formatPopulation(g.asylumSeekers), color: '#f59e0b' },
        { label: t('components.displacement.idps'), value: formatPopulation(g.idps), color: '#eab308' },
        { label: t('components.displacement.total'), value: formatPopulation(g.total), color: '#60a5fa' },
      ]
    : [];

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.displacement')}
      state={state}
      loadingText={t('common.loadingDisplacement')}
      emptyText={t('common.noDataShort')}
      infoTooltip={t('components.displacement.infoTooltip')}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      width={380}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$3">
        <XStack flexWrap="wrap" gap="$2">
          {stats.map((s) => (
            <StatTile key={s.label} value={s.value} label={s.label} color={s.color} />
          ))}
        </XStack>

        {countries.length === 0 ? (
          <SizableText size="$2" color="$color9">
            {t('common.noDataShort')}
          </SizableText>
        ) : (
          <YStack gap="$1">
            <XStack alignItems="center" paddingHorizontal="$1" paddingBottom="$1">
              <SizableText size="$1" color="$color9" style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 1 }}>
                {t('components.displacement.country')}
              </SizableText>
              <SizableText size="$1" color="$color9" style={{ flexBasis: 76, textTransform: 'uppercase', letterSpacing: 1 }}>
                {t('components.displacement.status')}
              </SizableText>
              <SizableText size="$1" color="$color9" style={{ flexBasis: 60, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>
                {t('components.displacement.count')}
              </SizableText>
            </XStack>
            {countries.map((c) => (
              <DisplacementRow key={c.code || c.name} country={c} tab={active} />
            ))}
          </YStack>
        )}
      </YStack>
    </Panel>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of the vanilla `.disp-stat-box`. */
function StatTile({ value, label, color }: { value: string; label: string; color: string }): React.JSX.Element {
  return (
    <YStack
      minWidth={80}
      flex={1}
      gap="$1"
      paddingHorizontal="$2"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      alignItems="center"
    >
      <SizableText size="$5" color={color} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>
        {label}
      </SizableText>
    </YStack>
  );
}

/** Severity badge threshold — the vanilla crisis/high/elevated classification. */
function badgeFor(total: number): { label: string; color: string } | null {
  if (total >= 1_000_000) return { label: t('components.displacement.badges.crisis'), color: '#ef4444' };
  if (total >= 500_000) return { label: t('components.displacement.badges.high'), color: '#f59e0b' };
  if (total >= 100_000) return { label: t('components.displacement.badges.elevated'), color: '#eab308' };
  return null;
}

function DisplacementRow({ country, tab }: { country: CountryDisplacement; tab: DisplacementTab }): React.JSX.Element {
  const hostTotal = country.hostTotal || 0;
  const count = tab === 'origins' ? country.refugees + country.asylumSeekers : hostTotal;
  const total = tab === 'origins' ? country.totalDisplaced : hostTotal;
  const badge = badgeFor(total);
  return (
    <XStack alignItems="center" paddingVertical="$1.5" paddingHorizontal="$1" borderBottomWidth={1} borderColor="rgba(255,255,255,0.06)">
      <SizableText size="$2" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
        {country.name}
      </SizableText>
      <XStack style={{ flexBasis: 76 }} alignItems="center">
        {badge ? (
          <XStack
            paddingHorizontal="$1.5"
            paddingVertical="$0.5"
            borderRadius="$2"
            backgroundColor={`${badge.color}22`}
          >
            <SizableText size="$1" color={badge.color} style={{ letterSpacing: 0.5 }}>
              {badge.label}
            </SizableText>
          </XStack>
        ) : null}
      </XStack>
      <SizableText size="$2" color="$color11" style={{ flexBasis: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatPopulation(count)}
      </SizableText>
    </XStack>
  );
}
