# API Audit

## Scope and notation

The code declares **252 router handlers**. Two handlers in `webhooks.router.ts` are unmounted. The direct app registrations add `/health` and RazorpayX while shadowing the router-level payment webhook, yielding **251 effective unique HTTP endpoints**.

Each module section defines inherited columns for every row: authentication, authorization, validation, response/error shape, status codes, pagination/filter/sort, and rate limiting. Row-level “risk” records deviations. `Std` means `{success:true,message,data[,meta]}` on success and global `AppError` on failure. Actual global errors omit the documented `statusCode`; Zod errors also omit `code`.

Global rate limit is 100 requests/15 minutes/IP for `/api/*`, in-memory per process. Auth is 10/15 minutes/IP, admin auth 5/15 minutes/IP, fleet ULIP 10/minute/IP, POD verification 5/5 minutes/IP. No endpoint has user/API-key quota unless noted.

## Effective app-level endpoints

| Method/route | Purpose | Auth/authz | Validation | Response/status | Page/filter/sort | Rate | Security/result |
|---|---|---|---|---|---|---|---|
| `GET /health` | DB/Redis deep health | Public | None | custom 200/503 | — | outside limiter | Liveness and readiness conflated; exposes environment name |
| `POST /api/v1/payments/webhook` | Razorpay PG webhook | HMAC only | raw JSON/signature | custom 200; 400 invalid signature | — | global | Internal failures are acknowledged 200 and lost; no event-id dedupe |
| `POST /api/v1/webhooks/razorpayx` | payout webhook | HMAC only | raw JSON/signature | custom 200/400/global errors | — | global | Mounted directly; refund path is not state-idempotent |

## Auth — `/api/v1/auth`

Defaults: public except `/me`; Zod body validation; Std 200; no pagination/filter/sort; global + auth limiter.

| Method/route | Purpose | Auth/authz | Validation | Risk/result |
|---|---|---|---|---|
| `GET /me` | current identity/profile | JWT, any role | none | DB role/state is not rechecked by middleware |
| `POST /send-otp` | issue phone OTP | Public | phone, optional FCM token and role | Critical: caller FCM token receives OTP for arbitrary phone |
| `POST /verify-otp` | verify OTP/create login | Public | phone/OTP/optional role | Critical: requested `ADMIN` role is placed in JWT |
| `POST /refresh` | rotate refresh token | Public, possession token | nonempty string | delete/create is not one DB transaction; role comes from decoded stored token |
| `POST /logout` | delete one refresh token | Public, possession token | nonempty string | access JWT remains valid until expiry |

## Users — `/api/v1/users`

Defaults: JWT any role; Zod on mutating bodies where listed; Std 200 (avatar also 200); global limit. Collection lists are unpaginated. IDs are not UUID-validated but ownership is checked in services.

| Method/route | Purpose | Validation | Page/filter/sort | Risk/result |
|---|---|---|---|---|
| `GET /me` | profile with related data | none | — | stable ownership |
| `GET /me/stats` | booking/rating totals | none | — | multiple aggregates per request |
| `PATCH /me` | update profile | Zod | — | client can set `profileComplete=true` without required-profile invariant |
| `PUT /me/fcm-token` | replace device token | Zod | — | single-device overwrite |
| `POST /me/avatar` | upload avatar | Multer, MIME allowlist | — | memory upload; content bytes not sniffed |
| `GET /me/addresses` | list addresses | none | default then newest | unpaginated |
| `POST /me/addresses` | add address | Zod | — | default-address race |
| `PATCH /me/addresses/:id` | update owned address | Zod | — | ownership checked |
| `DELETE /me/addresses/:id` | delete owned address | none | — | promotes replacement non-atomically |
| `POST /me/addresses/:id/set-default` | select default | none | — | transaction used; no DB uniqueness invariant |
| `GET /me/gst` | list GST records | none | primary then newest | unpaginated |
| `POST /me/gst` | add GST | Zod | — | duplicate prevention is application-only |
| `DELETE /me/gst/:id` | delete GST | none | — | ownership checked |
| `POST /me/gst/:id/set-primary` | select primary GST | none | — | no DB uniqueness invariant |
| `GET /me/team` | team list | none | newest | unpaginated |
| `POST /me/team` | add team member | Zod | — | team roles are data only, not permission enforcement |
| `PATCH /me/team/:id` | update team member | Zod | — | ownership checked |
| `DELETE /me/team/:id` | remove team member | none | — | ownership checked |

