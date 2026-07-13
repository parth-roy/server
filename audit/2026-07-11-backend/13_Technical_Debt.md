# Technical Debt Register

## Executive view

Technical debt is concentrated in five compounding areas: unaudited security shortcuts, inconsistent money/state invariants, non-reproducible persistence, process-local operational behavior, and absence of automated tests. This is not primarily cosmetic debt. It raises the probability that routine feature work creates financial or privacy incidents.

## Debt portfolio

| Debt theme | Current symptom | Business cost | Recommended treatment | Size |
|---|---|---|---|---:|
| Identity/auth | OTP delivery and role derived from client input; demo bypass; raw tokens | account/admin compromise; fraud | redesign challenge/session model and policy tests | XL |
| Authorization | router role checks plus scattered ownership conditions | IDOR/privacy/trip disruption | central resource policy layer and generated matrix tests | L |
| Financial ledger | duplicated wallet implementations, Float money, non-idempotent operations | monetary loss, reconciliation/tax error | canonical immutable ledger, fixed money, idempotent commands | XL |
| Booking/assignment state | bypassed transitions, ephemeral invitations, non-atomic allocation | double assignment, stuck trips, support burden | explicit state machines and transactional allocation | XL |
| Pricing truth | route/tax/commission/payable totals disagree | margin leakage and invoice disputes | versioned quote snapshot and one calculation core | XL |
| Database evolution | Prisma schema far ahead of migration history | deploy/restore failures and environment drift | production baseline plus continuous drift testing | XL |
| Tests | essentially no automated suite | slow unsafe change and repeated regressions | layered test platform, fixtures, coverage/security gates | XL |
| Service boundaries | five God services and booking-dispatch cycle | large blast radius and difficult ownership | use-case extraction after characterization tests | XL |
| Runtime topology | local sockets/events/timers/limits/jobs across hosts | missed/duplicate work and poor scaling | Redis/outbox/durable queues and process separation | XL |
| API contracts | inconsistent errors/validation, duplicate routes, docs drift | client breakage and integration cost | generated OpenAPI, uniform DTO/errors, version policy | L |
| Data privacy | plaintext raw KYC/bank/tokens and PII logging | regulatory and identity risk | encryption/redaction/retention/access auditing | XL |
| Delivery/infra | mutable server deploys and undocumented edge/DR | outage and non-recoverable release | immutable artifacts, IaC, staged rollout, restore drills | XL |
| Dependencies | vulnerable/outdated/unused packages | exploit and upgrade backlog | automated tested update cadence/SBOM | M |
| Observability | no traces/metrics/SLO/correlation | high MTTR and hidden fraud | OTel, metrics, security/business alerts/runbooks | L |

## Architecture debt

The nominal module boundary is useful, but services directly share Prisma and call one another across domains. Booking owns parts of dispatch, dispatch calls booking, driver wallet owns settlement/provider payout, admin reaches into many domains, and workforce combines identity through earnings. There is no stable application-command layer separating policy, transactions, provider effects, and transport DTOs.

Recommended target inside the monolith:

```text
transport (HTTP/socket/queue)
        -> application commands/queries
             -> domain policies/state machines
             -> persistence ports/transaction boundary
             -> provider ports + outbox
```

Do not begin with broad repository interfaces or microservices. First isolate the high-risk commands—authenticate, quote/create booking, accept/assign, pickup/complete, pay/refund, settle, withdraw—and make their invariants executable tests.

## Data debt

- Migration history is not authoritative.
- Financial values lack a stable unit/type and ledger invariant.
- Constraints do not prevent duplicate bids/allocations/idempotency references.
- State is redundantly represented with no consistency mechanism.
- High-volume tables lack lifecycle/partition policy.
- Government/provider payloads are mixed into operational records.
- Cascades conflict with financial/audit retention.

Data remediation must include backfill reconciliation and accounting sign-off, not merely schema alteration.

## Code debt and cleanup candidates

- Split `workforce.service.ts`, `booking.service.ts`, `admin.service.ts`, `fleet-owner.service.ts`, and `driver-wallet.service.ts` by use case.
- Break booking/dispatch circular imports using persisted invitations and outbox events.
- Consolidate general/workforce authentication around one safe challenge implementation.
- Consolidate wallet variants around one ledger core with owner adapters.
- Mount one hardened webhook implementation and delete the duplicate only after contract tests.
- Remove/finalize dispatch, OTP, notification, and invoice worker scaffolding.
- Remove duplicate pricing/announcement APIs through a versioned deprecation plan.
- Confirm and remove unused dependencies; enable the Redis adapter if it remains required.
- Replace manual parsing with uniform Zod schemas for params/query/body and response DTOs.
- Centralize constants/configuration; prohibit direct `process.env` access outside config.

## Documentation debt

Documents are extensive but materially stale. Examples include outdated role/vehicle/schema descriptions, missing active workforce/fleet/pricing endpoints, an advertised rewards redemption route that is not implemented, conflicting live/stub status, frontend-state terminology in backend flow docs, and security claims about upload key scoping that code does not enforce.

Make OpenAPI and schema references generated from executable sources; make narrative docs link to versioned decisions and tested runbooks. Assign owners and freshness dates.

## Debt governance

- Freeze net-new debt in auth, money, state, migration, and deployment code.
- Assign each item an owner, target release, risk, dependency, and acceptance test.
- Reserve explicit capacity (initially at least 60–70% of backend effort) until P0/P1 debt closes.
- Track change-failure rate, escaped defects, security findings, migration drift, coverage of critical invariants, dependency age, p95/p99, queue lag, reconciliation exceptions, and restore-test success.
- Architectural exceptions must be time-limited ADRs with compensating controls.

## Estimated program size

A credible remediation is a multi-team effort, not a short cleanup. With parallel security/identity, finance/data, platform/DevOps, and QA streams, the P0 stabilization is plausibly 4–8 weeks; production certification and scale readiness are more likely 3–6 months, depending on data migration, provider constraints, incident scope, and external retesting. Estimates require refinement after product decisions and production-data profiling.
