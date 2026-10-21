# Architecture

PPI runs as a SvelteKit application and a separate TypeScript worker. Both use PostgreSQL and the same private file store. The current target is one host and up to 100 concurrent users. Multiple hosts would require shared file storage.

| Location                             | Responsibility                                                         |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `src/routes`                         | Pages, form actions, file downloads and status endpoints               |
| `src/lib/components`                 | Shared Svelte UI                                                       |
| `src/lib/locales/de.json`, `en.json` | German and English text; `i18n.ts` supplies formatting helpers         |
| `src/lib/server/auth`                | Better Auth, zx eligibility, sessions and throttling                   |
| `src/lib/server/domain`              | Accounts, catalogue, submissions, moderation, tokens and reports       |
| `src/lib/server/jobs.ts`, `worker`   | Transactional outbox, pg-boss queues and task execution                |
| `src/lib/server`                     | Private storage, document checks, OCR, archives and statistics         |
| `migrations`                         | Ordered SQL schema changes; apply explicitly with `npm run db:migrate` |
| `tests`                              | Vitest tests, including isolated PostgreSQL integration tests          |

Routes call ordinary domain functions. SQL uses node-postgres parameters and explicit transactions. Better Auth owns credentials, verification/reset tokens and sessions; pg-boss owns queue execution. Numbered SQL migrations are authoritative for the schema.

## Accounts and access

Every login account, including administrators, needs a verified `zx[a-z]{3}[0-9]{2}@student.uni-tuebingen.de` address. An administrator can set another eligible account's admin flag. The initial administrator uses `scripts/bootstrap-admin.ts`. Suspension revokes access. Confirmed voluntary deletion immediately removes credentials and identifying profile fields while preserving contributed protocols and transaction history. The last active administrator cannot delete their account.

A monthly worker job removes credentials and identifying profile fields after two years without a login, using registration age when no login is recorded. It preserves protocol ownership, ledger entries and audit references through a non-login account record. The last active administrator is protected. Login timestamps are stored separately from retained audit logs. Administrators can disable cleanup or choose three- or six-month intervals.

The scheduled cleanup also completes deletion requests left pending by earlier versions. Retained submissions from deleted uploaders can be reviewed and published without issuing new rewards to those accounts.

Permissions are checked on the server against current account state. Private files are served through authorised endpoints. Students need current lecture access; multi-lecture protocols require access to any assigned lecture. Administrator review access is audited. Internal user notes and extracted document text stay out of student responses.

## Submissions and decisions

A revision contains exactly one PDF or TXT file, at most 30 MiB. New submissions require an examiner, semester and exam date. The upload dropdown covers the current semester minus six through plus one. Improvements append a revision and inherit the previous exam date and semester, including unknown values. File references and authorship attestations are immutable. The published revision remains available while an improvement is reviewed. Students cannot delete or withdraw submissions.

Students can propose lectures, which stay hidden until approved. Examiner associations belong to lectures; examiner names are stored with each revision. New files receive names such as `WS2026-27_2026-10-19_42.pdf`; storage keys remain private UUIDs. Admin metadata edits rebuild the display filename and invalidate affected ZIPs. Protocol lists use the initial upload number and sort by upload date, newest first.

Technical checks block unsafe files. Duplicate, similarity, content and metadata checks advise reviewers. Content-model moderation is a disabled interface placeholder. Administrators decide publication, correct metadata and lecture assignments, request improvements, withdraw content or delete file bytes while keeping metadata and decisions. Metadata edits record before/after values in the audit log. Version checks reject stale edits and decisions.

## Tokens

Defaults are configurable through administration: 5 tokens after verification, 3 for a contribution, 6 for an excellent contribution, 1 for four weeks of lecture access, and a periodic grant of 2. The default grant dates are 1 April and 1 October at midnight in Europe/Berlin. Reconcile the schedule before production activation.

Rewards are shared equally between distinct registered, verified contributors, including the uploader, rounding each share upward. Suspension blocks access but does not remove reward or periodic-grant eligibility. Unknown collaborators are ignored. Recipients freeze at the first award; improvements receive no reward. Corrections use explicit administrator adjustments.

Deleting protocol files keeps already-granted rewards and purchased lecture access unchanged. Deleted protocols cannot receive new rewards.

Balances cannot become negative and equal the sum of ledger entries. Purchases lock the account to prevent overspending. Decisions, rewards, audit events and notification enqueue commit together. Receipts and unique business keys prevent retries from repeating effects. Imported balances become opening entries without reconstructed history.

## Background processing

The worker dispatches durable outbox entries into pg-boss and runs independent queues for file checks, content checks, OCR, notifications, periodic grants, ZIP preparation and file deletion. Queue controls and schedules are available through administration. Waiting jobs can be cancelled; running work finishes before pause or shutdown. Running-job cancellation and website-editable concurrency remain unfinished.

PDF extraction runs in a bounded child process. OCR processes only image pages without extractable text; searchable pages and blank pages skip it. Original files remain immutable, and OCR derivatives are tied to the safety generation. Late results cannot replace newer checks. Downloads and ZIP members carry the student's zx ID and Berlin download date; administrator previews stay unmarked.

ZIP preparation runs after purchase and reports progress on the lecture page. Access, publication and file safety are checked again on download. ZIPs expire after one hour or at the next Berlin midnight, whichever comes first.

ZIP downloads use the lecture name and include `index.json` with protocol numbers, filenames, examiners, lectures, semesters, exam dates and upload dates. Lecture renames invalidate affected queued and ready archives, including protocols shared across lectures. Account administration includes unverified registrations, local role/status filters, last login and links to each account's submissions and access grants.

See [operations](operations.md) for limits, deployment and checks, and [migration](migration.md) for cutover and remaining legacy gaps.