## Bookings — `/api/v1/bookings`

Defaults: JWT; route RBAC as shown; Std; global limit. List query has Zod transform but no bounds/refinement. Several path/body endpoints have no schema.

| Method/route | Purpose | Authorization | Validation | Page/filter/sort | Risk/result |
|---|---|---|---|---|---|
| `GET /driver/active` | driver active trip | DRIVER | none | first active | no deterministic tie if data corruption yields multiple |
| `POST /` | create DRAFT | CUSTOMER | comprehensive Zod | — | only first stop priced; client insurance amount persists; driver check disabled |
| `GET /` | own bookings | CUSTOMER/DRIVER | query transform | page/limit/status; newest | unbounded/NaN/negative page-limit possible |
| `GET /:id` | booking detail | any JWT | none | — | drivers may read any unassigned booking, including DRAFT |
| `PATCH /:id/confirm` | DRAFT→CONFIRMED | CUSTOMER owner | none | — | check/update not conditional; duplicate dispatch possible |
| `PATCH /:id/cancel` | cancel | no route role | reason Zod | — | Critical: non-customer roles are not checked as assigned party |
| `POST /:id/rate` | customer rating | CUSTOMER owner | Zod | — | safe ownership; check/update race |
| `PATCH /:id/arrive` | record arrival | DRIVER assigned | none | — | normally broken because accept already sets same status |
| `PATCH /:id/pickup` | mark picked up | DRIVER assigned | none | — | High: bypasses pickup OTP endpoint |
| `POST /:id/stops/:stopId/request-pod-otp` | generate POD OTP | DRIVER assigned | none | — | limiter applies only paths containing `/pod`; FCM-only delivery |
| `POST /:id/stops/:stopId/pod` | verify POD/complete stop | DRIVER assigned | no body schema | — | non-atomic stop/status flow; OTP compare; photo URL unvalidated |
| `PATCH /:id/complete` | DELIVERED→COMPLETED | DRIVER assigned | none | — | settlement is fire-and-forget and non-idempotent |
| `PATCH /:id/accept` | claim/accept trip | DRIVER | none | — | no available/verified/vehicle/invitation guard; same driver can race two trips |
| `PATCH /:id/decline` | decline/re-dispatch | DRIVER | none | — | any driver may decline broadcast booking; direct reverse transition bypasses state guard |
| `POST /:id/verify-pickup-otp` | verify pickup OTP | DRIVER assigned | no body schema | — | no dedicated brute-force limiter; legacy pickup route bypasses it |
| `POST /:id/bids` | place bid | DRIVER | amount/note Zod | — | no booking status/vehicle/verification guard; uniqueness race |
| `GET /:id/bids` | list bids | CUSTOMER/DRIVER | none | amount ascending | any DRIVER can view competitors and their phone numbers |
| `POST /:id/bids/accept` | accept bid | CUSTOMER owner | bid UUID | — | allows DRAFT→ASSIGNED invalid transition; not transactional; negotiated taxes stale |
| `GET /:id/invoice` | invoice JSON | CUSTOMER | none | — | uses booking access ownership; recomputes values inconsistent with stored/payment totals |

## Wallet and payments

### Customer wallet — `/api/v1/wallet`

Defaults: JWT any role; Std 200; global limit.

| Method/route | Purpose | Validation | Page/filter/sort | Risk/result |
|---|---|---|---|---|
| `GET /` | balance + 20 tx | none | latest 20 | creates wallet on read |
| `GET /transactions` | ledger history | manual parse/clamp | page/limit; newest | acceptable bounds |
| `POST /add` | direct credit | amount Zod | — | Critical: every authenticated user can mint own balance |
| `POST /pay` | pay booking | manual bookingId | — | concurrent calls can double-debit; charges pre-GST `totalFare` |
| `POST /topup/create-order` | Razorpay order | manual positive amount | — | order not persisted/bound to user; max ₹100,000 |
| `POST /topup/verify` | verify and credit | manual required fields | — | check-then-credit race; reference not unique; order ownership not checked |

### Payments — `/api/v1/payments`

Defaults after webhook: JWT any role; manual validation; Std 200; global limit.

