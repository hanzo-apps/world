# World Monitor: World-Class Enhancement Plan
## Compiled: 2026-01-29 | Author: ClawdBot for Elie Habib

---

## Executive Summary

**Goal:** Transform World Monitor from "impressive dashboard" to "world-class intelligence platform" with viral shareability.

**Three Pillars:**
1. **Core Intelligence** — Make it the best source for understanding the world
2. **Story/Shareability** — Make people want to share it everywhere
3. **Launch/Growth** — Get it in front of the right audiences

---

## Part 1: Core Intelligence Enhancements

### Priority 1: Geographic Convergence Detection (from ROADMAP)
**Impact:** HIGH | **Effort:** MEDIUM | **Time:** 2-4 hours

Flag when 3+ event types (protests + military + news) converge in same geographic cell.

**Implementation:**
- [ ] Add 50km grid cell tracking
- [ ] Event-type tagging per cell
- [ ] Alert when 3+ types in same cell within 24h
- [ ] Confidence scoring (diversity × count)
- [ ] Display on map with convergence markers

**Files to modify:**
- `src/utils/geo-convergence.ts` (new)
- `src/components/ConvergenceLayer.ts` (new)
- `src/services/event-processor.ts` (update)

### Priority 2: Country Instability Index 2.0
**Impact:** HIGH | **Effort:** MEDIUM | **Time:** 2-3 hours

Upgrade CII with temporal baselines and trend detection.

**Implementation:**
- [ ] Add 7-day and 30-day rolling baselines
- [ ] Z-score calculation per component
- [ ] Trend detection (rising/stable/falling)
- [ ] Choropleth map layer with color scale
- [ ] Click → component breakdown modal

**Files to modify:**
- `src/components/CIIPanel.ts` (major update)
- `src/config/countries.ts` (baseline data)
- `src/services/cii-calculator.ts` (new)

### Priority 3: Temporal Anomaly Detection  
**Impact:** HIGH | **Effort:** MEDIUM | **Time:** 2-3 hours

Detect when current activity deviates from historical norms.

**Implementation:**
- [ ] Store hourly/daily baselines by weekday + month
- [ ] Z-score calculation for military, vessels, protests, news
- [ ] Alert format: "X is 3.2x normal for Tuesday"
- [ ] Historical comparison panel

**Files to modify:**
- `src/services/temporal-baseline.ts` (new)
- `src/components/TemporalAnomalyPanel.ts` (new)
- `src/components/StatusPanel.ts` (update)

### Priority 4: Prediction Market Integration 2.0
**Impact:** MEDIUM | **Effort:** LOW | **Time:** 1 hour

Expand Polymarket coverage and show as "leading indicator."

**Implementation:**
- [ ] Add topic-based market filters (Ukraine, Iran, China, Taiwan, Energy)
- [ ] Show probability shifts before news arrives
- [ ] Correlation indicator (market moved → news coming?)
- [ ] Top movers panel

**Files to modify:**
- `src/components/PredictionPanel.ts` (update)
- `src/config/markets.ts` (expand topics)

### Priority 5: Critical Data Source Additions
**Impact:** MEDIUM | **Effort:** LOW | **Time:** 1-2 hours

Add high-value RSS feeds from think tanks and official sources.

**Feeds to add:**
- [ ] RUSI (Defense)
- [ ] Chatham House (International relations)
- [ ] CFR (US foreign policy)
- [ ] FAO Food Price Monitor (Economic instability)
- [ ] UN Sanctions (Automated parsing)

**Files to modify:**
- `src/config/feeds.ts` (add 10-15 feeds)
- `api/rss-proxy.js` (add domains to allowlist)

---

## Part 2: Story/Shareability Enhancements

### Priority 1: Story Templates System
**Impact:** HIGH | **Effort:** MEDIUM | **Time:** 2-3 hours

Create multiple story templates for different use cases.

**Templates:**
- [ ] **"Country Intel"** — CII score, top risks, recent events
- [ ] **"Crisis Alert"** — Convergence detection, geographic context
- [ ] **"Daily Brief"** — AI summary + top 3 stories
- [ ] **"Compare"** — Two countries side-by-side
- [ ] **"Trend"** — 7-day instability index chart

**Files to modify:**
- `src/services/story-templates.ts` (new)
- `src/components/StoryModal.ts` (template selector)
- `src/services/story-renderer.ts` (template rendering)

### Priority 2: Viral Share Optimization
**Impact:** HIGH | **Effort:** LOW | **Time:** 1 hour

Make stories instantly shareable with one-tap actions.

**Features:**
- [ ] **Deep linking** — Share → opens specific view on worldmonitor.app
- [ ] **QR code generation** — For each story
- [ ] **Pre-written captions** — "Check out [Country] instability"
- [ ] **Twitter/X native share** — Twitter Cards support
- [ ] **Link preview** — OG meta tags for the shared URL

**Files to modify:**
- `src/components/StoryModal.ts` (add deep link + QR)
- `index.html` (add OG meta tags)
- `src/services/deep-link.ts` (new)

### Priority 3: Story Analytics
**Impact:** MEDIUM | **Effort:** LOW | **Time:** 1 hour

Track which stories get shared most.

**Features:**
- [ ] Track story generation count by country/topic
- [ ] "Trending stories" panel
- [ ] "Most shared this week" sidebar
- [ ] Anonymous analytics (no PII)

**Files to modify:**
- `src/services/analytics.ts` (new)
- `src/components/TrendingStories.ts` (new)
- `api/analytics.js` (new edge function)

### Priority 4: Interactive Story Builder
**Impact:** MEDIUM | **Effort:** HIGH | **Time:** 4-6 hours

Let users customize stories before generating.

