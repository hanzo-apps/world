export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    // Shareable, subdomain-free selection: ?variant=full|tech|finance|saas wins
    // and is persisted so it survives navigation. Falls back to the stored
    // choice, then the build-time default.
    const fromUrl = new URLSearchParams(window.location.search).get('variant');
    if (fromUrl === 'tech' || fromUrl === 'full' || fromUrl === 'finance' || fromUrl === 'saas') {
      localStorage.setItem('worldmonitor-variant', fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem('worldmonitor-variant');
    if (stored === 'tech' || stored === 'full' || stored === 'finance' || stored === 'saas') return stored;
  }
  return import.meta.env.VITE_VARIANT || 'full';
})();
