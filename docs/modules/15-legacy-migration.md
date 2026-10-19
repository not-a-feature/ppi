# Legacy import and cutover

## Responsibility and technology

A proposed TypeScript CLI reads an authorised MariaDB snapshot and protocol-file snapshot, validates them, and imports into PostgreSQL using the new schema. It uses shared validation rules and a maintained MariaDB client. It never modifies the legacy database.

The source of truth is the actual deployed schema and data, not only the PHP setup utility. Source snapshots, credentials and real documents remain outside Git. Retain source fingerprints and an import mapping so reruns are deterministic.

## Mapping

| Legacy data | Target |
|---|---|
| Users and roles | Better Auth identity, verified state, account state, admin flag and profile |
| Users.comment | Private `ppi_user.admin_note`; visible and editable only by administrators |
| User token count | Copy the current `Users.tokens` value unchanged into the new balance and one opening ledger entry |
| ExamProtocols | Submission plus initial immutable revision and original status |
| Protocol files | Private stored files with verified byte count and SHA-256 |
| Lectures | Catalogue records with source IDs mapped |
| ExamProtocolAssignedToLectures | Unique revision/lecture assignments |
| Examiner text | Preserved display value, reviewed normalisation/alias mapping |
| Collaborator text | Private imported claims; unresolved values reported |
| BorrowRecords | Access grants with original expiry, without a new charge |
| LogEvents | Restricted archive if retained by policy; do not invent structured decisions |
| RecurringTasks | Reviewed schedule configuration; disable first automatic grant until period reconciliation |

Copy each user's current token count directly from the source database. Do not reconstruct past rewards, split historical tokens among collaborators, or recalculate balances from protocol statuses. The opening ledger entry is simply the copied count.

Import protocol statuses without invoking reward handlers. Previously reviewed imports, including accepted and rejected protocols, do not receive automatic retrospective rewards on rechecks. Imported pending submissions use the new reward policy when first decided. Any exceptional later credit is an explicit administrator adjustment, not a reconstruction of legacy history.

## Rehearsal sequence

1. Inventory tables, encodings, timezone behaviour, hash formats, counts and status values.
2. Produce a report of missing files, duplicate usernames, invalid zx accounts, orphan relations, negative balances, malformed dates and unresolved collaborators.
3. Resolve or explicitly quarantine each exception with a recorded mapping. Never silently discard records or normalise distinct identities into one.
4. Import into an empty staging target with outbound notifications disabled. Run file checks; accepted source status does not bypass a failed technical safety check.
5. Reconcile per-user balances, active access expiry, protocol/file counts, hashes and catalogue links. Check representative German text and exam metadata manually.
6. Repeat the same import to prove idempotency, and rehearse a clean rebuild from the snapshot.
7. Test legacy authentication migration or the agreed password-reset flow with controlled accounts. The legacy registration/login path sanitises password input; test the exact preprocessing of special characters and Unicode as well as the hash algorithm. Do not assume a valid PHP hash verifies the raw password unchanged.

## Identity and reward exceptions

All staff must use verified zx accounts, with an admin flag. The legacy non-zx `admin` account therefore requires a nominated eligible replacement; never create an exception to public registration or transfer ownership without a recorded decision.

Mark imported active accounts' activation credit as already accounted for. Review unverified legacy accounts separately so later verification does not accidentally duplicate historical credits. Do not treat arbitrary legacy status text as a verified-email timestamp without validating its semantics.

## Cutover and rollback

Announce a maintenance window, stop legacy writes and background mutation, capture final matching snapshots, import and reconcile, then switch the reverse proxy after smoke checks. Retain the legacy deployment and snapshots read-only for the agreed period.

Before PPI-2 accepts writes, rollback can restore legacy routing. After new writes, rollback requires a write freeze and reconciliation/export of new submissions, account changes, credits and grants. There is no automatic lossless reverse migration. A short launch observation period and explicit recovery owner are required.

## Acceptance criteria

- Every source row/file is mapped, intentionally excluded by an approved rule, or listed as an unresolved blocker.
- Per-user opening balances and active access match the source exactly.
- No import triggers activation/contribution rewards or real notification delivery.
- Existing accepted content and pending reviews appear in their intended states, subject to technical safety holds.
- Import restart does not duplicate identities, files, assignments or opening credits.
- The team rehearses both pre-write rollback and the procedure for failure after new writes.

Dependencies: live schema/snapshot access, all core schemas, policy decisions and deployment rehearsal.

## Feature comparison, 19 October 2026

Compared the local legacy PHP source with the current PPI-2 implementation. These findings describe source behaviour; production configuration and data still need checking before migration.

Private user comments have been restored under **Admin → Accounts → Internal note**. Notes use optimistic concurrency checks and do not appear in student responses or audit detail. The legacy implementation is in `userslist.php:21,147,166`. Download watermarks are also restored for individual files, student previews and ZIP members, using the downloading student's zx ID and the Berlin download date. Legacy `download.php:46,75` applied a user-ID watermark to archives.

The following legacy features remain absent or incomplete:

| Feature | Legacy evidence | Current gap |
|---|---|---|
| Administrator corrections to protocol metadata | `viewexamprotocol.php:21–76` updates examiner, remarks, uploader and lecture links | Reviewers can decide, withdraw and delete files, but cannot correct protocol metadata. Add an audited correction workflow without rewriting immutable revision history. |
| Per-user uploads and borrowed-access views | `userslist.php:169–174,190–193` links to filtered protocol lists | Account cards do not link to a user's submissions or access grants. Current review search can find an uploader ID, but requires a manual search. |
| Latest sign-in on the user list | `userslist.php:145,164` displays `lastLoggedIn` | Sign-ins are recorded as events, but the account list has no latest-sign-in field. Historical events before recording began cannot be reconstructed. |
| Unverified registrations in account administration | Legacy user administration lists accounts before activation | Current account list joins `ppi_user`, created after verification; pending Better Auth registrations are omitted. There are also no dedicated role/status filters. |
| Completion of account deletion | `RecurringTasksSystem.php` invokes `removeToBeDeletedUsers`; `RecurringTasksDao.php` implements cleanup | Self-service deletion requests suspend access and preserve submissions. Administrator completion/anonymisation and the corresponding cleanup job are still missing. The retention policy needs to be agreed first. |
| ZIP index and readable archive name | `download.php:34–75` builds a lecture-named ZIP with a README listing files, upload dates and examiners | PPI-2 ZIPs contain the protocol files and use a lecture UUID as the archive name. A README and lecture-based filename are missing. |
| Help, imprint and support navigation | `help.php`, `impressum.php`, `core/ui_classes/Footer.php:14–18` | Equivalent pages and a visible support contact are missing from the current navigation/footer. |
| Log retention configuration | `RecurringTasksDao.php:121` trims logs to a configured count | PPI-2 retains audit history without a pruning policy. Decide retention/export rules rather than copying the legacy deletion routine. |

Some differences are intentional: administrators require verified zx accounts; improvements have no reward; immutable revisions replace direct file replacement; token changes use ledger entries rather than overwriting balances. Arbitrary password-hash, last-login and role-string editing from the old administrator form should not return. The actual legacy import remains deferred until the final migration phase.
