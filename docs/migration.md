# Legacy migration

The importer is deferred until the application is ready. Verify the deployed MariaDB schema, files and current private infrastructure; the public PHP setup utility and Docker repository are only references. Use matching read-only database/file snapshots, retain source-to-target IDs and fingerprints, and prove repeat imports do not duplicate records. Real snapshots and credentials stay outside Git.

## Mapping and rules

| Legacy data                    | Target                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Users and roles                | Better Auth identity, verified state, profile and admin flag                   |
| `Users.comment`                | Private `ppi_user.admin_note`                                                  |
| `Users.tokens`                 | Copy the current count unchanged into the balance and one opening ledger entry |
| Protocols and files            | Submission, initial revision, original status, private bytes and SHA-256       |
| Lectures and assignments       | Catalogue and revision/lecture links                                           |
| Examiner and collaborator text | Preserved display values and reviewed mappings; report unresolved claims       |
| Borrow records                 | Access grants with the original expiry and no new charge                       |
| Legacy logs                    | Restricted archive if retention policy requires it                             |
| Recurring tasks                | Reviewed schedules, with the first periodic grant disabled until reconciled    |

Do not reconstruct historical transactions, recalculate balances from protocol status, or split old rewards. Import without activation/contribution handlers or outbound notifications. Previously reviewed protocols must not receive retrospective rewards on recheck; imported pending submissions use the new policy on first decision. Mark activation credit as already accounted for and review unverified legacy accounts separately.

All administrators need verified zx accounts. Nominate a replacement for the legacy non-zx admin and record ownership mappings. Test the actual password hash and legacy input preprocessing, including special characters and Unicode; require password resets if compatibility cannot be established.

## Rehearsal and cutover

1. Inventory schema, encoding, timezones, hashes, counts and status values. Report missing files, duplicate/invalid accounts, orphan links, negative balances and malformed dates. Resolve or quarantine every exception explicitly.
2. Import into empty staging with real mail disabled. Preserve accepted legacy approval; explicitly trusted, previously accepted imports may skip the new virus scan. New uploads retain normal checks. Report incomplete or missing files and omit them from the import.
3. Reconcile each balance and access expiry, catalogue links, file counts and hashes. Check representative German text and exam metadata.
4. Repeat the import and a clean rebuild. Rehearse login/password reset and an isolated restore.
5. Freeze legacy writes and jobs, take final matching snapshots, import, reconcile and smoke-test before switching the proxy. Keep the old deployment read-only for the agreed period.

Before the new application accepts writes, rollback can restore old routing. Afterwards, freeze writes and reconcile/export new accounts, protocols, tokens and access grants before rollback. There is no automatic lossless reverse migration. Assign a cutover/recovery owner before launch.

## Remaining legacy gaps

Source comparison on 19 October 2026 found these gaps. Confirm production requirements before implementing them.

- Account links to the user's contributions/access grants and a latest-sign-in field (`userslist.php`).
- Unverified registrations and dedicated role/status filters in account administration.
- Completion/anonymisation of account deletion after retention rules are agreed (`RecurringTasksSystem.php`, `RecurringTasksDao.php`). Submitted protocols must survive account removal.
- A lecture-based ZIP filename and archive index with upload dates and examiners (`download.php`).
- Audit retention/export policy; do not copy the old log-pruning routine without deciding what must be retained.

User notes, audited protocol metadata corrections and personalised download watermarks are implemented. Required zx administrator accounts, unrewarded improvements, immutable revision files and ledger-based token changes are intentional differences.

References: [legacy source](https://github.com/fsi-tue/ppi/tree/cf6e8116c4a67b5e230d71329d4fa693076779fd), [public deployment](https://github.com/fsi-tue/docker/tree/master/ppi).
