# PPI 3

A new PPI for sharing exam protocols, built with SvelteKit, TypeScript, PostgreSQL and Better Auth.

Students upload PDF/TXT files and use tokens for lecture access. Administrators review submissions, manage the catalogue and control background jobs. Scan-only pages receive OCR; downloads include the student's zx ID and date.

## Run locally

Requires Node.js 24 and Docker.

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run db:seed-playground
docker compose --profile worker up -d --build worker
npm run dev
```

Set a random `BETTER_AUTH_SECRET` in `.env` first. Open http://localhost:5173; local email is available at http://localhost:8029. Seeded accounts use `Ppi2-demo-only-2026!`: admin `zxabc01`, student `zxabc02`.

Run `npm run check`, `npm test` and `npm run build`. Database tests require a disposable PostgreSQL database in `TEST_DATABASE_URL`.

This is a work in progress. Production setup and the legacy import are still pending. See [implementation status](docs/implementation-status.md) and [deployment notes](docs/modules/14-deployment.md).

Licensed under [EUPL 1.2](LICENSE). Legacy asset attribution is in [NOTICE](NOTICE).
