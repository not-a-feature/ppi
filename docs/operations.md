# Operations

The root [README](../README.md) covers local setup. `compose.yaml` provides development PostgreSQL, Mailpit and an optional worker; it is not a complete production deployment. Production infrastructure and migration are still pending.

The separate [test-server Compose file](../deploy/compose.test.yaml) runs web, worker, PostgreSQL and a private mail viewer under `/opt/ppi`, with application source in `source/`. Supply protected `app.env`, `mail.env` and `db.env` files, a restricted runtime database role, and an HTTPS host proxy that overwrites forwarded headers. SMTP credentials belong only in the worker's `mail.env`. The application listener and mail viewer bind to loopback; the database has no published port. Authenticated SMTP requires TLS. The website uses the normal verified-account login.

Run the `signatures` service before starting the worker, then install the supplied `ppi-signatures` systemd service and timer for daily updates. Certificate renewal must also reload the host proxy. A test deployment does not replace the production checks below or the final migration rehearsal.

## Verification

Use Node.js 24 and the locked dependencies. Database tests create isolated schemas in a disposable PostgreSQL database; never point `TEST_DATABASE_URL` at production.

```sh
npm run check
TEST_DATABASE_URL=postgresql://ppi:ppi_local_only@127.0.0.1:54329/ppi_test npm test
npm run build
```

The normal suite does not require native OCR tools. To exercise OCR inside the worker image after creating the disposable `ppi_test` database:

```sh
docker compose exec -e TEST_DATABASE_URL=postgresql://ppi:ppi_local_only@db:5432/ppi_test -e REAL_OCR_OUTPUT=/tmp/ppi-ocr-proof worker node node_modules/vitest/vitest.mjs run tests/ocr-pipeline.integration.test.ts
```

`REAL_OCR_OUTPUT` enables the native test and selects the output directory. For the synthetic 100-user load benchmark, set `TEST_DATABASE_URL` and `BETTER_AUTH_SECRET`, build the application, then run `node scripts/performance-load.mjs`. Results go to `.data/performance-100.json` by default. These synthetic measurements do not establish production capacity.

## Deployment

Build one release for web and worker, apply migrations once, and run both against matching database and private-file volumes. Use separate migration and restricted runtime database roles. The current development account is a bootstrap owner. Reuse the FSI proxy and SMTP infrastructure after verifying its current private configuration.

Start with [.env.example](../.env.example), [web settings](../deploy/web.env.example) and [nginx configuration](../deploy/nginx.conf). Set a random `BETTER_AUTH_SECRET`, the public HTTPS `ORIGIN`, database/SMTP credentials and private storage paths. Secrets and real protocol data stay outside Git. The private file directory must never be a static web root.

For the supplied single-proxy setup, set `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1`. nginx overwrites forwarding headers with its client's address. Keep the web listener private: loopback behind a host proxy, or a private container network with no published web port. An additional upstream proxy requires an explicitly reviewed trust configuration. Direct local development leaves `ADDRESS_HEADER` empty. SvelteKit and Better Auth retain their origin/CSRF checks.

Production requires ClamAV and current signatures; `FILE_SCAN_MODE=development` is rejected in production. Apply worker CPU, memory and process limits. Verify SMTP delivery, database connectivity and worker heartbeats before switching traffic. `/api/health` is a read-only database readiness check.

## Resource limits

| Setting                      | Default                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| File / request size          | 30 MiB / 32 MiB                                                                     |
| `UPLOADS_PER_HOUR`           | 30 per account                                                                      |
| `UPLOAD_PENDING_LIMIT`       | 10 per account                                                                      |
| `UPLOAD_STORAGE_MIB`         | 256 MiB retained originals and OCR derivatives per account                          |
| Upload parsing               | Four requests per web process, one per account; extra requests receive 429          |
| `PDF_EXTRACT_TIMEOUT_MS`     | 10 seconds, maximum 30; extraction heap 192 MiB                                     |
| OCR                          | One file at a time, two page processes, 15 seconds per page, three minutes per file |
| Development worker container | 1 GiB memory, two CPU cores, 128 processes                                          |

Upload quotas are checked before writing and again under an account lock when committing. Database connections have bounded statement, lock and idle-transaction waits. Administrators can inspect failures, retry jobs and pause queues through the website. A paused queue still permits running work to finish.

Admin settings allow any email address with separate choices for exhausted job failures, content reports, application/worker errors and uploads (including improvements). Alerts use the existing mail queue; worker crash alerts can arrive after restart. Repeated application errors are grouped into 15-minute windows. Abruptly stopped workers are detected after a missed two-minute heartbeat by a running worker. Complete server outages require external monitoring. Alert emails contain links and references, without protocol content or exception details.

Account cleanup defaults to the first of every month at 03:00 Europe/Berlin. It processes at most 100 accounts per transaction and repeats until eligible accounts are handled. Credentials, sessions, profile fields, private notes, queued personal mail and access grants are removed; contributed files, ledger entries and audit references remain. Historical protocol content and free-text audit/financial records are not rewritten. The last active administrator is skipped. The schedule can be disabled or reduced to every three or six months under administration; disabling it survives restarts. Job results show the number removed and protected administrators.

## Backup and release

1. Put the proxy in maintenance mode and prevent new worker jobs and schedules from starting.
2. Drain in-flight requests and jobs, then gracefully stop web and worker. Abort the backup if writers cannot be drained.
3. With all writers stopped, dump PostgreSQL and copy the private files plus a hash manifest as one backup set. Keep a protected off-host copy.
4. Verify the set, restart services, and test an isolated restore with outbound mail disabled. Check balances, access grants, published file references, hashes and durable jobs.

Queue pause alone does not create a consistent backup. Agree recovery targets and ownership, then demonstrate a timed restore before launch. Roll back application images only while schema and job payloads remain compatible; otherwise freeze writes and reconcile first.

Before production, finish the scanner/proxy deployment, restricted database roles, retention/anonymisation policy, restore rehearsal and legacy import. Running-job cancellation and website-editable concurrency are also outstanding. No model-based moderation is enabled.
