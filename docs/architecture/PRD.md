# Latentia - Product Requirements Document (PRD)

## Version 1.0 | October 2025

---

## 1. Executive Summary

**Latentia** is a next-generation generative AI web platform that functions as a unified interface for multiple state-of-the-art AI image and video generation models. Unlike existing tools like Krea, Latentia introduces a project-centric organizational structure that enables teams to collaborate effectively on creative work with proper hierarchy and session management.

### Core Value Proposition
- **Project-based organization**: Move beyond single sessions to organized, multi-session projects
- **True team collaboration**: Private/Shared toggle for real-time collaborative workflows
- **Dual interface paradigm**: Chat-based and node-based workflows in one platform
- **Model agnostic**: Seamless access to multiple SOTA models without platform switching
- **Production-ready**: Built for creative studios and professional teams

---

## 2. Product Vision & Goals

### Vision
To become the de facto creative workspace for AI-generated media, enabling seamless collaboration and iteration across the best AI models available.

### Goals
1. **Phase 1 (MVP)**: Launch with 4-5 core models, project management, and chat interface
2. **Phase 2**: Add node-based interface and real-time collaboration
3. **Phase 3**: Expand model library to 15+ models with advanced workflows
4. **Phase 4**: API access and enterprise features

---

## 3. User Personas

### Primary: Studio Creative Lead
- **Profile**: Design/creative director managing multiple projects simultaneously
- **Pain Points**: Krea's flat session structure makes project organization difficult
- **Needs**: Clear project hierarchy, team collaboration, reusable prompts

### Secondary: Individual Creator
- **Profile**: Freelance designer/artist exploring multiple concepts
- **Pain Points**: Juggling multiple tabs and tools for different models
- **Needs**: Single workspace, model comparison, iteration history

### Tertiary: Technical Artist
- **Profile**: Users comfortable with node-based workflows (ComfyUI users)
- **Pain Points**: Chat interfaces feel limiting for complex workflows
- **Needs**: Node-based interface with full parameter control

---

## 4. Core Features & Functionality

### 4.1 Project Management System

#### Projects (Top Level)
- **Purpose**: Container for all work related to a specific brief, campaign, or concept
- **Attributes**:
  - Name
  - Description
  - Cover image (auto-generated from first session output)
  - Created date / Modified date
  - Privacy setting: Private (default) or Shared
  - Members (for shared projects)
  - Tags/labels for organization
  
#### Sessions (Second Level)
- **Purpose**: Individual workstreams within a project (e.g., "Character concepts", "Background variations")
- **Attributes**:
  - Name
  - Type: Image or Video
  - Model used
  - Generation history (all prompts + outputs)
  - Session settings snapshot
  - Created date / Modified date
  
#### Data Hierarchy
```
Project "Spring Campaign 2025"
├── Session: "Product shots - Red variant" (Image)
│   ├── Generation 1: Flux, prompt, 4 images
│   ├── Generation 2: Krea, prompt, 4 images
│   └── ...
├── Session: "Product shots - Blue variant" (Image)
├── Session: "Lifestyle video concepts" (Video)
└── Session: "Final hero images" (Image)
```

### 4.2 Home Page (Dashboard)

#### Layout
- **Header**: Latentia logo, user profile, settings, notifications
- **Main area**: Project grid/list view
- **Actions**: 
  - "New Project" button (prominent)
  - "Shared with me" tab
  - Search/filter projects

#### Project Cards
- Project name
- Thumbnail (most recent generation)
- Last modified timestamp
- Privacy indicator (lock icon for private, people icon for shared)
- Number of sessions
- Quick actions: Open, Duplicate, Share, Delete

### 4.3 Generation Interface (Chat-based)

This is the primary workspace where users generate content.

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Header: Project name | Session tabs | [Image/Video toggle]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│                                                               │
│                    GENERATION GALLERY                         │
│                                                               │
│              [Image Grid - 2x2 or 4x1 layout]                │
│                                                               │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ Chat Input | [Aspect Ratio] [Resolution] [📎 Image] [...] │ Generate│
└─────────────────────────────────────────────────────────────┘

