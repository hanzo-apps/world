// The ONE Tamagui runtime config for the React surface. We build on @hanzogui's
// canonical v4 preset (tokens + shorthands + themes) rather than hand-rolling a
// config, so world inherits the same design system as every other Hanzo product.
// Runtime-only: no compiler/extraction step is required — @hanzo/gui generates
// atomic styles at runtime, which is all this foundation slice needs. Brand
// theming (monochrome, --hanzo-accent:#fff) rides on top via CSS variables in
// theme.css; this config supplies the primitive scales the @hanzogui/* stacks,
// text, button and card components resolve against.
import { defaultConfig } from '@hanzogui/config/v4';
import { createGui } from '@hanzo/gui';

export const guiConfig = createGui(defaultConfig);

export type GuiConf = typeof guiConfig;

// Register the config type globally so @hanzogui/* primitives get token
// autocompletion and typed props against OUR config (one source of truth). The
// GuiCustomConfig interface is declared in @hanzogui/web — the augmentation must
// target THAT module for declaration merging to reach the components.
declare module '@hanzogui/web' {
  interface GuiCustomConfig extends GuiConf {}
}

export default guiConfig;
