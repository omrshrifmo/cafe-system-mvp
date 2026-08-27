
# Browser Gate 6: Self-Setup Onboarding & Dynamic Readiness

- **Build ID**: build-v3.2-prod
- **Timestamp**: 2026-08-27T16:33:21.171Z
- **Tested Fixtures**: `fixtures/qa-clean-live.sqlite` and `fixtures/qa-demo.sqlite`

## Results
1. **Clean LIVE Onboarding**: Blank venue inputs with clear placeholders (no preseeded fake venue data).
2. **Dynamic Readiness Check**: `GET /api/setup/readiness` returns dynamic `PRAGMA integrity_check: PASS`, applied migrations count (`031`), and fiscal policy checks.
3. **Isolated DEMO Mode**: Separate demo database fixture with demo banner and sample catalog.
4. **Single Banner Enforcement**: Exactly one mode banner displayed at any time.
