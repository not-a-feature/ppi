# Delivery phases and release gates

The first release delivers the complete student/admin application with manual moderation. Local/external model providers and automatic acceptance/rejection are interface placeholders only. Implementation proceeds through complete workflows so the project is usable before advanced moderation work starts.

## Phase 0 Resolve the baseline

Outputs: current deployment inventory, representative sanitised fixtures, reviewed specification and a migration exception inventory.

- Confirm active Gitea deployment configuration, server resources, database/schema and SMTP access.
- Verify zx identifier format, initial administrator identity, source account states, and six-month grant alignment/eligibility.
- Confirm upload/page limits, retention policy, backup owner and recovery targets.
- Gather representative text PDFs, scan-only PDFs, TXT files and malformed examples without committing private data.

Exit: operational unknowns have owners; decisions needed for the next phase are resolved. Live credentials are not required merely to build synthetic fixtures.

## Phase 1 Foundation and authentication

Modules: server, authentication, database, deployment skeleton and audit basics.

Outputs: runnable local Compose environment, SvelteKit/TypeScript project, auth screens, migrations, mail sink, restricted zx registration, admin bootstrap and CI checks.

- Pin a mutually supported Node/SvelteKit/Better Auth/node-postgres/pg-boss package set.
- Prove atomic domain-write plus queue-enqueue rollback using real PostgreSQL.
- Test email verification, reset, session invalidation and direct-endpoint eligibility checks.
- Establish safe secret/config handling and the first production-style image build.

Exit: a student can register and verify; a nominated verified student can receive the admin flag through a controlled bootstrap; suspended/unverified users cannot access protected routes.

## Phase 2 Catalogue and first complete contribution

Modules: student/admin interfaces, catalogue, submissions, document checks, manual moderation, notifications, credits and jobs.

Outputs: login -> search -> upload -> technical check -> admin review -> shared reward -> lecture purchase -> download.

- Implement private files and safe review/download access.
- Implement immutable revisions, public feedback and decision conflicts.
- Implement configurable token rules and equal sharing with upward rounding.
- Provide the disabled moderation-provider contract and test fake only.

Exit: the complete workflow passes browser, permission, transaction and retry tests. Two contributors sharing a default 3-token reward each receive 2; a repeated acceptance grants nothing additional.

## Phase 3 Administration and operational completeness

Modules: admin interface, jobs, catalogue reports, credits requests, audit and deployment.

Outputs: website job controls, schedules, policy settings, token requests, account management, archive downloads, reporting and alerts.

- Pause/resume, retry/reprocess, cancellation and run-now work through the website.
- Validate schedule timezone, DST, downtime catch-up and periodic grant deduplication.
- Exercise worker crash, SMTP outage, disk-full and stale-review scenarios.
- Complete German/English and mobile/keyboard interaction checks.

Exit: routine administration needs no SSH; all privileged actions are audited; retry/cancellation tests preserve financial-like credit invariants and decisions.

## Phase 4 Migration and staging rehearsal

Modules: legacy migration, database, deployment and recovery.

Outputs: repeatable import, exception report, reconciled staging system, measured load results and timed restore.

- Verify legacy password compatibility or adopt the reset plan.
- Import a matching database/file snapshot and reconcile identities, balances, grants and hashes.
- Benchmark realistic catalogue and download load; tune indexed queries and resource limits from evidence.
- Rehearse backups with in-flight uploads and deletion jobs, confirming that all writers drain before matching database/file backups. Rehearse cutover rollback, including the limitation after new writes.

Exit: no unexplained balance/file discrepancies; account exceptions resolved; rollback and restore procedures tested on the actual deployment shape.

## Phase 5 Core launch

Freeze legacy writes, take final snapshots, import, reconcile, smoke-test, switch traffic and observe the agreed initial window. Enable periodic grants only after reconciling the legacy grant period. Keep old deployment and source snapshots read-only for the agreed retention period.

Launch requires named operations ownership, functioning verification email, backups, current file-scanning capability, private storage authorisation, tested credit invariants and website job management. Automated content decisions remain unavailable.

## Later phase Moderation automation

Implement local and external providers behind the agreed interface. Add extraction/OCR, richer duplicate detection and a benchmark set. Run in shadow mode and measure false approvals/rejections and abstentions. Enable automatic acceptance and rejection only under an evaluated, versioned policy, with review/appeal and a website kill switch. This work does not block the core release.

## Validation matrix

| Concern | Minimum evidence |
|---|---|
| Account restrictions | Direct auth endpoint tests, invalid-domain/identifier cases, verification lifecycle |
| Admin flag | Server permission tests, session revocation, last-admin protection |
| File permissions | Cross-user requests, expired access, withdrawn files and stale archives |
| Rewards | Multi-contributor rounding, duplicate names, policy changes, decision retries |
| Spending | Concurrent purchases on same/different lectures with insufficient funds |
| Background work | Crash after commit, retries, cancellation, pause acknowledgement, scheduler downtime |
| Migration | Per-user ledger totals, access expiries, source/target counts, file hashes and repeat imports |
| UI | Main browser journeys, German/English, mobile and manual keyboard review |
| Recovery | Isolated database/file restore, no real emails, measured recovery time |

Use Vitest for domain rules, actual PostgreSQL for transaction/concurrency tests, and Playwright for browser journeys. Avoid tests that merely reproduce implementation details. Re-run broader checks when a schema, integration or shared invariant changes.

## Scope control

Track implementation work against module acceptance criteria and this dependency order. A module is complete only when its behaviour, permissions, failure recovery and relevant tests are present. A polished screen with no server-side enforcement is incomplete; a backend with no website controls is also incomplete for this project.

Do not attach calendar estimates until the deployment inventory and available maintainer time are known. Each phase ends with a runnable, reviewable result and an updated list of remaining decisions.
