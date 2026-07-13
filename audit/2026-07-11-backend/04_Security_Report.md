# Security Report

**Audit date:** 2026-07-11  
**Scope:** `server` application, Prisma schema/migrations, configuration, dependencies, deployment workflow  
**Security score:** **12/100 — not suitable for production certification**

## Executive conclusion

The backend contains multiple independently exploitable paths to account takeover, administrator privilege, unauthorized financial credit, booking manipulation, sensitive-data access, and payout duplication. These are confirmed implementation defects, not theoretical hardening observations. A public attacker can request an OTP for another person's phone to an attacker-controlled FCM token (`src/modules/auth/auth.service.ts:183-205`), choose the `ADMIN` role during OTP verification (`auth.schema.ts:8,20`; `auth.service.ts:225,328`), and then exercise administrator APIs. Even without that chain, authenticated users can self-credit the customer wallet and non-customer identities can cancel bookings they do not own.

Production deployment must be blocked until the Critical and High findings in `12_Risk_Assessment.md` are remediated and independently retested.

## Confirmed critical vulnerabilities

### SEC-AUTH-01 — Caller-controlled OTP destination enables account takeover

- Evidence: `src/modules/auth/auth.schema.ts:7,19` accepts `fcmToken`; `auth.service.ts:183-205` sends the OTP for the requested phone to that token. The workforce implementation repeats the pattern at `workforce.service.ts:89-115`.
- Exploit: submit a victim phone with an attacker FCM registration token, receive the OTP, then verify it.
- Impact: arbitrary customer, driver, fleet, workforce, or admin account takeover.
- Required fix: OTP proof must be delivered only to a verified phone channel through MSG91 or equivalent. Never let the requester choose an alternative OTP destination. Bind challenges to purpose, phone, device, nonce, attempt counter, and short expiry.

### SEC-AUTH-02 — Client-selected `ADMIN` role

- Evidence: the request schemas permit `ADMIN` (`auth.schema.ts:8,20`); verification trusts it (`auth.service.ts:225`) and issues the access token with the requested role (`auth.service.ts:328`).
- Impact: direct administrative privilege escalation; all admin, finance, compliance, notification, and payout operations become exposed.
- Required fix: remove privileged roles from public schemas. Resolve role from the persisted account. Provision admins only through an audited, out-of-band workflow. Invalidate all issued tokens after remediation.

### SEC-FIN-01 — Authenticated customer can mint wallet funds

- Evidence: `POST /api/v1/wallet/add` is protected only by authentication (`wallet.router.ts:16`); `wallet.service.ts:75-98` directly credits the caller's wallet.
- Impact: unlimited fabricated balance, free bookings, financial loss, corrupted accounting.
- Required fix: delete the public credit operation. Credits must originate only from verified payment webhooks or strongly audited administrator adjustments with immutable ledger entries and idempotency.

### SEC-FIN-02 — Cross-flow Razorpay signature replay

- Evidence: `payment.controller.ts:137-143` rejects an order mismatch only when the booking already stores an order ID. A valid signature from another order can therefore satisfy an unpaid booking whose `razorpayOrderId` is null; the controller does not retrieve and verify order amount, currency, receipt, capture state, or booking binding before lines 145-151 mark payment complete.
- Impact: a low-value wallet/top-up payment can be replayed against a high-value booking owned by the attacker.
- Required fix: require the stored booking order ID, verify it exactly, fetch the payment/order server-side, validate amount/currency/receipt/capture, and complete via one idempotent transaction.

### SEC-FIN-03 — Withdrawal refund/retry can duplicate payout

- Evidence: the refund guard only excludes `COMPLETED` (`driver-wallet.service.ts:541-545`), allowing repeat refund from other states; funds are returned at lines 547-614. Admin retry sets the request back to pending and pays again (`driver-wallet.controller.ts:123-130`) without re-reserving the returned funds.
- Impact: duplicated cash payout and inconsistent wallet balances.
- Required fix: enforce a database state machine, reserve funds exactly once, store provider idempotency keys, and make refund/retry atomic and mutually exclusive.

### SEC-DATA-01 — Secrets and government PII are committed

