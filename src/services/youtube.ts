// The one-and-only YouTube IFrame Player API loader + player types, shared by every
// panel that embeds a *controllable* YouTube player: the single-player LiveNewsPanel and
// the StationsWall grid (all news channels at once, hover-to-unmute). This used to be
// braided into LiveNewsPanel, so a second embedder would have had to duplicate the
// script-injection + onYouTubeIframeAPIReady chaining. It lives here now — one place.

export type YouTubePlayer = {
  mute(): void;
  unMute(): void;
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  getIframe?(): HTMLIFrameElement;
  destroy(): void;
};

export type YouTubePlayerConstructor = new (
  elementId: string | HTMLElement,
  options: {
    videoId: string;
    host?: string;
    playerVars: Record<string, number | string>;
    events: {
      onReady: () => void;
      onError?: (event: { data: number }) => void;
    };
  },
) => YouTubePlayer;

type YouTubeNamespace = {
  Player: YouTubePlayerConstructor;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

// Load the YouTube IFrame Player API exactly once per page (idempotent — concurrent
// callers share the single Promise; a second embedder never re-injects the script).
// Resolves when window.YT.Player is ready, or — on an ad-blocker / network failure —
// resolves ANYWAY so callers degrade to a clean offline state instead of hanging.
// Chains any pre-existing onYouTubeIframeAPIReady so multiple embedders coexist.
export function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }

    // Chain (not clobber) any handler another embedder already installed.
    const chainReady = (): void => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve();
      };
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-youtube-iframe-api="true"]',
    );
    if (existingScript) {
      if (window.YT?.Player) resolve();
      else chainReady();
      return;
    }

    chainReady();

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.youtubeIframeApi = 'true';
    script.onerror = () => {
      console.warn('[youtube] IFrame API failed to load (ad blocker or network issue)');
      apiPromise = null; // allow a later retry
      script.remove();
      resolve();
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

// True once window.YT.Player exists (the API has finished loading).
export function isYouTubeAPIReady(): boolean {
  return !!window.YT?.Player;
}