Left sidebar (collapsible):
┌────────────────┐
│  SESSIONS      │
│  + New         │
│  ─────────────│
│  📸 Session 1  │
│  📸 Session 2  │
│  🎬 Video 1    │
└────────────────┘

Bottom left corner:
┌────────────────┐
│  MODEL PICKER  │
│  ★ Flux Pro    │  <- Pinned
│  ★ Krea        │  <- Pinned
│  ─────────────│
│  Seedream 4.0  │
│  Nano Banana   │
│  ...           │
└────────────────┘
```

#### Key UI Components

**1. Top Bar**
- Project name (clickable breadcrumb to return to home)
- Session tabs (horizontal scroll if many sessions)
- Image/Video mode toggle (pills)
- Settings icon (project settings, members, privacy)

**2. Generation Gallery**
- Grid layout (responsive, 2x2 default)
- Each generated image/video shows:
  - The media itself
  - Hover overlay with action buttons:
    - 🔄 Reuse parameters (primary action)
    - ⬇️ Download
    - ⭐ Star/favorite
    - 🗑️ Delete
    - 📋 Copy prompt
    - ℹ️ View metadata (model, settings, timestamp)
  - Small badge in corner showing model used

**3. Chat Input Area**
- Multi-line text input (expands as needed)
- Left side buttons (inline):
  - Aspect ratio selector: 1:1, 16:9, 9:16, 4:3, 3:4, custom
  - Resolution selector: Low (512), Medium (1024), High (2048)
  - 📎 Upload reference image button
  - ... More options (strength, steps, seed, etc. - model-dependent)
- Right side:
  - Large "Generate" button (primary CTA)
  - Generation count indicator (4 images default, configurable)

**4. Sessions Sidebar (Left)**
- Collapsible panel
- List of all sessions in current project
- Each session shows:
  - Icon (📸 for image, 🎬 for video)
  - Name (editable inline)
  - Thumbnail of latest generation
  - Timestamp
- "+ New Session" button at top
- Active session highlighted

**5. Model Picker (Bottom Left)**
- Modal/dropdown that opens when clicked
- Two sections:
  - **Pinned Models** (user can drag to reorder)
  - **All Models** (searchable, categorized)
- Each model shows:
  - Name
  - Icon/logo
  - Short description
  - Speed indicator (⚡ fast, 🐢 slow)
  - Pin/unpin star button
- Currently selected model highlighted

#### "Reuse Parameters" Flow

When user clicks 🔄 on a generated image:
1. Chat input populates with the exact prompt
2. Model picker auto-selects the model used
3. All settings restore (aspect ratio, resolution, seed, etc.)
4. Reference image (if any) reloads
5. User can now edit and regenerate

### 4.4 Generation Interface (Video Mode)

When toggled to Video mode:
- Sessions sidebar shows only video sessions (or allows creating new)
- Chat input area adds video-specific controls:
  - Duration (5s, 10s, 15s)
  - Frame rate (24fps, 30fps)
  - Start frame (for image-to-video)
  - End frame (for video interpolation)
  - Camera motion controls (if model supports)
- Gallery shows video thumbnails with play button
- Hover shows scrub preview

### 4.5 Node-Based Interface (Alternative View)

Accessible via toggle in top-right corner of generation interface.

#### Canvas Layout
- Infinite canvas (pan/zoom)
- Node types:
  - **Input nodes**: Text prompt, Image upload, Video upload
  - **Model nodes**: Flux, Krea, Seedream, etc. (draggable from library)
  - **Parameter nodes**: Aspect ratio, resolution, strength, steps
  - **Processing nodes**: Upscale, edit, mask, blend
  - **Output nodes**: Display, download, save to session
- Connection lines between nodes (click and drag)
- Right-click context menu for quick actions
- Node library panel (left side, searchable)
- Mini-map (bottom right corner)

#### Workflow Templates
- Pre-built workflows for common tasks:
  - "Simple text-to-image"
  - "Image-to-image variation"
  - "Style transfer"
  - "Video generation from image"
  - "Upscale and enhance"
- Users can save custom workflows

### 4.6 Real-Time Collaboration

When a project is set to "Shared":
- **Multiplayer cursors**: See where other users are clicking
- **Live generations**: New outputs appear in real-time for all users
- **Presence indicators**: See who's online in the project
- **Activity feed**: "User X generated in Session Y"
- **Permissions**: Owner can assign roles (Viewer, Editor, Admin)

### 4.7 Model Integration Strategy

#### Supported Models (Phase 1)
1. **Flux 1.1 Pro** (Black Forest Labs)
   - Type: Image
   - Strengths: Balanced photo/creative, fast
   - Options: Standard (prompt, aspect ratio, resolution, seed)
   
2. **Krea Realtime** (Krea.ai)
   - Type: Image
   - Strengths: Fast iterations, photorealism
   - Options: Standard + style presets
   
3. **Seedream 4.0** (Seed Studio)
   - Type: Image + Video
   - Strengths: Multimodal, high quality
   - Options: Standard + image prompt support
   
4. **Nano Banana** (Minimax)
   - Type: Image
   - Strengths: Smart editing, context-aware
   - Options: Standard + edit mode

5. **Minimax Video** (Minimax)
   - Type: Video
   - Strengths: Long-form video (up to 6s)
   - Options: Prompt, duration, resolution, start frame

#### API Wrapper Architecture
Each model requires:
- Authentication handler (API key management)
- Request formatter (convert UI params to API format)
- Response parser (normalize output format)
- Error handler (user-friendly error messages)
- Rate limiter (respect API quotas)
- Cost estimator (show estimated credits/cost before generation)

#### Model Configuration Schema
```json
{
  "model_id": "flux_1_1_pro",
  "name": "Flux 1.1 Pro",
  "provider": "Black Forest Labs",
  "type": ["image"],
  "capabilities": {
    "prompt_to_image": true,
    "image_to_image": true,
    "inpainting": false,
    "outpainting": false
  },
  "parameters": {
    "aspect_ratio": {
      "type": "select",
      "options": ["1:1", "16:9", "9:16", "4:3", "3:4"],
      "default": "1:1"
    },
    "resolution": {
      "type": "select",
      "options": [512, 1024, 2048],
      "default": 1024
    },
    "num_outputs": {
      "type": "number",
      "min": 1,
      "max": 4,
      "default": 4
    },
    "seed": {
      "type": "number",
      "optional": true
    }
  },
  "api_endpoint": "https://api.blackforestlabs.ai/v1/flux-1.1-pro",
  "pricing": {
    "per_image": 0.04,
    "currency": "USD"
  }
}
```

This schema-driven approach allows adding new models by just adding configuration files.

---

## 5. Technical Architecture

### 5.1 Tech Stack (Recommended)

#### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **UI Library**: React 18+
- **Styling**: Tailwind CSS + shadcn/ui components
- **Canvas**: React Flow (for node-based interface)
- **State Management**: Zustand (lightweight, no boilerplate)
- **Real-time**: Supabase Realtime (WebSocket)
- **Image handling**: Sharp (server-side), Fabric.js (client-side editing)

#### Backend
- **API Routes**: Next.js API routes (serverless)
- **Database**: Supabase (PostgreSQL + Auth + Realtime + Storage)
- **ORM**: Prisma (type-safe database access)
- **File Storage**: Supabase Storage (S3-compatible)
- **Caching**: Vercel Edge Config or Redis

#### Authentication
- **Provider**: Supabase Auth
- **Methods**:
  - Email/Password
  - Magic Link
  - OAuth (Google, GitHub, Discord)
  - SSO (SAML for enterprise)

#### Deployment
- **Hosting**: Vercel (optimized for Next.js)
- **CDN**: Vercel Edge Network
- **Domain**: latentia.ai
- **Environment**: Production, Staging, Development

### 5.2 Database Schema

```sql
-- Users (managed by Supabase Auth)
-- auth.users table is built-in