- Evidence: tracked `test_ulip.ts:4-5` contains ULIP credentials; `src/database/seed-admin.ts:28,83` contains and prints a default administrator password. Tracked `ulip-test-cases.json` contains real-looking identity and vehicle records plus an embedded government biometric image.
- Impact: credential compromise, identity exposure, regulatory and contractual incident.
- Required fix: rotate every affected secret, invalidate sessions, purge history using an approved repository-rewrite process, notify security/privacy owners, and replace data with synthetic fixtures. Secret values and PII are intentionally not reproduced here.

## Authorization and object-level access findings

| Finding | Evidence | Security consequence |
|---|---|---|
| Booking cancellation IDOR | `booking.router.ts:53-57`; `booking.service.ts:431-434` checks ownership only for `CUSTOMER` | Any authenticated non-customer with a booking ID can cancel it |
| Upload deletion IDOR | `upload.router.ts:8`; `upload.controller.ts:103-132` | Any authenticated account can delete an arbitrary known S3 key |
| Tracking room IDOR | `tracking.gateway.ts:61-65` | Any authenticated socket can subscribe to another booking's real-time location |
| Public recent-search IDOR | `maps.controller.ts:55-93`; `recent-search.service.ts:19-25,133-154` | Caller-controlled `x-user-id` reads/deletes another user's history; unauthenticated global bucket access |
| ULIP vehicle IDOR | `ulip.controller.ts:101-109` | A driver can request data for an arbitrary internal vehicle ID; FASTAG/eChallan calls also accept arbitrary registrations |
| Bid data exposure | `booking.service.ts:1137-1162` | Any driver can read all bids and bidder phone data, not only the bidding/assigned driver |
| Public notification relay | `notification.router.ts:9-11` | Unauthenticated callers can send push notifications and subscribe arbitrary tokens to topics |

Authorization is implemented as scattered router role checks and service-specific ownership conditions; there is no central resource-policy layer. This causes inconsistent protection and makes new endpoints unsafe by default.

## Authentication and session assessment

| Control | Assessment |
|---|---|
| Access JWT | 15-minute expiry is positive; claims are trusted without current user/role/activity lookup on ordinary requests |
| Refresh token | Single-use delete-and-reissue intent exists, but delete and creation are not transactional (`auth.service.ts:390-395`) |
| Refresh signing | Uses the access-token secret (`auth.service.ts:412-434`); configured `JWT_REFRESH_SECRET` is unused |
| Token storage | Raw refresh/reset tokens are stored in the database rather than keyed hashes |
| Logout/revocation | Logout removes a supplied refresh token; access JWT remains valid; no global session/device view or per-user token version |
| Passwords | Admin password verification uses Argon2; a committed default seed password defeats the otherwise sound primitive |
| Password reset | Reset tokens exist, but raw-token storage and weak operational controls increase exposure |
| OTP | Redis TTL is present, but caller-controlled FCM delivery is fatal; no durable attempt counter, purpose binding, or robust per-phone/device throttling |
| Demo bypass | Static demo phones/OTP are enabled without an environment guard (`auth.service.ts:22-27`) |
| Account lockout | No reliable failed-auth lockout or progressive delay |
| Device management | FCM token is mixed into authentication proof; no trusted device enrollment or user-visible session revocation |
| In-memory OTP data | `auth.service.ts:37-50` writes every OTP into a process map even in production; expired entries are not periodically removed |

## OWASP Top 10 mapping

| Category | Result | Evidence summary |
|---|---|---|
| A01 Broken Access Control | **Failed / Critical** | role escalation, booking/upload/maps/tracking/ULIP IDOR, public notification operations |
| A02 Cryptographic Failures | **Failed / High** | hardcoded secrets, plaintext sensitive records/tokens, TLS verification disabled for ULIP |
| A03 Injection | Partial | Prisma parameterization limits SQL injection; no confirmed command injection. CSV export formula injection remains possible |
| A04 Insecure Design | **Failed / Critical** | self-credit endpoint, payment replay, non-idempotent settlement/payout, OTP proof design |
| A05 Security Misconfiguration | **Failed / High** | static demo bypass, optional production secrets, direct-origin proxy trust assumptions, unauthenticated internal routes |
| A06 Vulnerable Components | **Failed / High** | `npm audit` reports 20 findings: 8 high and 12 moderate |
| A07 Identification/Auth Failures | **Failed / Critical** | attacker-selected OTP destination and role, weak revocation/lockout |
| A08 Software/Data Integrity | **Failed / High** | unpinned GitHub Action, non-reproducible migrations, undeduplicated webhooks |
| A09 Logging/Monitoring | **Failed / High** | sensitive raw-response logs, no request correlation/security alerts, production HTTP logging suppressed |
| A10 SSRF | No user-controlled URL sink confirmed | Nodemailer dependency advisory can enable SSRF/file-read if dangerous raw options are introduced; current application use was not proven exploitable |

