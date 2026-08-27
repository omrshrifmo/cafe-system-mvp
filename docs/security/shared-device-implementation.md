# Shared Physical Device & Multi-User Context Architecture
**MENA Cafe ERP Enterprise Platform — Hardware Security & Context Partitioning Specification**

---

## 1. Executive Summary & Core Security Principles

In hospitality and retail operations, multiple staff members frequently interact with identical physical hardware (counter POS terminals, kitchen displays, tableside tablets). A naive implementation using a single shared cookie context inevitably leads to **Cross-Account Pollution**, where transactions, discounts, and audit logs are erroneously attributed to whoever last authenticated on the terminal.

The Cafe ERP architecture enforces **Strict Context Partitioning** across three officially supported operating modes:

```mermaid
flowchart TD
    subgraph Hardware ["Physical Terminal / Shared Touch PC"]
        subgraph Mode1 ["Mode 1: Shared Terminal Mode"]
            A1[Profile: Default] --> B1[User A: Logged In]
            B1 -->|Logout / Scrub| C1[Storage Purged]
            C1 --> D1[User B: Fresh PIN Login]
        end

        subgraph Mode2 ["Mode 2: Multi-Seat Containers"]
            A2[Container 1: Seat POS-01] --> B2[Cashier Session]
            A3[Container 2: Seat KDS-02] --> B3[Barista Session]
        end

        subgraph Mode3 ["Mode 3: Per-Tab Context Mode"]
            A4[Tab 1: sessionStorage Token 1] --> B4[Waiter Context (Context-A)]
            A5[Tab 2: sessionStorage Token 2] --> B5[Manager Context (Context-B)]
        end
    end
```

---

## 2. Supported Operating Modes

### Mode 1: Shared Terminal Mode (Single Browser Profile / Default Counter POS)
- **Deployment**: Single touchscreen terminal used sequentially by multiple cashiers or shift supervisors.
- **Identity & UI**:
  - Prominent Arabic user badge in header: `👤 [اسم المستخدم] ([الدور الوظيفي])`.
  - Dedicated **Lock Screen** (`🔒 قفل`) and **Logout** (`🚪 خروج`) buttons.
  - Active shift badge (`☀️ وردية صباحية` / `🌙 وردية مسائية`).
- **User Switch Protocol**:
  1. Previous user clicks "Logout" or inactivity timeout triggers.
  2. Server immediately sets `v3_user_sessions.revoked_at = datetime('now', 'localtime')`.
  3. Server closes all open WebSockets for that session (`4001: AUTH_REQUIRED`).
  4. Client executes `clearLocalState()`, `sessionStorage.clear()`, removes local storage caches, and clears unsubmitted order drafts.
  5. Next user enters 4-digit PIN on a clean, unpopulated login keypad.

### Mode 2: Multi-Seat Device Mode (Isolated Profiles / Containers / Multi-Window Kiosks)
- **Deployment**: High-end POS terminal running multiple isolated display windows (e.g. Chrome Profile 1 for Counter Cashier, Chrome Profile 2 for Drive-Thru / Delivery Dispatch, Electron Container for KDS).
- **Seat Registration & Binding**:
  - Each seat operates under a registered `seat_id` (e.g. `SEAT-COUNTER-01`, `SEAT-DRIVE-THRU`).
  - Storage is partitioned at the OS/browser profile level: separate Cookies, separate `localStorage`, separate `IndexedDB` databases, separate Service Worker instances.
  - Requests include `x-device-id: [DEVICE-ID]` and `x-seat-id: [SEAT-ID]`.
  - **Zero Cross-Talk**: Seat 1 cannot inspect or mutate Seat 2's storage, session cache, or active draft.

