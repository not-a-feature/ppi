# Audit and operations visibility

## Responsibility and technology

TypeScript writes structured operational logs to container output and durable domain audit events to PostgreSQL. SvelteKit provides the admin overview. Start with existing operator log collection and monitoring where available; a separate observability platform is not a launch dependency.

## Events and information boundaries

Audit account suspension, admin-flag changes, moderation decisions, policy changes, credit adjustments, shared reward allocations, queue controls, schedule changes, data deletion and migration runs. Store actor, action, target, relevant before/after values, reason, timestamp and request/job correlation ID. Insert events within the domain transaction for successful mutations.

Audit is append-only through application interfaces. It is not claimed to resist a database superuser. Failed access attempts and operational exceptions use restricted logs with retention limits. Do not log passwords, cookies, auth links, complete documents or unredacted provider payloads.

Students can see their own public submission and credit history. Administrators can inspect audit records and sanitised operational errors. Private details appear only where needed for the task, and exports follow the same permissions as the page.

## Admin signals

- Review backlog, age of oldest item and processing failure count.
- Queue length and age, active attempts, repeated failures and worker heartbeat age.
- Email delivery failures and overdue scheduled tasks.
- Disk use/free space, file-integrity failures and missing stored files.
- Database readiness, running release and schema version.
- Scan-signature freshness and document-processing availability.
- Last backup/restore verification, where the operator supplies a trustworthy status record.

Do not display unknown backup status as healthy. A heartbeat proves recent worker activity, not that every task can succeed. Show dependency failures separately from empty queues.

## Retention and alerts

Operational job/log history and durable moderation/ledger history have separate retention settings. Queue cleanup must not erase public feedback, reward evidence or audit decisions. Proposed short-lived logs and archive retention are confirmed before production cleanup is enabled.

Alerts should fire on actionable sustained conditions, such as disk exhaustion risk, failed backups, unavailable workers with queued work, or repeated verification-email failures. Configure recipient and escalation ownership during deployment. Recovery clears an alert without generating repeated unchanged messages.

## Acceptance criteria

- Every privileged action can be traced to an actor and target without exposing secrets.
- Worker failure, SMTP failure and low-disk fixtures produce the expected admin status.
- A missing monitoring integration shows unknown rather than success.
- Retention cleanup preserves required decision and credit history.
- Release identifiers correlate a failed job with the executable version that ran it.

Dependencies: domain transactions, workers, deployment health information and admin interface.
