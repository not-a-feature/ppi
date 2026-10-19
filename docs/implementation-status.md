# Implementation status

Development build, 19 October 2026. The specification remains the release target; this page records the current implementation.

## Implemented

- Better Auth registration, verification, login and password recovery with server-enforced zx eligibility, database sessions and an administrator flag.
- PostgreSQL schema migrations and repeatable synthetic accounts, catalogue entries and protocols.
- Live catalogue search, card/list views, a default accepted-file filter, lecture purchases, private authorised downloads and a credit ledger showing lecture names.
- Original PPI logo and navy palette, responsive catalogue layouts, German/English interface text, and saved account language and light/dark/automatic appearance.
- Single-file drag-and-drop submissions, searchable lecture selection, examiner suggestions and required semester selection. Student lecture proposals remain private until administrator approval.
- Immutable improvements without rewards, manual review with editable standard feedback, shared rewards excluding unknown collaborators, and administrator withdrawal.
- New uploads require an exam date; improvements inherit the previous date. Authentication fields include standard password-manager autofill metadata.
- Administrator lecture editing and file deletion. Deletion immediately blocks downloads and queues removal of all revision files and affected ZIP archives while retaining metadata, review history and credits.
- Per-lecture examiner management and suggestions, preserving historical protocol metadata when associations change.
- Administrator line charts for recorded sign-ins and audit events, with 30-day, six-month, one-year and full-history ranges.
- Account suspension, administrator promotion, token requests, manual adjustments, configurable token values and audit records.
- Reports, reconsideration and file reprocessing through the website.
- Background lecture ZIP preparation with access, publication and file-safety checks on download.
- In-browser PDF review and automatic duplicate, similarity, content and metadata checks.
- Background OCR for scan pages without existing text; original files remain immutable. Downloads and ZIP members include the student's zx ID and date.
- Private administrator notes on user accounts, with concurrent-edit protection.
- Transactional outbox delivery to pg-boss, a separate worker, local SMTP delivery, periodic grants and website queue/schedule controls.
- Development Compose dependencies, a Node production build and CI with PostgreSQL integration tests.
- Bounded database waits and disconnect recovery, consistent proxy authentication throttling, account upload quotas and isolated PDF extraction.

## Remaining before production

- Production scanner deployment and updated signatures, resource measurements, TLS/proxy configuration and validated backup/restore procedures.
- Restricted production database roles; the local development database still uses its bootstrap owner.
- Final retention/anonymisation policy and cleanup of retained personal records.
- Final migration tooling, rehearsal and cutover after the application is ready. Current token balances must be copied unchanged.

Running work completes before a worker stops; queue pause prevents subsequent work. Each queue has its own processing loop, so a file scan does not block verification email. Cancellation currently applies to jobs waiting to run. Cooperative cancellation of running jobs and website-adjustable concurrency still need to be completed for the full operations specification.

Model-based moderation remains intentionally deferred. No model processes protocol content. The [legacy feature comparison](modules/15-legacy-migration.md#feature-comparison-19-october-2026) records the remaining differences, including account-deletion completion and administrator metadata corrections.