## Transport, browser, and input controls

- `helmet`, configured CORS, compression, Zod in many routes, and Prisma parameterized queries are positive controls.
- ULIP integrations explicitly disable TLS certificate verification in `fleet/ulipAuth.service.ts:22,83` and `ulip/ulip.service.ts:53`. Credentials, tokens, and government data can be intercepted by a network attacker.
- `app.ts:40` trusts one proxy. If the Node origin is reachable directly, spoofed forwarding headers can undermine IP rate limits and HTTPS decisions (`app.ts:47-57`). Edge enforcement is not committed as code.
- CSRF risk is presently lower because authentication uses bearer headers rather than ambient cookies. If cookie auth is added, explicit CSRF protection and SameSite policy will be required.
- No general HTML output encoding is expected from a JSON API; stored XSS risk depends on consuming clients. User-generated support/announcement fields require safe client rendering.
- Pricing/maps endpoints accept large/unbounded strings and lack dedicated cost controls. Global JSON accepts 10 MB; memory-based multipart requests can approach roughly 100 MB before sequential S3 upload.
- No confirmed runtime SQL/NoSQL injection or command-injection sink was found. This does not compensate for the confirmed access-control failures.

## File-upload security

Uploads use Multer memory storage and validate MIME/extension categories, then send to S3. Weaknesses:

- authorization is not tied to a resource or key prefix;
- deletion accepts arbitrary caller-supplied keys;
- content type and extension are caller-controlled and no magic-byte/antivirus/image re-encode step exists;
- large multi-file buffers amplify memory denial of service;
- upload malware scanning, quarantine, lifecycle, encryption/KMS, and retention controls are not evidenced;
- dependency `multer@2.1.1` has a high-severity denial-of-service advisory in the captured audit.

## Sensitive data and privacy

The Prisma schema stores bank account details, KYC/government payloads, DigiLocker tokens/codes, raw ULIP JSON, identity images, refresh/reset tokens, and payment details. Examples include `prisma/schema.prisma:363-372` and `:419-444`. No application-layer field encryption, token hashing, retention schedule, erasure workflow, or attribute-level admin redaction was found. Cascading deletion of financial records weakens statutory audit retention. Raw ULIP responses are logged at `ulip.service.ts:143,225,255,277`.

Recommended control set: envelope encryption with managed KMS, separate token hashes, field-level response DTOs, least-privilege database roles, immutable audit access logs, retention/legal-hold policy, redaction at collection and log sinks, and formal data classification.

## Dependency security result

`npm audit --json` was executed against the lockfile on 2026-07-11 and returned **20 vulnerabilities: 8 high, 12 moderate, 0 critical**. Confirmed affected chains include Multer, Nodemailer, `ws`, `@grpc/grpc-js`, `protobufjs`, `form-data`, Morgan, Firebase Admin dependencies, and OpenTelemetry baggage. Advisories include denial of service, process crash/memory exhaustion, log forging, request smuggling/CRLF, and dangerous Nodemailer raw-input file/URL access. Applicability varies, but all high findings require triage and regression testing before certification.

## Required remediation sequence

1. Immediately disable public traffic or place a deny-by-default gateway in front of authentication, wallet, payment, notification, upload, tracking, and admin routes.
2. Fix OTP proof and role derivation; rotate JWT/admin/ULIP/payment/cloud secrets and revoke all sessions.
3. Remove wallet self-credit and free subscription activation; repair payment, payout, settlement, and webhook idempotency.
4. Enforce resource policies for every route/socket event, including field-level response authorization.
5. Restore TLS verification; encrypt/redact sensitive data; complete incident handling for committed PII.
6. Upgrade vulnerable dependencies and add lockfile audit/SBOM/signature gates.
7. Add security integration tests for every finding, then conduct independent penetration and payment reconciliation testing.

## Certification status

**Rejected.** The current backend does not meet minimum controls for authentication integrity, access control, payment integrity, sensitive-data protection, dependency hygiene, or auditable deployment.
