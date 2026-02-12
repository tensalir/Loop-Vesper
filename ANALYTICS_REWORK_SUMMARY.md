# Analytics Rework Summary

## What Was Changed

### Problem Addressed

1. **Efficiency framing was wrong** - Metrics like "cost per asset", "value per dollar", and "iteration efficiency" framed exploration as waste. AI generation requires wide exploration before convergence—this is valuable work, not inefficiency.

2. **Schema mismatch** - The taxonomy system expected fields (`intent`, `themes`, `domains`, `complexity`) that were never in `claudeParsed`. The actual fields are `subjects`, `styles`, `mood`, `keywords`, `composition`, `lighting`, `colors`, `quality`, `motion`.

---

## Files Removed

- `src/app/api/analytics/efficiency/route.ts` - Deleted entire efficiency endpoint
- `docs/analytics-api-reference.md` - Removed stale documentation  
- `ANALYTICS_IMPROVEMENTS.md` - Removed stale documentation

---

## Files Rewritten

### 1. `src/lib/analytics/taxonomy.ts`

**Before:** Expected phantom fields (intent, themes, domains, complexity)
**After:** Maps actual `claudeParsed` fields:

```typescript
interface ParsedAnalysis {
  subjects: string[]      // "woman", "car", "landscape"
  styles: string[]        // "photorealistic", "cinematic", "anime"
  mood: string | null     // "dramatic", "peaceful"
  keywords: string[]      // general descriptive terms
  composition: string[]   // "close-up", "wide shot"
  lighting: string[]      // "golden hour", "studio lighting"
  colors: string[]        // "warm tones", "blue"
  quality: string[]       // "high detail", "soft focus"
  motion?: string[]       // video only
}
```

**New interfaces:**
- `SemanticProfile` - Direct mapping from claudeParsed
- `ProjectSemanticFingerprint` - Top subjects/styles/moods/colors/techniques
- `ConvergenceSignals` - What patterns appear in keeper outputs
- `ModelAffinity` - Which models for which semantic patterns
- `ExplorationBreadth` - Diversity metrics (neutral, descriptive)

### 2. `src/lib/analytics/cohorts.ts`

**Changes:**
- Renamed `PRODUCER` → `CONVERTER` (neutral label)
- Updated all references in `calculateUserCohort()`
- Removed productivity framing

### 3. `src/lib/analytics/insights.ts`

**Completely rewritten** with pattern-based rules:

