# User Roles & Settings Page Setup

## Overview

This update adds a comprehensive settings page with user roles (Admin vs Normal Users) and analytics.

## Features Added

### 1. Settings Page (`/settings`)
- **Account Tab**: Email, display name, username, and password change
- **Analytics Tab**: Usage statistics, model usage, generation counts

### 2. User Roles System
- **Admin**: Full access to all features (indicated with badge)
- **User**: Normal user with standard permissions

### 3. Analytics Dashboard
- Total generations count
- Images vs Videos breakdown
- Top 10 most-used models with percentages
- Placeholder for future analytics features

## Database Changes

### New Enum Type
```sql
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');
```

### Updated Profile Table
- `role` column now uses `UserRole` enum instead of string
- Default value: `user`

## Setup Instructions

### 1. Apply Database Migration

**Run the migration in Supabase SQL Editor**:
```sql
-- Copy and paste the contents of prisma/migrations/add_user_roles.sql
```

Or use Prisma migrate (if configured):
```bash
npx prisma migrate dev --name add_user_roles
```

### 2. Generate Prisma Client

```bash
npx prisma generate
```

### 3. Set Admin Users

To make a user an admin, run this SQL in Supabase:
```sql
UPDATE profiles 
SET role = 'admin' 
WHERE id = 'YOUR_USER_ID_HERE';
```

To find your user ID:
```sql
SELECT id, display_name, email 
FROM profiles 
JOIN auth.users ON profiles.id = auth.users.id;
```

## Usage

### Accessing Settings
Click the settings icon (cogwheel) in the navigation to open `/settings`.

### Admin Badge
Admin users will see a purple badge at the top of their account settings indicating their admin status.

### Analytics
The analytics tab shows:
- Total generations
- Images generated
- Videos generated  
- Top models by usage

## API Endpoints

### New Endpoints
- `GET /api/analytics/usage` - Get user usage statistics

### Updated Endpoints
- `GET /api/profile` - Returns user role
- `PATCH /api/profile` - Update display name and username

## User Role Usage in Code

```typescript
import { UserRole } from '@prisma/client'

// Check if user is admin
if (profile.role === UserRole.admin) {
  // Admin-only features
}

// Type-safe role checking
const isAdmin = profile.role === 'admin'
```

## Future Enhancements

Planned analytics features:
- Generation trends over time (charts)
- Most used prompts and keywords
- Average generation time
- Collaboration statistics
- Export and download reports

## Security Notes

- Only admins should be able to promote other users to admin
- User role changes should be logged for audit purposes
- Consider adding role-based middleware for protected routes

