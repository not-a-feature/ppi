# Legacy migration

The final migration combines two sources: the populated PPI database and private file store for protocols, corrected metadata and catalogue data; a fresh legacy export for accounts, current token balances and access grants. Do not rebuild the protocol collection from the original scrape or overwrite its corrected examiners, semesters and exam dates with legacy values.

The final importer is deferred until the application is ready. Use consistent read-only snapshots, retain source-to-target IDs and fingerprints, and prove repeat imports do not duplicate records. Real snapshots, mappings, files and credentials stay outside Git.

## Prepared protocol collection

Preserve the populated collection's submission/revision IDs, upload numbers, display filenames, original bytes, hashes, OCR derivatives, lecture assignments, examiner associations, exam dates, semesters and retained review/metadata history. Export its database records and private files as one consistent set with a hash manifest.

Use the private legacy-ID mappings to connect these records to freshly imported users and lecture access. Restore original ownership for eligible migrated users. Protocols and retained history belonging to excluded users use a non-login archival identity, with original source IDs retained in the private mapping. Remap references to rehearsal accounts as well. Report ambiguous ownership instead of assigning it to a test account. Account balances come only from the fresh legacy snapshot, copied unchanged into opening ledger entries.

Exclude synthetic test submissions and accounts, test ledger entries, sessions, queued email, runtime jobs, cached ZIPs and deployment secrets. Do not restore the entire test database into production.

At cutover, reconcile legacy changes made after the protocol collection was populated: new protocols, replacement files, withdrawals and deleted records. Import missing valid content and report conflicts. Preserve corrected metadata for matched records, and do not republish withdrawn protocols or restore deliberately deleted files.

## Mapping and rules

| Source data                    | Target                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Eligible users and roles       | Better Auth identity, verified state, profile and admin flag; require a new password |
| `Users.comment`                | Private `ppi_user.admin_note`                                                  |
| `Users.tokens`                 | Copy the current count unchanged into the balance and one opening ledger entry |
| Populated protocols and files  | Preserve submissions, revisions, corrected metadata, retained status, private bytes and hashes |
| Populated catalogue            | Preserve lectures, aliases, examiners and revision/lecture links              |
| Legacy ownership relationships | Link protocols to eligible users or a non-login archival identity through retained source-ID mappings |
| Collaborator relationships     | Preserve reviewed mappings; report unresolved claims without new rewards      |
| Borrow records                 | Access grants with the original expiry and no new charge                       |
| Legacy logs                    | Restricted archive if retention policy requires it                             |
| Recurring tasks                | Reviewed schedules, with the first periodic grant disabled until reconciled    |

Do not reconstruct historical transactions, recalculate balances from protocol status, or split old rewards. Import without activation/contribution handlers or outbound notifications. Previously reviewed protocols must not receive retrospective rewards on recheck; imported pending submissions use the new policy on first decision. Mark activation credit as already accounted for and review unverified legacy accounts separately.

## Accounts and passwords

Fix the activity cutoff at two calendar years before the final cutover timestamp in Europe/Berlin and record it in the migration manifest. Migrate only accounts with a recorded successful login at or after that cutoff. Accounts with an older login, no login date or no successful login are excluded. Do not fall back to registration dates or infer a login from an upload. Apply the same rule to administrators.

Exclude these accounts' balances and access grants from the account import; keep their contributed protocols and corrected metadata. Report excluded account counts, balance totals and ownership mappings separately so reconciliation does not silently drop records.

Do not copy legacy password hashes, sessions or verification/reset tokens. Every migrated user must set a new password through Better Auth's normal recovery flow before first login. Verify this flow with a migrated account that has no usable password. Password reset must not create activation or contribution rewards.

Populate `ppi_user.last_login_at` from the trusted legacy login timestamp. After migration, the monthly cleanup uses this field and falls back to registration age for new accounts that have never logged in. This runtime fallback does not change the migration rule above: legacy accounts without a recorded login are skipped.

All administrators need verified zx accounts. Nominate a replacement for any ineligible legacy administrator and use the normal bootstrap procedure if no eligible administrator remains. Preserve imported verification and suspension states; account migration must not activate suspended or unverified users.

## Rehearsal and cutover

1. Inventory both snapshots, source-ID mappings, hashes, counts and status values. Report missing files, duplicate/invalid accounts, orphan links, negative balances and malformed dates. Resolve every exception explicitly.
2. Combine the prepared protocol collection and fresh legacy account/access data in empty staging with real mail disabled. Preserve accepted legacy approval; explicitly trusted, previously accepted imports may skip the new virus scan. New uploads retain normal checks. Report incomplete or missing files and omit them from the import.
3. Reconcile each eligible account's balance and access expiry, ownership, catalogue links, file counts and hashes. Compare corrected metadata against the populated snapshot, verify the inactivity exclusions and confirm test data is absent.
4. Repeat the import and a clean rebuild. Confirm old passwords cannot log in, new passwords work after reset, and an isolated restore preserves the same result.
5. Freeze legacy writes and jobs, freeze edits to the prepared collection, take final consistent snapshots and reconcile the remaining legacy changes. Import and smoke-test before switching the proxy. Keep the old deployment read-only for the agreed period.

Before the new application accepts writes, rollback can restore old routing. Afterwards, freeze writes and reconcile/export new accounts, protocols, tokens and access grants before rollback. There is no automatic lossless reverse migration. Assign a cutover/recovery owner before launch.

## Remaining legacy gaps

Source comparison on 19 October 2026 found these gaps. Confirm production requirements before implementing them.

- Account links to the user's contributions/access grants and a latest-sign-in field (`userslist.php`).
- Unverified registrations and dedicated role/status filters in account administration.
- Completion of voluntary account-deletion requests after retention rules are agreed (`RecurringTasksSystem.php`, `RecurringTasksDao.php`). Inactive-account cleanup is implemented; submitted protocols survive removal.
- A lecture-based ZIP filename and archive index with upload dates and examiners (`download.php`).
- Audit retention/export policy; do not copy the old log-pruning routine without deciding what must be retained.

User notes, audited protocol metadata corrections and personalised download watermarks are implemented. Required zx administrator accounts, unrewarded improvements, immutable revision files and ledger-based token changes are intentional differences.

References: [legacy source](https://github.com/fsi-tue/ppi/tree/cf6e8116c4a67b5e230d71329d4fa693076779fd), [public deployment](https://github.com/fsi-tue/docker/tree/master/ppi).
