# Authentication and accounts

## Responsibility and technology

Better Auth handles credentials, sessions, verification and reset tokens. TypeScript application policies enforce student eligibility, the admin flag and account state. PostgreSQL stores sessions and supported auth tables through its native PostgreSQL adapter. [Email/password flows](https://better-auth.com/docs/authentication/email-password), [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)

## Registration and verification

Student registration accepts a zx identifier and password, not an arbitrary destination email. Trim surrounding whitespace, normalise the identifier to lowercase, and validate the entire value against `^zx[a-z]{3}[0-9]{2}$`. Construct exactly `<identifier>@student.uni-tuebingen.de`. The format is based on legacy intent and must be checked against current university identifiers before launch.

Enforce the restriction at the auth library's server-side creation boundary as well as the form. Disable unneeded social sign-up and public email-change routes. If email changes are later supported, apply the same validation and require verification before switching the identity.

Create an unverified account and send a time-limited, single-use verification link. Unverified accounts can only verify, resend within limits, recover access and sign out. First successful verification activates the profile and issues any starting credit exactly once. Provisioning must be recoverable if the callback fails after email verification; protected app access remains blocked until profile/account setup completes.

## Sessions and account lifecycle

Use database-backed sessions in secure HTTP-only cookies. Check current account state on protected requests and the current admin flag on privileged requests. Suspend/delete-pending actions revoke sessions and prevent subsequent requests even if an old cookie is replayed. Password reset revokes existing sessions. Session and reset lifetimes are explicit deployment defaults, tested with the selected Better Auth release.

Account states: unverified, active, suspended, deletion_pending. Privilege is a single `isAdmin` boolean, false by default and not writable through registration/profile fields. Changing it requires an administrator, an audit event and protection against removing or suspending the last active administrator. There is no separate moderator role.

Password recovery sends a reset link, never a generated password. Responses do not disclose whether an account exists. Configure shared rate limits for sign-in, sign-up, verification and recovery. MFA can be added later without changing the simple admin-flag model; it is not a new role system or a core-release dependency.

## Staff and legacy accounts

Administrators use the same verified zx accounts as other students. A bootstrap CLI assigns the first admin flag to an explicitly nominated, already verified active account and records the operation. Later changes happen in the admin website. There is no default administrator password. The legacy non-zx `admin` identity needs a documented migration mapping; it is not a registration exception.

Password import is a separate migration gate. Verify the actual legacy hash format with a maintained library and rehash on successful login only if compatibility is proven. Otherwise require reset without changing balances or access history.

## Acceptance criteria

- Prefix/suffix tricks, aliases, other domains and direct auth endpoint calls cannot bypass the address restriction.
- Expired/reused verification and reset links fail; repeated verification cannot duplicate starting credits.
- A suspended account with an existing session cannot search, download or enqueue work.
- Admin-flag escalation and last-admin removal/suspension attempts fail appropriately.
- Re-registration cannot replace an existing account's password or verification destination.
- Verification email failure is visible and retryable without recreating the account.

Dependencies: database, notifications, credits and audit. Keycloak is not a student dependency.
