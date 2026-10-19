# Submissions and private files

## Responsibility and technology

TypeScript functions manage uploads, immutable revisions, private file storage and authorised downloads. Files initially live on a persistent filesystem volume outside static assets and the public web root. PostgreSQL stores metadata and references.

## Upload contract

`submitProtocol` receives the current actor, file, lecture selections/proposals, examiner, optional exam date/term, remarks, collaborator claims, authorship attestation and request key. Server-side validation enforces account eligibility, allowed fields, a 30 MiB file limit, and PDF/TXT formats. Metadata-only validation happens before expensive processing. The browser, storage layer and domain share the same file-size constant; nginx and the Node adapter allow 32 MiB request bodies for multipart overhead. The per-account storage quota remains 256 MiB by default.

Stream to a private temporary file with a hard byte limit; compute SHA-256 and inspect actual type. Reject oversize/incompatible files with a useful form error. Generate storage keys internally; original filenames are display metadata only. Use atomic rename within the volume before committing the revision and processing job. A failed database transaction can leave an unreferenced file, so scheduled reconciliation removes old unreferenced files after a grace period. Never acknowledge a stored submission before its file is durable under the storage policy and its database transaction commits.

Repeated request keys return the previous result. A repeated hash identifies a duplicate candidate, not proof of copying. Do not reveal another student's identity or inaccessible submission through this check.

## Revisions and authorship

Once submitted, a student cannot delete or withdraw the submission or any of its revisions, regardless of processing, review or publication status. The uploader can submit an improvement as a new revision; existing files and history remain intact. Enforce this rule in server operations as well as the interface. Publication withdrawal and content removal require administrator authority and follow the moderation and retention policies.

Each submission represents one protocol file, not a collection of attachments. Corrections create successive revisions of that file, with exactly one file per revision. A revision owns its catalogue assignments, metadata and attestation. The submission points to the current revision and, separately, at most one published revision. A pending replacement does not displace the existing published file. Students download only the published version; superseded files are retained as restricted review history under the retention policy.

Contributors are private claims. Adding someone's zx identifier does not prove authorship or consent. Before awarding tokens, the administrator confirms the recipient list; the credits module divides the reward among the uploader and distinct registered verified collaborators. Ignore unregistered collaborators in both the recipients and divisor; do not reserve a share for later registration. Student-visible history includes public decisions and own revisions; internal notes and other users' data stay restricted. Only the original uploader can submit an improvement. Improvements receive no reward.

## Download and archive contracts

`GET /files/[revisionId]` checks current account state, file safety, publication status and lecture access on every request. Uploader/staff review access is allowed for safe files under their own permissions. A raw storage path never serves as an access credential. Unsafe/quarantined files cannot be downloaded through ordinary routes, including by their uploader.

Serve files through an nginx internal location after application authorisation, or an authenticated bounded stream. Use attachment disposition for original files and safe filenames. Staff preview uses a sandboxed viewer or rendered derivative; TXT is escaped. Prevent caching protected responses in shared caches.

Lecture ZIP preparation is a background job. The archive records requester, exact revision set and expiry. Recheck current access and publication eligibility before serving it; invalidate/rebuild if a withdrawal or changed entitlement makes its contents unauthorised. A completed archive is not permanent permission to download its contents.

## Acceptance criteria

- A disguised extension, traversal filename and oversize stream fail safely.
- Failed file/DB operations recover without a published missing file; reconciliation is observable.
- Two identical upload requests create one revision and one analysis generation.
- A student cannot delete or withdraw their submitted protocol or revisions, including through direct requests while pending, rejected or accepted.
- An improvement creates a new revision for review without deleting history or displacing the published file before approval.
- A withdrawn file cannot be retrieved through its old URL or an earlier ZIP.
- A late worker result cannot replace a newer uploaded revision.
- Closing the upload page after acknowledgement does not stop processing.

Dependencies: authentication, catalogue, file checks, jobs, credits and audit.
