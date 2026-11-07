# Hardening backlog

These items are deliberately deferred by the initial delivery plan. Prioritize before real supporter data is used.

1. **P0 — Security**: add login throttling and lockout; enforce least-privilege database access and review every authorization boundary; protect audit history against mutation; add strict security headers including CSP and HSTS; review session revocation and idle timeout.
2. **P0 — Privacy**: restore national-ID encryption and keyed hashing using server-side/private database secrets; add database-backed public endpoint rate limits and CAPTCHA; complete consent, data-subject request and retention workflows.
3. **P1 — Access control**: automated tests for mobilizer ownership, coordinator ward scoping, admin operations, and public endpoints.
4. **P1 — Operations**: add backup/restore and migration rollback guidance; monitor API errors without recording secrets or personal data.
5. **P2 — Compliance**: document ODPC registration obligations, approved consent language, retention periods, and opt-in requirements for outreach.