| Method/route | Purpose | Auth/authz | Risk/result |
|---|---|---|---|
| `POST /webhook` | duplicate router declaration | Public | effectively shadowed by app-level raw handler |
| `POST /create-order` | booking payment order | booking owner or ADMIN token | concurrent duplicate orders; charges `totalFare` not `grandTotal` |
| `POST /verify` | verify frontend callback | booking owner or ADMIN token | Critical: if stored order is null, any valid payment pair can pay booking; amount/status not fetched |
| `POST /mock-success` | dev payment override | booking owner or ADMIN token | runtime env check only; safe only if production env is correct |

### Driver wallet — `/api/v1/driver/wallet`

Defaults: JWT+DRIVER; no route schemas; Std; global limit.

| Method/route | Purpose | Validation/page | Risk/result |
|---|---|---|---|
| `GET /` | balance + recent ledger | none | — |
| `GET /transactions` | history | raw Number query, unbounded | invalid/huge page-limit may fail or exhaust |
| `POST /pay-commission` | create commission order | none | order identity not stored |
| `POST /pay-commission/verify` | clear debt/credit wallet | no body schema | payment not bound to commission order/driver; cross-ledger replay |
| `POST /withdraw` | create payout | `Number(amount)` only | NaN/Infinity edge; reserve race; async payout |

### Fleet wallet — `/api/v1/fleet/wallet`

Defaults: JWT+FLEET_OWNER; no schemas; Std; global limit.

| Method/route | Purpose | Risk/result |
|---|---|---|
| `GET /` | fleet balance | — |
| `GET /transactions` | history | controller parsing/bounds must be relied on; no route schema |
| `POST /withdraw` | fleet payout | reserve/pending check races |
| `POST /transfer` | fleet→driver transfer | service ownership check exists; finance invariants not DB constrained |
| `POST /offline-salary` | record physical salary | audit/credit semantics can create value; no schema |

## Pricing/maps/public content

### Pricing — `/api/v1/pricing`

Defaults: public; manual validation; Std; global limit; no dedicated cost quota.

| Method/route | Purpose | Validation | Risk/result |
|---|---|---|---|
| `GET /vehicles` | active vehicle pricing | none | cached; exposes internal pricing intentionally |
| `POST /estimate` | one-vehicle estimate | presence checks | rejects valid zero coordinates; coercion allows NaN; writes audit row per public call |
| `POST /estimate-all` | all vehicle estimates | presence checks | one Mapbox call; public cost surface |
| `GET /config` | public pricing config | none | suitable for caching |
| `GET /surge-status` | surge flag | ignores query | static stub response |

### Maps — `/api/v1/maps`

Defaults: public, including recent searches; manual validation; custom success; global limit. No pagination contract except recent limit.

| Method/route | Purpose | Validation | Page/filter/sort | Risk/result |
|---|---|---|---|---|
| `GET /autocomplete` | Mapbox search | input presence | Mapbox limit 5 | no length/country restriction; cost abuse |
| `GET /place-details` | place lookup | ID presence | — | public cost abuse |
| `GET /reverse-geocode` | coords→address | parseFloat only | — | NaN/range not rejected |
| `GET /geocode` | address→first result | presence only | first result | invokes two provider operations |
| `GET /distance-matrix` | route distance/time | truthy strings | — | NaN/range not rejected; retries provider |
| `GET /recent-searches` | history | trusts `x-user-id` | raw limit; newest | High IDOR; anonymous users share null bucket |
| `POST /recent-searches` | add history | manual fields | max 20 app-side | trusts `x-user-id`; caller controls address/coords |
| `DELETE /recent-searches/clear` | clear history | trusts `x-user-id` | — | arbitrary-user or global-anonymous deletion |
| `DELETE /recent-searches/:id` | delete one | trusts `x-user-id` | — | absent header deletes any known record by ID |

### Announcements — `/api/v1/announcements`

| Method/route | Purpose | Auth | Validation/page | Risk/result |
|---|---|---|---|---|
| `GET /` | active announcements | Public | none/unpaginated, newest | potentially unbounded; response includes configured target |

## Notifications — `/api/v1/notifications`

Defaults: first three public; remaining JWT; manual validation; custom/Std mix; global limit.

