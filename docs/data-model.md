# Data model and invariants

Names below describe the intended schema. Better Auth and pg-boss retain their supported schemas; their exact columns follow the pinned library versions. All other relations use explicit foreign keys, constraints, and migrations.

## Core entities

| Entity | Important fields and constraints | Owner |
|---|---|---|
| Auth user, account, session, verification | Library-managed IDs, canonical unique email, verification and credential/session state | Authentication |
| User profile | Auth user FK, unique zx identifier, isAdmin boolean default false, account state, locale, created time | Authentication |
| Lecture | ID, name, normalised name, aliases, active/archived state, version | Catalogue |
| Examiner | ID, display name, normalised name, aliases, version | Catalogue |
| Submission | ID, uploader FK, current revision FK, published revision FK or null, review state, visibility, version | Submissions |
| Submission revision | ID, submission FK, revision number, file FK, optional examiner FK pending proposal resolution, optional exam date/term, remarks, authorship attestation, created time; unique submission/revision | Submissions |
| Revision lecture | Revision FK, lecture FK; unique pair | Catalogue |
| Catalogue proposal | ID, revision FK, lecture/examiner kind, proposed name, state, optional resolved catalogue FK; accepted publication requires resolved catalogue assignments | Catalogue |
| Contributor claim | Revision FK, claimed zx identifier, optional resolved user FK; private claim, not proof of consent | Submissions |
| Stored file | ID, opaque storage key, SHA-256, byte count, detected media type, original filename, safety status, latest requested safety-check generation, created time | Submissions |
| Analysis run | ID, revision FK, generation, policy version, tool/model versions, state, artifact references, timings | Document processing |
| Check result | Analysis FK, check name, outcome, structured evidence, evidence locations | Moderation |
| Moderation decision | ID, revision FK, actor/system policy, outcome, reasons, public feedback, internal note, previous decision FK, timestamp | Moderation |
| Credit account | User FK as PK, integer balance >= 0, updated time | Credits |
| Credit entry | ID, user FK, signed amount, kind, source reference, unique business key, timestamp, actor/reason | Credits |
| Reward allocation | ID, submission FK unique, reward policy/version, sharing mode, base/excellent total, approved by/time | Credits |
| Reward recipient | Allocation FK, user FK, eligibility snapshot; unique pair, roster frozen at first award | Credits |
| Contribution reward | Allocation FK, beneficiary FK, base/bonus kind, entitlement amount, optional ledger entry FK when delta is zero; unique allocation/beneficiary/kind | Credits |
| Lecture access | User FK + lecture FK unique, start, expiry, last purchase entry FK, source | Credits |
| Token request | ID, user FK, explanation, pending/resolved state, decision, resolver, ledger entry FK | Credits |
| Content report | ID, user FK, lecture/submission FK, category, explanation, status, resolution | Catalogue |
| Mutation receipt | Actor, operation, request key, input fingerprint, result entity ID; unique actor/operation/key for retry-sensitive writes | Server/domain owner |
| Notification | ID, unique event/recipient/template key, template version, locale, protected payload, state, attempts, delivery time | Notifications |
| Queue job and schedule | Library-managed queue state; payloads reference domain IDs | Jobs |
| Task configuration | Task name, enabled flag, pause state, bounded concurrency, schedule/timezone, version | Jobs |
| Worker heartbeat | Process ID, release, capabilities, heartbeat time, active jobs | Jobs |
| Audit event | ID, actor, action, entity, relevant field changes, request/job ID, timestamp | Audit |
| Policy version | ID, immutable validated policy body, author, activation time | Moderation/admin |
| Migration map | Source system, table, legacy ID, target ID, source fingerprint; unique source/table/ID | Migration |

Application IDs are opaque UUIDs, except library-owned IDs. Legacy integer IDs remain in the migration map. Text limits, indexes and deletion rules are part of the schema migrations, not left to UI validation. JSONB is reserved for variable check evidence and versioned policies; relationships and money-like counters use typed columns.

## Submission state

Review workflow and publication visibility are separate dimensions:

```text
draft -> processing -> awaiting_review -> accepted
                   -> changes_requested -> new revision -> processing
                   -> rejected
accepted -> new revision -> processing (old published revision stays available)
```

Visibility is `unpublished`, `published`, `withdrawn` or `deletion_pending`. Each revision has exactly one file, and a submission has at most one published revision. A submission can have an accepted published revision while a replacement is under review. The published pointer changes only after the replacement passes review. Withdrawal targets that pointer independently of the pending revision, changes visibility and preserves the pointer for history. File-safety blocks independently prevent serving the affected file.

Processing state belongs to an analysis run: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `superseded`. A technical processing failure is not a content rejection. A safety block prevents publication independently of review state.

Every analysis or decision references an immutable revision. Metadata changes affecting eligibility create a new revision. Resolving a catalogue proposal creates a revised metadata snapshot before final acceptance, retaining the submitted proposal as history; technical file-check artifacts may be reused for the unchanged file hash. Never apply a result to whichever file happens to be current when the job finishes.

## Transaction invariants

- Publication decision, published revision pointer, reward entitlement, credit entry, audit event, and feedback notification enqueue commit together.
- A frozen reward allocation spans all revisions of a submission. The default share is `ceil(reward / number of distinct registered verified recipients)`, including the uploader. Unregistered collaborators are ignored. All recipient credits commit together; re-review and retries cannot create another award. Improvements never receive a reward.
- A lecture purchase locks the user's credit account, checks current access and funds, updates access and balance, and appends its ledger entry in one transaction. Concurrent purchases cannot overspend.
- Balance equals the sum of ledger entries. Legacy balances enter as opening entries rather than invented transaction history.
- Expired access is denied by comparing expiry with current database time. Cleanup is not part of the authorisation decision.
- A user may access a published multi-lecture protocol through any one currently authorised lecture assignment. A ZIP contains only revisions the requester can currently access.
- Blocking an account prevents future authenticated operations even when an earlier cookie exists. Staff permissions are checked from current state.
- A job can execute more than once. Database effects are deduplicated; external effects have explicit retry semantics.

## Lifecycle

Archive lectures rather than removing referenced history. Retire revisions and withdraw files before physical deletion. Final removal follows a configured retention policy and excludes files referenced by retained revisions or unfinished tasks. A deletion race is resolved by rechecking references immediately before removal.

Students cannot delete or withdraw submitted protocols or revisions; improvements append revisions. Content removal requires administrator authority under the retention policy.

Account deletion first suspends access and queues a reviewed anonymisation/deletion workflow. It must not cascade to contributed protocols or their revisions and files. Preserve those records and anonymise or detach account references according to the agreed retention policy. Retention periods and handling of personal data, credit history, audit identifiers and backups require the product policy decision listed in [decisions](decisions.md). No automatic permanent deletion is enabled until those rules exist.
