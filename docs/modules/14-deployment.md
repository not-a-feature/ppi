# Deployment and recovery

## Responsibility and technology

Docker Compose manages nginx, the SvelteKit Node web service, worker service and PostgreSQL. Web and worker use a versioned application build with different entry commands; native document tools are needed only in the worker image. Existing FSI proxy/certificate and SMTP infrastructure should be reused after verifying the current Gitea configuration.

Use persistent database and private-file volumes, a bounded temporary-work volume, and a managed antivirus signature directory. No container serves the private volume directly through a public static location. Configure worker CPU, memory and process limits according to the host and document sandbox test results.

## Release pipeline

1. Install exact locked dependencies and run type checks, focused unit/integration tests and browser smoke tests.
2. Build images labelled with commit/release IDs; scan dependencies/images through the available CI tooling.
3. Deploy the exact images to staging, run migrations and exercise verification, upload, manual review, shared rewards, access purchase, downloads and job controls.
4. Take/verify the required pre-deployment backup and acquire the release lock.
5. Apply compatible schema migrations once, start the release and wait for readiness.
6. Switch traffic after smoke checks, drain old processes and retain the previous image for rollback.

The migration strategy is tested with the queue schema as well as application tables. Choose package versions and migration order together. No `latest` image tags or in-place source pulls are part of the proposed release process.

## Runtime configuration

Validate configuration at startup: canonical URL, database connection, auth secret, SMTP settings, private/temporary paths, proxy trust, queue limits and release ID. Match nginx request limits to the configured file limit plus multipart overhead. Trust forwarded headers only from the configured proxy.

The production web adapter requires `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1`; see [web environment settings](../../deploy/web.env.example). nginx must overwrite `X-Forwarded-For` with its direct client's address, as the supplied configuration does. Place TLS termination at this ingress and set `ORIGIN` to the public HTTPS origin. If an upstream proxy is added, configure its trusted addresses and real-IP handling in nginx before accepting traffic; do not blindly append or trust arbitrary forwarding chains.

Keep the web listener private: on a host, bind `HOST=127.0.0.1` and have nginx proxy to `127.0.0.1:3000`. With containers, nginx proxies to `web:3000` over a private application network; web has no published `ports` mapping. Only nginx receives public traffic. The adapter cannot authenticate forwarding headers from a directly exposed listener, so publishing the web port invalidates this trust boundary.

Direct local development leaves `ADDRESS_HEADER` empty and uses the socket address. Before either form actions or the Better Auth handler runs, the application replaces the internal authentication IP header with the adapter-resolved address and removes incoming forwarding headers. Both throttles therefore use the same normalized IP, including IPv6 subnet grouping. The public API cannot select a different rate-limit bucket by supplying its own IP header. Better Auth remains responsible for API origin validation; SvelteKit validates form origins.

Health routes distinguish liveness from readiness. Web readiness checks database/schema compatibility. Worker health reports heartbeats and required tools; unavailable SMTP or file tools are visible dependency failures. Probes never grant tokens, send mail, trigger cleanup or create/drop tables.

## Backup and restoration

Back up PostgreSQL and referenced files together during a short maintenance window. Use this simple procedure for the initial single-host deployment:

1. Put the proxy into maintenance mode so new application requests cannot start writes, and stop workers from starting new jobs or scheduled tasks.
2. Allow in-flight web requests and worker jobs to finish, including file creation and deletion. Then gracefully stop the web and worker services. If they cannot drain within the maintenance timeout, abort this backup attempt and report the failure.
3. Confirm that all application writers are stopped. Keep PostgreSQL running and take the database dump, private-file backup and file/hash manifest while the web and workers remain stopped.
4. Verify successful completion of both backups, record them as one backup set, and restart the services. Retain a protected off-host copy of the set.

A normal queue pause is not sufficient: it permits already-running jobs to continue. A future atomic snapshot procedure may replace this maintenance window only after its database/file consistency and restoration have been tested.

Restore into an isolated environment with outbound email and future external moderation disabled. Validate account counts, ledger sums, active access, file hashes, published references and durable jobs before enabling traffic. Record a timed restoration test against the agreed recovery targets.

## Failure and rollback

Restart failed containers through Compose policy. Disk-full or missing storage blocks new uploads and shows actionable diagnostics; never accept a submission whose file cannot be retained. A database outage makes dependent routes unavailable rather than operating on guessed balances.

An application rollback is safe only while schema and job payloads remain compatible. After destructive schema changes or legacy cutover with new writes, freeze writes and execute the documented recovery/reconciliation plan; do not point the old app at the new schema.

## Acceptance criteria

- A clean host can deploy from documented configuration and exact images.
- Website job controls work without container-management privileges.
- Restarting web/worker preserves accounts, files, queues and outcomes.
- An isolated restore meets the agreed recovery objectives and sends no real email.
- A backup started during an upload or file-deletion job waits for that operation to finish; restoring the resulting set leaves no database reference to a missing file.
- The previous image can run against the tested compatible schema/job payloads.

Dependencies: current infrastructure inventory, secrets, backup destination and an identified operator.
