# Code Quality and Maintainability Report

**Code Quality score:** **44/100**  
**Maintainability score:** **41/100**

## Summary

The project has a recognizable module structure, strict TypeScript configuration, path aliases, schemas, controllers, services, and a successful type-check. Those strengths are undermined by very large service files, direct database access throughout business services, duplicated financial/authentication patterns, circular dependencies, mixed response/error conventions, dead routes/workers, and a lack of automated tests. The code can be understood, but high-risk changes cannot be made safely or verified cheaply.

## Positive observations

- `npx tsc --noEmit --pretty false` completed successfully during this audit.
- Most domains follow `router -> controller -> service -> schema` and use Zod.
- Shared error, logging, authentication, queue, and provider helpers exist.
- Prisma is instantiated as a singleton.
- Booking status transitions have a central `assertTransition()` concept, although multiple paths bypass or misuse it.
- Constants/enums in Prisma and route modules are generally clearer than free-form strings.

## Structural complexity

Large files concentrate unrelated responsibilities:

| File | Approximate size | Concern |
|---|---:|---|
| `src/modules/workforce/workforce.service.ts` | 1,162 lines | auth, profile, jobs, assignments, wallet, maps/training behavior |
| `src/modules/booking/booking.service.ts` | 1,057 lines | creation, pricing, transitions, dispatch, bids, POD/invoice |
| `src/modules/admin/admin.service.ts` | 919 lines | reporting, CRUD, finance, support, messaging, compliance |
| `src/modules/fleet-owner/fleet-owner.service.ts` | 833 lines | fleet identity, trucks, drivers, assignments, finance |
| `src/modules/driver-wallet/driver-wallet.service.ts` | 658 lines | settlement, cash collection, RazorpayX, withdrawal state |

These are change hotspots with high cyclomatic and cognitive complexity. Business rules, orchestration, provider calls, persistence, and response shaping are intertwined.

## Separation of concerns and SOLID

- Controllers are often thin, but several manually parse data, mutate state, or shape inconsistent responses. Some inline async route handlers bypass standard wrappers.
- Services depend directly on Prisma and other services, so domain logic cannot be isolated in unit tests. There is no repository abstraction; this is not inherently wrong, but persistence must then be deliberately separated through small query/command modules.
- Booking and dispatch directly import each other, producing a circular dependency and ambiguous ownership of assignment state.
- The Single Responsibility Principle is violated in the large services above.
- Open/Closed and Dependency Inversion are weak around provider clients, clocks, queues, and persistence; most dependencies are global imports rather than injected ports.
- Interface Segregation is limited by broad service modules rather than narrow use cases.

## Duplication and inconsistent abstractions

- Customer, driver, fleet, and worker wallets duplicate balance/transaction operations with different locking and idempotency behavior.
- General and workforce OTP flows repeat an insecure caller-controlled FCM design.
- Announcement creation exists in overlapping admin/announcement paths.
- Admin pricing exposes duplicate legacy and current aliases.
- Payment webhooks exist in both the payment controller and an unmounted webhooks router; the more idempotency-aware path is not mounted.
- Role/ownership policy is repeated ad hoc across routers and services.
- Error payload construction varies between global errors, rate limits, Zod, providers, and controllers.

## Dead, unused, and unreachable code

Confirmed/likely examples:

- `src/modules/webhooks/webhooks.router.ts` is never mounted.
- `src/shared/middleware/rateLimiter.ts` is effectively unused/empty while limits are defined elsewhere.
- Dispatch queue infrastructure exists, but normal dispatch is driven by local EventBus and no matching producer was found.
- OTP, notification, and invoice workers are stubs or lack active producers; OTP worker logs rather than delivers.
- Installed packages with no source import found include `@googlemaps/google-maps-services-js`, `@socket.io/redis-adapter`, `@sentry/profiling-node`, `dayjs`, and `pdfmake`.
- Several service imports instantiate `PrismaClient` unnecessarily or are unused.
- Documentation advertises routes/features that do not exist and omits active modules, increasing perceived dead code and integration mistakes.

Unused-package identification is static and should be confirmed with runtime/build tooling before removal.

## Naming, magic values, and readability

- Directory casing and names are inconsistent (`Driver` outside backend, `fleet-owner`, `ulip`, `vahan` meaning web portal rather than government API).
- Route `/:id/accept` means booking ID, while later workforce transition routes use assignment ID, an error-prone semantic overload.
- Driver commission is duplicated as environment/default values and pricing configuration; dispatch retry thresholds and demo identities are embedded constants.
- Monetary units are inconsistent (subscription comment says paise while values are handled as rupee-scale numbers).
- Comments sometimes assert idempotency or authorization the implementation does not provide.

## Error and async quality

Express 5 reduces some async rejection risk, and many handlers use `asyncHandler`. However, inline handlers without `next`, raw enum conversions, Prisma error handling limited mainly to `P2002`, and provider-specific catch blocks cause unpredictable 500/200 behavior. Errors lack a stable machine code/status contract, and expected provider/database failures are not classified.

## Technical debt priorities

1. Write characterization and security regression tests before structural refactors.
2. Introduce a central authorization policy layer and command/query use cases.
3. Extract ledger/payment, dispatch/assignment, OTP/session, and provider adapters from God services.
4. Break the booking-dispatch cycle through events/ports and persisted invitation state.
5. Standardize errors, DTOs, pagination, idempotency, money types, and transaction helpers.
6. Remove or finish dead workers/routes/dependencies only after coverage proves behavior.
7. Add ESLint, formatter, dependency analysis, complexity limits, architecture boundary tests, and duplicate-code reporting.

## Recommended quality gates

- strict type-check, lint, format check, build;
- unit/integration/contract/security tests with coverage thresholds on changed code;
- migration deploy against an empty database and drift detection;
- dependency audit, secret scan, SBOM, SAST;
- API schema compatibility checks;
- complexity/file-size budgets with explicit reviewed exceptions.

## Certification status

The codebase is type-correct but not safely maintainable for high-risk production finance/logistics changes without tests, boundary cleanup, and consistent domain invariants.
