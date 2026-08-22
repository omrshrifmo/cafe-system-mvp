# Current State (Round 4 Baseline)

## Architecture
- Node.js backend using Express.
- SQLite3 database using `sqlite3` driver with WAL mode.
- HTML/JS frontend served statically. Service worker (`sw.js`) precaches HTML assets.
- PM2 manages the `cafe-server` process.

## Known Defects
As of QA Round 3:
1. `pos.html` is fully blank for menu items (caching/DTO mapping issue).
2. Service Worker (`sw.js`) lacks cache-busting, offline mutations queue.
3. KDS systems connect via WebSocket but don't handle recovery/replay robustly.
4. The catalog has duplicates across `KITCHEN` and `SHISHA`.
5. EOD Cashier mode reveals expected cash and variance, violating financial blindness policy.
6. BI charts remain blank due to an unresolved schema issue (`amount` column missing in SQL queries).
7. Test suite is untracked and destructive rather than using isolated test databases.
