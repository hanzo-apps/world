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

// Type registration — the bundler/runtime is authoritative for the config, NOT tsc.
// ---------------------------------------------------------------------------------
// The upstream @hanzo/gui apps do NOT register a `GuiCustomConfig` module
// augmentation for the app's own tsc gate: `GuiProvider config={guiConfig}` is what
// actually runs, and the v4 dist ships default component types that already describe
// this exact preset (we pass `defaultConfig` unchanged, so runtime and types agree).
//
// Registering `interface GuiCustomConfig extends typeof createGui(defaultConfig)`
// does the opposite of help here: v4's `defaultConfig` sets
// `settings.onlyAllowShorthands: true`, which — once fed back into the type system —
// STRIPS every longhand style prop (backgroundColor, alignItems, borderRadius, …)
// and re-derives the media wrapper as a mapped index signature that JSX `children`
// can no longer satisfy. That is the entire source of the Stage-0 `typecheck:react`
// friction (both the "no properties in common with WithThemeValues<…>" longhand
// errors and the "children incompatible with index signature" errors). Neither a
// strictness knob nor a component wrapper removes it — it is inherent to registering
// this preset's type against strict JSX.
//
// So we let the config live where it belongs — at runtime — and keep tsc a clean
// STRUCTURAL gate (prop names, element shapes, children, token grammar). Token-VALUE
// validation is Tamagui's build/runtime concern, exactly as upstream leaves it.
// The single house rule that keeps this "one way": components use LONGHAND style
// props only (backgroundColor / paddingHorizontal / alignItems / …), never the v4
// shorthands — one explicit, CSS-familiar vocabulary that also matches theme.css.

export default guiConfig;
