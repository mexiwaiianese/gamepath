# Tagger roster

Local admin stores the people who tag video in `.gamepath/tagger-roster.json`
(already gitignored). Status is derived from `deactivation_date`, not stored as
its own column: a tagger is active while that date is empty or still in the
future, and deactivated once the date has been reached
(`isTaggerActive()` in `lib/tagger-roster.ts`).

When hosted tagging ships, swap the file store in `lib/tagger-roster-store.ts`
for a Supabase-backed `TaggerRosterStore` using a table like this. Keep the
TypeScript helpers (`Tagger`, `parseTaggerFields`, `isTaggerActive`,
`sortTaggers`) as the access and validation source of truth.

```sql
-- Draft schema for the future hosted-tagging Supabase `taggers` table.
-- Local admin currently stores the same fields in .gamepath/tagger-roster.json.

CREATE TABLE taggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  organization TEXT,
  notes TEXT,
  invited_at DATE NOT NULL,
  deactivation_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT taggers_email_unique UNIQUE (email),
  CONSTRAINT taggers_name_present CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT taggers_email_present CHECK (char_length(btrim(email)) > 0)
);

CREATE UNIQUE INDEX taggers_email_lower_idx ON taggers (lower(email));
CREATE INDEX taggers_deactivation_date_idx ON taggers (deactivation_date);

-- Active (including scheduled deactivation) as of the current calendar date:
--   deactivation_date IS NULL OR deactivation_date > CURRENT_DATE
```
