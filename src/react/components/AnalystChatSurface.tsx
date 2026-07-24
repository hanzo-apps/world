import { useEffect, useRef } from 'react';
import type { AnalystHost } from '@/services/analyst-actions';
import { AnalystChat, type AnalystChatOptions } from '@/components/AnalystChat';

/**
 * AnalystChatSurface — a thin React shell around the vanilla `AnalystChat`.
 *
 * This is deliberately NOT a rewrite. `AnalystChat` is the ONE analyst code path
 * (composer → analyst.ts → analyst-transport → app-commands.dispatch → the host
 * port), shared by the vanilla dock, in-grid panel and country brief. Re-authoring
 * that send loop / agentic dispatch in React would fork the vocabulary. So we mount
 * the real class into a React-owned container — exactly how `AiAnalystDock` hosts
 * it in the vanilla app — and let it drive itself. The agentic set_variant action
 * therefore flows through `dispatch → host.setVariant → useAnalyst's bridge → the
 * React one-switch`, byte-for-byte the same path as vanilla.
 *
 * React only owns WHERE the chat lives and its lifecycle: build once per host,
 * mount, re-mount on auth change (`hanzo:auth`, the same event the vanilla shell
 * listens to) so a sign-in swaps the signed-out prompt for the live composer.
 */
export function AnalystChatSurface({
  host,
  options,
}: {
  host: AnalystHost;
  options?: AnalystChatOptions;
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<AnalystChat | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const chat = new AnalystChat(root, host, options);
    chatRef.current = chat;
    chat.mount();
    requestAnimationFrame(() => chat.focus());

    // Re-render for the current auth state on sign-in/out — the vanilla dock does
    // the same (it re-mounts on open); the chat keeps its message history.
    const onAuth = () => chat.mount();
    document.addEventListener('hanzo:auth', onAuth);
    return () => {
      document.removeEventListener('hanzo:auth', onAuth);
      chatRef.current = null;
      root.innerHTML = '';
    };
    // host is stable for the surface's lifetime (see useAnalyst); options is a
    // literal from the parent — intentionally not a dep to avoid needless remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  return <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />;
}
