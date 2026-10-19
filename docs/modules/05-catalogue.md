# Catalogue and search

## Responsibility and technology

TypeScript domain functions and PostgreSQL queries manage lectures, examiners, protocol assignments and metadata search. Student and staff screens consume safe query results. Initial search uses database indexes; no external search service is required.

## Data and validation

Lectures have names, aliases and active/archived state. Examiners have display names and aliases. Protocol-to-lecture links belong to immutable revisions; a published submission uses its published revision's assignments.

Proposed limits: lecture and examiner names 200 characters, remarks 2,000 characters, search query 200 characters, default 25 results with a maximum of 100 per page. Use normalised names for matching, while preserving display spelling. Similar names are candidates for review, not automatic merges.

Students select existing catalogue entries or propose a new name during upload. Staff resolve proposed names before publication. Do not create public lecture entries from unaudited GET requests. Exam date/term is optional for imported records; show unknown values honestly.

## Interfaces and behaviour

- Search lectures by name/alias and filter protocols by examiner, known term/date and available access.
- Return counts of currently published safe protocols, never pending or withdrawn files.
- List protocol metadata without uploader identity or extracted content.
- Archive a lecture to prevent new assignments/purchases while preserving existing entitlements and history; a safety withdrawal is a separate action.
- Resolve spelling variants with aliases and reviewed edits. Preserve duplicate legacy entries as separate mapped records until a safe consolidation procedure is specified.
- Accept reports for outdated metadata, inappropriate content or unavailable files. Create a staff queue item and record resolution; do not automatically remove content based on a report count.

Full-text protocol search and catalogue merging are deferred. Full-text search must apply download-equivalent permissions to results and snippets. A future merge needs an explicit entitlement/history migration; it must not mutate immutable revision history or charge users again.

## Failure and access rules

Verified active users can browse published metadata. Staff can search pending catalogue proposals. Every query includes visibility constraints before pagination/counts, rather than filtering a broad result in the browser.

Concurrent aliases/name edits use version checks. Archiving preserves record IDs, revision assignments and existing entitlements. There is no merge button in the first release.

## Acceptance criteria

- A multi-lecture protocol appears once per result list, with all relevant assignments.
- Counts agree with downloadable published revisions.
- Search handles umlauts, case and aliases predictably on representative German names.
- Pending submissions and contributor identities do not leak through filters or counts.
- An archived lecture preserves already purchased access until expiry.
- Reports reach the admin interface and their resolution is traceable.

Dependencies: submissions for published revisions, credits for access badges, audit for catalogue changes.