| Method/route | Purpose | Validation | Risk/result |
|---|---|---|---|
| `POST /send` | arbitrary FCM send | required fields only | High: public push relay |
| `POST /send-multicast` | multicast FCM | nonempty array/title/body | High: public; no 500-token cap/payload limits |
| `POST /subscribe` | topic subscribe | token/topic presence | High: public arbitrary topic enrollment |
| `GET /me` | list in-app notices | controller parses page/limit | JWT-owned; count queries |
| `PATCH /read-all` | mark all read | none | JWT-owned |
| `PATCH /:id/read` | mark one | none | ownership checked |

## Upload — `/api/v1/upload`

Defaults: JWT any role; multipart; custom responses; global limit.

| Method/route | Purpose | Validation | Status | Risk/result |
|---|---|---|---|---|
| `POST /single` | upload one file | 10 MB, service MIME allowlist | 200/400/422 | memory buffering; no magic-byte scan; public-read |
| `POST /multiple` | upload ≤10 files | same, sequential provider writes | 200 even partial failure | slow; memory up to ~100 MB/request |
| `DELETE /:key` | delete object | key presence only | 200/422 | High IDOR: no ownership/key prefix enforcement |

## Rewards — `/api/v1/rewards`

Defaults: JWT any role; no schemas; Std; global limit.

| Method/route | Purpose | Page/filter/sort | Risk/result |
|---|---|---|---|
| `GET /me` | coin balance/tier | five latest | creates balance on read |
| `GET /history` | coin ledger | controller clamps page/limit | — |
| `GET /scratch-cards` | list own cards | unpaginated newest | potentially unbounded |
| `POST /scratch-cards/:cardId/scratch` | reveal/credit | none | concurrent requests can double-credit |

## Subscription — `/api/v1/subscription`

Defaults: JWT any role; select has inline Zod; Std; global limit.

| Method/route | Purpose | Risk/result |
|---|---|---|
| `GET /` | driver subscription | driver profile required | — |
| `POST /select` | activate/upgrade plan | High: no payment verification; arbitrary reference; stores rupees in a field documented as paise |

## Support — `/api/v1/support`

Defaults: JWT any role; Zod on creates/messages; Std; global limit; lists unpaginated.

| Method/route | Purpose | Validation | Risk/result |
|---|---|---|---|
| `POST /` | create ticket/message | Zod | booking ownership/reference not checked |
| `GET /` | own tickets | none | unpaginated |
| `GET /:id` | ticket detail | none | ownership checked |
| `POST /:id/messages` | reply | Zod | ownership/closed state checked |

## Fleet onboarding — `/api/v1/fleet`

Defaults below admin override: JWT+DRIVER; no imported route validation despite `fleet.schema.ts`; Std/custom; global. Verification endpoints additionally 10/min/IP.

| Method/route | Purpose | Authz/validation | Risk/result |
|---|---|---|---|
| `POST /admin/drivers/:driverId/verify-override` | manual approval | JWT+ADMIN; no schema | notes/body not validated; admin escalation makes exposed |
| `POST /drivers/register` | create driver | DRIVER; controller/manual | placeholder license and role context |
| `GET /drivers/me` | own driver | DRIVER | raw government response excluded |
| `PATCH /drivers/status` | availability | DRIVER; manual | verified requirement exists here |
| `POST /vehicles/register` | register vehicle | DRIVER; manual | ownership flows in service |
| `POST /drivers/verify-license` | synchronous SARATHI | DRIVER; manual | TLS verification disabled; raw PII stored |
| `POST /vehicles/verify-rc` | synchronous VAHAN | DRIVER; manual | TLS disabled; quota limited |

## ULIP — `/api/v1/ulip`

Defaults: JWT any role; Zod for all current mutators except legacy; Std/202; only global rate limit. Driver/worker profile checks occur in controllers.

