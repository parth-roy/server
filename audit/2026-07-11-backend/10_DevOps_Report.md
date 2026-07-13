# DevOps and Dependency Report

**DevOps/infrastructure readiness:** **20/100**

## Executive conclusion

The repository has a GitHub Actions deployment workflow and an application health endpoint, but the workflow is unsafe as a production delivery system: one target is mutated before source checkout, validation, build, or tests; deployments pull mutable Git state on servers; migrations precede build validation; another host receives a separately built copy; action versions are not fully pinned; and no rollback, artifact promotion, deployment concurrency, approval, IaC, backup, or disaster-recovery evidence exists.

## CI/CD audit

`.github/workflows/deploy.yml` deploys the backend to DigitalOcean before checkout/build/test on the runner. The remote sequence uses destructive Git reset/pull-style state, `npm install`, migration, build, and PM2 restart. Consequences:

- a source/install/migration failure occurs directly on production;
- database migration can succeed before compilation fails;
- there is no unit/integration/security verification;
- runtime dependency resolution is less deterministic than `npm ci` from a reviewed lockfile;
- mutable branches and two independent build paths can produce different artifacts;
- no automatic rollback exists after irreversible migrations;
- concurrent pushes can overlap because workflow concurrency is absent.

The AWS path builds after checkout on the runner and copies files, but does not apply the same database migration path. `appleboy/scp-action@master` is mutable rather than commit-SHA pinned. No protected environment approvals, signed provenance, artifact checksum, or release manifest is evident.

## Required pipeline shape

```text
commit -> secret/SAST/dependency gates -> type/lint/test
       -> empty-DB migration + integration tests -> build once
       -> SBOM/sign immutable artifact/container
       -> staging deploy + smoke/contract tests
       -> approved production rollout (one artifact)
       -> health/SLO verification -> canary/blue-green promote or rollback
```

Database changes require expand/contract compatibility. Backward-incompatible migrations must not be coupled to an immediate restart across two mutable hosts.

## Runtime and infrastructure

No committed Dockerfile, Docker Compose production topology, PM2 ecosystem definition, Nginx/reverse-proxy config, Terraform/Pulumi/CloudFormation, network policy, autoscaling policy, or hardened host specification was found. Documentation mentions PM2/Nginx and two hosts, but configuration evidence is required for audit.

Production requirements:

- immutable least-privilege runtime user and read-only root filesystem where feasible;
- documented Node version, resource requests/limits, graceful shutdown/readiness, and drain behavior for HTTP/sockets/workers;
- separate API, realtime, scheduler, and worker process profiles;
- private database/Redis/provider egress controls, firewall/security-group rules, and direct-origin denial;
- managed TLS with renewal alerts, HSTS at the trusted edge, and proxy-header allowlisting;
- centralized secrets manager with short-lived workload identity where supported;
- infrastructure as code, configuration review, drift detection, and asset inventory.

## Environment and secret management

`env.ts` validates several core variables, which is positive, but Razorpay values are optional and Firebase, S3, Mapbox, RazorpayX, commission thresholds, and payout-account configuration are not comprehensively validated. Some services access `process.env` directly (`driver-wallet.service.ts:14-22,417-423,498`), permitting partial boot and runtime failure.

Tracked credentials/default passwords are a confirmed incident. Move secrets to a managed vault, separate staging/production identities, rotate regularly, prohibit secret values in logs, and run pre-commit plus server-side secret scanning over full history.

## Availability, deployment, and recovery

- `/health` exists, but liveness and readiness are not clearly separated; dependency health endpoints can reveal internals.
- Socket.IO and jobs are not multi-host safe; restarting one host can lose rooms/timers/events.
- No canary/blue-green plan, graceful PM2 reload proof, or rollback runbook is committed.
- No database PITR evidence, backup retention, encrypted restore media, cross-region copy, restore drill, or defined RPO/RTO.
- No Redis persistence/eviction/failover policy is documented.
- No provider outage runbooks, queue replay/DLQ operations, or incident communication process was found.

Recommended baseline: multi-AZ managed PostgreSQL with tested PITR, immutable encrypted backups, quarterly restore exercises, explicit RPO/RTO, infrastructure recovery automation, and game-day testing.

## Dependency inventory findings

