# Hardening backlog

These controls are deliberately deferred by the migration plan. Review and prioritize them before real supporter data is used.

## P0 — Security and privacy

- Restrict the Neon database role to the minimum tables and operations needed by the API. Add database grants and row-level access controls or a separately reviewed equivalent.
- Protect National IDs at rest with keyed hashing for matching and encryption for retrieval; keep keys outside the repository and browser. Today the server database stores National IDs as text and masks API responses.
- Add login throttling, lockout and alerting for repeated failures.
- Add database-backed rate limits and CAPTCHA verification to public join and DSR endpoints.
- Add strict CSP and HSTS headers after validating Vercel and required asset behavior.
- Review session revocation and add idle timeout; the cookie currently expires after 12 hours.
- Add optional administrator two-factor authentication and review account recovery procedures.
- Protect audit history from update/delete by app credentials and complete the audit of every admin mutation.
- Review consent text and retention/anonymisation rules with campaign privacy staff.

## P1 — Workflow integrity

- Add automated tests for coordinator scope, admin settings and DSR actions, offline queue outcomes, join attribution, export scoping, and all import edge cases.
- Complete flag merging and grouped/bulk verification workflows; add backend tests for them.
- Complete import behavior for earliest captured date, trigram duplicate review, register matching, full row-level reports, automatic header detection, and a durable needs-mapping queue.
- Recreate the former RLS security suite as API authorization tests for mobilizer ownership, coordinator ward scope, pending/suspended accounts, and audit access.
- Decide a safe non-login attribution for legacy import rows; current rows use `source='legacy'` with a null `mobilizer_id`.
- Review backup/restore, migration recovery, and operational monitoring. Logs must never contain secrets or personal data.

## P2 — Compliance and operations

- Confirm ODPC registration obligations and approved privacy/consent language.
- Document retention periods and how completed access, correction, and deletion requests are carried out in the data store.
- Keep CHP contacts excluded from outreach exports unless an authorized policy decision changes that setting.
- Confirm opt-in requirements before any outreach; do not add bulk SMS without explicit consent and review.

## P3 — Performance and UX

- Measure the app on low-end Android and throttled mobile networks. The spreadsheet parsing chunk is dynamically loaded but remains large.
- Add accessible status announcements and verify every admin/mobile workflow at 360px width.
