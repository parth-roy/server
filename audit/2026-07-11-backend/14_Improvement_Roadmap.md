# Improvement Roadmap

## Objective

Move the backend from **27/100 overall health and production NO-GO** to a controlled launch candidate with verified identity, authorization, money integrity, reproducible data/deployments, automated evidence, and operable multi-instance behavior.

## Stage 0 — Immediate containment (0–24 hours)

**Exit condition:** known direct compromise paths are unavailable and exposed credentials are invalid.

- Restrict the API to an emergency allowlist/maintenance boundary if it is publicly reachable.
- Disable attacker-directed OTP delivery, client role selection, demo OTP, `/wallet/add`, unverified subscription activation, public notification relay, unsafe payment verify, withdrawal retry/complete, arbitrary upload delete, and unauthorized socket/map/ULIP operations.
- Rotate JWT, admin, ULIP, Razorpay/RazorpayX, Firebase, S3, Redis, database, DigiLocker, Mapbox, and deployment credentials as applicable; revoke sessions.
- Open a privacy/security incident for tracked government PII/biometric data and repository credentials. Preserve forensic evidence; do not casually rewrite history before the incident owner approves.
- Snapshot and reconcile wallet, payment, payout, subscription, booking, and settlement data for suspicious activity.

**Owners:** Security lead, backend lead, finance/reconciliation owner, privacy/legal, platform lead.

## Stage 1 — Identity, policy, and financial integrity (days 2–14)

**Exit condition:** P0 exploit regression tests pass and ledger reconciliation has no unexplained variance.

- Implement phone-channel OTP challenge with purpose/device/nonce/attempt binding and distributed limits.
- Derive roles and account status only from persisted server state; implement admin provisioning and token/session revocation.
- Add central resource policies for every HTTP endpoint and Socket.IO event; generate a role/ownership matrix.
- Define canonical fixed-unit money and immutable ledger/idempotency model.
- Repair payment order/amount/currency/receipt/capture binding, webhook inbox/dedupe, wallet commands, settlements, withdrawal state machine, and subscription activation.
- Define booking/driver/fleet/workforce/bid state machines; make transition/allocation commands atomic.
- Restore pickup/workforce proof requirements and fix multi-stop/total/commission pricing truth.
- Re-enable ULIP TLS verification and implement sensitive-field encryption/redaction.

**Verification:** attacker-focused API tests, property/concurrency tests, provider sandbox fixtures, accounting reconciliation, independent security review.

## Stage 2 — Database and test foundation (weeks 2–6)

**Exit condition:** a clean environment and a restored backup produce the same expected schema/data invariants.

- Inventory actual production schema; reconcile 54 models/28 enums against migration history.
- Produce reviewed forward/baseline migrations and deploy them to an anonymized clone.
- Convert financial fields to Decimal/minor units with before/after reconciliation.
- Add missing FKs, unique/idempotency/allocation constraints and query-driven indexes.
- Introduce ephemeral PostgreSQL/Redis integration environments and deterministic provider fakes.
- Cover critical domain rules, all routes, resource authorization, migrations, webhooks, queues/jobs, and concurrency.
- Generate OpenAPI/contracts from schemas and enforce response/error compatibility.

**Release gate:** `npm ci`, secret/SAST/dependency checks, type/lint/unit, empty-DB migrate, integration/API/security/concurrency, build/SBOM.

## Stage 3 — Safe delivery and operations (weeks 4–10)

**Exit condition:** one immutable artifact is promoted through staging/canary and rollback/restore drills succeed.

- Replace remote mutable Git deploys with signed immutable artifact/container promotion.
- Pin actions by commit; protect branches/environments; add approvals, concurrency, provenance, and rollback.
- Implement expand/contract database releases and deployment compatibility checks.
- Separate API/realtime/scheduler/worker profiles with graceful shutdown/readiness.
- Move secrets to a managed vault and validate complete typed configuration at startup.
- Codify infrastructure, edge proxy/TLS, network restrictions, resources, autoscaling, and environment drift detection.
- Configure/test encrypted PITR/backups, cross-failure-domain copies, RPO/RTO, and restoration.
- Patch high dependency vulnerabilities and establish automated update/SBOM/license policy.

