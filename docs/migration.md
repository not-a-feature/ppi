# Scraped legacy migration

The fresh snapshot prepared on 2026-11-01 is in `.data/migration-fresh/2026-11-01`.
Its merge-ready portable copy is `.data/migration-bundles/2026-11-01-ready`.
The full local rehearsal preserved 3,693 accounts, eight admin flags, 44,894 tokens,
and 1,442 protocols; repeating the import added zero records. All copied file hashes
were checked. The extra archival identity owns 26 protocols whose source users are
absent. No mail was queued. `rehearsal-report.json` records the checks.

Preparation applied 1,141 metadata corrections and retained 234 previously reviewed
records unchanged. Both newly uploaded protocols were inspected and corrected.
The remaining 67 records are flagged for metadata review: 38 have invalid file content,
23 lack extracted text, and six had no prior extraction result. Source metadata is
preserved where supported corrections are unavailable. One missing source file (607)
and three empty files (593, 813, 1300) are explicitly omitted. Files still need normal
antivirus scanning on the deployed system; 38 invalid files are blocked immediately.
Protocol 114 has no source lecture assignment and is preserved for catalogue review.

Migration uses authenticated, read-only HTTP scraping of the legacy PPI admin lists
and downloads. It never restores a legacy PostgreSQL database and has no dependency
on an old Hetzner deployment.

## Collect and prepare locally

Use a current administrator PHP session, supplied privately as a cookie file:

```powershell
python scripts/scrape-legacy.py --cookie-file <private-cookie-file> --output .data/migration-fresh/<snapshot>
node scripts/prepare-legacy.mjs .data/migration-fresh/<snapshot>
```

Each run uses a new directory. `--resume` can finish an interrupted directory without
`snapshot.json`. Never resume a completed snapshot.
Collection checks pagination totals, unique IDs and source lists again after downloads.
For final cutover, freeze legacy writes first; HTTP collection cannot guarantee an
atomic snapshot while the legacy application is being edited.

After preparation, create a portable private bundle with checksums for every file:

```powershell
node scripts/prepare-legacy-bundle.mjs .data/migration-fresh/<snapshot> .data/migration-bundles/<snapshot>
node scripts/verify-legacy-bundle.mjs .data/migration-bundles/<snapshot>
```

The bundle contains the raw minimal exports, correction evidence, prepared import data,
source documents and reports. It excludes credentials and rehearsal database files.

Raw account HTML is never saved. The scraper discards password hashes and activation
status tokens; it saves source ID, account name, role, balance, private note and last-login
date only. Account roles determine active/unverified/suspended/deletion states. All
scraped accounts are retained; the earlier proposed two-year import cutoff is not
applied. Last-login dates remain in the source snapshot for review; imported accounts
start their destination lifecycle at import time.

`ADMIN` sets `ppi_user.is_admin=true`; other roles set it false. The built-in account
`admin` (source ID 1) retains its admin flag and balance but receives a suspended,
non-deliverable identity. Named administrators retain verified student addresses and
active status. To activate the built-in account for a particular person, supply an
explicit private JSON mapping of source IDs to unique zx email addresses as the third
argument to `prepare-legacy.mjs`. Duplicate or invalid addresses fail preparation.
Encoded whitespace in usernames is decoded and trimmed. No privileges are inferred
from notes or protocol ownership.

Preparation reuses reviewed metadata only when the protocol file SHA-256 and original
examiner names match. It applies reviewed examiner replacements and lecture-specific
identity harmonization. `corrections.json` retains correction evidence; additional
reviewed corrections can be added there and preparation repeated. Never infer exam
dates or semesters from upload dates. New or changed documents without a reviewed
correction appear in `preparation-report.json`; missing and empty files are omitted
explicitly. The original source files are kept. Do not treat pending scans as clean.

Preparation reads only the snapshot directory. For a later scrape, copy
`corrections.json`, `harmonization-plan.json` and `reviewed-unchanged.json` from the
previous bundle into the new snapshot before preparing it. Matching file hashes and
source examiner names protect those decisions against changed documents. Missing
sidecars start empty, and unreviewed metadata is reported rather than inferred.

## Import after deployment

Transfer the entire private snapshot directory to the destination. Keep it outside Git
and public web roots. Back it up privately. Configure the destination `DATABASE_URL`
and persistent `UPLOAD_DIR`, run the normal application schema migrations first, then:

```powershell
node --env-file=.env scripts/import-legacy.mjs .data/migration-fresh/<snapshot>
node --env-file=.env scripts/import-legacy.mjs .data/migration-fresh/<snapshot> --apply
```

The first command rolls back all SQL and writes no destination files. The second
commits users, opening balances, catalogue entries, corrected protocols and source-ID
mappings in one transaction. It checks the prepared-data checksum and every file hash
before import. Keep workers stopped during import/reconciliation, especially periodic
grants and account cleanup. No email or historical token rewards are generated.

Use the database import/migration role and apply migration `021_legacy_import.sql`
before these commands. If the deployment injects environment variables directly,
omit `--env-file=.env`. The importer creates no database tables at runtime. Run it
with access to the same persistent file directory as web and worker. For Compose,
mount the private bundle into a one-off web container and invoke
`node scripts/import-legacy.mjs /migration` (then add `--apply`); do not copy the
bundle into an image or expose it through nginx. Run as the file-store owner and keep
the snapshot directory writable for import reports. Keep web and worker stopped until
reconciliation finishes, then enable scanning while notification and periodic queues
remain paused until their launch checks are complete.
Files receive pending scans (or blocked status for invalid content). Start the normal
file-check worker and reconcile failures before opening access. Previously accepted
protocols retain moderation status; pending protocols receive the normal first-decision
reward. Ownership is resolved through source user IDs, falling back to a non-login
archival identity only when an owner is absent.

Each imported credential gets a distinct cryptographically random password, hashed
using Better Auth and immediately discarded. Users set a password with the existing
password-reset flow. Never send or retain the random passwords. Unactivated and
blocked accounts keep their access restrictions. Opening balances use the business
key `activation:<target user ID>` to avoid duplicate starter grants.

Unchanged imports can be repeated: source mappings prevent duplicate records, password
resets, balance resets and rewards. Existing destination email collisions, changed
source records, and previously imported records absent from a fresh snapshot stop the
transaction for explicit reconciliation. This is an additive integration tool, not an
automatic overwrite/synchronization of a running system. Freeze legacy writes before
final reconciliation. Deliberate withdrawals/deletions must be resolved before applying
a refreshed snapshot. Failed imports can leave unreferenced destination files; these
are safe to retain for a retry.

To integrate only new users and protocols into a running system, use `--add-only` on
both the dry run and the apply command. This preserves previously imported accounts,
their admin flags, balances, notes, credentials and protocols even if the legacy source
has since changed. Review the resulting `import-report-<timestamp>.json` for changed
or absent source IDs; withdrawals, role changes and replacements require separate
reconciliation. New accounts still receive their scraped admin flags and opening
balances. Existing destination email collisions always fail rather than merging people.

## Verification

```powershell
node --test scripts/legacy-data.test.mjs
python scripts/test_scrape_legacy.py
$env:TEST_DATABASE_URL='<local PostgreSQL URL>'
node scripts/test-legacy-import.mjs
```

The integration check uses a temporary isolated schema, validates dry-run rollback,
admin flags, notes, random credentials and Better Auth password recovery, repeat-import
idempotency, preservation of spent live balances, conflict rollback, pending scanning
and absence of import mail. It removes only its own schema and temporary directory.
