# Background jobs and website controls

## Responsibility and technology

pg-boss stores durable jobs in PostgreSQL and Node.js workers execute registered TypeScript handlers. Workers share domain functions with SvelteKit. The website is the routine control surface. Container restart and deployment remain infrastructure operations.

pg-boss provides scheduling, retries and queue primitives. Application controls and business progress use the supported APIs of the pinned version; domain effects remain safe under repeated execution. [Queue documentation](https://pgboss.io/)

## Registered work

| Task | Trigger | Retry/idempotency boundary |
|---|---|---|
| Check submission file | Committed revision or explicit retry | Revision + analysis generation |
| Add PDF OCR layer | Clean image pages without text | File + safety generation; skip existing text/OCR, retain the original |
| Prepare lecture ZIP | Authorised student request | Requester + exact revision set + access context |
| Deliver notification | Committed domain event | Notification ID; external SMTP can still duplicate |
| Periodic token grant | Schedule or admin run-now | Grant period + recipient |
| Reconcile orphan/temporary files | Schedule | Recheck age and current references before removal |
| Clean expired archives and operational history | Schedule | Cutoff and retention policy |
| Process account/content deletion | Reviewed account request or admin-authorised content removal | Entity + deletion generation; account deletion does not remove contributed protocols; disabled until policy is configured |
| Evaluate moderation provider | Future only | Revision + analysis generation + policy version |

Only predefined task types are callable. Payloads contain IDs, policy/config versions and bounded parameters; no executable source, shell commands, passwords or document bodies.

## Execution and recovery

Jobs move through queued, running, retrying, completed, failed or cancelled states. The UI may derive retrying from queue state and next-attempt time. Stage labels and timestamps come from task checkpoints. Native queue attempt information remains authoritative for delivery state; submission analysis records are authoritative for domain results.

Start with one document-processing slot and a small independent email concurrency limit so large files cannot block verification messages. Transient errors retry with bounded exponential backoff; permanent validation errors do not loop. Configure per-task attempts and deadlines. Workers renew supported leases/heartbeats where necessary and shut down gracefully; interrupted work is retried after the queue's recovery timeout.

Every workflow-state commit checks the target revision, analysis generation and expected state. File-safety results instead check the stored file and its safety-check generation, independently of which revision is current. Repeated or stale completion cannot apply twice. No exactly-once guarantee is assumed for external email or model services.

## Website operations

- **Pause/resume:** persist a queue control flag. Workers check it before starting domain work. A pause is confirmed when workers acknowledge it; already-started work may finish. Resuming leaves queued work intact.
- **Retry:** rerun a failed attempt of the same logical operation, with deduplicated effects. Completed rewards are never recreated.
- **Reprocess:** create a new analysis generation with current configuration; retain prior evidence and decisions.
- **Cancel:** queued work is prevented from starting. Running handlers receive a durable cancellation request, check it at safe points and stop bounded subprocesses. Already committed effects are not rolled back.
- **Schedules:** edit registered task timing, timezone and enabled state with version checks; show the next three executions. Define DST and missed-run behaviour explicitly.
- **Run now:** creates an auditable run through the same handler and constraints as scheduled work.

Each worker reports release/capabilities and heartbeat. Mark it unavailable after a configurable grace period, proposed 60 seconds. Website-adjustable concurrency stays within deployment resource ceilings. Restarting a container is not needed for ordinary pause/resume.

## Acceptance criteria

- Kill a worker after a database effect but before queue acknowledgement: recovery does not duplicate it.
- A queue paused by one web instance is respected by all workers.
- Cancelled/superseded analysis cannot publish a late result.
- The admin UI controls jobs and schedules without SSH.
- Scheduler downtime does not replay every missed cleanup; run one catch-up. Periodic grants reconcile explicit periods, never invent duplicate grants.
- Database loss leaves a visible unavailable state and recovers without discarding durable jobs.

Dependencies: database, audit, domain handlers and admin UI.
