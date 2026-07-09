import { Panel } from './Panel';
import { AnalystChat } from './AnalystChat';
import type { AnalystHost } from '@/services/analyst-actions';

/**
 * AI Analyst panel — the dockable, in-grid analyst surface.
 *
 * Thin wrapper: all conversation logic lives in AnalystChat (the single analyst
 * code path, shared verbatim with the floating AiAnalystDock). The panel just
 * hosts an AnalystChat in its content element. It is also the dashboard's control
 * surface — AnalystChat dispatches typed actions through the `AnalystHost` port
 * (show/hide/move panels, toggle map layers, time range, variant, feed panels).
 *
 * Auth + billing: AnalystChat forwards the caller's IAM token to Hanzo inference,
 * so usage meters to their own org/project — never a shared key. Signed-out users
 * get a "sign in" prompt (AI is per-user IAM billed).
 */
export class AiAnalystPanel extends Panel {
  private chat: AnalystChat;

  constructor(host: AnalystHost) {
    super({
      id: 'ai-analyst',
      title: 'AI analyst',
      trackActivity: false,
      infoTooltip: 'Chat with your live world data — ask a question, or tell the analyst to rearrange the dashboard.',
    });
    this.chat = new AnalystChat(this.content, host);
    this.chat.mount();
  }
}