-- User profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  is_shared BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Project members (for shared projects)
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Generations
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  model_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  parameters JSONB NOT NULL, -- Flexible params per model
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Outputs (individual images/videos from a generation)
CREATE TABLE outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generation_id UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('image', 'video')),
  width INTEGER,
  height INTEGER,
  duration FLOAT, -- For videos
  is_starred BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Model configurations
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  type TEXT[] NOT NULL, -- ['image', 'video']
  config JSONB NOT NULL, -- Full model configuration
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User model pins
CREATE TABLE user_model_pins (
  user_id UUID NOT NULL REFERENCES auth.users(id),
  model_id TEXT NOT NULL REFERENCES models(id),
  pin_order INTEGER NOT NULL,
  PRIMARY KEY(user_id, model_id)
);

-- Workflows (for node-based interface)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  is_template BOOLEAN DEFAULT false,
  workflow_data JSONB NOT NULL, -- Node graph structure
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 5.3 API Structure

```
/api
├── /auth
│   ├── /signup
│   ├── /login
│   ├── /logout
│   └── /callback (OAuth)
├── /projects
│   ├── GET / (list projects)
│   ├── POST / (create project)
│   ├── GET /:id
│   ├── PATCH /:id
│   ├── DELETE /:id
│   └── POST /:id/share (share project)
├── /sessions
│   ├── GET /?project_id=xxx
│   ├── POST /
│   ├── GET /:id
│   ├── PATCH /:id
│   └── DELETE /:id
├── /generate
│   ├── POST /image
│   └── POST /video
├── /models
│   ├── GET / (list all models)
│   ├── GET /:id (model details)
│   └── POST /pins (update user pins)
├── /outputs
│   ├── GET /:id
│   ├── PATCH /:id (star/unstar)
│   └── DELETE /:id
└── /workflows
    ├── GET /
    ├── POST /
    ├── GET /:id
    └── PATCH /:id
```

