import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { isAuthenticated, login } from '@/services/iam';
import { getMyBilling, CONSOLE_BILLING_URL, type MyBilling } from '@/services/cloud-pulse';
import { fmtUsd } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * MyUsagePanel — the vanilla `MyUsagePanel` (src/components/MyUsagePanel.ts) ported
 * onto the React Panel chassis. The caller's own org-scoped usage + bill: it REUSES
 * the SAME data layer verbatim — `getMyBilling` (balance + last-30d ledger from
 * api.hanzo.ai with the caller's bearer, org pinned server-side), `isAuthenticated`
 * / `login` to gate + start sign-in, `CONSOLE_BILLING_URL` for the full invoice, and
 * the `fmtUsd` cents formatter. No fetch/format logic is re-authored; this file owns
 * only the view, expressed in @hanzo/gui longhand primitives.
 *
 * The chassis owns the frame + loading / empty / error states; the vanilla panel's
 * honest states map straight across:
 *   signed out                                     →  sign-in call to action (never demo billing)
 *   signed in, ledger not yet fetched              →  state="loading"
 *   signed in, billing unavailable for the account →  "unavailable" notice + console link
 *   signed in, billing in hand                     →  state="ready" (tiles + recent ledger)
 * A fake bill would be dishonest, so signed out is only ever a sign-in prompt.
 */

const SIGNIN_BODY =
  "Sign in to see your org's real spend, balance and usage — metered to your account, no shared keys.";

export function MyUsagePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [billing, setBilling] = useState<MyBilling | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Evaluated per mount, exactly as the vanilla `fetchData()` branches on it.
  const authed = isAuthenticated();

  useEffect(() => {
    if (!authed) {
      setLoaded(true);
      return;
    }
    let cancelled = false;

    const load = async (): Promise<void> => {
      const b = await getMyBilling();
      if (cancelled) return;
      setBilling(b);
      setLoaded(true);
    };

    void load();
    // Same 60s cadence as the vanilla poller.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authed]);

  // ── signed out → the sign-in CTA (honest: no fabricated billing) ────────────
  if (!authed) {
    return (
      <Panel ref={slot.ref} dragHandle={slot.dragHandle} title="My Usage & Bill" actions={<></>}>
        <YStack gap="$2" paddingVertical="$1">
          <SizableText size="$3" color="$color12">
            Your usage &amp; bill
          </SizableText>
          <SizableText size="$2" color="$color9">
            {SIGNIN_BODY}
          </SizableText>
          <XStack
            role="button"
            tabIndex={0}
            cursor="pointer"
            alignSelf="flex-start"
            paddingHorizontal="$3"
            paddingVertical="$2"
            borderRadius="$3"
            backgroundColor="rgba(255,255,255,0.14)"
            hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
            pressStyle={{ backgroundColor: 'rgba(255,255,255,0.28)' }}
            onPress={() => void login()}
          >
            <SizableText size="$2" color="$color12">
              Sign in
            </SizableText>
          </XStack>
        </YStack>
      </Panel>
    );
  }

  // ── state mapping (the vanilla render()'s honest gates) ─────────────────────
  let state: PanelState = 'ready';
  let loadingText: string | undefined;
  if (!loaded) {
    state = 'loading';
    loadingText = 'Loading your usage…';
  }

  // Billing unavailable for this account — vanilla's `unavailable` notice + link.
  if (loaded && !billing) {
    return (
      <Panel ref={slot.ref} dragHandle={slot.dragHandle} title="My Usage & Bill" actions={<></>}>
        <YStack gap="$2" paddingVertical="$1">
          <SizableText size="$2" color="$color9">
            Billing is not available for this account yet.
          </SizableText>
          <BillLink label="Open billing console →" />
        </YStack>
      </Panel>
    );
  }

  const b = billing;
  const availableCents = b?.balance?.available ?? b?.balance?.balance ?? 0;
  const tiles: Array<{ value: string; label: string }> = b
    ? [
        { value: fmtUsd(b.spend30dCents), label: 'spend · 30d' },
        { value: fmtUsd(availableCents), label: 'available balance' },
        { value: String(b.usage.length), label: 'billable events · 30d' },
      ]
    : [];

  const recent = (b?.usage ?? [])
    .slice()
    .sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))
    .slice(0, 8)
    .map((u, i) => {
      const label =
        typeof u.metadata?.product === 'string'
          ? u.metadata.product
          : typeof u.metadata?.description === 'string'
            ? u.metadata.description
            : 'usage';
      const when = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '';
      // The ledger carries integer cents, so a real sub-cent inference charge (< $0.005)
      // rounds to 0 and would render a bare "$0.00" that reads as "not billed". Show
      // "< $0.01" for a real row that rounded to zero — honest about a tiny real charge.
      const amt = u.amount > 0 ? fmtUsd(u.amount) : u.amount === 0 ? '< $0.01' : fmtUsd(u.amount);
      return { key: u.transactionId || `${i}`, label: String(label), when, amt };
    });

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="My Usage & Bill"
      state={state}
      loadingText={loadingText}
      actions={b ? <PanelLiveDot /> : <></>}
    >
      <YStack gap="$2.5">
        <XStack flexWrap="wrap" gap="$1">
          {tiles.map((tile) => (
            <StatTile key={tile.label} value={tile.value} label={tile.label} />
          ))}
        </XStack>

        <YStack gap="$1">
          {recent.length > 0 ? (
            recent.map((r) => <UsageRow key={r.key} label={r.label} when={r.when} amt={r.amt} />)
          ) : (
            <SizableText size="$2" color="$color9" paddingVertical="$2">
              No usage in the last 30 days.
            </SizableText>
          )}
        </YStack>

        <BillLink label="View full bill on console.hanzo.ai →" />
      </YStack>
    </Panel>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of the vanilla `statTile()` HTML. */
function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <YStack minWidth={96} paddingVertical="$1.5" paddingHorizontal="$2" gap="$1">
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
    </YStack>
  );
}

/** A single ledger row — the `.cloud-usage-row` analogue: label · date · amount. */
function UsageRow({ label, when, amt }: { label: string; when: string; amt: string }): React.JSX.Element {
  return (
    <XStack justifyContent="space-between" alignItems="baseline" gap="$2" paddingVertical="$1">
      <SizableText size="$2" color="$color12" numberOfLines={1} flex={1}>
        {label}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {when}
      </SizableText>
      <SizableText size="$2" color="$color11" style={{ minWidth: 72, textAlign: 'right' }}>
        {amt}
      </SizableText>
    </XStack>
  );
}

/** The console.hanzo.ai billing link — the full invoice lives there. */
function BillLink({ label }: { label: string }): React.JSX.Element {
  return (
    <a
      href={CONSOLE_BILLING_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none' }}
    >
      <SizableText size="$2" color="$color11">
        {label}
      </SizableText>
    </a>
  );
}
