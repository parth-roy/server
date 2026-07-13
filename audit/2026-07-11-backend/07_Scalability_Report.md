# Scalability Report

**Scalability score:** **30/100**

## Executive conclusion

The HTTP layer is mostly stateless in shape, but operational behavior is not horizontally safe. Socket rooms, rate limits, OTP fallback maps, EventBus events, cron jobs, and redispatch timers are process-local. The same monolith is deployed to two hosts and appears capable of starting jobs/workers on each, which can duplicate cleanup and dispatch work. Queue coverage is partial, database dispatch is O(n), and there is no committed infrastructure/capacity plan. Adding replicas today would increase inconsistent behavior and duplicate processing rather than simply increasing capacity.

Security and financial-integrity defects are independent of capacity: the system is unsafe even at one user.

## Capacity outlook

These are architecture-based estimates, not load-test guarantees.

| Population/workload | Assessment | Primary constraint |
|---|---|---|
| 100 users | Likely enough raw capacity on one correctly sized node | security/payment blockers still prohibit production |
| 1,000 users | Plausible at moderate concurrency after correctness fixes | provider quotas, tracking writes, process memory, DB pool |
| 10,000 users | At risk when hundreds are concurrent/actively tracked | global dispatch scans, Socket.IO isolation, sequential notifications |
| 100,000 users | Unsupported by current design | multi-node consistency, geospatial search, database/queue/observability limits |
| 1 million users | Not viable without substantial platform redesign | regional partitioning, event architecture, data lifecycle, capacity engineering |

## Horizontal scaling readiness

| Concern | Current state | Required state |
|---|---|---|
| HTTP sessions | JWT bearer is broadly stateless | retain, but resolve role/account state safely and support revocation |
| WebSockets | default in-memory Socket.IO adapter | Redis adapter or dedicated realtime tier; sticky connection policy and room authorization |
| Rate limits | per-process memory | distributed Redis-backed atomic limits with user/device/IP dimensions |
| Domain events | Node `EventBus`, non-durable | transactional outbox plus durable consumer queues |
| Scheduled jobs | started with application; host/process duplication likely | singleton scheduler or idempotent workers with distributed leases |
| Redispatch | `setTimeout` in a web process | delayed durable job with dedupe and persisted invitation state |
| Queues | BullMQ only for ULIP/ETA producers; other workers are stubs/unfed | explicit topology, producers, retry/DLQ/idempotency, independent autoscaling |
| Database | one PostgreSQL origin, no geospatial plan | PostGIS, pooling budget, replicas for safe reads, partition/retention |
| Files | S3 integration | direct upload/CDN, malware/quarantine pipeline, lifecycle policies |

## Statelessness and consistency

Authentication writes to in-memory maps even when Redis is configured. EventBus listeners execute only in the receiving process. Socket joins do not propagate. Timers disappear on restart. These violate the assumption that any request/event can reach any replica. Financial and allocation operations also lack idempotency, so at-least-once delivery cannot safely be introduced until handlers are repaired.

Target pattern:

```text
API replicas -> PostgreSQL transaction + outbox
                        |
                   outbox relay
                        v
                 durable queues/topics
          -> dispatch workers
          -> payment/ledger workers
          -> notification workers
          -> integration workers

Realtime gateways <-> Redis adapter/pubsub
API/worker limits  <-> Redis atomic quotas
```

## Database scaling

Read replicas and sharding are premature until migrations, financial correctness, indexing, and workload measurement are fixed. Immediate priorities are:

- PostGIS-indexed regional driver/worker search rather than application-wide scans;
- bounded connection pooling across every process;
- immutable/partitionable event and ledger tables;
- time partitioning/retention for tracking, notifications, audit, and provider logs;
- SQL/materialized aggregate paths for dashboards;
- explicit read-consistency classification before routing anything to replicas.

At larger scale, partition by operating region/time where business rules allow it. Booking/payment/wallet commands need a clear transactional home; cross-shard money movement is not currently designed.

## Queue and worker readiness

The code defines more workers than operational producers. ULIP and ETA have queue producers; dispatch uses local EventBus rather than its declared queue; OTP, notification, and invoice workers are effectively stubs or have no producer. There is no documented DLQ replay, poison-message policy, queue SLO, schema versioning, or worker-only deployment profile.

Before scaling workers, every consumer must be idempotent. Payment completion, wallet credit, settlement, workforce completion, and payout retry currently are not.

## CDN, provider, and regional concerns

S3 is appropriate for object storage, but a CDN/direct-upload strategy is not evidenced. Mapbox, Firebase, Razorpay, ULIP, Redis, and DigiLocker quotas can become global bottlenecks. Introduce tenant/user/provider rate budgets, circuit breakers, cost monitoring, and graceful degradation. Government/payment operations may also impose data-residency and audit requirements that must guide any multi-region design.

## Microservice readiness

Immediate microservice extraction is not recommended. Current domain boundaries are blurred by circular service imports, shared direct Prisma access, duplicated financial logic, and local EventBus behavior. First establish modular contracts, ownership, idempotency, outbox events, and observability inside the monolith. Natural later boundaries are identity, booking/dispatch, ledger/payments, notifications, integrations, and workforce/fleet—but only after transaction boundaries are explicit.

## Scalability roadmap

1. Repair security and money/state idempotency; reconcile migrations.
2. Add PostGIS and query/capacity baselines.
3. Make one replica semantically safe: Redis limits/socket adapter, outbox, durable delayed work, singleton/idempotent jobs.
4. Split API and worker deployment profiles; autoscale on HTTP saturation and queue lag.
5. Add data partition/retention, read replicas for classified queries, CDN/direct uploads.
6. Load/soak/chaos test multi-node deployments and provider failure.
7. Introduce regional or service partitioning only from measured need.

## Certification status

**Not horizontally scalable in its current operational form.**
