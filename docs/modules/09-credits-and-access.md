# Credits and lecture access

## Responsibility and technology

TypeScript domain functions and PostgreSQL transactions implement balances, contribution rewards, lecture access, token requests and periodic grants. The user confirmed retaining the existing token economy and making it easy to configure through the website.

## Configurable policy

| Setting | Initial value | Rule |
|---|---|---|
| Starting balance | 5 tokens | Granted once after account activation |
| Base contribution reward | 3 nominal tokens | Shared across all eligible recipients of one submission |
| Excellent contribution reward | 6 nominal tokens total | Replaces the nominal base amount for an excellent contribution |
| Reward sharing | Equal shares, round up | Configurable mode: equal_ceil by default, or uploader_only |
| Lecture access cost | 1 token | Charged only when new access is actually created/renewed |
| Access duration | 4 weeks | Four calendar weeks in Europe/Berlin, then stored as UTC expiry |
| Periodic grant | 2 tokens | Once per eligible user per configured grant period |
| Grant recurrence | Every 6 months | Initial alignment/date and eligibility still require confirmation |

Administrators edit these values in a labelled settings form, with integer/duration validation and a preview of affected future actions. The lecture price remains 1 token by default; configuration changes are exceptional maintenance actions, not a dynamic pricing feature. Settings apply to future operations, while existing ledger entries and access expiries remain unchanged. Each purchase/reward records the policy version and actual amount, and users see the configured price before purchase. Validate an excellent reward at least as large as the base; allow a zero grant/reward to disable it, but require a positive access duration.

## Shared reward calculation

Let `R` be the configured nominal reward and `N` the number of distinct eligible recipients, including the uploader. In the default mode each recipient receives `ceil(R / N)` tokens. Case-normalise identifiers, remove duplicates and count the uploader once. `N` must be at least one. With uploader_only, the uploader receives `R` and collaborators receive no automatic share.

| Nominal reward | Recipients | Each receives | Total issued |
|---|---|---|---|
| 3 | 1 | 3 | 3 |
| 3 | 2 | 2 | 4 |
| 3 | 3 | 1 | 3 |
| 3 | 4 | 1 | 4 |
| 6 | 4 | 2 | 8 |

Rounding up can increase the total above the nominal reward. Show the total and every share to the administrator before confirmation and to each recipient in their own ledger entry. Recipients must be registered verified accounts. Unregistered collaborators are ignored in the recipient list and divisor, with no share reserved for later registration.

Freeze the roster, amount and sharing policy at the first award. Award all recipients in one transaction, locking their credit accounts in stable ID order. Improvements receive no reward, including when the initial revision was not rewarded. Re-review does not upgrade or repeat an existing reward. The administrator chooses standard or excellent at the initial award.

Changing recipients after the first award requires an explicit audited adjustment with its own balance checks. Changing a global policy never recomputes past rewards.

## Ledger and transaction contracts

The append-only ledger is authoritative. A cached balance is updated in the same locked transaction as each entry. Entry kinds include activation, contribution, bonus, purchase, periodic_grant, manual_adjustment, reversal and legacy_opening. All amounts are integers. A debit that would make the balance negative fails; it is never silently clamped.

`purchaseLectureAccess` locks the account and checks existing unexpired access. If already valid, return it at zero additional cost. Otherwise debit the current policy amount and establish the new expiry in the same transaction. Check access against current database time on every protected download.

Contribution uniqueness spans all revisions of the submission and all recipients of its frozen allocation. Rejection with reward is permitted for the initial revision. Reprocessing, repeat acceptance and improvements never issue another reward. An explicit accounting correction appends an audited manual adjustment with a unique business key. A debit that would overdraw fails.

## Token requests and periodic grants

Students submit an explanation through the website. Administrators resolve the request with an amount and reason, atomically linking the ledger entry. A request cannot be granted twice.

Periodic grant jobs process bounded batches and resume after failures. Uniqueness is `(grant period, user)`, so retries or "run now" do not grant twice. Verified zx accounts receive the grant; suspension restricts login rather than grant eligibility. Keep the amount and eligibility settings unchanged until the whole run, including retries, has completed. Preview recipient count and total tokens before an administrator manually triggers a grant. Confirm production schedule alignment before enabling automatic runs.

## Acceptance criteria

- Two simultaneous purchases with one token cannot both spend it.
- Repeated purchases of active access do not charge or extend the expiry.
- Activation, approval, bonus and periodic-job replays preserve balances.
- Sharing tests cover one/two/three/four recipients, duplicate identifiers, unresolved accounts and the increase caused by rounding up.
- Improvements and re-review never add or upgrade a contribution reward.
- A failure crediting any recipient rolls back the entire allocation and moderation decision.
- Changing policy values affects future actions and is recorded in audit history.
- Ledger totals equal balances after import, grant retries and manual adjustments.
- DST boundary tests establish the intended four-calendar-week expiry.

Dependencies: authentication, catalogue, moderation transactions, jobs and audit.
