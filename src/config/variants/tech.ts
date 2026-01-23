// Tech/AI variant - startups.worldmonitor.app
// This file provides re-exports for tech-specific configuration.
// Actual feeds are in feeds.ts (TECH_FEEDS), panels are in panels.ts (TECH_PANELS).

// Re-export base config
export * from './base';

// Tech-specific data exports
export * from '../tech-companies';
export * from '../ai-research-labs';
export * from '../startup-ecosystems';
export * from '../ai-regulations';

// Feed utilities (shared between variants)
export {
  SOURCE_TIERS,
  getSourceTier,
  SOURCE_TYPES,
  getSourceType,
  getSourcePropagandaRisk,
  type SourceRiskProfile,
  type SourceType,
} from '../feeds';
