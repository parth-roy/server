# Database Report

**Database:** PostgreSQL/Supabase through Prisma 5  
**Database score:** **31/100**

## Executive conclusion

The conceptual schema is broad and mostly relational, but the migration history cannot reproduce it. The current Prisma schema declares **54 models and 28 enums**, while committed migrations create only **22 tables** and a substantially smaller enum set. A clean deployment will be missing approximately **32 model tables** plus many columns/enums/indexes unless it relies on undocumented manual drift. This is a production blocker.

Financial values use floating-point columns and several balance mutations are read/calculate/write sequences without sufficient idempotency or row-version protection. Referential integrity and query-oriented indexes are inconsistent, and destructive cascades can erase financial audit history.

## Schema and migration integrity

### DB-01 — Non-reproducible database

Confirmed by comparing `prisma/schema.prisma` with `prisma/migrations/*/migration.sql`. Migrations do not create these mapped tables:

`bids`, `cash_collection_records`, `driver_payout_subsidy`, `driver_wallet_transactions`, `driver_wallets`, `fleet_drivers`, `fleet_earnings`, `fleet_fuel_logs`, `fleet_maintenance`, `fleet_owners`, `fleet_truck_documents`, `fleet_truck_usage`, `fleet_trucks`, `fleet_wallet_transactions`, `fleet_wallets`, `job_assignments`, `pricing_audit_log`, `pricing_config`, `processed_webhooks`, `scratch_cards`, `serviceability_config`, `team_members`, `training_courses`, `truck_assignments`, `user_notifications`, `withdrawal_requests`, `worker_training_progress`, `worker_wallet_transactions`, `worker_wallets`, and `workers`. `Badge` and `WorkerBadge` also have no creating migration.

Impact: clean deploy, disaster recovery, preview environments, and CI database tests cannot reliably start. `prisma migrate deploy` may report success while the runtime later fails on absent objects.

Required action: create a sanitized production-schema baseline, reconcile `_prisma_migrations`, generate reviewed forward migrations, validate on a production-sized clone, and make schema-drift checks mandatory in CI. Do not use `db push` as a production substitute.

## Financial modeling and ledger integrity

- Monetary columns are broadly `Float`. Binary floating point is unsuitable for currency totals, taxes, balances, refunds, commissions, and reconciliation. Use `Decimal(p,s)` or integer minor units with explicit currency.
- Customer wallet payment checks booking state and balance outside the transaction, then updates booking without a conditional status predicate (`wallet.service.ts:140-207`). Concurrent calls can debit twice.
- Top-up idempotency is check-then-create and `referenceId` is indexed but not unique (`wallet.service.ts:285-311`).
- Refund/cashback and several wallet mutations perform read/calculate/write operations susceptible to lost updates (`wallet.service.ts:319-390`).
- Driver settlement upserts an earning but unconditionally mutates balances afterward; repeat invocation credits again (`driver-wallet.service.ts:130-194`). Fleet trips credit both driver and fleet wallets with overlapping value.
- Withdrawal reservation/refund/retry has no database-enforced state machine or provider idempotency identity.
- Booking financial snapshots are internally incomplete: `totalFare` is paid while invoice logic derives a higher grand total; historic recomputation can diverge from money collected.
- Cascading deletes from owners to wallets/transactions can remove accounting evidence. Financial ledgers should be immutable, reversed with compensating entries, and retained independently of profile deletion.

Recommended invariant: every monetary command writes one immutable double-entry-style ledger transaction with unique business/idempotency keys in the same serializable transaction as the state transition. Balances should be derived or transactionally updated with a version/conditional predicate.

## Relationships and referential integrity

Confirmed gaps and risks:

- `SavedAddress.userId`, GST/user references, team ownership, several document/earning references, and `RecentSearch.userId` lack consistent database foreign keys.
- `TruckAssignment.truckId` intentionally lacks a foreign key (`prisma/schema.prisma:1241`), allowing orphaned assignments.
- No database constraint prevents duplicate bids by the same driver for one booking.
- No exclusion/unique strategy prevents one driver or truck from being assigned to overlapping active bookings.
- Booking status and related driver/truck/assignment state are duplicated across records without database constraints that enforce cross-row consistency.
- Optional relations and wide cascades make orphaning or audit deletion possible depending on the model.
- `ProcessedWebhook.eventId` is unique and also separately indexed, creating a redundant index.

Use explicit foreign keys unless a measured cross-boundary reason is documented. For temporal allocation, add an allocation record with an exclusion constraint or transactional active-assignment uniqueness strategy.