**Removed:**
- All efficiency-based insights (cost per asset, value per dollar, iteration efficiency)
- `analyzeSpendingEfficiency()`
- `analyzeModelPerformance()` (old efficiency version)
- `analyzeIntentPatterns()` (intent doesn't exist)

**Added:**
- `analyzeSemanticPatterns()` - Primary creative territory, mood signatures
- `analyzeModelAffinity()` - Which models for which subjects/styles
- `analyzeConvergenceSignals()` - High-value subject/style patterns in keepers
- Updated `analyzeProjectFunnel()` - Removed waste framing, added exploration patterns

**New insight types:**
- "Primary Creative Territory" - Top subject + style combination
- "Mood Signature" - Dominant mood patterns
- "Model Creative Territory" - Model affinity for subjects
- "High-Value Subject Pattern" - Convergence signals
- "Style Resonance" - What styles appear in keepers
- "Broad Exploration" - Wide exploration patterns (neutral)
- "High Engagement Pattern" - Curation happening (neutral)
- "Strong Convergence" - Focused exploration (success)

---

## Files Updated

### 4. `src/app/api/analytics/projects/[projectId]/profile/route.ts`

**Changes:**
- Removed references to `INTENT_CATEGORIES`, `VISUAL_THEMES`, `DOMAIN_TAGS`, `COMPLEXITY_LEVELS`
- Now aggregates actual fields: subjects, styles, moods, colors, techniques
- Returns `ProjectSemanticFingerprint` with real data

### 5. `src/app/api/analytics/funnels/route.ts`

**Changes:**
- Changed default dimension from `'intent'` to `'subject'`
- Updated dimension extraction to use `profile.subjects[0]` instead of `profile.intent`
- Updated docs: `dimension: 'subject' | 'model' | 'project'` (was `'intent' | 'model' | 'project'`)

### 6. `src/app/api/analytics/insights/route.ts`

**Changes:**
- Removed efficiency fetch (`/api/analytics/efficiency`)
- Removed efficiency data from `insightInput`
- Removed spending data aggregation
- Changed from `intentFunnelsRes` to `subjectFunnelsRes`
- Updated fetch URL: `dimension=subject` (was `dimension=intent`)

### 7. `src/app/(dashboard)/analytics/page.tsx`

**Removed:**
- `efficiency` state
- Efficiency fetching in `useEffect`
- Entire "Quality & Efficiency" card (90+ lines)
- All efficiency UI components (completion rate, assets per dollar, semantic coverage, cost per asset, value scores)

**Kept:**
- Insights section (now shows pattern-based insights)
- Usage distribution
- Model cards
- Spending breakdown (admin only)
- Semantic analysis controls (admin only)

---

## New Analytics Philosophy

### Before
- **Framing:** Efficiency, waste, cost-per-asset, value-per-dollar
- **Implied:** Iteration is bad, you should minimize generations
- **Metrics:** Punished exploration behavior

### After
- **Framing:** Exploration patterns, convergence signals, creative territory
- **Implied:** Iteration is valuable, exploration before convergence is normal
- **Metrics:** Descriptive patterns without judgment

---

## Example Insights (Before vs After)

### Before (Removed)
❌ "Project X: Low Completion Rate - High iteration (45 generations) but only 8.2% result in downloads. This suggests prompt drift or unclear goals."
❌ "High Cost Per Completed Asset - Each downloaded asset costs $1.87 on average. With 5.2x generation-to-download ratio, efficiency could be improved."
❌ "Model Y: Low Value-to-Volume Ratio - 87 generations with only 12.4% download rate suggests outputs aren't meeting expectations."

### After (New)
✅ "Project X: Broad Exploration - 45 generations with 18.2% reaching engagement. This suggests wide exploration—you may still be finding the direction."
✅ "Primary Creative Territory - Your work clusters around portrait subjects with cinematic styling. This is your most-explored creative space."
✅ "High-Value Subject Pattern - Landscape subjects convert to keepers at 68%—significantly higher than average. This may be your quality signature."
✅ "Model A: Creative Territory - This model is your primary choice for architectural subjects (28 generations). It has established territory in your workflow."

---

## API Changes

### Endpoints Removed
- `GET /api/analytics/efficiency` - Entire endpoint deleted

### Endpoints Updated
- `GET /api/analytics/funnels` - Default dimension changed from `intent` to `subject`
- `GET /api/analytics/insights` - No longer fetches efficiency data
- `GET /api/analytics/projects/[projectId]/profile` - Returns subjects/styles/moods/colors/techniques

### Query Parameters Changed
- `?dimension=subject|model|project` (was `?dimension=intent|model|project`)

---

## Data Flow (After)

```
claudeParsed (actual schema)
    ↓
extractSemanticProfile
    ↓
subjects, styles, moods, colors, techniques
    ↓
┌─────────────────────────────────────┐
│ • Project Semantic Fingerprint      │
│ • Convergence Signals               │
│ • Model Affinity                    │
│ • Exploration Breadth               │
└─────────────────────────────────────┘
    ↓
Pattern-Based Insights
    ↓
Analytics UI (exploration-focused)
```

---

## Success Criteria

✅ **No efficiency/waste framing** - All language is neutral/descriptive
✅ **Schema fixed** - Uses actual claudeParsed fields, no phantom data
✅ **Exploration celebrated** - Iteration is framed as valuable work
✅ **Patterns surfaced** - What users make, where they converge, model affinity
✅ **No linter errors** - All code clean

---

## Files Still Using Old Insights (Optional Future Cleanup)

These files may still reference the old insight types but aren't critical:
- Any external components that import from `@/lib/analytics/insights`

The core analytics flow is now pattern-based with no efficiency framing.
