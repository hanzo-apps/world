---
phase: 02-theme-core-settings-toggle
plan: 01
subsystem: ui
tags: [theme, localStorage, FOUC, CSP, TypeScript]

# Dependency graph
requires:
  - phase: 01-css-foundation
    provides: CSS custom properties architecture, getCSSColor/invalidateColorCache utilities
provides:
  - ThemeManager module (getStoredTheme, getCurrentTheme, setTheme, applyStoredTheme)
  - Theme type export
  - FOUC prevention inline scripts in both HTML entry points
  - CSP update allowing inline scripts
  - applyStoredTheme() calls in both TS entry points
affects: [02-02 (settings toggle UI will call setTheme), 03 (map/chart theme subscriptions via theme-changed event)]

# Tech tracking
tech-stack:
  added: []
  patterns: [CustomEvent dispatch for theme-changed, inline IIFE for FOUC prevention, data-theme attribute on documentElement]

key-files:
  created: [src/utils/theme-manager.ts]
  modified: [src/utils/index.ts, index.html, settings.html, src/main.ts, src/settings-main.ts]

key-decisions:
  - "Dark mode is default — FOUC script only sets data-theme when stored value is explicitly 'light'"
  - "applyStoredTheme() is a lightweight pre-mount call that skips event dispatch and cache invalidation"
  - "CSP updated with unsafe-inline for script-src to allow FOUC prevention inline scripts"

patterns-established:
  - "Theme state flow: localStorage -> data-theme attribute -> CSS custom properties -> getCSSColor cache"
  - "FOUC prevention: inline IIFE in <head> before stylesheets, reads localStorage, sets data-theme"
  - "Theme change notification: window CustomEvent 'theme-changed' with { detail: { theme } }"

# Metrics
duration: 2min
completed: 2026-02-16
---

# Phase 2 Plan 1: ThemeManager Module Summary

**ThemeManager module with localStorage persistence, FOUC prevention inline scripts, and entry point wiring for both index.html and settings.html**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T10:29:06Z
- **Completed:** 2026-02-16T10:30:59Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created ThemeManager module with 4 exported functions (getStoredTheme, getCurrentTheme, setTheme, applyStoredTheme) and Theme type
- Added FOUC prevention inline scripts to both index.html and settings.html that read localStorage before first paint
- Updated CSP to allow inline scripts and wired applyStoredTheme() into both TS entry points as safety net

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ThemeManager module and update barrel exports** - `9cf2833` (feat)
2. **Task 2: Add FOUC prevention scripts to HTML files and wire entry points** - `e7e7bf0` (feat)

## Files Created/Modified
- `src/utils/theme-manager.ts` - Theme state management: get/set/apply theme with localStorage persistence and event dispatch
- `src/utils/index.ts` - Barrel re-export of all ThemeManager functions and Theme type
- `index.html` - FOUC prevention inline script in head, CSP updated with unsafe-inline for script-src
- `settings.html` - FOUC prevention inline script in head
- `src/main.ts` - Import and call applyStoredTheme() before App initialization
- `src/settings-main.ts` - Import and call applyStoredTheme() at start of initSettingsWindow()

## Decisions Made
- Dark mode is the default: FOUC script only acts when stored value is explicitly 'light' (no attribute needed for dark since :root styles default to dark)
- applyStoredTheme() is intentionally lightweight: no event dispatch, no cache invalidation, since components are not mounted yet
- CSP updated with 'unsafe-inline' for script-src (already present for style-src) to enable FOUC prevention

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ThemeManager foundation complete, ready for Plan 02 (settings toggle UI)
- setTheme() function ready to be called from UI toggle
- theme-changed CustomEvent ready for component subscriptions
- Both entry points apply stored theme before first paint

## Self-Check: PASSED

All 7 files verified present. Both task commits (9cf2833, e7e7bf0) verified in git log.

---
*Phase: 02-theme-core-settings-toggle*
*Plan: 01*
*Completed: 2026-02-16*
