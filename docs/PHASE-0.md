# Phase 0

## Objectives

Phase 0 creates the foundation for a dependable live-stat pilot and establishes the technical guardrails for privacy, deterministic calculations, and local-only AI.

## Scope

- create a Next.js + React + TypeScript project
- define the volleyball data model and event taxonomy
- document the first live match workflow
- scaffold a local-first app shell for match entry and analysis
- set up deterministic metrics and test coverage
- create an Ollama adapter with graceful fallback when unavailable
- generate realistic fictional seed data for simulation and validation

## Requirements coverage

The initial build must satisfy the highest-priority needs:

1. Ability to record roster, lineup, sets, and rally events
2. Ability to undo, edit, and correct entries
3. Calculation of core volleyball metrics with documented formulas
4. Rotation and lineup analysis based on the recorded data
5. CSV export for downstream use
6. Local AI summary support with graceful degradation when Ollama is unavailable
7. Clear separation between data entry and AI explanation

## Pilot workflow (exact)

1. Create or select organization, program, and team
2. Create a new match with opponent and season context
3. Build a starting lineup for each team
4. Enter live rally events with athlete attribution and score before/after values
5. Undo or edit the most recent event or any event in the rally log
6. End a set when score reaches the set threshold and records are complete
7. End the full match and lock the final set result
8. Review player stat cards and team-level summary
9. View rotation and lineup analysis panels
10. Export the match to CSV
11. Save the match with audit history and provenance information

## Data collection rules

- every event must capture athlete attribution when relevant
- every event must preserve score context before and after the rally
- every event must record the team and set
- every correction must be logged with timestamp and reason
- every match should include a local video timestamp or reference if a recording is available

## Standards for the first launch

- No hosted AI required for calculations
- No use of AI to fabricate event outcomes
- All metrics must be deterministic and testable
- The UI should prioritize speed and minimal clicks over visual flourishes
- The app should remain usable even if Ollama is stopped or unreachable

## Exit criteria for Phase 0

The project is ready to advance beyond foundational work when:

- a user can create a team and roster
- a match can be created and a lineup can be set
- live rallies can be entered quickly
- core metrics calculate correctly from stored events
- CSV export works
- the local AI summary path exists and uses a graceful fallback
- tests cover the major formulas and edge cases
