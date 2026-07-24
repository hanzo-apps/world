import { useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { GULF_INVESTMENTS } from '@/config/gulf-fdi';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { t } from '@/services/i18n';
import type {
  GulfInvestment,
  GulfInvestmentSector,
  GulfInvestorCountry,
  GulfInvestingEntity,
  GulfInvestmentStatus,
  MapLayers,
} from '@/types';
import { Panel } from './Panel';
import type { PanelSlot } from './PanelGrid';
import { getGlobeInstance } from '../hooks/globe-instance';

/**
 * InvestmentsPanel — the vanilla `InvestmentsPanel` (src/components/InvestmentsPanel.ts)
 * ported onto the React Panel chassis. Shape: a filtered, sortable table over the
 * static Gulf-FDI critical-infrastructure database, with a row-click that flies the
 * globe to the investment.
 *
 * The data layer is REUSED verbatim, not re-authored: rows come from the same
 * `GULF_INVESTMENTS` seed, the filter + sort predicate is the vanilla `getFiltered`
 * logic carried over unchanged (same search fields, same `av < bv` comparator, same
 * asc/desc toggle), the dropdown option sets keep the vanilla dedup transform
 * (`Array.from(new Set(...)).sort()`), and the row-click reuses the `focusInvestmentOnMap`
 * service byte-for-byte — enabling the `gulfInvestments` layer + centring the globe.
 * The `formatUSD` formatter and the SECTOR_LABELS / STATUS_COLORS / FLAG presentation
 * maps are the panel's own constants, copied verbatim from the vanilla file.
 *
 * `escapeHtml` (used by the vanilla innerHTML build) is intentionally dropped: React
 * escapes text children natively, so every asset / entity / country renders as a safe
 * text node. Form controls are native <input>/<select> (styled inline, dark) — the
 * same native-element pattern the ported GdeltIntelPanel uses for its <a> rows —
 * because @hanzo/gui exposes only layout primitives here.
 *
 * States: the seed is static and local, so there is no fetch to await — no fake
 * loading, no fake error. The one honest placeholder is the chassis `empty` state,
 * shown when the active filters match nothing (the vanilla "No investments match
 * filters" row); otherwise the chassis stays `ready` and owns the frame.
 */

const SECTOR_LABELS: Record<GulfInvestmentSector, string> = {
  ports: 'Ports',
  pipelines: 'Pipelines',
  energy: 'Energy',
  datacenters: 'Data Centers',
  airports: 'Airports',
  railways: 'Railways',
  telecoms: 'Telecoms',
  water: 'Water',
  logistics: 'Logistics',
  mining: 'Mining',
  'real-estate': 'Real Estate',
  manufacturing: 'Manufacturing',
};

const STATUS_COLORS: Record<GulfInvestmentStatus, string> = {
  'operational':         '#22c55e',
  'under-construction':  '#f59e0b',
  'announced':           '#60a5fa',
  'rumoured':            '#a78bfa',
  'cancelled':           '#ef4444',
  'divested':            '#6b7280',
};

const FLAG: Record<string, string> = {
  SA:  '🇸🇦',
  UAE: '🇦🇪',
};

function formatUSD(usd?: number): string {
  if (usd === undefined) return 'Undisclosed';
  if (usd >= 100000) return `$${(usd / 1000).toFixed(0)}B`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}B`;
  return `$${usd.toLocaleString()}M`;
}

interface InvestmentFilters {
  investingCountry: GulfInvestorCountry | 'ALL';
  sector: GulfInvestmentSector | 'ALL';
  entity: GulfInvestingEntity | 'ALL';
  status: GulfInvestmentStatus | 'ALL';
  search: string;
}

/** Column layout: fixed px so the header cells and the data cells stay aligned as the
 *  table region scrolls horizontally inside the panel (the vanilla `.fdi-table-wrap`). */
const COLS = {
  asset: 168,
  country: 96,
  sector: 92,
  status: 116,
  investment: 78,
  year: 48,
} as const;

const SORT_COLUMNS: readonly { key: keyof GulfInvestment; label: string; width: number }[] = [
  { key: 'assetName', label: 'Asset', width: COLS.asset },
  { key: 'targetCountry', label: 'Country', width: COLS.country },
  { key: 'sector', label: 'Sector', width: COLS.sector },
  { key: 'status', label: 'Status', width: COLS.status },
  { key: 'investmentUSD', label: 'Investment', width: COLS.investment },
  { key: 'yearAnnounced', label: 'Year', width: COLS.year },
];

const SELECT_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#e6e6e6',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: 12,
  outline: 'none',
};

const INPUT_STYLE: React.CSSProperties = {
  ...SELECT_STYLE,
  flex: 1,
  minWidth: 0,
};

export function InvestmentsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [filters, setFilters] = useState<InvestmentFilters>({
    investingCountry: 'ALL',
    sector: 'ALL',
    entity: 'ALL',
    status: 'ALL',
    search: '',
  });
  const [sortKey, setSortKey] = useState<keyof GulfInvestment>('assetName');
  const [sortAsc, setSortAsc] = useState(true);

  // Dropdown option sets — the vanilla dedup transform, KEPT verbatim.
  const entities = useMemo(
    () => Array.from(new Set(GULF_INVESTMENTS.map((i) => i.investingEntity))).sort(),
    [],
  );
  const sectors = useMemo(
    () => Array.from(new Set(GULF_INVESTMENTS.map((i) => i.sector))).sort(),
    [],
  );

  // The vanilla `getFiltered()` predicate + comparator, carried over unchanged.
  const filtered = useMemo<GulfInvestment[]>(() => {
    const { investingCountry, sector, entity, status, search } = filters;
    const q = search.toLowerCase();

    return GULF_INVESTMENTS
      .filter((inv) => {
        if (investingCountry !== 'ALL' && inv.investingCountry !== investingCountry) return false;
        if (sector !== 'ALL' && inv.sector !== sector) return false;
        if (entity !== 'ALL' && inv.investingEntity !== entity) return false;
        if (status !== 'ALL' && inv.status !== status) return false;
        if (q && !inv.assetName.toLowerCase().includes(q)
               && !inv.targetCountry.toLowerCase().includes(q)
               && !inv.description.toLowerCase().includes(q)
               && !inv.investingEntity.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortAsc ? cmp : -cmp;
      });
  }, [filters, sortKey, sortAsc]);

  const setFilter = <K extends keyof InvestmentFilters>(key: K, value: InvestmentFilters[K]): void =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleSort = (key: keyof GulfInvestment): void => {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const onRowClick = (inv: GulfInvestment): void => {
    const map = getGlobeInstance();
    focusInvestmentOnMap(map, map?.getState().layers ?? ({} as MapLayers), inv.lat, inv.lon);
  };

  const sortArrow = (key: keyof GulfInvestment): string =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.gccInvestments')}
      infoTooltip={t('components.investments.infoTooltip')}
      state={filtered.length === 0 ? 'empty' : 'ready'}
      emptyText="No investments match filters"
      actions={<SizableText size="$1" color="$color9">{filtered.length}</SizableText>}
      width={440}
    >
      <YStack gap="$2">
        {/* Toolbar — search + the four filter dropdowns (verbatim option sets). */}
        <YStack gap="$1.5">
          <XStack gap="$1.5" alignItems="center">
            <input
              type="text"
              placeholder="Search assets, countries, entities…"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              style={INPUT_STYLE}
            />
          </XStack>
          <XStack gap="$1.5" flexWrap="wrap">
            <select
              value={filters.investingCountry}
              onChange={(e) => setFilter('investingCountry', e.target.value as InvestmentFilters['investingCountry'])}
              style={SELECT_STYLE}
            >
              <option value="ALL">🌐 All Countries</option>
              <option value="SA">🇸🇦 Saudi Arabia</option>
              <option value="UAE">🇦🇪 UAE</option>
            </select>
            <select
              value={filters.sector}
              onChange={(e) => setFilter('sector', e.target.value as InvestmentFilters['sector'])}
              style={SELECT_STYLE}
            >
              <option value="ALL">All Sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>{SECTOR_LABELS[s] || s}</option>
              ))}
            </select>
            <select
              value={filters.entity}
              onChange={(e) => setFilter('entity', e.target.value as InvestmentFilters['entity'])}
              style={SELECT_STYLE}
            >
              <option value="ALL">All Entities</option>
              {entities.map((ent) => (
                <option key={ent} value={ent}>{ent}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value as InvestmentFilters['status'])}
              style={SELECT_STYLE}
            >
              <option value="ALL">All Statuses</option>
              <option value="operational">Operational</option>
              <option value="under-construction">Under Construction</option>
              <option value="announced">Announced</option>
              <option value="rumoured">Rumoured</option>
              <option value="divested">Divested</option>
            </select>
          </XStack>
        </YStack>

        {/* Table region — scrolls horizontally so the six columns stay aligned. */}
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <YStack minWidth={Object.values(COLS).reduce((a, b) => a + b, 0)}>
            <XStack
              gap="$2"
              paddingVertical="$1"
              borderBottomWidth={1}
              borderColor="rgba(255,255,255,0.12)"
            >
              {SORT_COLUMNS.map((col) => (
                <XStack
                  key={col.key}
                  width={col.width}
                  cursor="pointer"
                  role="button"
                  tabIndex={0}
                  onPress={() => toggleSort(col.key)}
                >
                  <SizableText size="$1" color="$color10" numberOfLines={1}>
                    {col.label}{sortArrow(col.key)}
                  </SizableText>
                </XStack>
              ))}
            </XStack>

            {filtered.map((inv) => (
              <InvestmentRow key={inv.id} inv={inv} onClick={onRowClick} />
            ))}
          </YStack>
        </div>
      </YStack>
    </Panel>
  );
}

function InvestmentRow({
  inv,
  onClick,
}: {
  inv: GulfInvestment;
  onClick: (inv: GulfInvestment) => void;
}): React.JSX.Element {
  const statusColor = STATUS_COLORS[inv.status] || '#6b7280';
  const flag = FLAG[inv.investingCountry] || '';
  const sector = SECTOR_LABELS[inv.sector] || inv.sector;
  const year = inv.yearAnnounced ?? inv.yearOperational ?? '—';

  return (
    <XStack
      gap="$2"
      paddingVertical="$1.5"
      alignItems="center"
      cursor="pointer"
      role="button"
      tabIndex={0}
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.06)"
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      onPress={() => onClick(inv)}
    >
      <YStack width={COLS.asset}>
        <XStack gap="$1" alignItems="center">
          {flag ? <SizableText size="$2">{flag}</SizableText> : null}
          <SizableText size="$2" color="$color12" numberOfLines={1}>
            {inv.assetName}
          </SizableText>
        </XStack>
        <SizableText size="$1" color="$color9" numberOfLines={1}>
          {inv.investingEntity}
        </SizableText>
      </YStack>
      <SizableText width={COLS.country} size="$2" color="$color11" numberOfLines={1}>
        {inv.targetCountry}
      </SizableText>
      <SizableText width={COLS.sector} size="$1" color="$color10" numberOfLines={1}>
        {sector}
      </SizableText>
      <XStack width={COLS.status} gap="$1" alignItems="center">
        <XStack width={6} height={6} borderRadius={999} backgroundColor={statusColor} />
        <SizableText size="$1" color="$color11" numberOfLines={1}>
          {inv.status}
        </SizableText>
      </XStack>
      <SizableText width={COLS.investment} size="$2" color="$color12" numberOfLines={1}>
        {formatUSD(inv.investmentUSD)}
      </SizableText>
      <SizableText width={COLS.year} size="$1" color="$color10" numberOfLines={1}>
        {year}
      </SizableText>
    </XStack>
  );
}
