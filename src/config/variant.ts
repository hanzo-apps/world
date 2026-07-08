export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    // Shareable, subdomain-free selection: ?variant=full|tech|finance wins and
    // is persisted so it survives navigation. Falls back to the stored choice,
    // then the build-time default.
    const fromUrl = new URLSearchParams(window.location.search).get('variant');
    if (fromUrl === 'tech' || fromUrl === 'full' || fromUrl === 'finance') {
      localStorage.setItem('worldmonitor-variant', fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem('worldmonitor-variant');
    if (stored === 'tech' || stored === 'full' || stored === 'finance') return stored;
  }
  return import.meta.env.VITE_VARIANT || 'full';
})();
