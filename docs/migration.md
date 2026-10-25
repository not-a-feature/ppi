# Legacy migration

The final importer is not implemented yet. It will combine:

- The populated protocol database and private files, including corrected examiners, semesters, dates, catalogue links and review history.
- A fresh legacy export of accounts, token balances, access grants and original ownership.

Keep submission/revision IDs, upload numbers, file hashes and OCR derivatives. Export the database and files as one consistent set with a hash manifest. Keep snapshots, source-ID mappings and credentials outside Git. Do not restore the whole test database into production: exclude synthetic accounts/submissions, test transactions, sessions, queued mail/jobs and cached ZIPs.

## Accounts and balances

Fix the cutoff at two calendar years before cutover in Europe/Berlin. Import only accounts with a recorded successful login at or after that cutoff, including administrators. Skip older accounts and accounts without a successful-login date; registration age and uploads are not substitutes.

Preserve verification and suspension states, populate `last_login_at`, and require verified zx addresses for administrators. Runtime cleanup later uses registration age for never-used accounts; that fallback does not apply to this import.

Do not copy passwords, hashes, sessions or verification/reset tokens. Every migrated user must set a new password through Better Auth recovery. Confirm this works for an imported account with no usable password.

| Legacy data             | Import rule                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `Users.tokens`          | Copy unchanged into the balance and one `legacy_opening` ledger entry      |
| `Users.comment`         | Private `ppi_user.admin_note`                                              |
| Borrow records          | Keep access expiry; charge nothing                                         |
| Ownership/collaborators | Resolve through private source-ID mappings; issue no retrospective rewards |
| Logs                    | Retain privately only as required by the agreed retention policy           |

Use `activation:<target user ID>` as the opening entry's business key to prevent starter-token duplication. Do not reconstruct transactions, recalculate old rewards or run activation/contribution handlers during import. Disable outbound mail and periodic grants until reconciliation. Imported pending submissions follow the new reward policy on first decision.

Excluded accounts bring no balance or access grants. Their protocols remain under a non-login archival identity. Remap rehearsal-account references and report ambiguous ownership instead of assigning it to a test user. Report excluded account counts and balance totals separately.

## Rehearsal and cutover

1. Inventory both sources. Resolve missing files, invalid/duplicate accounts, orphan links, negative balances and malformed dates. Skip incomplete files and record every omission.
2. Import into empty staging with mail disabled. Preserve accepted legacy status; trusted, previously accepted imports may skip scanning. New uploads keep normal checks.
3. Compare balances, access expiry, ownership, catalogue links, metadata and file hashes against both sources. Confirm inactivity exclusions and the absence of test data. Check that old passwords fail and reset passwords work without extra rewards.
4. Repeat the import to prove it creates no duplicates, rebuild from scratch, and verify an isolated restore.
5. Freeze writes on the legacy system and prepared collection. Take final snapshots and reconcile later uploads, replacements, withdrawals and deletions. Preserve corrected metadata; do not republish withdrawn content or restore deliberately deleted files. Import and smoke-test before switching traffic.

Assign a cutover/recovery owner and keep the old site read-only for an agreed period. Before new writes, rollback can switch routing back. Afterwards, freeze writes and reconcile new accounts, protocols, tokens and access grants first; there is no automatic lossless reverse migration.

References: [legacy source](https://github.com/fsi-tue/ppi/tree/cf6e8116c4a67b5e230d71329d4fa693076779fd), [deployment repository](https://github.com/fsi-tue/docker/tree/master/ppi).
