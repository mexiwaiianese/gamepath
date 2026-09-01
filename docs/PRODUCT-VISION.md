# Product Vision

## Mission

GamePath exists to help youth and high-school volleyball programs capture match data with speed, accuracy, and privacy. The first release should support one real team in live match conditions without depending on cloud AI or external data pipelines.

## Target user

- Head coach
- Assistant coach
- Team analyst
- Program director
- Volunteer match recorder

## User problems

- Current match tracking is slow, inconsistent, or spreadsheet-based
- Volleyball stats are difficult to enter accurately during live play
- Coaches need lineup and rotation insight without waiting for post-match manual processing
- Teams want clean labeled data for future analysis without exposing minors' video or athlete details to third parties

## Product vision

Build a local-first volleyball intelligence platform that is optimized for:

- fast live rally entry
- low-friction corrections and undo
- deterministic metrics and formulas
- high-quality labeled event data
- local-only AI explanation when available
- future longitudinal athlete development analysis

## First live pilot

Volleyball is the first live pilot and testing environment. The initial release focuses on the exact workflow needed for one real high-school team:

Roster → New Match → Starting Lineup → Live Rally/Stat Entry → Undo/Edit → End Set → End Match → Player Stats → Rotation Analysis → Lineup Analysis → Match Summary → CSV Export

## Non-goals for the first phase

- no computer vision or automatic video tagging yet
- no external hosted AI dependency
- no recruiting/transfer optimization before the match-entry workflow is reliable
- no advanced forecasting before the fundamental data model is proven

## Privacy and safety principles

- minors and athletes are protected by local-only storage by default
- video and roster data stay on the local network unless the team explicitly opts into a broader sync flow
- every stat entry should preserve provenance, audit history, and corrections
- all AI features are explanatory and assistive, not independent fact generators
