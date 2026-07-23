// One canonical embedded-player <iframe> factory.
//
// Every video embed in the app (live webcams, the live-news desktop bridge, the
// watch queue, the immersive background) is a cross-origin YouTube-nocookie or
// cloud-bridge frame that needs the SAME permissions to autoplay and go
// fullscreen, sandboxed to the minimum that still lets the YouTube IFrame Player
// API run — that API needs its own scripts plus same-origin (kept in the frame's
// own origin, not ours, since the frame is cross-origin).

export interface EmbedIframeOptions {
  src: string;
  title: string;
  /** Feature-policy `allow`. Defaults to the shared YouTube set. */
  allow?: string;
  /** Whether the frame may go fullscreen. Default true. */
  allowFullscreen?: boolean;
  /** Extra class(es) for the iframe. */
  className?: string;
  /** `loading` attribute. */
  loading?: 'lazy' | 'eager';
  /** `referrerpolicy` — only set when provided. */
  referrerPolicy?: ReferrerPolicy;
  /** Sandbox tokens. Defaults to the shared YouTube-safe set; pass null to omit
   *  the sandbox entirely (for an embed that a sandbox would break). */
  sandbox?: string | null;
}

export const YOUTUBE_EMBED_ALLOW = 'autoplay; encrypted-media; picture-in-picture';
export const YOUTUBE_EMBED_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-popups';

export function embedIframe(opts: EmbedIframeOptions): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  if (opts.className) iframe.className = opts.className;
  iframe.src = opts.src;
  iframe.title = opts.title;
  iframe.allow = opts.allow ?? YOUTUBE_EMBED_ALLOW;
  if (opts.allowFullscreen ?? true) iframe.allowFullscreen = true;
  if (opts.referrerPolicy) iframe.referrerPolicy = opts.referrerPolicy;
  if (opts.loading) iframe.setAttribute('loading', opts.loading);
  const sandbox = opts.sandbox === undefined ? YOUTUBE_EMBED_SANDBOX : opts.sandbox;
  if (sandbox) iframe.setAttribute('sandbox', sandbox);
  return iframe;
}
