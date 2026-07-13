# Parther Logistics Backend — Project Overview

**Audit date:** 2026-07-11  
**Scope:** `server/` only  
**Method:** Read-only static source/configuration review, route inventory, schema/migration reconciliation, TypeScript compilation, dependency advisory query. No runtime penetration test, live database inspection, infrastructure login, or load test was performed.  
**Build evidence:** `npx tsc --noEmit --pretty false` completed successfully.  
**Inventory:** 138 TypeScript/Prisma/SQL files, about 20,162 measured source lines, 252 declared router handlers, 54 Prisma models, 28 enums, 7 committed migrations.

## Executive understanding

Parther is a modular Express monolith serving customer, driver/fleet-owner, workforce, admin, and public-web clients. It combines REST, two Socket.IO namespaces, BullMQ workers, in-process domain events, scheduled jobs, PostgreSQL through Prisma, Redis, Mapbox, Firebase, DigitalOcean Spaces, Razorpay/RazorpayX, Zoho Mail, Sentry, and ULIP government APIs.

The breadth of implemented product surface is substantial, but the current repository is **not safe to certify for production**. Authentication, money movement, deployment migrations, tracked secrets/PII, and several authorization/state-transition paths contain confirmed release blockers. Treat all “LIVE” labels in existing documentation as unverified product-status claims.

## Technology stack

| Layer | Technology | Evidence |
|---|---|---|
| Runtime/API | Node.js, Express 5.2.1, TypeScript 6.0.3 | `package.json`; `src/app.ts`; `src/server.ts` |
| ORM/database | Prisma 5.22, PostgreSQL | `prisma/schema.prisma:7-12`; `src/shared/db/prisma.ts:23-37` |
| Cache/queue | ioredis, BullMQ | `src/config/redis.ts`; `src/shared/queue/index.ts` |
| Realtime | Socket.IO `/tracking`, `/workforce` | `src/modules/tracking/tracking.gateway.ts:38-40`; `src/modules/workforce/workforce.gateway.ts:20-22` |
| Auth | Phone/workforce OTP; JWT access; DB refresh tokens; Argon2 admin password | `src/modules/auth/auth.service.ts`; `src/modules/workforce/workforce.service.ts`; `src/modules/admin/admin.service.ts` |
| Maps | Mapbox Geocoding v5 and Directions v5 | `src/modules/maps/maps.service.ts:61-71,206-211` |
| Object storage | DigitalOcean Spaces through AWS S3 SDK | `src/modules/upload/upload.service.ts:24-42` |
| Push | Firebase Admin/FCM | `src/config/firebase.ts`; notification module |
| Payments | Razorpay PG and RazorpayX | payment, wallet, driver-wallet, webhook modules |
| Government APIs | ULIP: SARATHI, VAHAN, FASTAG, eChallan, DigiLocker | fleet/ULIP modules |
| Email | Nodemailer over Zoho SMTP | `src/config/mailer.ts` |
| Observability | Winston, Morgan, Sentry | shared logger, `src/config/sentry.ts` |
| Scheduling | node-cron, `setInterval`, BullMQ repeat jobs | engagement, cleanup, ETA jobs |
| Deployment | GitHub Actions SSH/SCP; PM2; DigitalOcean and AWS targets | `.github/workflows/deploy.yml` |

## Actual folder structure

```text
server/
├── .github/workflows/deploy.yml
├── package.json / package-lock.json / tsconfig.json
├── prisma/
│   ├── schema.prisma                 # 54 models; source-of-runtime shape
│   └── migrations/                   # only 7; materially behind schema
├── src/
│   ├── app.ts                        # middleware and REST registration
│   ├── server.ts                     # process bootstrap and sockets
│   ├── workers.ts                    # starts all BullMQ workers
│   ├── config/                       # env, Redis, Firebase, maps, mail, Sentry
│   ├── database/                     # seeds, resets, pricing migration scripts
│   ├── modules/                      # feature routers/controllers/services/schemas
│   │   ├── auth, user, booking, pricing, maps, wallet, payment, rewards
│   │   ├── fleet, fleet-owner, fleet-wallet, driver-wallet, workforce
│   │   ├── support, notifications, announcement, upload, subscription
│   │   ├── tracking, dispatch, ulip, webhooks, admin, training, gamification
│   └── shared/                       # DB, errors, middleware, logger, queue,
│       └── eventbus, jobs, sockets, services, types, utilities
└── ad-hoc test/reset/check scripts   # not an automated test suite
```

## Runtime architecture

```text
Mobile/Web/Admin clients
        |
        | HTTPS REST + Socket.IO (edge/reverse proxy not committed)
        v
Express monolith / PM2
  |-- middleware: Helmet -> CORS -> body parsers -> compression -> Morgan -> limits
  |-- REST modules under /api/v1
  |-- Socket.IO /tracking and /workforce (in-memory adapter)
  |-- EventEmitter2 listeners (non-durable)
  |-- BullMQ workers in the same process
  |-- cron/setInterval jobs in every process
  |
  +--> Prisma --> PostgreSQL
  +--> ioredis --> Redis / BullMQ
  +--> Mapbox
  +--> Firebase FCM
  +--> DigitalOcean Spaces
  +--> Razorpay / RazorpayX
  +--> Zoho SMTP
  +--> ULIP government endpoints
  +--> Sentry
```

## Request flow

