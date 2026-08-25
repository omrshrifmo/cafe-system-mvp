# Deterministic Full-Day Simulator Documentation

This document describes the design, execution flow, and verification gates of the Deterministic Full-Day Simulator.

## Architecture
- Runs exclusively on an isolated SQLite test database (`artifacts/full-day/full_day_sim.sqlite`).
- Never touches production or `cafe.db`.
- Executes 30 full table sessions across Morning and Night shifts.
- Validates all 11 linked chain invariants, 8 concurrency stress tests, and full financial / inventory reconciliations.