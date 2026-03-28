# LILA Tic-Tac-Toe - Backend

Nakama game server for multiplayer Tic-Tac-Toe.

## Prerequisites

- **Node.js 20+**
- **GitHub Account**
- **Render.com Account** (free) - [render.com](https://render.com)

## Project Structure

```
/backend
├── /src                    # TypeScript source code
│   ├── main.ts             # Entry point (InitModule)
│   ├── match_handler.ts    # Server-authoritative game logic
│   ├── leaderboard.ts      # Leaderboard management
│   ├── rpc.ts              # Custom RPC endpoints
│   └── types.ts            # Shared types
├── /build                  # Compiled JavaScript (for deployment)
│   └── index.js            # Bundled runtime module
├── /config
│   ├── local.yml           # Local development config
│   └── production.yml      # Production config (uses env vars)
├── Dockerfile              # Docker image for Render
├── render.yaml             # Render.com blueprint
├── package.json
├── tsconfig.json
└── rollup.config.js
```

## Setup & Deploy

### Step 1: Install & Build

```bash
npm install
npm run build
```

This creates `build/index.js` which is required for deployment.

### Step 2: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new repository on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/lila-backend.git
git push -u origin main
```

### Step 3: Deploy to Render.com (Blueprint - Recommended)

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **"New"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render auto-detects `render.yaml` and creates:
   - PostgreSQL database (`lila-postgres`)
   - Nakama web service (`lila-nakama`)
5. Click **"Apply"**
6. Wait 5-10 minutes for deployment

### Alternative: Manual Setup

#### Create PostgreSQL Database

1. Render Dashboard → **"New"** → **"PostgreSQL"**
2. Configure:
   - **Name**: `lila-postgres`
   - **Database Name**: `nakama`
   - **User**: `nakama`
   - **Plan**: Free
3. Click **"Create Database"**
4. Copy the **Internal Database URL**

#### Create Web Service

1. Render Dashboard → **"New"** → **"Web Service"**
2. Connect your GitHub repo
3. Configure:
   - **Name**: `lila-nakama`
   - **Environment**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Plan**: Free
4. Add Environment Variables:

| Key | Value |
|-----|-------|
| `NAKAMA_DATABASE_ADDRESS` | Your PostgreSQL Internal URL |
| `NAKAMA_CONSOLE_PASSWORD` | Generate a secure password |
| `NAKAMA_CONSOLE_SIGNING_KEY` | Random 32+ character string |
| `NAKAMA_SESSION_ENCRYPTION_KEY` | Random 32+ character string |
| `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY` | Random 32+ character string |

5. Set **Health Check Path**: `/healthcheck`
6. Click **"Create Web Service"**

## Verify Deployment

After deployment completes (5-10 minutes):

1. **Your URL**: `https://lila-nakama.onrender.com`
2. **Test health**: Visit `https://lila-nakama.onrender.com/healthcheck`
3. **Nakama Console**: `https://lila-nakama.onrender.com:443`
   - Username: `admin`
   - Password: Your `NAKAMA_CONSOLE_PASSWORD`

**Note**: Free tier spins down after 15 minutes of inactivity. First request may take 30-60 seconds to wake up.

## Making Changes

To modify the game logic:

1. Edit files in `/src`
2. Rebuild: `npm run build`
3. Commit changes: `git add . && git commit -m "Update game logic"`
4. Push to GitHub: `git push`
5. Render auto-deploys on push

## Environment Variables Reference

| Variable | Description |
|----------|-------------|
| `NAKAMA_DATABASE_ADDRESS` | PostgreSQL connection string |
| `NAKAMA_CONSOLE_PASSWORD` | Admin console password |
| `NAKAMA_CONSOLE_SIGNING_KEY` | JWT signing key |
| `NAKAMA_SESSION_ENCRYPTION_KEY` | Session token encryption |
| `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY` | Refresh token encryption |

## Next Step

After backend is deployed, deploy the frontend. See `frontend/README.md`.
