export const BETA_MODE = typeof window !== 'undefined'
  && localStorage.getItem('world-beta-mode') === 'true';