## Stage 4 — Durable multi-instance behavior and observability (weeks 6–12)

**Exit condition:** duplicate delivery, restart, provider outage, and node loss do not lose or create business value.

- Implement transactional outbox/inbox and idempotent durable consumers.
- Replace EventBus/timers with queues/delayed jobs; add retry, jitter, DLQ, replay controls, and queue SLOs.
- Use Redis-backed Socket.IO adapter and rate limits; enforce room policy across nodes.
- Ensure singleton/idempotent scheduled jobs with leases and visible run history.
- Deploy OpenTelemetry traces, Prometheus metrics, centralized redacted logs, Grafana dashboards, Sentry correlation, SLOs, and paging.
- Add security/business alerts for role changes, wallet credits, payment mismatches, payout retries, reconciliation exceptions, queue lag, and backup failure.
- Exercise incident, provider-outage, failover, reconciliation, and DLQ runbooks.

## Stage 5 — Performance and scale (weeks 10–20)

**Exit condition:** production-like load and soak tests meet agreed SLOs with at least 2x expected peak headroom.

- Replace global dispatch/workforce scans with PostGIS indexed radius/region search.
- Coalesce/batch tracking persistence and partition/retain high-growth tables.
- Move analytics to SQL/materialized aggregates and large exports/broadcasts to workers.
- Adopt presigned direct uploads, scanning/quarantine, CDN/lifecycle policy.
- Establish DB connection budgets, query-plan regression checks, provider quotas/circuit breakers, cache stampede control.
- Load test HTTP, sockets, queues, database, provider degradation, rolling restart, and failover at staged populations.
- Classify reads before adopting replicas; shard/region only when measured limits justify it.

## Stage 6 — Maintainability and certification (months 3–6)

**Exit condition:** independent audit/penetration review has no open Critical/High findings and operational evidence is accepted.

- Decompose God services into tested application commands/domain policies/adapters.
- Break circular dependencies and consolidate ledger/auth/provider patterns.
- Remove dead routes/workers/dependencies and deprecate duplicate APIs through versioning.
- Add architecture boundary, complexity, changed-code coverage, mutation/property, contract, and performance regression gates.
- Reconcile documentation with generated contracts/schema and owned runbooks.
- Complete external penetration test, privacy/compliance assessment, payment reconciliation certification, and DR exercise.

## Prioritization matrix

| Workstream | Business impact | Effort | Start | Dependencies |
|---|---|---:|---|---|
| Auth/role containment | Extreme | L | now | none |
| Credential/PII incident | Extreme | L | now | security/privacy authority |
| Payment/wallet/payout integrity | Extreme | XL | now | finance owner, provider sandbox |
| Resource authorization | Extreme | L | now | route inventory |
| Migration reconciliation | Extreme | XL | now | production schema snapshot |
| Critical automated tests | Extreme | XL | now | deterministic fixtures |
| Immutable delivery/DR | High | XL | week 2 | test/migration gates |
| Durable events/multi-node | High | XL | week 4 | idempotent commands |
| Observability/runbooks | High | L | week 2 | event/error taxonomy |
| PostGIS/performance | High at scale | L | week 8 | workload/data profile |
| Service refactoring | Medium/high | XL | week 6 | characterization tests |

## Target score gates

| Gate | Minimum evidence-based target |
|---|---|
| Internal stabilization | no open Critical; Security ≥60; Testing ≥40; clean migrations |
| Limited controlled pilot | no open Critical/High without acceptance; Production Readiness ≥70; restore/load tests pass |
| General availability | Security/Database/Production ≥85; Testing ≥75; Overall ≥80; independent retest passes |

Scores must rise because controls are implemented and verified, not because findings are reclassified.
