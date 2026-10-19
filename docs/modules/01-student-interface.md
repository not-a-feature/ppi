# Student interface

## Responsibility and technology

Svelte components and SvelteKit pages provide the student-facing application. TypeScript describes view data and interactions. Proposed styling is Tailwind CSS with shared form, table, status, dialog and navigation components. All text has German and English translations; German is the default.

The interface owns presentation and temporary form state. Authentication, permission checks, balances and moderation decisions are server responsibilities.

## Screens and contracts

| Route | Required behaviour |
|---|---|
| `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password` | zx registration, verification state, login and recovery |
| `/lectures` | Search, filters, protocol counts and current access status; query state in URL |
| `/lectures/[id]` | Protocol metadata, access price/expiry, purchase action and authorised downloads |
| `/upload` | File selection, lecture/examiner metadata, optional collaborators, authorship attestation |
| `/submissions` | Own submissions with processing/review status and feedback |
| `/submissions/[id]` | Revision history, safe own-file access, Submit improvement action and review request; no delete or withdraw action |
| `/account` | Locale, account security actions and deletion request |
| `/account/credits` | Balance, ledger, active lecture access and token request form |

The catalogue lists metadata before purchase. Full protocol text and content previews require access. Student identity and contributor claims are never included in catalogue responses.

## Interactions

Upload is a three-step flow: choose file, enter metadata, confirm. A failed submission preserves valid form fields and gives specific recovery instructions. Once stored, a submission has a stable URL; leaving the page does not cancel processing. Display named stages, such as "Extracting text", rather than invented completion percentages.

An access purchase displays cost and expiry before submission. A duplicate click returns the same entitlement without charging twice. On insufficient balance, preserve the current lecture and link to contribution and token-request options.

After submission, students can submit improvements as new revisions but cannot delete or withdraw the protocol or its revisions. Explain this before the initial submission. Improvements go through review; an existing published version remains available until a replacement is approved, unless an administrator withdraws it or a file-safety check blocks access. Account deletion is a separate request and does not delete contributed protocols.

Show public moderation reasons separately from technical processing status. A failed file-check task says processing needs attention, rather than implying that the protocol was rejected. The upload summary previews the current reward split among distinct contributor identifiers and explains that final rewards depend on review. The ledger shows the student's individual share.

## Access, failures and accessibility

Unauthenticated users see login/registration and public help/legal pages. Verified active students can use the catalogue. Server responses omit inaccessible content even if the browser calls endpoints directly.

Use semantic HTML, labelled inputs, keyboard-accessible controls, visible focus and text labels for status colours. Mobile forms and reviewer-independent student flows must work at 360 px. Search and core forms should work through ordinary server submission; JavaScript improves responsiveness.

Handle expired sessions, offline requests, conflicts and throttling without losing non-sensitive form state. Do not persist document content or authentication secrets in local storage.

## Acceptance criteria

- A student can register, verify, upload, receive feedback, earn tokens, buy access and download using keyboard navigation.
- German and English cover validation messages, statuses, emails and empty states.
- Page reload restores search filters and server-side submission status.
- Protected content is absent from HTML, JSON page data and unauthorised download responses.
- Failed purchases/uploads can be retried without duplicate charges or submissions.

Dependencies: authentication, catalogue, submissions, credits, notifications and background status endpoints.
