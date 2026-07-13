# Performance Report

**Performance score:** **43/100**  
**Basis:** static analysis and build verification; no production traces or load-test results were available.

## Summary

The code is asynchronous and uses a shared Prisma client, Redis caching for selected map/pricing paths, compression, and queues for ULIP/ETA work. Those are sound foundations. The dominant risks are global in-memory scans, high-frequency location database writes, sequential provider calls, memory-buffered uploads, Node-side reporting aggregation, public cost-amplification endpoints, and jobs sharing the HTTP process. Performance cannot be certified without workload targets and measured p95/p99 latency, error rate, saturation, and database plans.

## Confirmed bottlenecks

| Area | Evidence | Bottleneck and impact | Priority |
|---|---|---|---|
| Driver dispatch | `dispatch.service.ts:73-109` | Loads every eligible driver and Haversine-sorts in Node; O(n) DB transfer/CPU for each search | Critical for scale |
| Workforce map | `workforce.service.ts:909-954` | Loads jobs then filters by distance in memory | High |
| Tracking writes | `tracking.gateway.ts:152-164` | Multiple DB operations and potential history insert per location event | High |
| Admin push | `admin.service.ts:971-1001` | Loads all FCM tokens and sends sequentially | High |
| Uploads | upload middleware/controllers | Multer memory storage plus multi-file requests can retain roughly 100 MB/request; uploads are sequential | High |
| Admin revenue/trends | admin service reporting paths | Fetches result sets and groups/reduces in application memory | Medium/High |
| Pricing estimate | public pricing routes | Performs computation plus an audit-log write per estimate; attractive cost-amplification target | High |
| Map proxy | public maps routes | External geocode/direction cost and latency without endpoint-specific quota | High |
| Webhook work | `payment.controller.ts:171-280` | Database/business work occurs inline and failures are swallowed with HTTP 200 | High reliability/latency risk |
| Dispatch timers | `dispatch.service.ts:238-243,265-269` | Process-local timers consume memory and vanish on restart | Medium |

## Event-loop and memory assessment

- No obvious synchronous filesystem, child-process, or cryptographic loops were found in normal request paths. Argon2 correctly runs through native asynchronous APIs.
- Application-side Haversine sorting and large admin reductions are CPU work on the event loop. As eligible populations grow, one request can delay unrelated traffic.
- `auth.service.ts:37-50` always inserts OTP state into an in-memory map; production verification skips that fallback, so unsuccessful/expired entries can remain indefinitely. Similar fallback storage exists in workforce auth.
- JSON body limit is 10 MB. In-memory multipart buffers multiply per file and concurrent request, increasing GC pressure and out-of-memory risk.
- Large raw ULIP/base64 identity payloads stored and returned inline increase heap, serialization time, bandwidth, and log volume.
- Socket.IO's default in-memory adapter maintains room state per process and cannot distribute it correctly.

## Database performance

Positive: Prisma singleton usage avoids a client per request; many lists paginate; selected counts/data calls run concurrently; booking/location indexes exist.

Risks:

- absence of geospatial indexes forces global dispatch scans;
- several list/report predicates lack matching composite indexes (see `05_Database_Report.md`);
- no slow-query telemetry or captured `EXPLAIN ANALYZE` evidence;
- location history is an unpartitioned, unbounded high-write table;
- N+1-like patterns appear where per-candidate/provider/state calls follow candidate enumeration;
- broad `include` graphs and admin detail endpoints return more data than needed;
- wallet/assignment race fixes will require carefully scoped transactions to avoid lock contention.

## Caching

Redis-backed OTP, map, and pricing cache paths are useful. Missing or unsafe areas:

- rate limits are process-local rather than Redis-backed;
- Socket.IO Redis adapter is installed but unused;
- recent searches and operational lookups lack defined invalidation/TTL policies;
- no cache stampede protection for external map/provider calls;
- no explicit CDN strategy for public/static or S3-delivered assets;
- caching must not be used to mask missing authorization—tracking, KYC, balances, and user-specific data require strict keys and policies.

## Streaming, batching, and pagination

- Core list APIs often paginate, but several admin exports cap at an arbitrary 1,000 rows instead of streaming/asynchronous export.
- CSV generation should stream, neutralize spreadsheet formulas, and move large exports to a worker with expiring object-storage links.
- FCM supports batching/multicast; bulk push should chunk, limit concurrency, track token-level outcomes, and execute in workers.
- Multi-file S3 uploads should have bounded concurrency and preferably presigned direct-to-S3 flows with post-upload verification.
- Location ingestion should sample/coalesce, batch persistence, and define retention while preserving the latest state separately.

## Connection and external-service handling

No documented connection-budget calculation was found for Prisma across two deployment hosts, PM2 processes, workers, and migration runs. External API clients require explicit connect/read timeouts, bounded retries with jitter, circuit breakers, and bulkheads. Retries must be idempotent and should not happen while holding database transactions.

Mapbox, Firebase, Razorpay, ULIP, AWS S3, Redis, and DigiLocker each need per-provider latency/error metrics and rate/cost budgets. Current generic error handling does not distinguish timeout, throttling, provider outage, or invalid response.

## Measurement plan

Before certification, establish realistic scenarios and run staged load tests:

1. OTP/login/refresh, booking create/estimate, concurrent driver accept, wallet/payment verify, tracking updates, admin lists, notification broadcast, and provider webhooks.
2. Test 50/200/1,000 concurrent HTTP users, 1k/10k/100k connected sockets, and realistic driver/worker candidate cardinalities.
3. Record p50/p95/p99 latency, throughput, error/timeout rate, event-loop delay, heap/GC, CPU, Prisma pool wait, locks/deadlocks, query buffers, Redis/provider latency, and queue lag.
4. Use production-sized anonymized data; inject provider throttling/failure and rolling restarts.
5. Set SLOs and capacity thresholds, then repeat tests in CI/release gates for critical paths.

## Priority recommendations

1. Move dispatch/nearby search to PostGIS with bounded radius and indexed predicates.
2. Rate-limit costly endpoints in Redis and add per-user/device/provider quotas.
3. Decouple jobs/webhooks/broadcasts from API processes through durable queues/outbox.
4. Coalesce tracking updates and partition/retain history.
5. Replace memory-buffered bulk upload with presigned uploads or strict bounded streaming.
6. Push reporting aggregation into SQL/materialized summaries and make exports asynchronous.
7. Add OpenTelemetry traces, database query telemetry, event-loop metrics, and repeatable load tests.

## Certification status

**Not performance-certified.** Static analysis identifies material bottlenecks, and no load/soak evidence establishes capacity or latency.