| Method/route | Purpose | Validation | Risk/result |
|---|---|---|---|
| `POST /verify-dl` | queue SARATHI | Zod | logs DL number; no dedicated quota |
| `POST /verify-rc` | queue VAHAN | Zod | vehicle ownership not checked |
| `POST /verify-fastag` | queue FASTAG | Zod | arbitrary vehicle number permitted |
| `POST /verify-echallan` | queue challan | Zod | arbitrary vehicle number permitted |
| `POST /digilocker/init` | start Aadhaar KYC | Zod/consent | sensitive PKCE/session stored plaintext |
| `POST /digilocker/verify-otp` | DigiLocker OTP | Zod | no dedicated brute-force limit |
| `POST /digilocker/fetch-docs` | fetch PAN/Aadhaar | Zod | stores base64 documents inline/plaintext |
| `POST /digilocker/manual-upload` | manual KYC URLs | Zod | URLs not constrained to owned storage |
| `GET /digilocker/status` | own KYC status | none | exposes full PAN number in status response |
| `GET /digilocker/document/:type` | own document | manual enum | returns full base64 data URI |
| `POST /verify-digilocker` | deprecated response | none | still exposed; should be 410/removal plan |

## Fleet owners — `/api/v1/fleet-owners`

Defaults: JWT; `/register` has no role guard; remaining routes JWT+FLEET_OWNER. Mutations use Zod except deletes; Std; global limit. Lists are generally unpaginated except pending bookings/earnings.

| Method/route | Purpose | Validation/page/filter/sort | Risk/result |
|---|---|---|---|
| `POST /register` | self-create fleet role/profile/wallet | Zod | self-elevates DB role by design; no eligibility approval |
| `GET /me` | profile | — | — |
| `GET /dashboard` | aggregate dashboard | — | multiple DB queries |
| `POST /trucks` | add truck | Zod | — |
| `GET /trucks` | list trucks | unpaginated | — |
| `PATCH /trucks/:truckId` | update owned truck | Zod | ownership checked |
| `DELETE /trucks/:truckId` | delete truck | none | service blocks active use |
| `PATCH /trucks/:truckId/assign-driver` | set current driver | Zod | membership checked |
| `GET /trucks/:truckId/documents` | documents | none | ownership checked |
| `POST /trucks/:truckId/documents` | add document metadata | Zod | file URL trust |
| `GET /drivers/earnings` | per-driver earnings | none | potentially unbounded aggregation |
| `POST /drivers` | add membership | Zod | target phone/profile required |
| `GET /drivers` | list members | unpaginated | — |
| `DELETE /drivers/:fleetDriverId` | deactivate member | none | ownership checked |
| `GET /bookings/active` | active assigned bookings | unpaginated | — |
| `GET /bookings/pending` | marketplace | Zod query | page/limit/type; oldest | exposes customer pickup data to every fleet owner |
| `POST /bookings/assign` | assign truck/driver | Zod | same truck/driver can race multiple bookings |
| `GET /earnings` | earnings | Zod query | date/page filters | — |
| `GET /maintenance` | list maintenance | optional raw truckId | unpaginated; truck filter not route-schema validated |
| `POST /maintenance` | add maintenance | Zod | ownership checked |
| `PATCH /maintenance/:id` | update maintenance | Zod | ownership checked |
| `DELETE /maintenance/:id` | delete maintenance | none | ownership checked |
| `GET /fuel-logs` | list fuel logs | optional raw truckId | unpaginated |
| `POST /fuel-logs` | add fuel | Zod | ownership checked |
| `DELETE /fuel-logs/:id` | delete fuel | none | ownership checked |
| `GET /analytics` | fleet analytics | none | many aggregates; no cache |

## Workforce — `/api/v1/workforce`

Defaults: auth endpoints public; all others JWT+WORKER. Most body/query endpoints use Zod; transition IDs are not UUID-validated. Std; global limit only. Route `:id` meaning changes from booking ID to assignment ID.

