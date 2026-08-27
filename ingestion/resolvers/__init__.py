"""Post-ingestion enrichers that annotate events with external donation URLs.

A resolver is NOT a source — it never creates events, it only annotates ones
that already exist. Each resolver writes to the `event_donations` table
(one-to-one with `events`), so the main pipeline and the API don't need to
branch on whether donations exist.

See SPIKE_DONATIONS.md for the matching strategy and coverage numbers.
"""
