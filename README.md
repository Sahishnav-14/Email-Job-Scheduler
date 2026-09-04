# ReachInbox Email Scheduler

A beginner-friendly TypeScript monorepo with a React/Vite frontend and an Express backend.

## Project structure

```text
frontend/   React + TypeScript + Vite + Tailwind CSS
backend/    Node.js + TypeScript + Express
```

PostgreSQL is used to persist campaigns and their scheduled delivery metadata. Redis/BullMQ
and Nodemailer power the queued delivery workflow and are included for future delivery features.

## Database configuration

The backend expects a PostgreSQL connection through `DATABASE_URL` (or the standard
`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` variables). Copy
`.env.example` to a local, untracked environment file and provide your own connection
details there. Never commit a password or connection string.

The backend applies `backend/schema.sql` when it starts. It creates the `campaigns` and
`schedules` tables and the indexes needed to retrieve queued schedules efficiently.

Campaign API routes:

```text
GET  /api/campaigns
POST /api/campaigns
GET  /api/campaigns/:campaignId
GET  /api/campaigns/:campaignId/schedules
POST /api/campaigns/:campaignId/schedules
GET  /api/schedules
```

## Development

Install dependencies from the repository root:

```bash
npm install
```

Run the frontend:

```bash
npm run dev:frontend
```

Run the backend in a separate terminal:

```bash
npm run dev:backend
```

Run the worker in another terminal:

```bash
npm run worker --workspace backend
```

For local development, Redis runs with AOF persistence on port `6379`, and Elasticsearch runs as a single local node on port `9200`. The frontend runs on port `5000`, and the backend runs on port `3001`.

### Worker settings

The worker has small, configurable throughput controls:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `WORKER_CONCURRENCY` | `2` | Number of emails one worker can process at once |
| `MIN_EMAIL_DELAY_MS` | `1000` | Minimum time between email send reservations |
| `HOURLY_EMAIL_LIMIT` | `100` | Maximum send reservations in each UTC hour |

The hourly counter and last-send timestamp are stored in Redis and reserved with one atomic Lua script, so multiple workers share the same limits safely. If the hourly limit is reached, BullMQ moves the job to the next UTC hour instead of failing it. See `.env.example` for the available variables.

## API

Health check:

```text
GET http://localhost:3001/api/health
```

Response:

```json
{ "status": "ok" }
```

Campaigns:

```text
GET  http://localhost:3001/api/campaigns
POST http://localhost:3001/api/campaigns
```

The development PostgreSQL database uses `backend/schema.sql`. Its connection is provided
through the `DATABASE_URL` environment variable.

When a campaign is sent, the saved campaign includes an Ethereal preview link instead of sending a real email. Delayed jobs are stored in Redis, so they remain available after the backend or worker restarts.

## Search and queue dashboard

Emails are indexed in one Elasticsearch index named `emails`. Search by recipient or subject:

```text
GET http://localhost:3001/api/emails/search?q=welcome
```

Bull Board shows the live BullMQ queue at:

```text
http://localhost:3001/admin/queues
```

The worker uses `WORKER_CONCURRENCY=2`, `MIN_EMAIL_DELAY_MS=1000`, and `HOURLY_EMAIL_LIMIT=100` by default. Search indexing errors are logged without stopping email scheduling or sending.