## Index audit

Useful indexes exist on several booking, driver, location-history, notification, wallet, and refresh-token paths. However, likely missing or inadequate indexes include:

| Query area | Recommended index/strategy |
|---|---|
| Driver dispatch | PostGIS `geography(Point,4326)` with GiST/SP-GiST plus availability/vehicle partial index |
| Workforce nearby search | geospatial index plus status/slot/required-role predicates |
| Driver earnings | `(driverId, createdAt)` and status/time composites used by reports |
| Bids | unique `(bookingId, driverId)` plus `(bookingId, status, amount)` |
| Booking stops | `(bookingId, sequence)` unique/order index |
| Saved addresses/recent searches | `(userId, updatedAt/createdAt)` plus actual FK |
| Support tickets | `(userId, status, updatedAt)` and admin queue composites |
| Driver/fleet documents | `(ownerId, status, expiryDate)` |
| Fleet maintenance/fuel/usage | `(truckId, date)` and owner/date reporting composites |
| Wallet/coin ledgers | unique `(type, referenceId, ownerId)` or explicit idempotency key; `(ownerId, createdAt)` |
| Announcements/notifications | active/audience/date and recipient/read/date composites |
| Training progress | unique `(workerId, courseId)` |

Validate with `EXPLAIN (ANALYZE, BUFFERS)` against production-like cardinalities before adding indexes; every write-heavy index has a cost.

## Query and transaction audit

- Dispatch loads all eligible drivers/workers and calculates Haversine distance in application memory (`dispatch.service.ts:73-109`; `workforce.service.ts:909-954`). This is an O(n) global scan and prevents efficient regional scaling.
- Admin revenue/trend calculations fetch many completed bookings and group in Node instead of SQL aggregation.
- Admin notification broadcast loads all tokens and processes them sequentially.
- Location tracking performs multiple lookups and may insert a history row for each accepted socket update (`tracking.gateway.ts:152-164`), producing a high-write hot path without retention/partitioning.
- Booking accept, fleet assign, bid accept, workforce accept/complete, wallet pay, and settlement split dependent state changes across transactions or omit transactions.
- `Promise.all` is used in some list/count operations and Prisma is a singleton, which are positive patterns.
- No evidence of transaction isolation selection, optimistic versions, advisory locks, or retry policy for serialization/deadlock errors.

Recommended isolation is not globally `SERIALIZABLE`; apply narrow serializable/conditional-update transactions to financial and allocation commands, add bounded retry for PostgreSQL conflicts, and keep external provider calls outside DB locks with an outbox/saga.

## Normalization and duplication

The schema appropriately snapshots certain booking/payment values for historical truth, but source-of-truth boundaries are unclear:

- booking contains many fare components while invoice and payment paths recompute/choose different totals;
- commission percentage defaults differ between pricing configuration and settlement environment variables;
- driver/fleet/worker wallet models duplicate similar ledger logic with divergent guarantees;
- assignment state is duplicated in Booking, Driver, FleetTruck, TruckAssignment, JobAssignment, and workforce records;
- provider/raw-government payloads are stored inline in operational tables, increasing row width and privacy scope.

Document canonical ownership for each invariant. Extract a shared ledger/state-transition substrate where behavior must be identical, not merely similar.

## Capacity, retention, and operations

No committed evidence was found for PITR validation, logical backup schedules, restore drills, RPO/RTO, partitioning, vacuum/bloat monitoring, slow-query capture, or connection-budget planning. Supabase may provide platform features, but an enterprise audit requires configured evidence and tested procedures.

High-growth tables—booking location history, notifications, pricing audit logs, ULIP logs, wallet transactions, and provider webhooks—need retention/archival and likely time partitioning. Prisma connection pool sizing must be budgeted across every PM2 instance, worker, deployment host, migration job, and admin service; PgBouncer transaction pooling should be evaluated with Prisma's documented constraints.

## Recommended roadmap

1. Stop schema changes until migration drift is reconciled and clean restore is demonstrated.
2. Convert currency to minor-unit integers or fixed decimal through an audited migration and reconciliation.
3. Define state-machine and ledger invariants; add unique idempotency keys and conditional transitions.
4. Add missing foreign keys/uniques and query-driven composite/geospatial indexes.
5. Move global scans/aggregations into indexed SQL/PostGIS and introduce location-history retention/partitioning.
6. Establish PITR, encrypted backups, restore drills, RPO/RTO, slow-query monitoring, and capacity tests.

## Certification status

**Rejected pending migration reproducibility and financial-integrity remediation.**