### 5.4 External API Integrations

Each model provider requires:
1. API key storage (environment variables)
2. Webhook endpoint for async generation callbacks
3. Error handling and retry logic
4. Rate limiting and queue management

#### Integration Priority (Phase 1)
1. **Flux** - Black Forest Labs API
2. **Replicate** - For Flux and other models
3. **Seedream** - Via their API
4. **Minimax** - For Nano Banana and Video

---

## 6. User Flows

### 6.1 First-Time User Flow
1. Land on landing page (latentia.ai)
2. Click "Get Started"
3. Choose auth method (Google OAuth recommended)
4. Onboarding:
   - Welcome message
   - "Create your first project" prompt
   - Quick tutorial (optional, dismissible)
5. Redirected to generation interface with sample prompt

### 6.2 Creating and Using a Project
1. From home, click "New Project"
2. Modal appears: "Project name" input
3. Project created, redirected to generation interface
4. First session auto-created ("Session 1")
5. User selects model from picker
6. User enters prompt
7. User clicks "Generate"
8. Loading state (progress bar)
9. Results appear in gallery
10. User clicks 🔄 on an image
11. Prompt reloads, user edits, regenerates

### 6.3 Collaboration Flow
1. User A creates project
2. Clicks settings icon → "Share project"
3. Enters User B's email
4. User B receives email notification
5. User B clicks link, added to project
6. User B sees project in "Shared with me"
7. Both users can see each other's generations in real-time

### 6.4 Node-Based Workflow
1. User toggles to "Node view"
2. Canvas appears with starter node (prompt input)
3. User drags "Flux" model node from library
4. User connects prompt to model
5. User adds output node
6. User clicks "Run workflow"
7. Results stream into output node
8. User saves workflow as template

---

## 7. UI/UX Specifications

### 7.1 Design System

