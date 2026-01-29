# World Monitor: 10 Initiatives for Tonight
## Goal: Make it world-class and launch-ready
## Rule: Work locally, push everything at end

---

## INITIATIVE 1: Critical RSS Feed Integration
**Goal:** Add 15+ high-value intelligence feeds
**Files:** `src/config/feeds.ts`, `api/rss-proxy.js`
**Feeds:**
- [ ] RUSI (Defense)
- [ ] Chatham House (International relations)
- [ ] CFR (US foreign policy)
- [ ] FAO Food Price Monitor (Economic)
- [ ] UN Sanctions List (Automated)
- [ ] Arms Control Association
- [ ] FAS (Federation of American Scientists)
- [ ] Middle East Institute
- [ ] Stimson Center
- [ ] CNAS (Center for a New American Security)
- [ ] GMFUS (German Marshall Fund)
- [ ] ECFR (European Council on Foreign Relations)
- [ ] Wilson Center
- [ ] Lowy Institute (Asia-Pacific)
- [ ] NATO RSS

**Status:** ⏳ PENDING

---

## INITIATIVE 2: Country Instability Index 2.0 with Trends
**Goal:** Add 7-day and 30-day rolling baselines with trend detection
**Files:** `src/components/CIIPanel.ts`, `src/services/cii-trends.ts` (new)
**Features:**
- [ ] Rolling 7-day baseline per country
- [ ] Rolling 30-day baseline per country
- [ ] Trend detection (rising/stable/falling icons)
- [ ] 24h change display
- [ ] Component breakdown visualization
- [ ] Sort by "Most Improved" / "Most Declining"

**Status:** ⏳ PENDING

---

## INITIATIVE 3: Trending Stories Panel
**Goal:** Show which stories are being shared most
**Files:** `src/components/TrendingStories.ts` (new), `api/analytics.js`
**Features:**
- [ ] Track story generation by country/topic
- [ ] "Trending this week" panel
- [ ] "Most shared countries" sidebar
- [ ] Anonymous analytics (no PII)
- [ ] Simple counter in localStorage

**Status:** ⏳ PENDING

---

## INITIATIVE 4: Launch Copy Finalization
**Goal:** Polish all copy for launch
**Files:** `LAUNCH_MATERIALS.md`
**Tasks:**
- [ ] Final Twitter thread (5 tweets)
- [ ] LinkedIn post polish
- [ ] Product Hunt description (final)
- [ ] Email templates for journalists
- [ ] Press kit (simple markdown)

**Status:** ⏳ PENDING

---

## INITIATIVE 5: Product Hunt Submission
**Goal:** Submit to Product Hunt
**Tasks:**
- [ ] Finalize tagline: "Real-time global intelligence monitoring for everyone"
- [ ] Write 5 bullet points
- [ ] Add 3 screenshots
- [ ] Choose category: "Technology" or "Security"
- [ ] Schedule publish (or submit now)
- [ ] Prepare comments for after launch

**Status:** ⏳ PENDING

---

## INITIATIVE 6: Reddit Launch Posts
**Goal:** Post to 5+ subreddits
**Subreddits:**
- [ ] r/cybersecurity (primary)
- [ ] r/INTELLIGENCE (primary)
- [ ] r/geopolitics (primary)
- [ ] r/technology (secondary)
- [ ] r/ArtificialInteligence (secondary)
- [ ] r/dataisbeautiful (tertiary)

**Format:**
- [ ] Unique title for each
- [ ] Tailored description
- [ ] Relevant x-post to multiple communities
- [ ] Timing: stagger posts 1 hour apart

**Status:** ⏳ PENDING

---

## INITIATIVE 7: OG Meta Tags & Twitter Cards
**Goal:** Make shared links look good
**Files:** `index.html`, `src/main.ts`
**Tags:**
- [ ] Twitter Card: summary_large_image
- [ ] OG meta tags (title, description, image)
- [ ] Dynamic meta tags for story pages
- [ ] Favicon and app icons
- [ ] Theme color

**Status:** ⏳ PENDING

---

## INITIATIVE 8: Story Template System
**Goal:** Multiple story templates for different use cases
**Files:** `src/services/story-renderer.ts`, `src/services/story-templates.ts`
**Templates:**
- [ ] **ciianalysis** - Full country analysis (existing)
- [ ] **crisisalert** - Crisis-focused with convergence highlight
- [ ] **dailybrief** - AI summary + top 3 stories
- [ ] **marketfocus** - Prediction market probabilities
- [ ] **compare** - Two-country side-by-side
- [ ] **trend** - 7-day CII trend chart

**Status:** ⏳ PENDING

---

