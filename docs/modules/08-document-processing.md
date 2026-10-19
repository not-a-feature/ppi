# Document processing

## Scope and technology

TypeScript workers orchestrate native file tools in bounded subprocesses. Technical upload checks, PDF/TXT text extraction, duplicate/similarity signals and selective PDF OCR are implemented. Semantic analysis and model processing remain deferred.

Poppler inspects PDFs; ClamAV scans uploads; PDF.js extracts text; OCRmyPDF 17.13.0 and Tesseract add a searchable layer; pdf-lib applies download watermarks. The container supplies German and English OCR languages.

## OCR and download delivery

PDF text extraction runs in a disposable Node process with a 192 MiB JavaScript heap limit, bounded image decoding and a ten-second deadline (`PDF_EXTRACT_TIMEOUT_MS`, at most 30 seconds). Parser failures cannot terminate the worker's other queues. The development worker container also caps memory at 1 GiB, CPU at two cores and processes at 128. Production must apply equivalent resource limits.

Uploads and improvements share per-account limits: 30 files per hour, ten files awaiting processing, and 256 MiB retained originals plus OCR derivatives. Configure `UPLOADS_PER_HOUR`, `UPLOAD_PENDING_LIMIT` and `UPLOAD_STORAGE_MIB` as positive integers. Checks run before disk writes and again under an account lock before committing the revision, so concurrent requests cannot exceed the accepted quota. Failed concurrent attempts have their unreferenced temporary file removed.

Before multipart parsing, each web process admits at most four upload/improvement requests and one per authenticated account; additional requests receive HTTP 429 with a two-second retry hint, and slots are released on completion, redirects or errors.

After a clean safety result, content analysis selects only image pages with **no extractable words**. Any existing text or OCR layer skips that page, even when short. Blank pages without images also skip OCR. Mixed documents process only selected scan pages. Already searchable PDFs never queue OCR. OCRmyPDF additionally uses `--skip-text`; existing OCR is never redone.

The separate `pdf_ocr` queue processes one file at a time with two OCR page processes and one OpenMP thread per process. It uses PDF output, no optimisation or PDF/A conversion, a 15-second Tesseract timeout per page, a 20-megapixel page limit and a three-minute subprocess deadline. Upload requests do not wait for OCR. Administrators manage this queue through the existing job controls.

Original bytes remain immutable. A private derivative is keyed by file ID and safety generation. Publication checks the current generation, safety and deletion state again; failures retain the original and show a failed OCR status. Content checks rerun after a derivative becomes available. Deleting a protocol removes both originals and OCR derivatives while retaining review metadata.

Individual downloads, student previews and ZIP members carry `PPI - zxID - DD.MM.YYYY`, using the Europe/Berlin date. Administrator review previews remain unmarked. PDF watermarks preserve searchable text and page geometry; TXT files receive the same label as a header. Watermarked PDF bytes have a bounded 32 MiB process cache separated by file source, student and date. Every download still checks permissions. Archives expire after one hour or at the next Berlin midnight, whichever comes first.

The local synthetic benchmark measured 2.34 seconds for a one-page scan, 3.11 seconds for three pages and 2.37 seconds for a mixed two-page PDF. Watermark generation took 6–30 ms. One hundred concurrent cached delivery calls completed in 16–27 ms; these are delivery-function timings, not HTTP throughput or a production capacity guarantee. Already searchable PDFs queued no OCR. Handwriting quality and sustained scanner/OCR load still need representative testing.

Synthetic scan fixtures are in `tests/fixtures/ocr`. After building the worker and creating the disposable `ppi_test` database, run the native OCR test inside the container:

```sh
docker compose exec -e TEST_DATABASE_URL=postgresql://ppi:ppi_local_only@db:5432/ppi_test -e REAL_OCR_OUTPUT=/tmp/ppi-ocr-proof worker node node_modules/vitest/vitest.mjs run tests/ocr-pipeline.integration.test.ts
```

The test creates and removes an isolated database schema. `REAL_OCR_OUTPUT` enables the native-engine test and selects a writable directory for benchmark JSON and two proof PDFs. It is skipped in the ordinary test run, which does not require Tesseract.

## First-release pipeline

1. Resolve the immutable revision and file reference; verify the stored hash and byte count.
2. Validate actual media type against PDF/TXT and configured limits.
3. Scan for malware using current signatures. Scanner unavailable or stale signatures produce a processing failure/hold, not a clean verdict.
4. Check PDF parseability, encryption/password requirements and page count, or TXT encoding and nonempty content. Apply configurable resource limits before rendering.
5. Produce the minimum safe preview needed by the reviewer, if preview generation is enabled. Failure to generate a preview may route to review with download only when safety checks have otherwise passed.
6. Record structured check results and update the checked file's safety verdict independently of submission review state. Only transition the current revision to awaiting_review or changes_requested when its analysis generation still matches. Suspicious/malicious files are quarantined and held for staff attention, including when the checked file belongs to an older revision that is still published.

An exact hash match is a staff-visible duplicate candidate. It does not automatically reject or grant/withhold credits.

## Execution and artifacts

Each run records revision/hash, tool versions, signature version, settings, stage timings and check outcomes. Store derivative artifacts privately with deterministic identifiers based on input hash and tool configuration. Publish artifacts through an atomic rename only after completion. A cancelled or superseded run cannot update current submission state.

File-safety checks use a generation counter on the stored file, separate from the submission's current revision. A result can change the file verdict only if it belongs to that file's latest requested safety check. This allows a rescan of published revision 1 to block its downloads while revision 2 is pending, and prevents an older clean result from clearing a newer block. Failed/cancelled checks cannot establish a clean verdict. Downloads, previews and archives check the stored-file verdict. A clean rescan never reverses an administrator's withdrawal or publishes a replacement automatically.

Launch defaults proposed for validation: at most 50 PDF pages, one document job per worker, a two-minute overall technical-check deadline and a separate bounded temporary directory per run. Confirm these with real examples before release. Set memory, CPU and child-process limits; excessive resource use is a visible technical failure.

Subprocess arguments are constructed without a shell from server-owned paths. Run as an unprivileged user with only the required input and temporary/output paths. The implementation must prove the selected sandbox/network restrictions on the target Linux host before accepting untrusted PDF processing. OCR runs in the worker; the web process parses safety-checked PDFs when creating download watermarks.

## Future extraction contract

A future moderation adapter can consume page-indexed text, method (native/OCR), language, quality signals, warnings and artifact IDs. Unreadable output is a review signal, not evidence that a protocol lacks content. OCR remains restricted to pages without existing text; low-quality existing OCR is not automatically replaced.

## Acceptance criteria

- Malformed, encrypted, oversized and hostile test files produce bounded, visible outcomes.
- A failed scanner never yields a clean safety status.
- A killed subprocess leaves no usable partial preview and is recoverable on retry.
- Retries cannot attach results to a replacement revision.
- A failed safety rescan of an older published file blocks its downloads even when a newer revision is pending; a late clean result from an older check cannot clear that block.
- Test fixtures cover German characters, plain text, ordinary PDFs and scan-only PDFs.
- No model request is required. An OCR failure leaves the original available for manual review.

Dependencies: submissions/private storage, jobs, moderation result schema and operational alerts.