#### Color Palette
- **Primary**: Vibrant purple/blue gradient (modern AI aesthetic)
- **Background**: Dark mode default (toggleable)
  - Dark: #0A0A0A (almost black)
  - Surface: #1A1A1A
  - Elevated: #2A2A2A
- **Accent**: Cyan #00D9FF for CTAs
- **Text**: 
  - Primary: #FFFFFF
  - Secondary: #A0A0A0
  - Muted: #606060

#### Typography
- **Font**: Inter (clean, modern, excellent readability)
- **Headings**: 600 weight
- **Body**: 400 weight
- **Code**: Fira Code (for technical details)

#### Spacing
- Base unit: 4px
- Small: 8px
- Medium: 16px
- Large: 24px
- XL: 32px

#### Components
Use shadcn/ui for consistency:
- Buttons
- Inputs
- Dropdowns
- Modals
- Tooltips
- Cards

### 7.2 Responsive Design

#### Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

#### Mobile Adaptations
- Sessions sidebar becomes bottom sheet
- Model picker becomes full-screen modal
- Gallery switches to single column
- Chat input remains fixed at bottom
- Node view disabled (too complex for small screens)

### 7.3 Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation for all interactions
- Screen reader labels
- Focus indicators
- High contrast mode option

---

## 8. Non-Functional Requirements

### 8.1 Performance
- **Initial load**: < 2s (LCP)
- **Generation latency**: Display results as soon as API returns (streaming if possible)
- **Image optimization**: Serve WebP with fallback, lazy loading
- **Caching**: Aggressive caching for generated images (CDN)

### 8.2 Security
- **API keys**: Never exposed to client, stored in environment variables
- **RLS**: Row-level security in Supabase (users can only access their projects)
- **File upload**: Validate file types and sizes, scan for malware
- **Rate limiting**: Prevent abuse (per user, per endpoint)

### 8.3 Scalability
- **Concurrent users**: Support 10,000+ concurrent users (Phase 2)
- **Storage**: Unlimited via Supabase/S3
- **Queue**: Use BullMQ for generation queue (if needed)

### 8.4 Monitoring & Analytics
- **Error tracking**: Sentry
- **Analytics**: Posthog (privacy-focused)
- **Uptime**: Vercel monitoring
- **Metrics**: Generation count, session length, model usage

---

## 9. Development Phases

### Phase 1: MVP (8-10 weeks)
**Goal**: Launch with core functionality for individual users

**Week 1-2: Setup & Foundation**
- Initialize Next.js project
- Set up Supabase (database, auth, storage)
- Create database schema
- Implement authentication (email/password, Google OAuth)
- Basic UI shell (header, nav, routing)

**Week 3-4: Project & Session Management**
- Home page (project grid)
- Create/edit/delete projects
- Create/edit/delete sessions
- Sessions sidebar
- Basic project settings

**Week 5-7: Generation Interface (Chat-based)**
- Chat input area
- Model picker (with pins)
- Parameter controls (aspect ratio, resolution)
- Image upload
- Gallery grid
- Hover actions (download, star, delete)
- "Reuse parameters" functionality

**Week 8-9: Model Integrations**
- Integrate Flux via Replicate
- Integrate Krea (if API available, or use Replicate alternative)
- Integrate Seedream
- Integrate Nano Banana
- Error handling and loading states

**Week 10: Polish & Testing**
- Bug fixes
- UI polish (animations, transitions)
- Mobile responsive adjustments
- User testing with small group
- Deploy to Vercel production

**Launch**: Soft launch to early adopters

---

### Phase 2: Collaboration & Advanced Features (6-8 weeks)

**Week 1-2: Real-Time Collaboration**
- Shared projects (invite system)
- Multiplayer cursors (Supabase Realtime)
- Live generation updates
- Presence indicators
- Activity feed

**Week 3-4: Video Generation**
- Video mode toggle
- Video-specific model integrations (Minimax Video, Seedream Video)
- Video player with scrubbing
- Video download