## INITIATIVE 9: Deep Link Router
**Goal:** Handle story URLs to open specific views
**Files:** `src/services/deep-link.ts` (new), `src/App.ts`
**Routes:**
- [ ] `/story?c=UA&t=ciianalysis` - Open country story
- [ ] `/convergence` - Show convergence alerts
- [ ] `/trending` - Show trending stories
- [ ] Parse URL params on load
- [ ] Auto-open modals for shared content

**Status:** ⏳ PENDING

---

## INITIATIVE 10: Self-Review & Logging
**Goal:** Log improvement progress per @jumperz pattern
**Files:** `memory/worldmonitor-progress.md`
**Log Format:**
```
[2026-01-29 20:42] 
TAG: depth
MISS: 
FIX: 

[Initiative N] - Description
- Completed: X/Y subtasks
- Files modified: list
- Notes: 
```

**Status:** ⏳ PENDING

---

## EXECUTION ORDER

1. **Initiative 7** (OG Meta) - Quick win, no deps
2. **Initiative 9** (Deep Link Router) - Core infrastructure
3. **Initiative 8** (Story Templates) - Uses deep links
4. **Initiative 3** (Trending Stories) - Uses templates
5. **Initiative 2** (CII Trends) - Data enhancement
6. **Initiative 1** (RSS Feeds) - Content enhancement
7. **Initiative 4** (Launch Copy) - Marketing
8. **Initiative 5** (Product Hunt) - Launch platform
9. **Initiative 6** (Reddit) - Community launch
10. **Initiative 10** (Logging) - Documentation

---

## COMMIT STRATEGY

**Single push at end:**
```bash
git add -A
git status  # Verify all changes
git diff --stat  # Review scope
git commit -m "feat(worldmonitor): 10 initiatives - launch prep and enhancements

- Add 15+ critical RSS feeds (RUSI, Chatham, CFR, etc.)
- CII 2.0 with 7-day and 30-day trends
- Trending stories panel with analytics
- 4 story templates (analysis, crisis, brief, markets)
- Deep link routing for story sharing
- OG meta tags and Twitter Cards
- Product Hunt submission ready
- Reddit launch posts (5 subreddits)
- Self-review logging implemented

Ready for launch!"
git push origin main
```

---

*Initiatives compiled: 2026-01-29 20:42 UTC*
*Target: All 10 complete by morning*

---

## PROGRESS TRACKER

### ✅ COMPLETED (4/10)
- [x] **Initiative 7: OG Meta Tags** - Dynamic meta tags for story sharing
- [x] **Initiative 9: Deep Link Router** - /story?c=UA routing
- [x] **Initiative 8: Story Templates** - 6 templates configured
- [x] **Initiative 7a: Meta Tags Service** - src/services/meta-tags.ts

### 🔄 IN PROGRESS (3/10)
- [ ] **Initiative 1: RSS Feeds** - 15 feeds to add
- [ ] **Initiative 2: CII Trends** - 7-day/30-day baselines
- [ ] **Initiative 3: Trending Stories** - Analytics panel

### ⏳ PENDING (3/10)
- [ ] **Initiative 4: Launch Copy** - Polishing
- [ ] **Initiative 5: Product Hunt** - Submission
- [ ] **Initiative 6: Reddit Posts** - 6 subreddits
- [ ] **Initiative 10: Self-Review Logging** - Documentation

### FILES MODIFIED SO FAR
```
M  index.html (meta tags)
M  src/main.ts (init meta tags)
M  src/App.ts (deep link routing)
A  src/services/meta-tags.ts
A  src/services/story-templates.ts
A  10_INITIATIVES.md
```


---

## PROGRESS UPDATE 02:00 UTC

### ✅ COMPLETED (6/10)
- [x] **Initiative 1: RSS Feeds** - 20+ new feeds (RUSI, Chatham, CFR, etc.)
- [x] **Initiative 2: CII Trends** - 7-day/30-day baselines, trend detection
- [x] **Initiative 3: Trending Stories** - Analytics panel with localStorage
- [x] **Initiative 7: OG Meta Tags** - Dynamic meta tags for story sharing
- [x] **Initiative 8: Story Templates** - 6 templates configured
- [x] **Initiative 9: Deep Link Router** - /story?c=UA routing

### 🔄 IN PROGRESS (2/10)
- [ ] **Initiative 4: Launch Copy** - Final polishing
- [ ] **Initiative 5: Product Hunt** - Submission ready
- [ ] **Initiative 6: Reddit Posts** - 6 subreddits ready to post

### ⏳ PENDING (2/10)
- [ ] **Initiative 10: Self-Review Logging** - Documentation

### FILES ADDED/MODIFIED
```
A  src/services/meta-tags.ts
A  src/services/story-templates.ts
A  src/services/cii-trends.ts
A  src/services/trending-stories.ts
M  src/config/feeds.ts
M  api/rss-proxy.js
M  src/main.ts
M  src/App.ts
M  index.html
```

