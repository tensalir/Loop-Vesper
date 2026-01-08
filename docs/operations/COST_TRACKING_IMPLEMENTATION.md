# Cost Tracking Implementation

## Overview

This implementation adds cost tracking for AI model API usage, allowing admins to monitor spending across different providers (Gemini, Replicate, FAL.ai).

## Features

1. **Cost Calculation**: Automatic cost calculation for each generation based on model type
2. **Spending Analytics API**: Endpoint to get spending breakdown by provider and model
3. **Navbar Spending Tracker**: Admin-only widget in the navbar showing total spending with hover details
4. **Database Schema**: Added `cost` field to `Generation` model

## Database Changes

### Schema Update

Added `cost` field to the `Generation` model:
```prisma
cost Decimal? @db.Decimal(10, 6) // Cost in USD (e.g., 0.010000 for $0.01)
```

**To apply the schema change:**
```bash
npx prisma migrate dev --name add_cost_tracking
# or
npx prisma db push
```

## Cost Calculation

### Pricing Models

**Gemini:**
- Nano Banana Pro (Image): ~$0.01 per image
- Veo 3.1 (Video): ~$0.05 per second of video

**Replicate:**
- Seedream 4: ~$0.00075 per second (estimated, based on typical compute time)
- Reve: ~$0.00075 per second (estimated)

**FAL.ai:**
- Seedream 4: ~$0.00075 per second (estimated)

### Implementation

Costs are calculated in `lib/cost/calculator.ts` and stored when a generation completes in `app/api/generate/process/route.ts`.

## API Endpoints

### GET `/api/analytics/spending` (Admin Only)

Returns spending breakdown:
```json
{
  "totalCost": 12.45,
  "totalGenerations": 150,
  "providerBreakdown": [
    {
      "provider": "Gemini",
      "totalCost": 8.50,
      "generationCount": 85,
      "models": [
        {
          "modelName": "Nano Banana Pro",
          "cost": 6.00,
          "generationCount": 60
        }
      ]
    }
  ],
  "dailyBreakdown": [...],
  "lastUpdated": "2024-01-15T10:30:00Z"
}
```

## UI Components

### SpendingTracker Component

Located at `components/navbar/SpendingTracker.tsx`:

- Only visible to admin users
- Shows dollar icon with total cost badge
- Hover/Popover shows detailed breakdown:
  - Total spending
  - Breakdown by provider (Gemini, Replicate, FAL.ai)
  - Breakdown by model within each provider
- Auto-refreshes every 30 seconds

## Making Users Admin

To make `vince@thoughtform.co` an admin, run the SQL in Supabase:

```sql
UPDATE profiles 
SET role = 'admin' 
WHERE id IN (
  SELECT id 
  FROM auth.users 
  WHERE email = 'vince@thoughtform.co'
);
```

Or use the migration file: `prisma/migrations/make_vince_admin.sql`

## Integration Points

The spending tracker is currently integrated into:
- `/projects` page navbar

To add to other pages (like project detail page), import and use:
```tsx
import { SpendingTracker } from '@/components/navbar/SpendingTracker'

// In your component:
const [isAdmin, setIsAdmin] = useState(false)

// Fetch profile to check admin status
useEffect(() => {
  fetch('/api/profile')
    .then(r => r.json())
    .then(profile => setIsAdmin(profile.role === 'admin'))
}, [])

// In JSX:
<SpendingTracker isAdmin={isAdmin} />
```

## Notes

1. **Cost Estimates**: Replicate and FAL.ai costs are estimates based on typical compute times. For exact costs, you would need to capture actual compute time from the API responses.

2. **Historical Data**: Costs are only tracked for new generations after this implementation. Historical generations will have `cost = null`.

3. **Failed Generations**: Failed generations may have a cost if they reached the API call stage before failing. You may want to exclude failed generations from spending calculations.

4. **Pricing Updates**: Pricing may change over time. Update `lib/cost/calculator.ts` if providers change their pricing.

