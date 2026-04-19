/**
 * Hanzo World Tamagui config — built on @hanzo/gui (Tamagui-based).
 *
 * Monochromatic dark-first palette. Only neutral greys, no accent color.
 * Inter font for chrome (Hanzo brand). Map chrome retains its own typography.
 */

import { createGui, defaultConfig } from '@hanzo/gui';

const tokens = {
  ...defaultConfig.tokens,
  color: {
    ...defaultConfig.tokens.color,
    bg: '#000000',
    bgMuted: '#0a0a0a',
    bgElevated: '#111111',
    fg: '#ffffff',
    fgMuted: '#9a9a9a',
    fgSubtle: '#525252',
    border: '#1a1a1a',
    borderHover: '#262626',
    overlay: 'rgba(0, 0, 0, 0.85)',
  },
};

export const guiConfig = createGui({
  ...defaultConfig,
  tokens,
  themes: {
    dark: {
      background: tokens.color.bg,
      backgroundHover: tokens.color.bgElevated,
      backgroundPress: tokens.color.bgMuted,
      backgroundFocus: tokens.color.bgMuted,
      color: tokens.color.fg,
      colorHover: tokens.color.fg,
      colorPress: tokens.color.fgMuted,
      colorFocus: tokens.color.fg,
      borderColor: tokens.color.border,
      borderColorHover: tokens.color.borderHover,
    },
    light: {
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
  fonts: {
    ...defaultConfig.fonts,
    body: { ...defaultConfig.fonts.body, family: 'Inter, system-ui, sans-serif' },
    heading: { ...defaultConfig.fonts.heading, family: 'Inter, system-ui, sans-serif' },
  },
  defaultTheme: 'dark',
  shouldAddPrefersColorThemes: true,
  themeClassNameOnRoot: true,
});

export type AppGui = typeof guiConfig;

declare module '@hanzo/gui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface GuiCustomConfig extends AppGui {}
}