| Method/route | Purpose | Validation/page/filter/sort | Risk/result |
|---|---|---|---|
| `POST /auth/send-otp` | workforce OTP | Zod | caller FCM account takeover; production memory fallback |
| `POST /auth/verify-otp` | login/create worker | Zod | reactivates user; forces contextual role; no refresh route of its own |
| `GET /dashboard/stats` | dashboard | — | multiple queries |
| `GET /jobs/active` | active assignment | — | first, nondeterministic if corruption |
| `GET /jobs/available` | feed | Zod query; page/limit/type/payout/distance/sort | totals computed only from fetched page; in-memory filtering |
| `GET /jobs/nearby-pins` | map jobs | Zod query | fetches all candidate bookings globally then filters in memory |
| `GET /jobs/history` | completed/cancelled | Zod query; page/limit/status | enum includes nonexistent assignment cancellation behavior |
| `POST /jobs/:id/accept` | accept job | none | broken with pre-created assignments; slot/worker races; ID ambiguity |
| `POST /jobs/:id/decline` | decline job | Zod reason | treats ID as booking ID |
| `POST /jobs/:id/arrive` | assignment transition | none | treats ID as assignment ID; ownership checked |
| `POST /jobs/:id/start` | start work | none | state checked |
| `POST /jobs/:id/request-otp` | completion OTP | none | creates plaintext DB OTP; FCM delivery |
| `POST /jobs/:id/complete` | complete/credit | Zod optional OTP | OTP verification deliberately removed; concurrent double payout |
| `GET /wallet/balance` | balance/pending | — | creates wallet on read |
| `GET /wallet/transactions` | history | manual parse | unbounded raw page/limit |
| `GET /wallet/earnings-chart` | chart | Zod period | loads transactions and groups in application |
| `POST /wallet/withdraw` | request payout | Zod amount | reserve/pending race |
| `GET /profile/me` | worker profile | — | includes plaintext bank/KYC/session fields unless select limits are applied (full include returned) |
| `PATCH /profile/status` | online status | Zod | doc-verification check commented out |
| `PATCH /profile/location` | GPS | Zod | duplicates socket route |
| `PATCH /profile/bank-details` | bank data | Zod | no bank verification before storage |
| `PUT /profile/preferences` | work preferences | Zod | — |
| `PATCH /profile/settings` | language/notification | Zod | — |
| `DELETE /profile/account` | soft deactivate | none | access token remains valid; ledger retention unclear |
| `POST /profile/documents` | save KYC URLs | Zod | URLs not bound to owned object keys |
| `GET /performance/metrics` | metrics | — | several counts |
| `GET /safety/alerts` | static tips | — | — |
| `POST /safety/sos` | SOS notification/email/log | Zod coords/message | no dedicated abuse limit; operational dispatch is not evidenced |
| `GET /badges` | evaluate/list badges | — | writes/evaluates on GET; N badge operations |
| `GET /training/courses` | course catalog | — | dedicated controller; unpaginated |
| `POST /training/courses/:id/progress` | update progress | no route schema | service must constrain progress |
| `GET /announcements` | workforce announcements | — | unpaginated |

## Admin — `/api/v1/admin`

Defaults: five public auth routes; every subsequent route JWT+ADMIN. Most admin controller methods parse Zod internally even though router middleware is absent. Success is `{success:true,data}` without `message`; errors use global handler. Lists usually clamp page/limit to 100. All are subject to global limit; only `/auth/*` additionally receives the 5/15-minute admin limiter, including refresh/logout/reset operations.

