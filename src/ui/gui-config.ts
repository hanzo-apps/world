/**
 * Hanzo World GUI config — pure @hanzo/gui (Tamagui-based).
 *
 * Built on the official Hanzo defaultConfig from @hanzogui/config (which
 * is a transitive peer of @hanzo/gui). Overrides the dark/light themes for
 * the monochromatic Hanzo brand: black bg, white fg, neutral greys only.
 *
 * Inter is the chrome font for all Hanzo-branded surfaces.
 */

import { defaultConfig } from '@hanzogui/config/v5';
import { createGui } from '@hanzo/gui';

const monoOverrides = {
  ...defaultConfig,
  themes: {
    ...defaultConfig.themes,
    dark: {
      ...defaultConfig.themes.dark,
      background: '#000000',
      backgroundHover: '#111111',
      backgroundPress: '#0a0a0a',
      backgroundFocus: '#0a0a0a',
      color: '#ffffff',
      colorHover: '#ffffff',
      colorPress: '#9a9a9a',
      colorFocus: '#ffffff',
      borderColor: '#1a1a1a',
      borderColorHover: '#262626',
    },
    light: {
      ...defaultConfig.themes.light,
      background: '#ffffff',
      backgroundHover: '#f5f5f5',
      backgroundPress: '#fafafa',
      backgroundFocus: '#fafafa',
      color: '#0a0a0a',
      colorHover: '#0a0a0a',
      colorPress: '#525252',
      colorFocus: '#0a0a0a',
      borderColor: '#e5e5e5',
      borderColorHover: '#d4d4d4',
    },
  },
  defaultTheme: 'dark' as const,
  shouldAddPrefersColorThemes: true,
  themeClassNameOnRoot: true,
};

export const config = createGui(monoOverrides);

export default config;

export type Conf = typeof config;

declare module '@hanzo/gui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface GuiCustomConfig extends Conf {}
}
