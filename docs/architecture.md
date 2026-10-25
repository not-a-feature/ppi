# Architecture

PPI is a SvelteKit application with a separate TypeScript worker, PostgreSQL and a shared private file store. It targets one host and up to 100 concurrent users. Multiple hosts need shared storage.

| Location                                | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `src/routes`                            | Pages, form actions and authorised downloads         |
| `src/lib/components`, `src/lib/locales` | Shared UI and German/English text                    |
| `src/lib/server/auth`                   | Better Auth, zx eligibility, sessions and throttling |
| `src/lib/server/domain`                 | Accounts, submissions, moderation and tokens         |
| `src/lib/server/jobs.ts`, `worker`      | Transactional outbox and pg-boss queues              |
| `migrations`, `tests`                   | Ordered SQL migrations and regression tests          |

Routes call domain functions. SQL uses parameters and explicit transactions. Better Auth manages credentials and sessions; pg-boss runs background jobs. Search and filters run locally after the initial page load.

## Account and submission rules

All accounts, including administrators, need a verified zx student address. Suspension revokes access immediately. Confirmed account deletion removes credentials and personal fields while retaining protocols, ledger entries and audit references under a non-login identity. The last active administrator is protected.

Monthly cleanup applies after two years without a login, falling back to registration age for accounts that never logged in. It also completes older pending deletion requests. Administrators can disable it or choose three- or six-month intervals.

Each revision contains one PDF or TXT file, up to 30 MiB. New uploads require an examiner, semester and exam date. Improvements inherit the date and semester, leave the published revision available during review and receive no reward. Students cannot withdraw or delete submissions. Proposed lectures remain hidden until approved.

Administrators review files, edit metadata and lecture assignments, or delete file bytes while retaining metadata and decisions. Changes are audited; version checks reject stale edits. Internal notes and extracted document text stay private.

## Tokens

Configurable defaults: 5 after verification, 3 per accepted contribution, 6 for an excellent contribution, 1 for four weeks of lecture access, and 2 on 1 April and 1 October at midnight Europe/Berlin.

Rewards are split equally among distinct registered, verified contributors, rounding each share up. Unknown collaborators are ignored; suspension does not remove reward or periodic-grant eligibility. Recipients freeze at the first award. Deleted accounts and deleted protocols receive no new rewards. Deleting files does not reverse existing rewards or purchased access.

Balances equal the ledger sum and cannot become negative. Account locks prevent overspending; receipts and unique business keys prevent duplicate effects. Decisions, rewards, audit events and notifications commit together.

## Files and jobs

ClamAV blocks unsafe files. Duplicate, similarity and content checks advise reviewers; model moderation remains a disabled placeholder. OCR processes image pages without text, preserving originals. Downloads carry the student's zx ID and Berlin download date; admin previews stay unmarked.

Purchases start ZIP preparation on the lecture page. Archives use lecture names and include a metadata `index.json`. Metadata edits invalidate affected ZIPs. Downloads recheck access, publication and safety; multi-lecture protocols require access to any assigned lecture. ZIPs expire after one hour or at the next Berlin midnight, whichever comes first.

Administrators manage queues and schedules through the website. Waiting jobs can be cancelled; running jobs finish before pause or shutdown. Running-job cancellation and editable concurrency are still pending.

See [operations](operations.md) for deployment and [migration](migration.md) for cutover rules.
