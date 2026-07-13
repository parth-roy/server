# Architecture Audit

## Score

**Architecture: 50/100 (5.0/10).** The feature-first monolith, shared Prisma client, central middleware, typed validation, and explicit services are sound foundations. The score is limited by critical migration drift, duplicated auth/financial logic, non-durable orchestration, unsafe multi-instance behavior, module cycles, oversized services, and numerous business invariants enforced only by convention.

## Module boundaries and organization

### Strengths

- Feature folders generally follow router → controller → service → schema.
- Shared error, database, queue, event, logger, and socket facilities reduce basic duplication.
- Prisma is centralized (`src/shared/db/prisma.ts:23-37`), preventing per-module pools.
- Core booking access helpers and a named state-transition map exist (`booking.service.ts:32-51,146-159`).
- Fleet-owner ownership helpers are used across truck/maintenance/fuel/document operations.

### Confirmed boundary defects

| Finding | Evidence | Consequence |
|---|---|---|
| Circular booking/dispatch dependency | booking imports dispatch at `booking.service.ts:14`; dispatch imports booking at `dispatch.service.ts:6` | Fragile CommonJS initialization and hard-to-test lifecycle coupling |
| Controllers contain integration/business logic | payment controller is 332 lines and directly operates Prisma/Razorpay; subscription router contains service orchestration | Inconsistent layering and test seams |
| God services | workforce 1,162 lines; booking 1,057; admin 919; fleet-owner 833; driver-wallet 658 | High change risk and cognitive load |
| Auth duplicated | auth and workforce independently implement OTP/JWT/refresh behavior | Security drift: production fallback and role behavior differ |
| Financial logic fragmented | wallet, payment, driver-wallet, fleet-wallet, workforce, admin all mutate balances | No single ledger/invariant boundary; replay/idempotency policy differs |
| State machine not centralized | direct booking status writes in bidding, fleet assignment, accept/decline, POD, workforce | Declared invariant is not enforceable |
| Webhook implementations duplicated | `payment.controller.ts` and `webhooks.controller.ts`; `webhooks.router.ts` unmounted | Different idempotency/error behavior on nominally same integration |
| Queue declarations overstate use | only ULIP and ETA have producers | Operational complexity without durability benefit |

## Separation of concerns

Controllers are usually thin, especially user/support/booking wrappers. Exceptions are material: payment owns persistence, HMAC, provider calls, state completion, and HTTP responses; invoice construction lives in booking controller; admin controller validates and performs CSV rendering; subscription defines schema and handlers inline. Services frequently call FCM directly and also emit events, mixing domain state and side effects.

There is no repository layer. For a monolith of this size, Prisma in services is acceptable; introducing repositories everywhere would add ceremony. The needed abstraction is narrower: ledger, booking-state, identity/role, provider adapters, and outbox boundaries.

## Request and orchestration integrity

- EventEmitter2 handlers are async but non-durable. A state commit followed by process death loses dispatch, reward, or notification work (`shared/eventbus/listeners.ts`).
- Several services use fire-and-forget promises for settlement, payout, notification, location persistence, and redispatch. Errors are logged but no durable recovery exists.
- Workers, cron, HTTP, and sockets run in the same process (`server.ts:52-70`). Scaling or restarting any concern affects all others.
- `setTimeout` drives redispatch (`dispatch.service.ts:238-243,265-269`); timers disappear on restart and duplicate when multiple events fire.
- Web/worker process shutdown does not retain and close BullMQ workers, cron tasks, or Socket.IO; there is no forced shutdown deadline (`server.ts:77-92`).

## Circular dependencies

One direct source cycle is confirmed:

```text
booking.service.ts
  -> dispatch.service.ts (handleDriverDecline)
  -> booking.service.ts (cancelBookingBySystem)
```

Recommended boundary: a booking state-command service with no dispatch import; dispatch reacts via an outbox/queue and requests cancellation through a narrow command interface.

## Duplication and dead code

Confirmed unused/dead or misleading elements:

- `src/modules/webhooks/webhooks.router.ts` is never mounted.
- The payment webhook is declared both directly in `app.ts` and in `payment.router.ts`; the latter handler is effectively unreachable because the first handler responds.
- `src/shared/middleware/rateLimiter.ts` is empty.
- OTP/notification/invoice workers are stubs; their queues have no producers.
- Dispatch worker has no producer; direct EventBus dispatch is used.
- `saveLocationHistory()` and `deductMoney()` have no call sites.
- Announcement creation is duplicated; the announcement service creation function has no route call site.
- `PrismaClient` is imported but unused across multiple services/controllers.
- Dependencies unused by runtime source include `@googlemaps/google-maps-services-js`, `@socket.io/redis-adapter`, `@sentry/profiling-node`, `dayjs`, and `pdfmake`.

## Unreachable or broken API architecture

- Workforce dispatch pre-creates a `PENDING_ACCEPTANCE` assignment, but `acceptJob()` rejects any existing assignment (`dispatch.service.ts:375-389`; `workforce.service.ts:564-576`). The route parameter is treated as booking ID for accept/decline and assignment ID for subsequent transitions.
- `/bookings/:id/arrive` is normally invalid because accept already sets `DRIVER_ARRIVING`; it cannot record arrival for the direct-dispatch flow.
- The mounted legacy payment webhook route is shadowed by the raw app route.
- Two otherwise better idempotent webhooks in `webhooks.router.ts` are not mounted; only RazorpayX is wired directly.
- Documentation advertises rewards redemption, but the router exposes scratch cards instead.

## Recommended target architecture

Keep a modular monolith, but establish enforceable domain boundaries:

```text
HTTP/Socket adapters
  -> Identity & policy layer
  -> Application commands/queries
       -> Booking aggregate/state machine
       -> Pricing snapshot
       -> Ledger (integer minor units, idempotency keys)
       -> Payout aggregate
  -> Prisma transaction boundary
  -> Outbox table
       -> dedicated BullMQ workers
            -> FCM / Razorpay / RazorpayX / ULIP / email / sockets
```

Priorities:

1. Centralize identity/role issuance and remove client-selected privileged roles.
2. Centralize all money mutation in an append-only, idempotent ledger.
3. Make booking transitions conditional database updates through one command service.
4. Use a transactional outbox and dedicated worker process.
5. Add Redis Socket.IO adapter, distributed rate limits, and leader-safe schedules before horizontal scaling.
6. Split the five largest services by bounded capability, not by generic “repository” wrappers.

## Architecture certification conclusion

The monolith is a reasonable deployment unit for the current team and product. A microservice rewrite is not recommended. Production certification requires fixing the trust and transactional boundaries; merely reorganizing folders would not address the failures.
