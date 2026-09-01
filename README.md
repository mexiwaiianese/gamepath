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
