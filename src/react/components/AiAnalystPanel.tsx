import { useAnalyst } from '../hooks/useAnalyst';
import { Panel } from './Panel';
import { AnalystChatSurface } from './AnalystChatSurface';
import type { PanelSlot } from './PanelGrid';

/**
 * AiAnalystPanel — the vanilla `AiAnalystPanel` (src/components/AiAnalystPanel.ts)
 * ported onto the React Panel chassis. It is the "shape other" analogue of
 * MarketsPanel: where a data panel REUSES its `@/services` fetcher + `@/utils`
 * formatters + sparkline verbatim, this panel REUSES the ONE analyst code path
 * verbatim — no send loop, streaming, tool-trace or agentic dispatch is
 * re-authored here.
 *
 * Exactly like the vanilla panel — a thin `Panel` subclass that just hosts an
 * `AnalystChat` in its content — this file is a thin wrapper: it renders the shared
 * `<AnalystChatSurface>` (the React shell that mounts the real vanilla `AnalystChat`
 * class, byte-for-byte the same path the floating AnalystDock uses) into the ONE
 * `<Panel>` chassis, threading the PanelGrid slot's `ref` + `dragHandle`.
 *
 * Host: the panel builds its own agentic host from `useAnalyst` (the verbatim
 * `AnalystCommandHost`), mirroring the vanilla App handing each analyst surface its
 * OWN `buildAnalystHost()` — the dock and the in-grid panel are independent
 * sessions on both surfaces. `set_variant` routes through the SAME one-switch path
 * App owns, passed in as `onVariantChange`.
 *
 * States: this is a conversation surface, not a data fetch — there is no
 * loading/empty/error lifecycle to fake, so the chassis stays in its default
 * "ready" state and the chat owns its own affordances (the OIDC sign-in prompt for
 * signed-out users, the empty-chat starter chips). `scroll={false}` lets the chat's
 * own message scroller fill the frame, matching the vanilla panel's zero-padding
 * content. The live dot is suppressed (vanilla `trackActivity: false`).
 *
 * @hanzo/gui LONGHAND primitives only, via the chassis.
 */
export function AiAnalystPanel({
  slot,
  onVariantChange,
}: {
  slot: PanelSlot;
  /** App's `handleSelect` — the ONE React variant switch the agent routes through. */
  onVariantChange: (id: string) => void;
}): React.JSX.Element {
  const { host } = useAnalyst({ onVariantChange });

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="AI analyst"
      infoTooltip="Chat with your live world data — ask a question, or tell the analyst to rearrange the dashboard."
      actions={<></>}
      scroll={false}
    >
      <AnalystChatSurface host={host} />
    </Panel>
  );
}
