---
phase: 01-css-foundation-color-centralization
plan: 03
subsystem: ui
tags: [css-custom-properties, theming, light-mode, embedded-styles, template-literals, color-mix]

# Dependency graph
requires:
  - "01-01: CSS custom properties in :root and [data-theme='light'] overrides"
provides:
  - "settings-window.css fully converted to CSS variable references (0 hex, 0 rgba)"
  - "8 TS component embedded <style> blocks converted from hardcoded colors to var(--*) references"
  - "color-mix() pattern for semi-transparent tints from CSS variables"
affects: [01-04, 01-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "color-mix(in srgb, var(--x) N%, transparent) for creating alpha-transparent tints from opaque CSS variables"
    - "Settings window local variables (--settings-*) aliasing global theme variables for cascade isolation"

key-files:
  created: []
  modified:
    - src/styles/settings-window.css
    - src/components/ClimateAnomalyPanel.ts
    - src/components/DisplacementPanel.ts
    - src/components/DownloadBanner.ts
    - src/components/PopulationExposurePanel.ts
    - src/components/SatelliteFiresPanel.ts
    - src/components/UcdpEventsPanel.ts
    - src/components/PizzIntIndicator.ts
    - src/components/VerificationChecklist.ts

key-decisions:
  - "Used color-mix(in srgb, var(--x) N%, transparent) instead of rgba for alpha-transparent tints -- CSS variables cannot be interpolated inside rgba(), color-mix is the modern standard"
  - "Settings window --settings-* local variables now alias global --bg-secondary, --surface-hover etc. -- maintains cascade isolation while enabling theme switching"
  - "DEFCON_COLORS JS object and verdictColors left as hardcoded hex in TS runtime -- these are Plan 04 scope (inline style attributes), not embedded <style> blocks"

patterns-established:
  - "color-mix() for alpha tints: color-mix(in srgb, var(--semantic-critical) 10%, transparent) replaces rgba(255, 68, 68, 0.1)"
  - "Semantic color references in severity badges: var(--semantic-critical), var(--threat-high) etc. for data-driven color coding"

# Metrics
duration: 5min
completed: 2026-02-16
---

# Phase 1 Plan 03: Settings Window & Embedded Style Block Color Conversion Summary

**settings-window.css and 8 TS component embedded style blocks converted from hardcoded hex/rgba to CSS variable references using var() and color-mix() for theme-responsive styling**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-16T08:46:37Z
- **Completed:** 2026-02-16T08:52:25Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Converted all 25+ hardcoded colors in settings-window.css to var() references (0 hex, 0 rgba remaining, 88 var() references)
- Converted embedded `<style>` blocks in 8 TypeScript components from hardcoded hex/rgba to CSS variable references
- Introduced color-mix() pattern for creating semi-transparent tints from opaque CSS custom properties
- Settings window local --settings-* variables now alias global theme variables for seamless theme switching
- TypeScript compilation passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert settings-window.css hardcoded colors** - `c24c956` (feat)
2. **Task 2: Convert embedded style blocks in 8 TS components** - `42dbd7b` (feat)

## Files Created/Modified
- `src/styles/settings-window.css` - All 25+ hardcoded hex/rgba converted to var() and color-mix() references
- `src/components/ClimateAnomalyPanel.ts` - Table headers, borders, severity badges -> var(--text-muted), var(--semantic-*)
- `src/components/DisplacementPanel.ts` - Stat boxes, tabs, crisis badges -> var(--threat-*), var(--overlay-*)
- `src/components/DownloadBanner.ts` - Removed fallback values, button tints -> color-mix(var(--green), ...)
- `src/components/PopulationExposurePanel.ts` - Summary bar, card colors -> var(--threat-critical), var(--accent)
- `src/components/SatelliteFiresPanel.ts` - Table styling -> var(--text-muted), var(--border), var(--threat-*)
- `src/components/UcdpEventsPanel.ts` - Tabs, death counts, actors -> var(--semantic-*), var(--text-dim)
- `src/components/PizzIntIndicator.ts` - Panel, location statuses -> var(--defcon-*), var(--overlay-*), var(--text-*)
- `src/components/VerificationChecklist.ts` - Checklist items, notes -> var(--surface-hover), var(--border), var(--text-*)

## Decisions Made
- Used color-mix(in srgb, var(--x) N%, transparent) for alpha-transparent tints -- CSS variables cannot be interpolated inside rgba() functions, and color-mix is the CSS4 standard with full browser support
- Settings window --settings-* variables now alias global variables rather than defining independent colors -- enables the settings BrowserWindow to respond to theme changes via the same [data-theme] mechanism
- Left DEFCON_COLORS JS object (PizzIntIndicator.ts) and verdictColors (VerificationChecklist.ts) as hardcoded hex -- these are runtime JS values used in inline style= attributes, which is Plan 04's scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All CSS `<style>` blocks (both in .css files and embedded in TS) now use var() references
- Plan 04 can proceed to convert inline style= attribute colors in TypeScript components
- Plan 05 can proceed with remaining file conversions
- The color-mix() pattern established here will be reused wherever alpha-transparent tints are needed

## Self-Check: PASSED

All 9 modified files verified present. Both commit hashes (c24c956, 42dbd7b) verified in git log.

---
*Phase: 01-css-foundation-color-centralization*
*Completed: 2026-02-16*
