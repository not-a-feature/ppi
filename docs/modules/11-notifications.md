# Notifications

## Responsibility and technology

TypeScript templates and an SMTP client send transactional email through a configured relay. pg-boss runs delivery attempts. German and English templates share the same event data. The first release needs verification, password recovery, submission receipt, review outcome, shared reward and token-request resolution emails. The uploader receives public review feedback; each collaborator receives only their own reward notification, without private feedback or other contributors' details.

## Data and interfaces

`enqueueNotification(transaction, event, recipient, locale)` creates a notification with a unique event/recipient/template key and enqueues delivery in the same transaction as its originating domain change. Authentication callbacks use a documented integration that durably records delivery intent and reports failure to the auth flow; no success response may silently discard verification mail.

Templates accept a small schema: display identifier, relevant URL, public reason, credited amount and expiry where applicable. They never accept arbitrary HTML. Use a configured canonical site URL, not the request Host header, to generate links. The sender and reply-to address are deployment configuration.

Verification/reset messages necessarily contain sensitive links. Keep their queued payload protected, restrict database/job access, redact logs, expire it with the token and purge it promptly after completion. Prefer reference-based payloads where the library permits. Internal moderation notes and original document contents never appear in emails.

## Delivery semantics

States are pending, sending, sent, retrying, failed and expired. Persist attempts, timestamps and a sanitised failure category. Retry temporary SMTP failures; stop on permanent rejection or expired auth links. Administrators see failures and can retry eligible messages through the website. A user may request a new verification/reset link subject to rate limits.

An SMTP server can accept a message just before the worker loses the acknowledgement. A retry may therefore send a duplicate. Stable message IDs and application deduplication reduce this risk but do not guarantee exactly-once delivery. Email never applies credits or changes moderation state, so duplicate delivery cannot repeat those effects.

Operational failure alerts use a configured channel and deduplication window. The application shows email failure in the admin interface even when SMTP itself cannot deliver an alert.

## Acceptance criteria

- A review decision succeeds independently of immediate SMTP availability, with a durable pending notification.
- Transient delivery failures recover; permanent failures become visible without endless retries.
- Emails contain only public feedback and valid canonical URLs.
- An expired reset token is not repeatedly mailed from an old queued job.
- Integration tests use a local mail sink; production recipients are never contacted by tests.
- Repeated domain commands do not enqueue duplicate notification records.

Dependencies: auth callbacks, moderation/credits events, jobs and audit. Notification templates are versioned with releases.