`npm audit --json` on 2026-07-11 found **20 vulnerabilities: 8 high, 12 moderate**. High-severity affected chains include Multer, Nodemailer, `ws`, `@grpc/grpc-js`, `protobufjs`, and `form-data`. Moderate issues include Morgan log forging and Firebase Admin/OpenTelemetry transitive chains. Upgrade and retest based on the audit's exact dependency paths; do not suppress advisories without documented reachability/risk acceptance.

Notable version/debt observations from `npm outdated`:

- Prisma 5.22 is multiple major versions behind 7.8; upgrade requires a planned compatibility/migration project, not a blind bump.
- Firebase Admin 13.10 trails 14.1.
- Nodemailer 8.0.11 trails 9.0.3.
- Multer 2.1.1 should move at least to the patched 2.2.x line after tests.
- Morgan 1.10.1 has a newer patched line.

Likely unused direct packages based on source import search: `@googlemaps/google-maps-services-js`, `@socket.io/redis-adapter`, `@sentry/profiling-node`, `dayjs`, and `pdfmake`. The Redis adapter is operationally needed but currently unused; decide whether to wire it or remove it. Runtime `dependencies` also contain `@types/multer`, `@types/node-cron`, and `@types/nodemailer`, which belong in development dependencies. Confirm with dependency analysis/build before changing.

## Direct dependency-by-dependency review

This table accounts for every direct manifest entry. “Likely unused” is based on static import search and must be confirmed against dynamic loading/build behavior before removal. Transitive advisory detail is summarized above and retained in the captured `npm audit` result from this audit session.

| Runtime dependency | Declared version | Observed purpose/status | Audit disposition |
|---|---:|---|---|
| `@aws-sdk/client-s3` | `^3.1048.0` | S3 object upload/delete | Used; keep modular client, add upload security/timeouts |
| `@aws-sdk/s3-request-presigner` | `^3.1045.0` | presigned S3 operations | Used/available; direct-upload design recommended |
| `@googlemaps/google-maps-services-js` | `^3.4.2` | Google Maps SDK | Likely unused; Mapbox implementation is active; remove if confirmed |
| `@prisma/client` | `^5.22.0` | PostgreSQL ORM runtime | Used; major upgrade debt and migration testing required |
| `@sentry/node` | `^10.56.0` | error monitoring | Used; add release/trace/redaction integration |
| `@sentry/profiling-node` | `^10.56.0` | native profiling | Likely unused; remove or deliberately configure/test |
| `@socket.io/redis-adapter` | `^8.3.0` | multi-node realtime adapter | Installed but unused; wire before replicas or remove until planned |
| `@types/multer` | `^2.1.0` | TypeScript declarations | Misclassified runtime dependency; move to dev dependency |
| `@types/node-cron` | `^3.0.11` | TypeScript declarations | Misclassified and may conflict with package-owned types; move/remove after type-check |
| `@types/nodemailer` | `^8.0.1` | TypeScript declarations | Misclassified runtime dependency; move to dev dependency |
| `argon2` | `^0.44.0` | admin password hashing | Used; appropriate primitive; native build/supply-chain testing needed |
| `axios` | `^1.16.0` | external HTTP integrations | Used; standardize timeouts/retries/TLS through configured clients |
| `bullmq` | `^5.76.8` | Redis queues/workers | Partially used; topology/producers/idempotency/DLQ incomplete |
| `compression` | `^1.8.1` | HTTP response compression | Used; avoid compressing already-compressed/secret-sensitive responses where applicable |
| `cors` | `^2.8.6` | browser origin policy | Used; allowlist positive, test environment configuration |
| `dayjs` | `^1.11.20` | date helper | Likely unused; remove if confirmed |
| `dotenv` | `^17.4.2` | local environment loading | Used; production should use managed injected secrets |
| `eventemitter2` | `^6.4.9` | in-process domain events | Used; non-durable/non-distributed, replace for critical events |
| `express` | `^5.2.1` | HTTP framework | Used; Express 5 async behavior positive; contract/error gaps remain |
| `express-rate-limit` | `^8.5.1` | request throttling | Used; memory store is not multi-node safe |
| `firebase-admin` | `^13.9.0` | FCM push | Used; outdated to 14.x and audit has transitive advisories; upgrade/test |
| `helmet` | `^8.1.0` | security headers | Used; retain and test trusted-edge interaction |
| `ioredis` | `^5.10.1` | Redis/cache/BullMQ connections | Used; define TLS, failover, pool and eviction behavior |
| `jsonwebtoken` | `^9.0.3` | access/refresh JWT | Used; library is adequate, token design is not |
| `morgan` | `^1.10.1` | HTTP access logs | Used; audit advisory/log-forging and production level suppression; upgrade/sanitize |
| `multer` | `^2.1.1` | multipart memory uploads | Used; high advisory, move to patched line and redesign buffering |
| `node-cron` | `^4.6.0` | scheduled cleanup/jobs | Used; process-local duplicate execution risk |
| `nodemailer` | `^8.0.11` | email/provider delivery | Used; high advisory chain and newer major available; never expose raw options |
| `pdfmake` | `^0.3.8` | PDF generation | Likely unused; remove if invoice path does not dynamically load it |
| `prisma` | `^5.22.0` | CLI/generator | Used only for build/dev operations; should be a dev dependency, planned major upgrade |
| `razorpay` | `^2.9.6` | payment order integration | Used; application binding/idempotency defects are critical |
| `socket.io` | `^4.8.3` | realtime tracking | Used; authorization and Redis adapter required |
| `uuid` | `^14.0.0` | identifiers | Used; modern package provides types; verify separate `@types/uuid` need |
| `winston` | `^3.19.0` | structured logging | Used; add redaction/correlation/central transport |
| `zod` | `^4.4.3` | request/config validation | Used; coverage incomplete and response schemas absent |