**Features:**
- [ ] Select data points to include/exclude
- [ ] Custom headline input
- [ ] Color theme selector
- [ ] Background image upload option
- [ ] Save custom templates

**Files to modify:**
- `src/components/StoryBuilder.ts` (new)
- `src/components/StoryModal.ts` (integrate builder)

---

## Part 3: Launch/Marketing Plan

### Launch Checklist

#### Pre-Launch (Day 0)
- [ ] Finalize "viral story" templates
- [ ] Test all share flows (WhatsApp, Twitter, Instagram, LinkedIn)
- [ ] Add OG meta tags for link previews
- [ ] Create landing page screenshot assets
- [ ] Write launch post (Twitter/X)
- [ ] Write launch post (LinkedIn)
- [ ] Write Reddit post (r/cybersecurity, r/INTELLIGENCE, r/geopolitics)
- [ ] Write Reddit post (r/technology, r/ArtificialInteligence)
- [ ] Prepare Product Hunt submission
- [ ] Email friendly tech journalists (TBD)

#### Launch Day (Day 1)
- [ ] Post on Twitter/X (with story screenshot)
- [ ] Post on LinkedIn
- [ ] Submit to Product Hunt
- [ ] Post on r/cybersecurity
- [ ] Post on r/INTELLIGENCE
- [ ] Post on r/geopolitics
- [ ] Post on r/technology
- [ ] Post on r/ArtificialInteligence
- [ ] Notify any GitHub followers (release note)
- [ ] Update GitHub release description

#### Post-Launch (Day 2-7)
- [ ] Monitor Twitter engagement, reply to questions
- [ ] Monitor Reddit comments, answer questions
- [ ] Track Product Hunt upvotes, respond to feedback
- [ ] Tweet follow-up: "Thank you for the support! Here's what's coming next"
- [ ] Email newsletter subscribers (if list exists)
- [ ] Submit to alternative launch platforms (Betanews, OMG! Ubuntu!, etc.)

### Copy Templates

#### Twitter/X Launch Post
```
🗺️ World Monitor just got a major upgrade:

📊 Country Instability Index — Real-time risk scores for 190+ countries
🚨 Geographic Convergence Alerts — When protests + military + news converge
⏰ Temporal Anomaly Detection — Spot unusual activity before it makes news
📱 Stories that share anywhere — One-tap to WhatsApp, IG, Twitter

Try it: https://worldmonitor.app

Built by @eliehabib | Open source: github.com/koala73/worldmonitor
#OSINT #Geopolitics #Intelligence
```

#### LinkedIn Launch Post
```
Excited to announce the biggest World Monitor update yet.

For months, I've been building an open-source intelligence platform that aggregates 80+ global news feeds, military tracking data, and infrastructure maps into a single view.

Today's launch adds:

🎯 Country Instability Index — Composite risk scores with 7-day trends
🚨 Geographic Convergence — Detects when multiple signals point to the same region
⏰ Temporal Anomaly Detection — Flags unusual activity vs historical norms
📱 Shareable "Stories" — One-tap generation of intelligence snapshots

The goal: Make world-class geopolitical intelligence accessible to everyone.

Try it: https://worldmonitor.app

Huge thanks to the open-source community for the feedback and contributions.

#Geopolitics #OSINT #Intelligence #OpenSource #DataVisualization
```

#### Reddit Post (r/cybersecurity)
```
Title: World Monitor — Open-source geopolitical intelligence dashboard (I built this)

Body:
Hey r/cybersecurity,

I've been building an open-source intelligence platform for the past few months and just pushed a major update.

**What it does:**
- Aggregates 80+ RSS feeds (defense, energy, tech, government)
- Tracks military flights, naval vessels, infrastructure
- Shows real-time instability scores for 190+ countries
- Detects "convergence" when multiple signals point to the same region

**What's new today:**
- Country Instability Index 2.0 with trend detection
- Temporal anomaly detection (spot unusual activity)
- Shareable "Stories" for intelligence snapshots

**Why I built it:**
Commercial OSINT tools cost $10K+/year. I wanted something free and open that anyone could use.

Demo: https://worldmonitor.app
Code: https://github.com/koala73/worldmonitor

Questions? AMA
```

---

## Part 4: Technical Implementation Tasks

### Week 1 Sprint (Tonight + Tomorrow)

| Task | Owner | ETA | Status |
|------|-------|-----|--------|
| Story templates system | Codex | 2h | ⏳ |
| Viral share optimization | Me | 1h | ⏳ |
| Geographic convergence | Codex | 3h | ⏳ |
| CII 2.0 with trends | Me | 2h | ⏳ |
| Temporal anomaly detection | Codex | 2h | ⏳ |
| Critical RSS feeds | Me | 1h | ⏳ |
| Launch copy writing | Me | 1h | ⏳ |
| Product Hunt submission | Me | 30m | ⏳ |
| Reddit posts | Me | 1h | ⏳ |

### Total Estimated Time: 13.5 hours

---

## Execution Notes

### Using Codex for Code Generation
For complex features (convergence detection, temporal baseline), Codex will:
1. Generate the core logic
2. Create unit tests
3. Integrate with existing components

### Using Me for Review/Polish
I will:
1. Review Codex output
2. Polish UI/UX
3. Ensure consistency with existing code style
4. Test share flows manually

---

## Success Metrics

| Metric | Target (Week 1) |
|--------|-----------------|
| GitHub Stars | +500 (2,000 → 2,500) |
| Daily Active Users | 1,000 → 5,000 |
| Stories Generated | 500 → 2,000 |
| Twitter Mentions | 50 → 200 |
| Product Hunt Upvotes | 100+ |
| Reddit Upvotes | 100+ per post |

---

*Plan generated by ClawdBot for Elie Habib*
*2026-01-29 | Compound Engineering Session*