### Mode 3: Secure Per-Tab Context Mode (Split-Screen / Multi-Tab POS)
- **Deployment**: Advanced cashier stations operating multiple tabs simultaneously for different tasks (e.g. Tab 1: Hall Table Orders; Tab 2: Takeaway & Phone Deliveries).
- **Context Isolation Architecture**:
  - Each tab generates an ephemeral `context_id` (`CTX-[TIMESTAMP]-[RANDOM]`) upon instantiation.
  - Authentication tokens are held **strictly in memory and `sessionStorage`** (never in `localStorage` and never in URL query strings).
  - API requests transmit authentication via explicit `x-session-token` and `x-context-id` HTTP headers.
  - **Server-Side Binding**: The server validates that all order submissions, discounts, and payments match the session user and context bound to that token.
  - **Trade-off Justification**: `sessionStorage` is isolated per browser tab by the W3C Web Storage specification. Even if Tab A logs out or changes users, Tab B's `sessionStorage` remains untouched unless explicitly synchronized or instructed.

---

## 3. Shared-Device Safeguards & Data Leakage Protections

### 1. Stale Context Detection & In-Page Arabic Safeguard
When a user switches or logs out in Tab 1, background storage events notify all other open tabs on the same origin. When Tab 2 detects a stale context, it renders an in-page modal warning:
> **⚠️ تنبيه أمان: تم تغيير أو إنهاء الجلسة**  
> تم تسجيل الخروج أو تغيير المستخدم من نافذة أخرى. لحماية البيانات المالية، تم قفل هذه الصفحة وتوجيهك لتسجيل الدخول بأمان.

### 2. Draft & Cart Ownership Binding
- Unsubmitted order drafts in memory or local storage are explicitly stamped with `owner_user_id` and `venue_id`.
- If User B logs into a terminal where User A left an unsubmitted draft, the system detects the ownership mismatch and archives/purges the draft, preventing User B from settling User A's unposted items or inheriting unapproved discounts.

### 3. Offline Command Queue Partitioning
- In `IndexedDB` (`CafeSystemOfflineDB`), every queued command records:
  ```json
  {
    "client_command_id": "CMD-1787810000-abc",
    "actor_id": "USR-CASHIER-01",
    "device_id": "DEV-POS-01",
    "context_id": "CTX-TAB-01",
    "action": "SUBMIT_ORDER",
    "created_at": "2026-08-27T06:30:00.000Z"
  }
  ```
- When connectivity resumes, the replay worker compares `command.actor_id` against the currently active server session. If mismatched, the command is held for supervisor authorization and tagged `STALE_ACTOR_MISMATCH`.

### 4. Realtime Outbox Station Scoping
- WebSockets authenticate via `session_token` and specify `stationId` (`BARISTA`, `KITCHEN`, `SHISHA`, `HALL`, `RUNNER`).
- High-privilege events (manager voids, financial audits, cash variance warnings) are dispatched **only** to authorized roles (`OP_MANAGER`, `OWNER`, `SUPER_ADMIN`), preventing waiters or runners on shared tablets from eavesdropping on confidential management feeds.

---

## 4. Security Verification Matrix

| Threat Scenario | Protected Mode | Defense Mechanism | Automated Test Reference |
|---|:---:|---|---|
| **Sequential User Switch Cart Leak** | Mode 1 | Full memory & storage scrub on logout | `shared_device_simultaneous_context.test.js` (Test 1) |
| **Two Profiles on Same PC** | Mode 2 | Isolated browser containers & distinct tokens | `shared_device_simultaneous_context.test.js` (Test 2) |
| **Two Tabs with Different Users** | Mode 3 | Per-tab `sessionStorage` token & context ID | `shared_device_simultaneous_context.test.js` (Test 3) |
| **Back-Button Session Resurrect** | Modes 1, 2, 3 | Server session `revoked_at` + `no-store` headers | `shared_device_simultaneous_context.test.js` (Test 4) |
| **Offline Queue Replay Under Wrong User**| Modes 1, 2, 3 | Actor signature check on batch sync | `shared_device_simultaneous_context.test.js` (Test 5) |
| **Realtime Outbox Eavesdropping** | Modes 1, 2, 3 | Role-based WebSocket filtering & instant socket termination | `shared_device_simultaneous_context.test.js` (Test 6) |
