# Server application

## Responsibility and technology

SvelteKit server loads, actions and endpoints form the HTTP boundary. TypeScript domain functions perform business operations. Proposed Zod schemas validate external values. PostgreSQL and filesystem access remain in server-only modules.

## Domain contracts

These are logical function contracts, not a required generic service framework:

| Operation | Input | Result and effects |
|---|---|---|
| `submitProtocol` | Actor, validated metadata, stored upload, request key | Revision and queued analysis |
| `reviseProtocol` | Uploader or admin actor, submission ID, expected version, changes | New immutable revision and analysis generation; existing revisions remain intact |
| `decideSubmission` | Staff actor, revision, expected version, outcome, reasons, reward selection | Decision, publication state, permitted reward and feedback job |
| `withdrawPublication` | Admin actor, submission ID, expected published revision ID, expected version, reason | Publication withdrawn, audit and feedback recorded; pending revision and credits unchanged |
| `purchaseLectureAccess` | Actor, lecture ID, request key | Existing or newly purchased access and balance |
| `requestDownload` | Actor, revision or archive ID | Authorised safe file response |
| `controlJob` | Staff actor, job ID, allowed action, expected state | Audited control result |
| `updateTaskSchedule` | Admin actor, task name, validated schedule, expected version | New configuration and next run |

An actor is derived from a verified server session. Client-supplied user IDs or admin flags never establish authority. A system actor carries a registered task identity and can perform only that task's operations.

Submission ownership permits improvements, not deletion or withdrawal. Deny student attempts to remove submitted protocols or revisions in every workflow state. Administrator removal follows the retention policy; account deletion cannot cascade to contributed protocols.

## Request lifecycle

Authenticate and validate; authorise the operation and resource; execute the bounded domain transaction; return safe view data. Expensive work is enqueued before the transaction commits. The response does not await OCR, model calls, email, or ZIP generation.

Use supported SvelteKit and Better Auth origin/session protections. Restrict cookie scope, use secure HTTP-only cookies in production, configure the canonical origin and trusted proxy headers, and verify these settings behind nginx. Parameterise database values and escape displayed text. Rich user-supplied HTML is outside launch scope.

## Consistency and failure behaviour

Expected domain conflicts return actionable form errors. Unexpected errors roll back transactions and reach central error handling with a request ID. Retry only explicitly transient infrastructure failures; never convert a failed check into an approved submission.

Idempotency keys are scoped to actor and operation. Reusing a key with different input is a conflict. Database uniqueness protects rewards and purchases independently of browser retries. Queries have bounded pagination, timeouts and allowed sort fields.

## Acceptance criteria

- Route and direct-domain tests enforce the same account, admin-flag and object rules.
- A transaction failure after a provisional reward write leaves no decision, reward or notification job committed.
- A submission commit cannot succeed while its processing job is silently lost.
- Cross-origin mutation attempts fail, including when served through the production proxy.
- Domain errors contain no database credentials, raw SQL, file paths or private reviewer notes.
- Type checking and tests cover inputs at runtime; compile-time types are not treated as request validation.

Dependencies: authentication, module-owned domain functions, database transactions and queue integration.