| Endpoint(s) | Purpose | Validation/page/filter/sort | Principal risk/result |
|---|---|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` | admin identity | Zod; Argon2/reset token | password login is bypassed by general OTP ADMIN role escalation |
| `POST /auth/logout`; `GET /auth/me` | session/profile | logout body not schema-parsed; protected me | access JWT not revoked |
| `GET /dashboard/stats`, `/dashboard/revenue-trend`, `/dashboard/alerts` | operational metrics | days 7–90; aggregate queries | revenue grouped in memory |
| `GET /bookings`, `/bookings/:id`, `/bookings/export` | list/detail/CSV | page/filter/sort newest; export 1,000 | detail includes last 100 locations; CSV formula injection not neutralized |
| `POST /bookings/:id/assign-driver`, `/cancel`, `/refund` | admin booking commands | Zod bodies | refund can exceed paid amount; wallet-only refund; stale finance totals |
| `GET /users`, `/users/:id` | user search/detail | page/role/active/search | detail returns sensitive related data |
| `PATCH /users/:id/status`; `DELETE /users/:id/sessions`; `POST /users/:id/wallet-credit` | user control | Zod except no params | general OTP escalation exposes all operations |
| `GET /drivers`, `/drivers/:id`, `/drivers/:id/verification-logs` | driver/compliance views | filters/page | returns raw ULIP response/bank data to any ADMIN token |
| `PATCH /drivers/:id/documents/:docId/status`, `/drivers/:id/doc-verified` | compliance override | Zod | no general admin action audit table |
| `GET /fleet-owners`, `/fleet-owners/:id`; `PATCH /fleet-owners/:id/status` | fleet admin | page/search/flags; Zod status | — |
| `GET /workforce`, `/workforce/:id`; `PATCH /workforce/:id/bank` | worker admin | controller-specific, bank update lacks router schema | sensitive KYC/bank exposure |
| `GET /fleet-trucks`, `/fleet-trucks/expiring` | fleet compliance | page/search; raw days | missing expiry indexes |
| `GET /finance/revenue`, `/driver-earnings`, `/fleet-earnings`, `/subscriptions`, `/wallet-transactions` | finance reporting | page/date/entity filters | Float money and ledger inconsistencies undermine reports |
| `PATCH /finance/driver-earnings/:id/mark-paid`, `/finance/subscriptions/:id` | finance mutation | subscription Zod; earning none | no immutable admin audit |
| `GET /support/tickets`, `/support/tickets/:id`; `POST /support/tickets/:id/reply`; `PATCH /support/tickets/:id/status` | support admin | page/filter; Zod reply/status | — |
| `GET /pricing/vehicles`, `/pricing/config`, `/pricing/commission`, `/pricing/fuel`, `/pricing/audit-log`, `/pricing/subsidies` | pricing views | page/filter on logs | — |
| `PATCH /pricing/vehicles/:vehicleType`, `/pricing/:vehicleType` | update vehicle pricing (duplicate aliases) | raw `req.body` passed to service | runtime schema not applied; arbitrary fields/type errors |
| `PATCH /pricing/config/:key` | arbitrary config key/value | only truthy value | no allowlist/type validation |
| `PATCH /pricing/commission`, `/pricing/fuel` | commission/fuel change | manual Number conversion | NaN/invalid range risks partly service-checked |
| `GET /pricing`, `PATCH /pricing/:vehicleType` | legacy aliases | same as vehicle endpoints | duplicate API maintenance burden |
| `GET /announcements`; `POST /announcements`; `PATCH /announcements/:id`; `DELETE /announcements/:id` | announcement CRUD | Zod create/update | delete/action audit absent |
| `POST /notifications/broadcast` | bulk push | Zod | loads every token and sends sequentially; timeout at scale |
| `GET /ulip-logs`, `/ulip-logs/:id` | raw government audit | page/filters | extremely sensitive PII response exposure |
| `GET /system/health` | internal dependency health | none | duplicates health concerns |
| `GET /driver-wallets`, `/withdrawals` | wallet/payout admin | raw status query; max 100 withdrawals | invalid enum may 500; bank snapshots returned |
| `POST /cash-collection` | credit cash receipt | no Zod; Number conversion | arbitrary entity/amount; critical with compromised ADMIN token |
| `PATCH /withdrawals/:id/complete`, `/retry` | manual payout state | no schemas/state constraints | Critical: retry after refunded failure can pay twice |
| `GET /gamification/badges`, `/gamification/stats`; `POST /gamification/badges`; `PATCH /gamification/badges/:id` | badge admin | no route schemas | raw body/enum failures; no delete |
| `GET /training/courses`, `/training/stats`; `POST /training/courses`; `PATCH /training/courses/:id`; `DELETE /training/courses/:id` | training admin | no route schemas | inline wrappers omit `next`; async rejection handling relies on Express 5 |

## Unmounted endpoints

`POST /webhooks/razorpay` and `POST /webhooks/razorpayx` in `src/modules/webhooks/webhooks.router.ts:9-18` are not registered with `app.use`. The RazorpayX controller is mounted directly; the better event-id-aware Razorpay handler is not. These declarations should not be advertised as reachable.

## API design conclusions

**API Design score: 35/100.** Positives include versioned routes, mostly clear nouns, consistent role middleware in several modules, Zod adoption, and pagination in core lists. Certification is blocked by privilege escalation, IDORs, unauthenticated internal APIs, inconsistent error contracts, missing schemas, ambiguous identifiers, duplicate/deprecated routes, non-idempotent financial commands, broken workforce acceptance, and incomplete OpenAPI/contract documentation.

Priority recommendations: freeze new endpoints; generate OpenAPI from schemas; require explicit policy per route; use idempotency keys for commands; validate params/query/body uniformly; separate public/internal routers; remove duplicate/legacy routes on a versioned schedule; add contract tests for all 251 endpoints.
