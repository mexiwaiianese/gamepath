# GamePath

GamePath is a local-first volleyball athlete and team intelligence platform focused on fast, accurate live match data capture and analysis for real teams.

## Purpose

The immediate goal is to help a high-school volleyball program collect clean, labeled match data without depending on cloud services or hosted AI. The first live pilot is a local-first stat entry and analysis workflow for one real team.

## Product goals

- Local-first match data collection and storage
- Deterministic statistics and analysis logic
- Support for roster, lineup, live rally entry, rotation analysis, and match summaries
- Local AI assistance through Ollama only when available
- Privacy-first operation with no athlete or video data leaving the machine by default
- Fast stat entry designed for laptop and tablet use during live matches

## Stack

- Next.js + React + TypeScript
- Tailwind + shadcn/ui-inspired component patterns
- PostgreSQL for local persistence
- Docker for local services where useful
- Local video storage and references
- Ollama for local LLM support
- Deterministic, test-backed business logic for all volleyball metrics

## First live workflow

Roster → New Match → Starting Lineup → Live Rally/Stat Entry → Undo/Edit → End Set → End Match → Player Stats → Rotation Analysis → Lineup Analysis → Match Summary → CSV Export

## Local setup

1. Install dependencies:
   npm install
2. Run the app:
   npm run dev
3. Use the local match-entry workflow in the browser.
4. If Ollama is running locally, match summaries can use the local AI adapter. If not, the app falls back to deterministic summaries.

## Admin password (public repo, private controls)

The repository and GitHub Pages remain public. **Public source is not authentication.**
Pages is a static export: it does not ship `/admin` or `/api/admin` routes. The admin
video portal still runs only with `npm run dev` on **localhost/loopback**, now with
an additional password gate. This does not enable remotely hosted admin access.

1. Copy `.env.example` to `.env.local` (ignored by git).
2. Set `GAMEPATH_ADMIN_PASSWORD` to a long, unique password, then restart `npm run dev`.
3. Open `http://localhost:3000/admin/` (or your dev port) and sign in.

There is no default password and no dev bypass: **unset/empty disables admin access**
(UI explains setup; admin APIs return 503). The main app and live game remain usable.
The password stays server-side; never use a `NEXT_PUBLIC_` variable for it, commit it,
or put it in a URL. Keep `.env.local`, `.gamepath/`, and `videos/` out of commits.
Changing the password and restarting invalidates existing portal sessions.

### Access boundaries

| Surface | Access |
| --- | --- |
| `/admin/`, `/admin/videos/` (including Prepare/player) | Admin session + existing development/loopback restriction |
| `/api/admin/taggers/` (status/start/stop/force-stop) | Admin session |
| `/api/admin/videos/`, `upload/`, `pipeline/`, `file/` (including HEAD/Range) | Admin session, checked before body/file/process work |
| `/api/admin/session/` | Same-origin, loopback-only POST for login/logout; login is password-checked and rate-limited |
| Standalone court/player/touch marker pages, state, stills, preview/save (ports 8765–8767) | HTTP Basic admin password; username `admin`, same env password. Separate browser prompt per port, not the portal cookie |
| Marker `/health` GET | Open, data-free; keeps portal status/stop/Prepare checks working |
| `/`, report QR/share links (`/report/?match=…&token=…`), join links (`/?match=…&join=…`), `/camera/` | No admin password; existing match-link tokens and device roles still apply |
| Live server `:3850` (`/host`, `/devices`, `/matches/…`, camera updates) | Unchanged, passwordless game access with existing token/device checks |
| Legacy share server `:3031` (`/health`, `/matches/:id`) | Unchanged; existing report/share-token checks, no admin password |
| Hotspot setup/helper (`npm run hotspot`, loopback `:3847`) | Unchanged local operator setup, not an admin-portal route; Wi-Fi passphrase is separate from admin password |

Portal sessions last 8 hours (signed, random-nonce, HttpOnly, SameSite=Strict,
Secure on HTTPS; no localStorage). Use **Sign out** to clear this browser's portal
cookie. Marker Basic credentials are separate and may be remembered by the browser;
close its authenticated session to clear them. Login is limited to 10 attempts per
minute per process (not a distributed internet-facing identity system). Admin writes
reject cross-origin browser requests, including other localhost ports.

Portal-started Python marker processes inherit the env password automatically.
For standalone CLI markers, export `GAMEPATH_ADMIN_PASSWORD` in the shell before
starting them; Python does not read `.env.local`. Restart already-running markers
when introducing/changing the password so none are left running old ungated code.
Court/player markers remain loopback-only; the touch marker retains its Wi-Fi bind,
but **offline video annotation is admin work**, distinct from live stat keeping.
Do not expose these development/HTTP services to the public internet: use a trusted
local network (HTTP Basic credentials are not encrypted without HTTPS). A future
remote admin deployment needs HTTPS and a server deployment, not GitHub Pages.

## Data and privacy expectations

- no athlete data leaves the local machine/network by default
- only local AI is used in the first phase
- no OpenAI, Anthropic, Gemini, or other hosted AI service should be required
- all live match data is labeled and documented with provenance and corrections history

## Documentation

- [docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)
- [docs/PHASE-0.md](docs/PHASE-0.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/VOLLEYBALL-DATASET.md](docs/VOLLEYBALL-DATASET.md)
- [docs/LOCAL-AI.md](docs/LOCAL-AI.md)
- [docs/FIRST-LIVE-MATCH-CHECKLIST.md](docs/FIRST-LIVE-MATCH-CHECKLIST.md)