1. Production HTTP redirect is applied from forwarded-protocol headers (`app.ts:47-57`).
2. Helmet and CORS run (`app.ts:60-72`).
3. Razorpay and RazorpayX raw-body routes are registered before JSON parsing (`app.ts:75-87`).
4. JSON/urlencoded parsing, compression, and Morgan run (`app.ts:89-95`).
5. Global, auth, admin-auth, and conditional POD rate limits run (`app.ts:98-143`).
6. Router-specific authentication/RBAC/validation runs.
7. Controllers generally call services and format a response; admin/subscription contain some inline logic.
8. Errors reach Sentry then the global handler (`app.ts:192-195`).

## Authentication flows

### Customer/driver/fleet flow

`POST /auth/send-otp` generates an OTP, writes Redis and memory, and sends it by FCM; `POST /auth/verify-otp` upserts a user, issues a 15-minute access JWT and a 30-day JWT-form refresh token stored in PostgreSQL. Refresh deletes the old token then creates a new pair. See the critical security defects in `04_Security_Report.md`: caller-controlled FCM delivery and caller-controlled role destroy the trust model.

### Workforce flow

Separate OTP endpoints use a different Redis namespace and issue a contextual `WORKER` token. This duplicates auth logic, retains a production memory fallback, can reactivate deactivated users, and inherits the caller-controlled FCM OTP defect (`workforce.service.ts:89-179`).

### Admin flow

Email/password login uses Argon2 and DB-backed opaque UUID refresh tokens (`admin.service.ts:44-93`). Password reset uses a one-hour plaintext UUID token (`admin.service.ts:109-153`). This otherwise stronger flow is bypassed by the general OTP role-escalation flaw.

## Database flow

Services import one shared Prisma client (`src/shared/db/prisma.ts`). Most ordinary writes use Prisma parameterization; no runtime SQL-injection sink was found. Some finance/state workflows use transactions, but many check-then-update sequences are not atomic. The schema uses many `Float` money fields and contains 54 models, while committed migrations create only 22 tables. A clean deployment cannot reproduce the runtime schema.

## File upload flow

Authenticated multipart requests use in-memory Multer, then public-read S3-compatible object writes. General uploads allow JPEG/PNG/WEBP/GIF/PDF based on client MIME; avatar uploads restrict image MIME. Keys are UUID-based but not user-owned. Any authenticated user can delete any known key (`upload.controller.ts:103-132`), and content signatures are not inspected.

## External services and third parties

| Service | Use | Call mode | Key audit concern |
|---|---|---|---|
| PostgreSQL | system of record | synchronous | migrations incomplete; Float money; sensitive plaintext |
| Redis | OTP, maps/pricing cache, locations, BullMQ | synchronous/best effort | mixed required/optional semantics |
| Mapbox | geocoding/routing | synchronous | public cost surface; v5; limited validation |
| Firebase | OTP and notifications | synchronous/fire-and-forget | caller can choose OTP delivery token |
| Spaces/S3 | files/KYC | synchronous | delete IDOR; public-read; MIME trust |
| Razorpay | booking/top-up/commission collection | synchronous + webhook | cross-flow replay and idempotency defects |
| RazorpayX | payouts | fire-and-forget + webhook | retry/refund double-payout defects |
| ULIP | government verification/KYC | BullMQ and direct calls | TLS verification disabled; PII logs/storage |
| Zoho | admin reset email | synchronous | vulnerable Nodemailer version |
| Sentry | errors/traces | SDK | caught webhook errors bypass it |

## Queue systems and background jobs

| Component | Actual state |
|---|---|
| ULIP queue | Used; controller adds jobs and worker processes them |
| ETA queue | Used; repeatable 60-second batch |
| Dispatch queue | Worker exists, but no producer; dispatch is called directly by EventBus |
| OTP queue | Worker is an MSG91 stub and no producer uses it |
| Notification queue | Stub worker; no producer |
| Invoice queue | Stub worker; no producer; invoice endpoint returns JSON synchronously |
| Cleanup | In-process 24-hour interval for location history and refresh tokens |
| Engagement | In-process cron pushes three times weekly |

## Notification flow

Booking/domain events trigger FCM plus `UserNotification` inserts. Some direct service calls are awaited; others are fire-and-forget. Three public notification endpoints permit unauthenticated arbitrary sends/subscriptions. Scheduled promos target `all_users`, but topic enrollment correctness is outside this repository.

## Booking/payment flow

Bookings are created as `DRAFT`, confirmed, dispatched, accepted, picked up, delivered by stop, and completed. Multiple code paths bypass the declared state-machine guard. Fare calculation calls Mapbox and a DB-configured pricing engine. The booking stores pre-GST `totalFare`, not calculated `grandTotal`; payment charges `totalFare`. Multi-stop pricing uses only the first stop.

Razorpay creates an order and stores its ID. Frontend verify checks HMAC; a separate raw webhook handles captured/failed events. Wallet top-up, driver commission payment, fleet/driver/worker wallets, and RazorpayX payouts are implemented, but the system is not a true double-entry ledger and has confirmed replay, race, refund, and duplicate-settlement paths.

## Deployment architecture (observed, not certified)

The workflow deploys the monolith to a DigitalOcean host first via root-path Git operations, migration, build, and PM2 restart; it then checks out/builds on GitHub and copies compiled assets to an AWS host, restarting PM2 there. No committed Nginx/Cloudflare configuration proves routing, TLS termination, health routing, or whether both hosts receive general traffic. Both hosts would start sockets, workers, cron, and in-process events, while Socket.IO and rate limits remain process-local.

## Scope limitations

- No `.env` values were disclosed or validated against live infrastructure.
- No live endpoint was invoked and no database rows were changed.
- Dependency results reflect `npm audit`/`npm outdated` on 2026-07-11.
- Capacity conclusions are architectural estimates, not benchmark results.
- Legal/RBI/GST/ULIP observations require counsel/compliance confirmation.
