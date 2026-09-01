# Local AI

## Principle

Local AI is a support layer for explanation and summarization, not a source of truth for stats. GamePath must never allow Ollama or any local model to invent underlying volleyball statistics. All metrics must come from deterministic logic and the event stream.

## Allowed local AI runtime

- Ollama is the initial local LLM runtime
- Future local providers may be added behind the same abstraction, but hosted providers are not allowed in the MVP

## Architecture

Browser
→ Next.js app
→ local AI provider abstraction
→ Ollama

The abstraction should expose a small interface like:

- generateMatchSummary(params)
- summarizePerformance(metrics)
- explainRotationInsights(rotationData)

## Graceful fallback

If Ollama is unavailable, the app must still function normally. In that case, the UI should show a deterministic summary generated from the same calculated stats instead of failing.

## Privacy controls

- no athlete or match data leaves the local machine or local network by default
- video is not uploaded to any external service
- prompts should strip or avoid unnecessary personal data when generating summaries
- only a minimal summary should be sent to the local model

## Required behavior

- the LLM may explain results in natural language
- the LLM may generate a coaching-style note with context
- the LLM must reference already-computed values
- the app must not accept raw model output as authoritative stats

## Example fallback summary

"This match featured a 67.0% serve-in rate, 3 aces, and a 0.41 digs-per-set average for the starting lineup. The team posted a hitting efficiency of 0.23 with 4 attack errors and 8 kills across the recorded rallies."

This is generated from exact computed data rather than inferred from the model.
