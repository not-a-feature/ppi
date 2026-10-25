# Operations

See the [README](../README.md) for local setup. Root `compose.yaml` is for development. The [test deployment](../deploy/compose.test.yaml) runs web, worker, PostgreSQL and a private mail viewer, using protected `app.env`, `mail.env` and `db.env` files.

## Deployment

Build one release for web and worker, apply migrations once, and give both access to the same database and private files. Use separate migration and restricted runtime database roles. Store secrets and real files outside Git; never expose the private file directory as static content.

Start with [.env.example](../.env.example), [web settings](../deploy/web.env.example) and [nginx configuration](../deploy/nginx.conf). Set the public HTTPS `ORIGIN`, a random `BETTER_AUTH_SECRET`, database credentials and storage paths. Keep SMTP credentials in the worker environment and require TLS for authenticated SMTP.

The proxy must overwrite `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. Set `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1` and `PROTOCOL_HEADER=x-forwarded-proto`; keep the application listener private. SvelteKit 3 derives the request origin from these headers; `ORIGIN` configures Better Auth and email links. Direct local development leaves `ADDRESS_HEADER` empty. Additional proxies require a reviewed trust configuration.

There are no default accounts. Register and verify the first administrator, set `BOOTSTRAP_ADMIN_EMAIL` in the operator's `.env`, then run `npm run db:bootstrap-admin` once. Remove that setting afterwards; further promotions happen through the website.

Production requires ClamAV with current signatures; development scan mode is rejected. Run the `signatures` service before the worker and install the supplied signature-update service/timer. Apply worker CPU, memory and process limits. Reload the proxy after certificate renewal.

## Checks and monitoring

Use the locked dependencies and current Node 24 security release. Monthly update PRs cover npm, the Dockerfile and CI actions. TypeScript stays on compatible 6.x; PostgreSQL stays on supported 17.x until a planned major upgrade.

```sh
export TEST_DATABASE_URL=postgresql://ppi:ppi_local_only@127.0.0.1:54329/ppi_test
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `TEST_DATABASE_URL` to a disposable local database for both test commands. Browser tests isolate their data, capture email and use synthetic safety results. Native OCR tests additionally require `REAL_OCR_OUTPUT` and the worker's OCR tools. The optional `scripts/performance-load.mjs` benchmark uses the same test database plus `BETTER_AUTH_SECRET` and a compiled build; its synthetic results do not establish production capacity.

`/api/health` checks database readiness. Verify mail delivery and worker heartbeats separately. Admin email alerts cover exhausted job failures, reports, application/worker errors and uploads; a mail/worker outage can delay delivery. External monitoring must detect complete outages and low disk space.

Upload/request limits are 30/32 MiB. Configurable quotas and extraction timeouts are in `.env.example`; parsing admits four uploads per process and one per account. OCR and database operations have bounded waits. Queue pause allows running work to finish.

Account cleanup defaults to the first of each month at 03:00 Europe/Berlin, in batches of 100. It removes credentials, personal fields and access grants, retaining protocols, ledger entries and audit references. Historical document and free-text audit/financial content is not rewritten. See [account rules](architecture.md#account-and-submission-rules).

## Backup and launch

1. Enable maintenance mode, stop new jobs/schedules and drain requests and running jobs. Stop web and worker; abort if writers cannot be stopped.
2. With writers stopped, dump PostgreSQL and copy private files with a hash manifest as one backup set. Verify it and keep a protected off-host copy before restarting.
3. Rehearse an isolated restore with mail disabled. Check balances, grants, published files, hashes and durable jobs; record recovery ownership and acceptable data loss/downtime.

Queue pause alone is not a consistent backup. Roll back images only when schema and job payloads remain compatible; otherwise freeze writes and reconcile first.

Before launch, complete the [migration rehearsal](migration.md), verify real registration/reset mail, scanning, OCR and downloads on the release image, configure monitoring/log retention, and confirm the imprint, privacy notice and retention policy with the operator.
