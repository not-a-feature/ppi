# Moderation

## Scope and technology

The first release implements manual review in TypeScript, with technical safety checks, local content checks and decision history. It defines an interface for future local and external moderation providers. Model integration, semantic duplicate detection, automatic acceptance and automatic rejection remain deferred.

Publication and rewards remain separate decisions. Reviewers can accept with standard/bonus reward, reject without reward, reject with a permitted reward, request changes, or withdraw publication. Each action has explicit public feedback; an internal note is optional and never sent to the student.

## Automatic review checks

The review page shows byte-identical files, highly similar text, word and page counts, text extraction coverage, repeated passages and missing exam metadata. Matches link to the relevant revision and identify earlier versions of the same submission. These findings inform the manual decision and do not change publication, rewards or acceptance rules.

After a file passes its safety checks, the `content_check` queue extracts text from TXT or PDF with the installed PDF.js library. Existing clean files are queued by migration 011. Staff can rerun checks from the review card and pause or retry the queue through Processing. Page loads read cached results; a private admin endpoint polls only while analysis is pending.

The initial thresholds are defined in `content-fingerprints.ts`: fewer than 100 words is low content; similarity requires at least 50 words and 80% Jaccard overlap of distinct five-word sequences; more than 50% repeated sequences is flagged. Unicode normalization, case and punctuation are ignored for text comparison. This detects copying and small edits, not paraphrases or semantic similarity. Up to five matches are shown, and new matching files also update the older file's match list.

Extraction is limited to 50 PDF pages and 500,000 characters. Image pages without extractable words queue background OCR; pages with existing text or OCR are skipped. The card shows OCR status, and content checks rerun when a searchable derivative becomes available. Unsupported or failed extraction is never a successful content check. Partial extraction reports the available word count without treating it as the entire document. Analysis tables store counts, hashes, word-sequence fingerprints and match metadata, without extracted text strings. The private OCR PDF contains the searchable layer. No document content is sent to an external service. File deletion removes derivatives and analysis fingerprints and hides the file from other results. Analysis generations prevent stale rescans from replacing current results.

## Manual decision contract

`decideSubmission(actor, revisionId, expectedVersion, outcome, reasonCodes, publicFeedback, internalNote, rewardSelection)` handles acceptance, rejection and requests for changes to the current revision. It validates the admin flag and current revision/version; acceptance additionally requires successful technical safety checks. It commits the immutable decision, any publication change, confirmed shared reward allocation, audit record and notification jobs together. RewardSelection includes the reviewed recipient roster and displayed policy version; a changed roster/policy requires a refreshed preview.

`withdrawPublication(actor, submissionId, expectedPublishedRevisionId, expectedVersion, reason)` independently withdraws the published file. It requires the admin flag and matching publication/version, but does not require a pending replacement to pass checks. Keep the published-revision pointer as the historical target, mark visibility withdrawn, record the decision and notify the uploader. Leave a pending replacement's review state and all credits unchanged. Restoring withdrawn publication requires an explicit administrator action and a currently clean file-safety verdict; a worker cannot restore it automatically.

Proposed reason codes: incomplete_metadata, insufficient_detail, duplicate_candidate, unreadable_document, wrong_document_type, authorship_concern, privacy_concern, other. A free-text explanation is required for other. Reasons describe the reviewer's finding, not an unproven claim of misconduct.

Accepted content must have passed required technical checks. A safety failure cannot be overridden by a normal acceptance button. A later reversal records a new decision linked to the previous one. Existing ledger entries are never edited or automatically erased by changing publication status.

Students can request reconsideration with a short explanation. It reopens a review item without changing publication or reward automatically. Staff can retry technical analysis; the result cannot silently replace a human decision.

## Future provider interface

Define one explicit interface because future local and external providers are a stated requirement. Its conceptual contract is:

- Input: immutable revision ID, analysis generation, file hash, validated metadata, permitted document text/artifact references, language and policy version.
- Output: `recommendation` (accept/reject/review/abstain), reason codes, evidence locations, per-check results, provider/model/version, processing time and optional cost estimate.
- Failure: typed transient failure, permanent unsupported input, or unavailable provider. None is interpreted as rejection or acceptance.

The initial disabled provider reports unavailable without reading document content or making network calls. A deterministic fake provider is permitted in tests only. No provider controls token amounts, executes tools from document instructions, writes decisions directly, or has database credentials through its interface.

The future policy layer evaluates provider results and technical gates. It may eventually accept or reject automatically, as requested, after a separate evaluation/activation phase. Rejection for subjective quality or authorship uncertainty requires an explicit policy and an appeal route. LLM confidence alone is not an activation threshold.

## Future evaluation gate

Use an adjudicated set of representative German/English protocols, scans, duplicates, short reports and adversarial instructions. Measure false approvals, false rejections, abstentions, subgroup performance, reviewer time and cost. Separate tuning examples from the final evaluation set. Record the approved policy/model version. The core release does not wait for this work.

## Acceptance criteria for the first release

- All legacy acceptance/rejection/reward combinations have explicit supported actions.
- Concurrent decisions and replays cannot duplicate rewards or overwrite newer reviews.
- With revision 1 published and revision 2 processing, an administrator can withdraw revision 1 immediately without accepting, rejecting or altering revision 2.
- The decision preview and committed reward match the configured equal-sharing/rounding policy for every confirmed contributor.
- Reviewer feedback reaches the student; private notes remain private.
- Provider interfaces compile and a test provider exercises validation, abstention and failure handling.
- Production configuration exposes automation as unavailable; there is no functioning auto-decision switch until implemented and evaluated.

Dependencies: submissions, document safety, credits, notifications, audit and admin UI.
