# Offline Recovery & Resilience Report

**Test Suite**: `test/security/offline_sync_recovery.test.js` (10/10 PASS)  
**Service Worker**: `cafe-os-v3.3` (SHA256: `4f3990430fc57081de68844225d42de7d865e6325221bff998c198c291db1cbe`)

---

## 1. Offline Capabilities
- **Cache-First Dynamic Assets**: Static pages, CSS, JS, fonts, and cached catalog data operate offline.
- **IndexedDB Transaction Outbox**: Orders created offline are stored in client IndexedDB.
- **Durable Sync & Replay**: Upon network reconnect, outbox transactions replay in sequence with server-side conflict detection.
- **Durable ESC/POS Print Outbox**: Print jobs queued during offline network partitions print automatically when printer connectivity recovers.
