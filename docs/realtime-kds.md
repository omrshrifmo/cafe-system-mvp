# Real-Time Kitchen Display System (KDS) & Prep Routing

## 1. Multi-Station KDS Routing

Incoming orders are automatically split and routed by department category to designated station screens:

| Department Code | Station Name | Hardware Display URL | Staff In Charge |
| :--- | :--- | :--- | :--- |
| `BARISTA` | شاشة البار والمشروبات | `/kds.html` | Baristas (Bebo, Hager) |
| `KITCHEN` | شاشة المطبخ والوجبات | `/kitchen.html` | Chefs (Chef) |
| `SHISHA` | شاشة الشيشة والمعسل | `/shisha.html` | Shiash (Asmaa) |
| `ALL` | شاشة الصالة والرانر | `/runner.html` | Hall Manager / Waiters |

---

## 2. Four-Lane KDS State Machine

Each line item on a preparation screen advances through a deterministic 4-stage lifecycle:

```
[ PENDING (وارد جديد) ]
          |
          v (Barista/Chef taps "قبول وبدء التحضير")
[ ACCEPTED (جاري التحضير) ]
          |
          v (Barista/Chef taps "جاهز للتسليم")
[ READY (جاهز للاستلام) ]
          |
          v (Runner/Waiter taps "تم التسليم للعميل")
[ DELIVERED (تم التسليم) ]
```

---

## 3. Two-Phase Cancellation Handshake Protocol

To prevent food and beverage waste caused by mid-prep cancellations:
1. **If Order is `PENDING` (Not yet started)**: Waitstaff can cancel immediately. Item is voided and BOM inventory is refunded automatically.
2. **If Order is `ACCEPTED` (Preparation in progress)**:
   - Waitstaff clicks "طلب إلغاء".
   - The ticket on the KDS prep screen turns flashing amber with the label `⚠️ طلب إلغاء من الويتر`.
   - The Barista / Chef / Shiash receives an interactive prompt:
     - **Approve Cancellation**: If preparation has not wasted ingredients. Item is voided and stock is refunded.
     - **Reject Cancellation**: If the drink/meal is already finished. Item remains on order and must be billed.

---

## 4. Authenticated WebSocket Hub (`src/realtime/websocket.js`)

- **Protocol**: Standard WebSockets over WS/WSS.
- **Authentication**: On connection handshake, clients provide active `session_token`.
- **Channels**:
  - `kds:barista`
  - `kds:kitchen`
  - `kds:shisha`
  - `kds:runner`
  - `pos:broadcast`
- **Reconnection Resiliency**: When network drops, the client reconnects with exponential backoff and performs a full state refresh from `GET /api/orders?department=XYZ`.
