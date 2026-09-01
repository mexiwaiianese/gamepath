# Volleyball Dataset

## Purpose

The dataset for GamePath is intentionally structured around clean, labeled event data that can support both live coaching use and future longitudinal analytics.

## Core entities

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
- provenance
- corrections/audit history

## Required event types

### Serving

- serve attempt
- ace
- serve error
- successful serve

### Serve receive

- reception attempt
- reception rating
- reception error

### Attack

- attack attempt
- kill
- attack error
- blocked attack
- continuation

### Setting

- assist
- setting error

### Blocking

- solo block
- block assist
- block touch

### Defense

- dig
- defensive error where tracked

### Additional

- point winner
- substitutions
- lineup state
- rotation state

## Labeling requirements

Every event should record, at minimum:

- match id
- set id or set number
- rally id
- team
- athlete id or null for team-level event
- event type
- success indicator when relevant
- rating when relevant
- rotation when relevant
- score before and after the event
- video timestamp/reference if present
- source/provenance
- correction audit record if edited

## Calculated metrics

The app must calculate and attribute the following metrics from the event stream:

- hitting percentage
- kill percentage
- attack error percentage
- serve-in percentage
- ace percentage
- average reception rating
- reception-error rate
- digs per set
- assists per set
- side-out percentage
- rotation performance
- lineup performance
- team error rate

### Formula definitions

- hitting percentage = (kills + blocks - attack errors) / attack attempts x 100
- kill percentage = kills / attack attempts x 100
- attack error percentage = attack errors / attack attempts x 100
- serve-in percentage = successful serves / serve attempts x 100
- ace percentage = aces / serve attempts x 100
- average reception rating = sum of reception ratings / reception attempts
- reception-error rate = reception errors / reception attempts x 100
- digs per set = total digs / total sets
- assists per set = total assists / total sets
- side-out percentage = side-outs / side-out opportunities x 100
- rotation performance = points won in a specific rotation / total rallies in that rotation x 100
- lineup performance = aggregate performance of the six-player lineup over the match
- team error rate = total team errors / total team actions x 100

## Data quality standards

- every metric must be derived from the same underlying event log
- all formulas must be tested in code
- event corrections must not silently overwrite original data
- every match should be identifiable by season, team, opponent, and date
- all labels should be consistent across match records

## Seed-data objective

The initial project includes realistic synthetic volleyball data for a local pilot and development workflow. This dataset is not production match data; it is a realistic fixture for validating the workflow and tests before real team usage.
