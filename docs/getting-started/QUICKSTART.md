# Latentia - Quick Start Cheat Sheet

## 🚀 TL;DR - Get Running in 5 Minutes

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env.local

# 3. Edit .env.local with your Supabase credentials (see below)

# 4. Push database schema
npm run prisma:push

# 5. Run development server
npm run dev
```

## 📝 What You Need in .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUz...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1...
DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Where to Get These:

1. **Supabase URL & Keys**: 
   - supabase.com → Your Project → Settings → API

2. **Database URL**: 
   - supabase.com → Your Project → Settings → Database → Connection String → URI
   - Replace `[YOUR-PASSWORD]` with your database password

## 🏃 NPM Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

npm run prisma:push      # Push schema to database
npm run prisma:generate  # Generate Prisma client
npm run prisma:studio    # Open Prisma Studio (database GUI)
```

## 🌐 Default URLs

- **App**: http://localhost:3000
- **Prisma Studio**: http://localhost:5555 (when running)

## 📊 Project Structure

```
app/
  (auth)/login         → Login page
  (auth)/signup        → Signup page  
  projects/            → Projects dashboard
  projects/[id]        → Generation workspace
  api/projects         → Project CRUD
  api/sessions         → Session CRUD

components/
  ui/                  → shadcn/ui components
  projects/            → Project components
  generation/          → Generation interface

lib/
  supabase/            → Supabase clients
  api/                 → API helpers
```

## 🔑 Key Files

- **`prisma/schema.prisma`**: Database schema
- **`middleware.ts`**: Auth protection
- **`app/projects/[id]/page.tsx`**: Main workspace
- **`components/generation/GenerationInterface.tsx`**: Core generation UI

## 🐛 Common Issues

### "Can't reach database server"
```bash
# Check your DATABASE_URL
# Make sure password is URL-encoded if it has special chars
```

### "Invalid API key"
```bash
# Double-check SUPABASE_ANON_KEY
# Restart dev server after changing .env.local
```

### "Prisma Client could not locate Query Engine"
```bash
npm run prisma:generate
```

### "Port 3000 already in use"
```bash
# Kill the process
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm run dev
```

## 🎯 Quick Test Checklist

- [ ] Server starts without errors
- [ ] Navigate to http://localhost:3000
- [ ] Redirected to `/login`
- [ ] Sign up with email
- [ ] Check email for confirmation
- [ ] Confirm email
- [ ] Log in
- [ ] Create a project
- [ ] Open project
- [ ] See generation interface
- [ ] Select model from picker
- [ ] Enter prompt
- [ ] Adjust parameters
- [ ] (Generation won't work yet - AI models not integrated)

## 📚 Documentation

- **Full Setup**: [SETUP.md](./SETUP.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Progress**: [PROGRESS.md](./PROGRESS.md)
- **Summary**: [SUMMARY.md](./SUMMARY.md)
- **PRD**: [PRD.md](./PRD.md)

## 🆘 Need Help?

1. Check [SETUP.md](./SETUP.md) for detailed instructions
2. Check [PROGRESS.md](./PROGRESS.md) for what's implemented
3. Check [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details

## 🎉 You're All Set!

Your Latentia instance should now be running. Time to start building! 🚀

