# Phase 0: Clone, Archive & Cleanup

## Overview
**Goal**: Start fresh by cloning the repository, archiving the old one, and removing all unnecessary code before any feature work begins.

**Duration**: ~4-6 hours  
**Prerequisites**: GitHub access, Git CLI

---

## Tasks

### Task 0.1: Create New Repository
**Priority**: 🔴 Critical  
**Estimated Time**: 15 minutes

**Description**: Create a new repository for the v2 codebase.

**Steps**:
1. Create new GitHub repository named `ShelvesAI` (or preferred name)
2. Do NOT initialize with README (we'll push existing code)
3. Note the new repository URL

**Acceptance Criteria**:
- [ ] New empty repository created on GitHub
- [ ] Repository URL documented

---

### Task 0.2: Clone and Push to New Repository
**Priority**: 🔴 Critical  
**Estimated Time**: 15 minutes

**Description**: Clone the current Collector repo and push to the new repository.

**Steps**:
```bash
# Clone current repo
git clone https://github.com/YOUR_USERNAME/Collector.git ShelvesAI
cd ShelvesAI

# Remove old origin and add new
git remote remove origin
git remote add origin https://github.com/YOUR_USERNAME/ShelvesAI.git

# Push all branches and tags
git push -u origin main
git push --all origin
git push --tags origin
```

**Acceptance Criteria**:
- [ ] Code pushed to new repository
- [ ] All branches preserved
- [ ] All tags preserved

---

### Task 0.3: Archive Original Repository
**Priority**: 🟡 Medium  
**Estimated Time**: 5 minutes

**Description**: Archive the original Collector repository to prevent changes.

**Steps**:
1. Go to original Collector repo on GitHub
2. Settings → General → Danger Zone
3. Click "Archive this repository"
4. Confirm archive

**Acceptance Criteria**:
- [ ] Original repo marked as archived
- [ ] Repo is now read-only

---

### Task 0.4: Delete Frontend Directory
**Priority**: 🔴 Critical  
**Estimated Time**: 10 minutes

**Description**: Remove the React web frontend as we're going mobile-first.

**Files to Delete**:
```
frontend/
├── .env.local
├── .gitignore
├── README.md
├── backup/
├── dist/
├── eslint.config.js
├── index.html
├── node_modules/
├── package-lock.json
├── package.json
├── public/
├── src/
├── tsconfig.json
└── vite.config.js
```

**Steps**:
```bash
# From repository root
rm -rf frontend/
git add -A
git commit -m "chore: remove web frontend (mobile-first approach)"
```

**Acceptance Criteria**:
- [ ] `frontend/` directory deleted
- [ ] No frontend references remain in root package.json
- [ ] Committed to git

---

### Task 0.5: Delete Plasmic Host Directory
**Priority**: 🔴 Critical  
**Estimated Time**: 5 minutes

**Description**: Remove abandoned Plasmic experiment.

**Files to Delete**:
```
plasmic-host/
├── .env.local
├── dist/
└── node_modules/
```

**Steps**:
```bash
rm -rf plasmic-host/
git add -A
git commit -m "chore: remove plasmic-host (abandoned experiment)"
```

**Acceptance Criteria**:
- [ ] `plasmic-host/` directory deleted
- [ ] Committed to git

---

### Task 0.6: Delete Root Vite App (UI Designer)
**Priority**: 🔴 Critical  
**Estimated Time**: 10 minutes

**Description**: Remove the custom UI designer experiment from root.

**Files to Delete**:
```
src/
├── App.css
├── App.jsx
├── assets/
├── index.css
└── main.jsx

# Also delete root-level files:
index.html
vite.config.js
eslint.config.js
update_canvas.py
tsconfig.base.json
```

**Steps**:
```bash
rm -rf src/
rm -f index.html vite.config.js eslint.config.js update_canvas.py tsconfig.base.json
git add -A
git commit -m "chore: remove root UI designer app"
```

**Acceptance Criteria**:
- [ ] `src/` directory deleted
- [ ] Root config files deleted
- [ ] Committed to git

---

### Task 0.7: Delete UI Editor Backend Routes
**Priority**: 🔴 Critical  
**Estimated Time**: 15 minutes

**Description**: Remove the 562-line UI editor routes and supporting services.

**Files to Delete**:
```
backend/routes/uiEditor.js           (562 lines)
backend/services/ui/                  (4 files)
├── canvasStore.js
├── projectSettingsStore.js
├── publishScreenBundle.js
└── routesStore.js
```

**Steps**:
```bash
rm -f backend/routes/uiEditor.js
rm -rf backend/services/ui/
git add -A
git commit -m "chore: remove UI editor backend routes and services"
```

**Acceptance Criteria**:
- [ ] `uiEditor.js` deleted
- [ ] `backend/services/ui/` deleted
- [ ] Committed to git

---

### Task 0.8: Update Server.js to Remove UI Editor
**Priority**: 🔴 Critical  
**Estimated Time**: 20 minutes

**Description**: Remove UI editor route imports and registration from server.js.

**File**: `backend/server.js`

**Changes**:
1. Remove import:
```diff
- const uiEditorRoutes = require('./routes/uiEditor');
```

2. Remove route registration:
```diff
- app.use('/api/ui-editor', uiEditorRoutes);
```

3. Remove frontend static serving (lines ~204-234):
```diff
- // Serve frontend build with optional env override
- const distPath = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
- ... (entire block)
```

**Steps**:
1. Open `backend/server.js`
2. Remove uiEditorRoutes import (line ~17)
3. Remove route registration (line ~151)
4. Remove frontend static serving block (lines ~204-234)
5. Save and test server starts

```bash
cd backend
npm run dev
# Verify: Server should start without errors
```

**Acceptance Criteria**:
- [ ] UI editor routes removed from server.js
- [ ] Frontend serving removed from server.js
- [ ] Server starts without errors
- [ ] Committed to git

---

### Task 0.9: Rename Backend to API
**Priority**: 🟡 Medium  
**Estimated Time**: 20 minutes

**Description**: Rename `backend/` to `api/` for cleaner structure.

**Steps**:
```bash
# Rename directory
mv backend api

# Update any internal references (if any exist in scripts)
# Check package.json scripts don't break

# Update root package.json if it references backend
# Example: change "cd backend && ..." to "cd api && ..."
```

**Files to Check for References**:
- Root `package.json`
- `README.md`
- `DEPLOY.md`
- `.gitignore`

**Acceptance Criteria**:
- [ ] Directory renamed to `api/`
- [ ] All references updated
- [ ] Server still starts from `cd api && npm run dev`
- [ ] Committed to git

---

### Task 0.10: Clean Up Root Package.json
**Priority**: 🟡 Medium  
**Estimated Time**: 15 minutes

**Description**: Remove frontend-related dependencies and scripts from root package.json.

**File**: `package.json` (root)

**Current Contents Review**:
- Remove any Vite/React dependencies
- Remove frontend-related scripts
- Keep only workspace/monorepo management if needed

**Steps**:
1. Open root `package.json`
2. Remove unused dependencies
3. Update scripts to reflect new structure
4. Run `npm install` to clean up

**Acceptance Criteria**:
- [ ] No frontend dependencies in root
- [ ] Scripts updated for new structure
- [ ] `npm install` runs cleanly
- [ ] Committed to git

---

### Task 0.11: Update .gitignore
**Priority**: 🟢 Low  
**Estimated Time**: 10 minutes

**Description**: Update .gitignore for new project structure.

**File**: `.gitignore`

**Additions**:
```gitignore
# Environment
.env
.env.local
.env.*.local

# Database
*.db
*.sqlite
postgres_data/

# Docker
docker-compose.override.yml

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Dependencies
node_modules/

# Build
dist/
build/

# Logs
*.log
npm-debug.log*

# Google Cloud credentials (never commit!)
*-service-account.json
credentials.json
```

**Acceptance Criteria**:
- [ ] .gitignore updated
- [ ] Sensitive files won't be committed
- [ ] Committed to git

---

### Task 0.12: Update README.md
**Priority**: 🟡 Medium  
**Estimated Time**: 30 minutes

**Description**: Update README to reflect new mobile-first architecture.

**File**: `README.md`

**New Structure**:
```markdown
# ShelvesAI

Mobile-first app for cataloging and sharing physical collections.

## Architecture

- **Mobile**: Expo/React Native app (`/mobile`)
- **API**: Node.js/Express backend (`/api`)
- **Database**: PostgreSQL (self-hosted or cloud)

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- Expo CLI

### Development

# Start database
docker-compose up -d db

# Start API
cd api && npm install && npm run dev

# Start mobile (in separate terminal)
cd mobile && npm install && npx expo start

## Project Structure

ShelvesAI/
├── api/                 # Express backend
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── server.js
├── mobile/              # Expo app
│   └── src/
├── docker-compose.yml
└── README.md
```

**Acceptance Criteria**:
- [ ] README reflects new structure
- [ ] Quick start instructions work
- [ ] Old references removed
- [ ] Committed to git

---

### Task 0.13: Final Cleanup Commit
**Priority**: 🔴 Critical  
**Estimated Time**: 10 minutes

**Description**: Review all changes and create a clean Phase 0 completion commit.

**Steps**:
```bash
# Review what's changed
git status
git diff --stat HEAD~10

# Verify nothing important was deleted
ls -la
ls -la api/
ls -la mobile/

# Final commit (if any uncommitted changes)
git add -A
git commit -m "Phase 0: Complete cleanup for mobile-first v2"

# Push to remote
git push origin main
```

**Acceptance Criteria**:
- [ ] All Phase 0 tasks committed
- [ ] Code pushed to remote
- [ ] Project structure matches expected layout
- [ ] API server starts successfully
- [ ] Mobile app starts successfully

---

## Phase 0 Completion Checklist

Before moving to Phase 1, verify:

- [ ] New repository created and pushed
- [ ] Original repository archived
- [ ] `frontend/` deleted
- [ ] `plasmic-host/` deleted
- [ ] `src/` (root) deleted
- [ ] UI editor routes/services deleted
- [ ] `server.js` updated
- [ ] Directory renamed to `api/`
- [ ] Root package.json cleaned
- [ ] .gitignore updated
- [ ] README updated
- [ ] `cd api && npm run dev` works
- [ ] `cd mobile && npx expo start` works
