# Testing Report

**Testing score:** **3/100**  
**Estimated meaningful automated coverage:** **approximately 0%**

## Executive conclusion

No automated test framework, test script, unit/integration suite, coverage configuration, API contract tests, security tests, or performance suite is present in the backend package. The two tracked files that resemble tests are ad-hoc executable scripts, not assertions-based repeatable tests; one contains committed credentials and calls an external government service. A successful TypeScript check is useful but does not validate runtime or business behavior.

## Inventory

| Test type | Evidence | Assessment |
|---|---|---|
| Type checking | `npx tsc --noEmit --pretty false` passed | Positive compile-time baseline |
| Unit tests | none found | Missing |
| Service/business tests | none found | Missing |
| API integration tests | none found | Missing |
| Database/migration tests | none found | Missing despite severe schema drift |
| Contract/OpenAPI tests | no OpenAPI source or runner found | Missing |
| Authorization/security tests | none found | Missing |
| Payment/webhook tests | no automated suite | Missing |
| Concurrency/idempotency tests | none found | Missing |
| Queue/job tests | none found | Missing |
| Load/soak tests | none found | Missing |
| Fault/chaos tests | none found | Missing |
| Coverage reports/gates | none found | Missing |
| Ad-hoc scripts | `test_ulip.ts`, `test-booking.js` | mutate external/DB state; not hermetic, not assertions-based, unsafe for CI |

## Critical missing regression tests

### Identity and access

- OTP must be delivered only to the verified phone and cannot be redirected through caller input.
- Public role input cannot create or mint `ADMIN`/privileged JWTs.
- persisted inactive/changed-role users lose access; refresh tokens rotate once and cannot replay.
- demo OTP is impossible in production.
- every route and socket event has an explicit role and resource ownership matrix.
- IDOR tests cover booking, uploads, tracking rooms, maps history, ULIP, bids, support, documents, wallets, fleet, and workforce.

### Money and payments

- customer cannot create credit without a verified provider event.
- payment verification rejects order, amount, currency, receipt, booking, account, capture-state, and replay mismatches.
- duplicate/out-of-order webhooks cause exactly one state/ledger transition.
- concurrent wallet pay/top-up/refund/cashback calls preserve balance and ledger invariants.
- settlement retries do not credit driver/fleet twice and apply one canonical commission.
- withdrawal failure/refund/retry/manual completion cannot create or pay value twice.
- Decimal/minor-unit rounding cases cover GST, commission, fuel, surge, cashback, cancellation, and refund.

### Booking, dispatch, workforce, and fleet

- every status edge uses and obeys the transition table; invalid/repeated transitions fail.
- two drivers cannot accept one booking and one driver/truck cannot accept overlapping bookings.
- pickup requires correct OTP exactly once; legacy route cannot bypass it.
- multi-stop pricing includes the entire route and configured included kilometers.
- bids enforce one-per-driver, status/vehicle/doc eligibility, atomic accept, and privacy.
- workforce accept/complete is atomic, slot-safe, assignment-ID consistent, OTP-gated, and exactly-once paid.
- process restart and multi-worker delivery preserve dispatch/redispatch state.

### Database and operations

- migrations deploy successfully to an empty PostgreSQL instance and schema diff is empty.
- seed is idempotent and contains no fixed production credential.
- restore from backup meets documented RPO/RTO.
- jobs are idempotent under duplicate execution and queues handle retry/DLQ.
- log snapshots confirm secrets/PII are redacted.

## Proposed test architecture

- **Unit:** Vitest or Jest for pure pricing, transition, commission, validation, authorization, and state-machine rules.
- **Integration:** ephemeral PostgreSQL/Redis (containers), real Prisma migrations, fake clocks, transactional fixture factories, deterministic provider adapters.
- **API:** Supertest against the Express app with generated role/resource matrix cases and response-contract assertions.
- **Contract:** OpenAPI generated/validated from schemas; breaking-change detection and provider webhook fixtures.
- **Security:** Semgrep/CodeQL, secret scanning, dependency audit, OWASP API checks, malicious upload/CSV/header/body cases, fuzz/property tests for money and transitions.
- **Concurrency:** parallel requests and duplicate queue/webhook delivery against PostgreSQL, asserting ledger and allocation invariants.
- **Performance:** k6/Artillery scenarios with production-like cardinality and OpenTelemetry/DB metrics.
- **End-to-end:** Razorpay/Firebase/Mapbox/S3 sandbox contracts with local mocks for normal CI; controlled staging smoke tests for providers.

## Coverage policy

Initial repository-wide percentages will be misleading because baseline is effectively zero. Start with mandatory 100% branch coverage for new/fixed security and finance invariants, at least 90% for pure domain modules, and a ratcheting changed-lines threshold. Require every Critical/High finding to have a failing-before/passing-after regression test. Coverage never replaces mutation/property/concurrency and end-to-end tests.

## CI gate order

1. secret scan and lockfile integrity;
2. install with `npm ci`;
3. type-check, lint, format, unit tests;
4. start ephemeral PostgreSQL/Redis and run `prisma migrate deploy` from empty;
5. integration/API/authorization/concurrency tests;
6. build, SAST, dependency audit, SBOM;
7. deploy immutable artifact to staging; smoke and provider sandbox tests;
8. performance/security release gates for material changes.

## Certification status

**Rejected.** There is no automated evidence that current behavior is correct, secure, reproducible, or regression-resistant.