**Week 5-6: Node-Based Interface**
- Canvas setup (React Flow)
- Node library (model nodes, parameter nodes, etc.)
- Connection logic
- Workflow execution
- Save/load workflows

**Week 7-8: Enhanced Features**
- Image editing tools (crop, mask, inpaint)
- Generation history search
- Export project as ZIP
- API documentation (for future API access)

**Launch**: Public beta

---

### Phase 3: Expansion (Ongoing)

- Add 10+ more models (Stable Diffusion, Midjourney API, etc.)
- Advanced workflow templates
- Team workspaces
- Usage analytics dashboard
- Public sharing (gallery)
- Model comparison view (generate with multiple models at once)
- Batch generation
- API access for developers
- Enterprise SSO and compliance

---

## 10. Success Metrics (KPIs)

### User Acquisition
- Weekly signups
- Activation rate (users who create first project)
- Referral rate

### Engagement
- DAU/MAU ratio
- Average sessions per user
- Average generations per session
- Retention (D1, D7, D30)

### Product
- Model usage distribution
- Reuse parameters click rate
- Shared project adoption
- Node-based interface usage

### Business (Future)
- MRR (when monetization added)
- Churn rate
- LTV:CAC ratio

---

## 11. Risks & Mitigations

### Risk 1: API Reliability
- **Risk**: Third-party model APIs may be unreliable or slow
- **Mitigation**: Implement queue system, retry logic, and status updates

### Risk 2: Cost Overruns
- **Risk**: API costs may be high with free tier
- **Mitigation**: Implement usage limits, consider freemium model early

### Risk 3: Differentiation
- **Risk**: Krea or FloraFauna may copy project-based structure
- **Mitigation**: Focus on execution quality, UX polish, and unique workflows

### Risk 4: Model Access
- **Risk**: Some models (Krea) may not have public APIs
- **Mitigation**: Use Replicate or similar aggregators, or skip and use alternatives

---

## 12. Open Questions

1. **Pricing model**: How will we monetize? (Freemium, subscription, credit-based?)
2. **Storage limits**: How much storage per user? Expire old generations?
3. **Moderation**: Do we need content moderation for NSFW/harmful content?
4. **Branding**: Final logo, color scheme refinement
5. **Terms of Service**: Who owns generated content? (User owns, standard IP assignment)

---

## 13. Appendix

### A. Competitive Analysis

| Feature | Krea | FloraFauna | Latentia |
|---------|------|------------|----------|
| Project organization | ❌ (sessions only) | ✅ | ✅ |
| Multi-model support | ✅ | ✅ | ✅ |
| Real-time collaboration | ❌ | ✅ | ✅ |
| Node-based interface | ❌ | ✅ | ✅ |
| Chat-based interface | ✅ | ❌ | ✅ (both!) |
| Reuse parameters | ✅ | ? | ✅ (enhanced) |
| Video generation | ✅ | ❌ | ✅ |
| Pinned models | ❌ | ? | ✅ |

**Latentia's unique value**: Combines the best of both worlds (chat + nodes) with superior organization.

### B. Technology References

- **Next.js 14 Docs**: https://nextjs.org/docs
- **Supabase Docs**: https://supabase.com/docs
- **React Flow**: https://reactflow.dev/
- **shadcn/ui**: https://ui.shadcn.com/
- **Replicate API**: https://replicate.com/docs
- **Black Forest Labs**: https://blackforestlabs.ai/

### C. Inspiration Gallery

- Krea.ai: Session-based generation UI
- FloraFauna.ai: Infinite canvas, multiplayer
- ComfyUI: Node-based workflows
- Runway: Video generation UI
- Midjourney: Discord bot prompting (for chat UX ideas)

---

## Document Control

**Author**: Latentia Product Team  
**Version**: 1.0  
**Last Updated**: October 24, 2025  
**Status**: Draft - Awaiting Approval  
**Next Review**: After stakeholder feedback

---

*This PRD is a living document and will be updated as the product evolves.*