| Development dependency | Declared version | Observed purpose/status | Audit disposition |
|---|---:|---|---|
| `@types/compression` | `^1.8.1` | compression types | Appropriate dev-only declaration |
| `@types/cors` | `^2.8.19` | CORS types | Appropriate dev-only declaration |
| `@types/express` | `^5.0.6` | Express types | Used; aligned with Express 5 |
| `@types/ioredis` | `^4.28.10` | legacy Redis types | Likely unnecessary/incompatible because ioredis 5 ships types; verify then remove |
| `@types/jsonwebtoken` | `^9.0.10` | JWT types | Appropriate dev-only declaration |
| `@types/morgan` | `^1.9.10` | Morgan types | Appropriate dev-only declaration |
| `@types/node` | `^25.7.0` | Node platform types | Used; ensure production Node major matches this contract |
| `@types/pdfmake` | `^0.3.2` | PDF types | Likely unused with `pdfmake`; remove together if confirmed |
| `@types/uuid` | `^10.0.0` | UUID declarations | Likely unnecessary with UUID 14 package types; verify then remove |
| `nodemon` | `^3.1.14` | local reload | Appropriate dev tool |
| `rimraf` | `^6.1.3` | clean build output | Used by build; appropriate dev tool |
| `ts-node` | `^10.9.2` | TypeScript scripts/dev | Used; old relative to TypeScript 6, compatibility should be tested/upgraded |
| `tsc-alias` | `^1.8.10` | rewrite compiled aliases | Used by build; add artifact smoke test |
| `tsconfig-paths` | `^4.2.0` | runtime aliases for TS scripts | Used by dev/seed scripts |
| `typescript` | `^6.0.3` | compiler | Used; type-check passed during audit |

## Supply-chain controls

Add:

- commit-SHA pinning for all actions and automated update review;
- `npm ci`, lockfile-diff review, registry policy, and lifecycle-script governance;
- SBOM (CycloneDX/SPDX), vulnerability policy, license review, provenance/attestation, and artifact signing;
- secret scanning, CodeQL/SAST, container/base-image scan if containerized;
- Renovate/Dependabot with grouped, tested upgrades;
- protected branches/environments and least-privilege GitHub/SSH credentials.

## Monitoring and incident operations

Sentry and structured logging are present in part, but there is no deploy-quality gate using telemetry. Add centralized logs, Prometheus/OpenTelemetry metrics/traces, dashboards, paging, release markers, and SLO/error-budget policy. Alert on auth anomalies, admin-role creation, wallet credits, payment mismatches, withdrawal retries, duplicate webhook IDs, queue lag/DLQ, provider failures, DB saturation/replication lag, and backup failure.

## Certification status

**Rejected.** The current deployment is mutable, untested, non-reproducible, and lacks demonstrated rollback and disaster recovery.
