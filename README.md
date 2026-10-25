# PPI 3

PPI lets students share exam protocols and use tokens for lecture access. Built with SvelteKit, TypeScript, PostgreSQL and Better Auth, with browser review, OCR and personalised downloads.

## Run locally

Requires Node.js 24.22.1 or a newer 24.x release, and Docker.

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:migrate
docker compose --profile worker up -d --build worker
npm run dev
```

Set a random `BETTER_AUTH_SECRET` in `.env` before starting. Open http://localhost:5173; local mail is at http://localhost:8029.

There are no default accounts. Register and verify your zx account, set its full address as `BOOTSTRAP_ADMIN_EMAIL` in `.env`, then run `npm run db:bootstrap-admin`. Assign further administrators through the website.

Run `npm run check`, `npm test` and `npm run build`. Database and browser tests need a disposable local database in `TEST_DATABASE_URL`; see [operations](docs/operations.md).

Work in progress: final migration and production rollout are pending. See [architecture](docs/architecture.md), [operations](docs/operations.md) and [migration](docs/migration.md).

Licensed under [EUPL 1.2](LICENSE). Legacy asset attribution is in [NOTICE](NOTICE).
