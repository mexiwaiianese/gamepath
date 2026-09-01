# Architecture

## System overview

GamePath is designed as a local-first volleyball intelligence application. The primary runtime is a Next.js application that handles the interactive user experience, deterministic stat logic, local analytics, and local AI explanation. PostgreSQL is used for relational data persistence, while video files remain stored locally on disk. External hosted AI services are not required.

## High-level architecture

Browser
→ Next.js app
→ PostgreSQL / analytics layer
→ local AI provider abstraction
→ Ollama runtime

## Key architectural principles

- local-first by default
- deterministic calculations over AI-generated facts
- minimal trust in LLM outputs
- privacy-preserving storage model
- modular separation between statistics and AI explanation

## Proposed runtime components

### 1. Frontend

The Next.js app provides the live match-entry workflow and analysis dashboards. It is optimized for fast laptop/tablet use and should support keyboard shortcuts, quick stat buttons, rally editing, and rapid correction.

### 2. Data layer

PostgreSQL stores:

- organization
- program
- team
- season
- athlete
- roster membership
- opponent
- match
- set
- rally
- lineup
- rotation
- substitution
- libero replacement
- volleyball event
- player attribution
- score before/after
- video timestamp/reference
- provenance/audit history

### 3. Local AI layer

A local AI provider abstraction sits between the app and Ollama. The app may call Ollama for summary generation, but the AI layer must never be the source of truth for match statistics. It only interprets and explains already-calculated results.

### 4. Video layer

Video remains local. The app stores local file paths or references, plus timestamps that tie the clip to a specific rally or set.

## Database model

Core tables:

- organizations
- programs
- teams
- seasons
- athletes
- roster_memberships
- opponents
- matches
- sets
- rallies
- lineups
- rotations
- substitutions
- libero_replacements
- volleyball_events
- event_attribution
- score_snapshots
- video_references
- stat_provenance
- audit_logs

### Example schema shape

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE athletes (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE,
  jersey_number INT,
  primary_position TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  season_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  opponent_id UUID,
  scheduled_at TIMESTAMPTZ,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE rallies (
  id UUID PRIMARY KEY,
  match_id UUID REFERENCES matches(id),
  set_number INT NOT NULL,
  rally_number INT NOT NULL,
  serving_team TEXT NOT NULL,
  receiving_team TEXT NOT NULL,
  score_before_home INT,
  score_before_away INT,
  score_after_home INT,
  score_after_away INT,
  point_winner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE volleyball_events (
  id UUID PRIMARY KEY,
  rally_id UUID REFERENCES rallies(id),
  event_type TEXT NOT NULL,
  team TEXT NOT NULL,
  athlete_id UUID REFERENCES athletes(id),
  success BOOLEAN,
  rating INT,
  rotation INT,
  score_before_home INT,
  score_before_away INT,
  score_after_home INT,
  score_after_away INT,
  provenance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Deterministic metric architecture

The stat engine should evaluate live rally records and compute metrics without any model inference. All formulas are implemented as code and covered by unit tests.

## Future roadmap

- phase 1: improved editing and audit UX
- phase 2: deeper rotation and lineup optimization
- phase 3: player development trend analysis
- phase 4: local CV/ML experimentation in separate Python service

## Security and privacy

- default to local storage and local network access
- never sync athlete or video data to hosted services by default
- restrict AI to local-only endpoints
- ensure all database access is within the local environment unless explicitly configured otherwise
