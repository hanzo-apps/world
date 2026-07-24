import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getTrafficGlobe, type TrafficGlobeData } from '@/services/cloud-map';
import { fmtCompact, fmtInt } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * TrafficGlobePanel — the vanilla `TrafficGlobePanel`
 * (src/components/TrafficGlobePanel.ts) ported onto the React Panel chassis. The
 * companion tile to the Hanzo-mode globe: live request-geo throughput read from the
 * native aggregate (/v1/world/cloud/traffic-globe → the ai backend's
 * /v1/traffic/globe) — headline request rates + the top origin countries.
 * Aggregates only, no IPs.
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same
 * `getTrafficGlobe` fetcher and the same `fmtCompact` / `fmtInt` formatters. No
 * fetch/format logic is re-authored; the port is purely the view, expressed in
 * @hanzo/gui longhand primitives. The vanilla `statTile()` HTML helper is
 * re-expressed as the <StatTile> primitive below (same value/label/sub shape), and
 * the `flag()` / `fmtRate()` panel-local helpers are carried over verbatim. The
 * chassis owns the frame; this file owns only the tiles/rows.
 *
 * HONEST empty state preserved exactly: before any traffic is recorded (or before
 * the ai release lands) it shows the zeroed tiles + a "no traffic yet" note, never
 * fabricated data.
 */

interface Tile {
  value: string;
  label: string;
  sub?: string;
}

/** ISO-3166 alpha-2 → regional-indicator flag emoji (no asset needed). */
function flag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + cc.toUpperCase().charCodeAt(0) - 65,
    base + cc.toUpperCase().charCodeAt(1) - 65,
  );
}

/** Rates read naturally: 2 decimals under 1k, compact above. */
function fmtRate(n: number): string {
  return n >= 1000 ? fmtCompact(n) : (Math.round(n * 100) / 100).toString();
}

export function TrafficGlobePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<TrafficGlobeData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      const d = await getTrafficGlobe();
      if (!cancelled && d) setData(d);
    };

    void fetchData();
    // Live surface: same 12s cadence as the vanilla poller.
    const id = window.setInterval(() => void fetchData(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // State machine, mirroring the vanilla render() gate: no payload yet ⇒ loading;
  // once any payload lands ⇒ ready (the honest zeroed/empty body handles no-traffic).
  const state: PanelState = data ? 'ready' : 'loading';
  const live = !!data && data.live && data.points.length > 0;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Live Traffic"
      state={state}
      loadingText="Loading traffic…"
      actions={live ? <PanelLiveDot /> : <XStack />}
      width={460}
    >
      {data ? <TrafficBody data={data} live={live} /> : null}
    </Panel>
  );
}

/** The scope line + 2×2 stat grid + top-country rows — the vanilla `.cloud-overview`
 * body. Tile selection and the valid-ISO country filter mirror the vanilla render()
 * exactly. */
function TrafficBody({ data, live }: { data: TrafficGlobeData; live: boolean }): React.JSX.Element {
  const d = data;
  const t = d.totals;

  // Distinct countries with real traffic (valid ISO alpha-2 only) — a real 4th metric
  // so the tiles read as a symmetric 2×2 instead of 3 + a lone box.
  const countries = (t.top_countries ?? []).filter((c) => /^[A-Za-z]{2}$/.test(c.country)).length;
  const tiles: Tile[] = [
    { value: fmtRate(t.rps_1m), label: 'requests / sec', sub: '1m' },
    { value: fmtRate(t.rpm_60m), label: 'requests / min', sub: '60m avg' },
    { value: fmtInt(d.points.length), label: 'active regions' },
    { value: fmtInt(countries), label: 'countries' },
  ];

  // Only real ISO-3166 alpha-2 codes: upstream geo occasionally leaks malformed
  // tokens (`u=`, `ᐢN`, bare digits) — drop them rather than render garbage flags.
  const rows = (t.top_countries ?? [])
    .filter((c) => /^[A-Za-z]{2}$/.test(c.country))
    .slice(0, 8);

  return (
    <YStack gap="$2.5">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        api.hanzo.ai · last {d.window.minutes || 60}m
      </SizableText>
      <XStack flexWrap="wrap" gap="$2">
        {tiles.map((tile, i) => (
          <StatTile key={`${tile.label}-${i}`} {...tile} />
        ))}
      </XStack>
      {live ? (
        <YStack gap="$1">
          {rows.map((c) => (
            <XStack
              key={c.country}
              alignItems="center"
              justifyContent="space-between"
              paddingVertical="$1"
            >
              <SizableText size="$3" color="$color12">
                {flag(c.country)} {c.country.toUpperCase()}
              </SizableText>
              <SizableText size="$3" color="$color11">
                {fmtInt(c.count)}
              </SizableText>
            </XStack>
          ))}
        </YStack>
      ) : (
        <SizableText size="$2" color="$color9">
          No live traffic yet — points light up as requests hit api.hanzo.ai.
        </SizableText>
      )}
    </YStack>
  );
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label, optional sub. */
function StatTile({ value, label, sub }: Tile): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={128}
      flex={1}
    >
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}
