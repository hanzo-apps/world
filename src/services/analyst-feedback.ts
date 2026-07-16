/**
 * Analyst reward signals — content-free, through the @hanzo/ai SDK.
 *
 * The analyst chat emits reward signals (thumbs up/down, regenerate) keyed on the
 * gateway response id. This is the ONE place that talks to the SDK's sendFeedback:
 * it posts SAME-ORIGIN (`baseUrl: ''` → `/v1/feedback`) to world's BFF proxy,
 * which forwards to the gateway with the caller's IAM bearer for per-org
 * attribution. Fire-and-forget: sendFeedback never throws and is a silent no-op
 * on any failure.
 *
 * Content-free BY CONSTRUCTION: the SDK's FeedbackInput union only permits
 * `{ requestId, signal }` (+ `rating` for `signal:'rating'` alone), and world's
 * BFF re-whitelists server-side. No prompt/response/text ever transits.
 */

import { sendFeedback, type FeedbackSignal } from '@hanzo/ai';
import { getToken } from './iam';

/** Local opt-out (VITE_HANZO_FEEDBACK ∈ 0|false|off disables all emission). */
const DISABLED = ((): boolean => {
  const v = String(import.meta.env.VITE_HANZO_FEEDBACK ?? '').toLowerCase();
  return v === '0' || v === 'false' || v === 'off';
})();

/** Emit one non-rating reward signal for a generation. No-op when `id` is falsy
 *  (never fabricate an id) or when feedback is disabled. The IAM bearer is passed
 *  as a lazy provider so the BFF's userBearer() attributes it to the user. */
export function emitFeedback(id: string | undefined, signal: Exclude<FeedbackSignal, 'rating'>): void {
  if (!id) return;
  sendFeedback(
    { requestId: id, signal },
    { baseUrl: '', token: () => getToken().then((t) => t ?? ''), disabled: DISABLED },
  );
}
