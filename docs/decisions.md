# Decisions and unresolved questions

## Agreed direction

- SvelteKit and TypeScript replace the PHP application.
- Student access remains restricted to verified zx addresses at `student.uni-tuebingen.de`.
- Regular students cannot use FSI Keycloak, so it is not the student login dependency.
- Background jobs are monitored and controlled through the PPI website.
- Maintain one modular codebase, with independent web and worker processes.
- Improve the student interface and reduce manual moderation work.
- Complete the specification before implementation.
- Retain existing token rules and make values editable in the admin interface.
- Treat the 1-token lecture price as stable; configuration changes are exceptional. Periodic grant settings remain unchanged throughout a run and its retries.
- Migrate current user token counts directly, without reconstructing historical rewards.
- Each submission represents one protocol file. Keep revisions as successive versions of that file, with exactly one file per revision and at most one published revision; multiple attachments are outside scope.
- Students cannot delete or withdraw submitted protocols or revisions; they can submit improvements as new revisions. Content removal requires administrator authority. Account deletion does not delete contributed protocols.
- Divide contribution rewards equally among uploader and collaborators, rounding each share up; make the distribution policy configurable.
- Ignore unregistered collaborators in the reward calculation. They receive no reserved share. Improvements never receive a reward, and only the original uploader can submit them.
- Administrators may reward an initial submission even when rejecting publication. Existing administrators can promote other verified zx accounts.
- Periodic grants go to verified accounts. Develop against synthetic PostgreSQL data; implement legacy migration at the end.
- All administrators use verified zx student accounts, distinguished only by an admin flag.
- Provide interfaces for both local and external content-moderation providers, with automatic acceptance and rejection as future capabilities. Implement neither providers nor automatic decisions in the core release.

The user accepted the proposed module overview. PostgreSQL, Better Auth, pg-boss, Docker Compose, nginx, and initial private filesystem storage are the resulting planning baseline. The detailed product rules below still require decisions where indicated.

## Proposed technical defaults

| Choice                   | Default                                                                     | Reason and validation                                                                                               |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Database access          | node-postgres with numbered SQL migrations                                  | Explicit transactions and locks; Better Auth uses its PostgreSQL adapter and pg-boss shares transaction connections |
| Runtime input validation | Zod                                                                         | Share bounded schemas across forms and server actions                                                               |
| Styling                  | Tailwind CSS and a small shared Svelte component set                        | Consistent spacing, states and responsive layouts; no large design-system dependency initially                      |
| Tests                    | Vitest, real PostgreSQL integration tests, Playwright                       | Cover domain rules, concurrency and complete browser flows                                                          |
| Document tools           | Poppler inspection/rendering and ClamAV scanning initially; Tesseract later | Validate safe manual-review files first; defer OCR                                                                  |
| Email                    | Existing FSI SMTP relay if available                                        | Avoid mail-server administration inside the app container                                                           |
| Migration tooling        | TypeScript command-line program                                             | Same schema and validation types as the new application                                                             |
| Initial moderation mode  | Manual review with technical file checks                                    | Model providers and automatic content decisions are interface placeholders                                          |

These defaults can be revised before their implementation phase without changing the agreed product direction.

## Product decisions

| Question                                             | Working assumption while unresolved                                                                                                                                                                 | Needed by                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Periodic grant timing and eligibility?               | Every six months by default; reconcile the next run and recipient scope with production before enabling                                                                                             | Schedule activation                          |
| Collaborator eligibility and roster changes          | Confirmed: distinct registered verified recipients; ignore unregistered collaborators, freeze the award, use explicit adjustments for corrections                                                   | Implemented                                  |
| Student identifier format?                           | Fully anchored `^zx[a-z]{3}[0-9]{2}$`, matching the legacy intended format                                                                                                                          | Auth implementation and migration exceptions |
| Continued student eligibility?                       | One-time email verification at launch; periodic reverification remains undecided                                                                                                                    | Launch policy                                |
| Initial administrator and legacy non-zx admin?       | Nominate an eligible zx account for controlled bootstrap; map legacy account ownership explicitly                                                                                                   | Auth migration                               |
| Password migration?                                  | Prefer a tested legacy verifier with rehash at successful login; reset flow if hashes are incompatible                                                                                              | Import rehearsal                             |
| File limit?                                          | 30 MiB per PDF/TXT; 32 MiB request limit allows multipart metadata                                                                                                                                  | Upload UI                                    |
| Revision/publication retention and account deletion? | Administrator-only content removal; account deletion preserves contributed protocols. Retention periods and anonymisation details remain open; permanent automatic deletion disabled pending policy | Production cleanup                           |
| Automatic acceptance/rejection quality thresholds?   | Future evaluation must cover both error types; no arbitrary model confidence cutoff                                                                                                                 | Later automation phase                       |

## Operational inputs

Obtain the current Gitea deployment path, supported Docker setup, server CPU/RAM/disk, SMTP configuration, database version/schema, backup process, account/file counts, upload frequency, and peak traffic. Production credentials and real protocol contents must stay outside this repository.

Agree recovery objectives, service owner, alert destination, retention periods and maintenance window. The proposed 24-hour recovery point and four-hour recovery time are release targets awaiting operator confirmation.

## Framework references

- [SvelteKit Node deployment](https://svelte.dev/docs/kit/adapter-node)
- [Better Auth email verification and password flows](https://better-auth.com/docs/authentication/email-password)
- [Better Auth PostgreSQL integration](https://better-auth.com/docs/adapters/postgresql)
- [node-postgres transactions](https://node-postgres.com/features/transactions)
- [pg-boss queue and scheduling](https://pgboss.io/)

The package lock records the selected dependency versions. PostgreSQL integration tests verify authentication, domain transactions and queue delivery together.
