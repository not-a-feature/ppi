# Admin interface

## Responsibility and technology

SvelteKit supplies an authenticated administration area using the same Svelte components and TypeScript contracts as the student interface. The application provides task-specific screens rather than exposing arbitrary database editing.

## Screens

| Route | Capabilities |
|---|---|
| `/admin` | Review backlog, oldest waiting submission, failed processing and worker health |
| `/admin/review` | Filter by state, age, lecture and check outcome; oldest-first default |
| `/admin/review/[id]` | Safe document preview, metadata, duplicate candidates, check evidence, revision and decision history |
| `/admin/users` | Account state, admin flag, access revocation and controlled credit adjustments |
| `/admin/catalogue` | Lectures, examiner aliases, archive operations and content reports |
| `/admin/credits` | Token requests, adjustments and periodic grant runs |
| `/admin/jobs` | Queue overview and worker availability |
| `/admin/jobs/[id]` | Stage, attempts, timings, safe error details, retry/cancellation controls |
| `/admin/schedules` | Enable/disable tasks, next runs, timezone and run-now controls |
| `/admin/settings` | Versioned moderation policy and bounded product settings |
| `/admin/audit` | Searchable record of decisions, admin-flag changes, rewards and maintenance actions |

## Review workflow

The review screen places the safe document view beside metadata and findings. It distinguishes detected evidence, model suggestions, and human decisions. Duplicate candidates link to files the reviewer is permitted to inspect. Claiming a review is optional coordination; it does not replace transactional conflict checks.

Actions are accept, request changes, reject, and withdraw. Publication and reward fields are explicit. Before confirmation, show the configured nominal reward, recipient list, rounded per-person shares, total credits issued and prior awards. An administrator can reject publication while granting a permitted contribution reward. Internal notes and student-visible reasons are separate fields.

Every decision submits the expected revision and version. If another reviewer acted first, show the new state and require a fresh decision. Keyboard shortcuts must not bypass confirmation of reward or destructive actions.

## Job controls and permissions

Verified active users with `isAdmin=true` can inspect processing, retry analysis, pause queues, edit schedules, cancel jobs, and trigger predefined maintenance tasks. The interface explains that pausing stops new work and cancellation may wait for a safe checkpoint.

Admin-flag changes, bulk rewards, permanent deletion and policy activation show the affected scope before confirmation. There is no shell-command field, SQL console or arbitrary executable upload.

## Acceptance criteria

- Direct requests to administrator actions are denied for accounts without the admin flag.
- A stale review cannot overwrite a newer decision or award tokens again.
- A job retry links back to the same submission and shows previous attempts.
- An unavailable worker appears as unavailable, not as an empty queue.
- Every privileged mutation produces an audit event with actor, time, target and reason where required.
- An administrator can complete review entirely through the website, including a readable failure report when processing failed.

Dependencies: all domain modules, with read models assembled by server functions. No UI component writes database rows directly.
