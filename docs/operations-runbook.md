# Mazaj Operations Runbook & Daily Guide | دليل التشغيل اليومي لكافيه مزاج

---

## 1. Daily Opening Checklist | إجراءات فتح الكافيه الصباحية

### English
1. **Power & Server Initialization**: Ensure the main venue server/hub is powered on and Node.js process is active (`pm2 status` or `npm start`).
2. **Printer Network Verification**: Verify ESC/POS thermal printers have paper rolls loaded and green LAN indicator is active.
3. **Cashier Clock-In & Opening Float**:
   - Cashier enters their 4-digit PIN on `/index.html`.
   - Opens `/pos.html` or `/eod.html` to register the morning starting float (e.g. `500.00 ج.م`).
4. **Table Floor Check**: Open `/tables.html` and ensure all indoor and terrace zones are in `AVAILABLE` (متاحة) state.

### العربية
1. **تشغيل الخادم الرئيسي**: التأكد من إقلاع جهاز الخادم واتصال شبكة الواي فاي الداخلية للكافيه.
2. **فحص طابعات البونات**: التأكد من وجود بكر الورق الحراري في طابعات البار والمطبخ واتصال كابل الشبكة LAN.
3. **تسجيل حضور الكاشير وعُهدة الدرج**:
   - إدخال رمز الـ PIN في صفحة الدخول `/index.html`.
   - تسجيل مبلغ بداية الوردية (الدرج الافتتاحي) في شاشة الكاشير.
4. **فحص جاهزية الصالة**: فتح شاشة الطاولات `/tables.html` والتأكد من ظهور كافة الصالات والتراس باللون الأخضر (متاحة).

---

## 2. Shift Handover & Blind Cash Declaration | تسليم الوردية وإغلاق الدرج (EOD)

### English
1. **Clock-out Prep**: Cashier collects all pending table bills and ensures all open orders are either settled or transferred.
2. **Physical Cash Counting**: The cashier counts all physical currency in the cash drawer.
3. **Blind Declaration Submission**:
   - Cashier navigates to `/eod.html`.
   - Types their actual counted cash in the "إثبات النقدية الفعلي" field and submits.
   - The cashier does not see system expected revenue figures.
4. **Manager Z-Report Verification**:
   - Operations Manager or Owner logs in with their PIN.
   - Reviews the calculated variance (Shortage/Surplus).
   - Generates and prints the official shift Z-Report.

### العربية
1. **تسوية الحسابات المفتوحة**: تحصيل كافة حسابات الطاولات المفتوحة وتسكين الفواتير.
2. **العد الفعلي للخزينة**: يقوم الكاشير بعد النقدية الورقية والمعدنية الموجودة بالدرج بدقة.
3. **إثبات تسوية الدرج (Blind Declaration)**:
   - يفتح الكاشير شاشة التقفيل `/eod.html`.
   - يقوم بكتابة المبلغ الفعلي المعدود والضغط على "تسجيل وتثبيت الإغلاق" دون إظهار المبيعات المتوقعة للحفاظ على الخصوصية المالية.
4. **اعتماد المدير وطباعة تقرير Z**:
   - يدخل مدير التشغيل أو المالك للاطلاع على الفارق المالي (عجز / فائض / مطابق).
   - طباعة تقرير التقفيل المعتمد Z-Report وتوقيعه.

---

## 3. Thermal Printer Troubleshooting | معالجة أعطال الطابعات الحرارية

### Problem: Printer Not Printing Kitchen / Receipt Chits
1. **Check Red Light / Paper Out**: Ensure thermal paper is not empty and paper cover is tightly closed.
2. **Check IP Connectivity**: Ping the configured printer IP (default: `192.168.1.100`):
   ```bash
   ping 192.168.1.100
   ```
3. **Trigger Test Print**: In `/settings.html`, click "تجربة الطباعة" to send an ESC/POS diagnostic ticket.
4. **Check Print Queue**: Inspect `print_jobs` status in the database:
   ```bash
   sqlite3 data/cafe.db "SELECT id, job_type, status, error_message FROM print_jobs ORDER BY id DESC LIMIT 5;"
   ```

---

## 4. Emergency Backup & Database Maintenance | الصيانة الدورية والنسخ الاحتياطي

```bash
# Take immediate on-demand hot snapshot
node src/db/cli.js backup

# Check database integrity
sqlite3 data/cafe.db "PRAGMA integrity_check;"
```
