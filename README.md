# ReachInbox Email Scheduler

A full-stack email scheduling application built with React, TypeScript, Express.js, PostgreSQL, Redis, BullMQ, Elasticsearch, and Ethereal Email.

## Features

### Backend

- Express.js REST API
- PostgreSQL persistence for scheduled and sent emails
- BullMQ delayed jobs backed by Redis
- Configurable worker concurrency
- Configurable minimum delay between email sends
- Configurable hourly email rate limit
- Atomic Redis-based rate-limit reservation for safe multi-worker processing
- Jobs delayed to the next UTC hour when the hourly limit is reached
- Restart recovery for scheduled emails
- Duplicate-send protection through persisted job/status handling
- Ethereal SMTP email delivery with preview URLs
- Elasticsearch indexing and recipient/subject search
- Bull Board queue dashboard
- Google OAuth authentication
- Slack OAuth integration and rate-limit notifications

### Frontend

- React + TypeScript + Vite
- Google login
- User information in the dashboard
- Connect/Disconnect Slack
- Compose new email campaign
- CSV/text recipient upload
- Recipient count display
- Configurable start time and delay
- Scheduled Emails table
- Sent Emails table
- Email status and Ethereal preview links
- Loading, empty, error and success states

## Architecture

```text
React Frontend
      |
      v
Express API
      |
      +---- PostgreSQL
      |
      +---- BullMQ ---- Redis
      |                  |
      |                  v
      |             Email Worker
      |                  |
      |                  +---- Ethereal SMTP
      |                  +---- Elasticsearch
      |                  +---- Slack notification
      |
      +---- Google OAuth
      |
      +---- Slack OAuth
      |
      +---- Slack OAuth

## How scheduling works

When emails are scheduled:

1. The recipient list is parsed in the browser.
2. Scheduled email records are stored in PostgreSQL.
3. A BullMQ delayed job is created for each email.
4. BullMQ keeps the job in Redis until its scheduled time.
5. The worker processes the job when it becomes available.
6. Redis-based delay and hourly rate limits are checked.
7. If allowed, the email is sent through Ethereal SMTP.
8. PostgreSQL is updated with the final status and preview URL.
9. The email is indexed in Elasticsearch.

No operating-system cron job or Node.js cron library is used.

## Persistence and restart handling

Scheduled jobs are stored through BullMQ/Redis and their application state is stored in PostgreSQL.

When the backend/worker starts, it checks PostgreSQL for scheduled emails that do not have an active queued job and re-enqueues them.

This allows scheduled emails to survive API server or worker restarts.

Completed sends are persisted with their final status to prevent the same email from being sent again during recovery.

## Rate limiting and concurrency

| Variable | Default | Purpose |
| --- | ---: | --- |
| `WORKER_CONCURRENCY` | `2` | Number of jobs processed concurrently |
| `MIN_EMAIL_DELAY_MS` | `1000` | Minimum delay between email send reservations |
| `HOURLY_EMAIL_LIMIT` | `100` | Maximum email sends allowed per UTC hour |

Redis stores the hourly counter and last-send timestamp.

A single atomic Redis Lua script reserves send capacity, allowing multiple workers to share the same limits safely.

When the hourly limit is reached, the job is delayed until the next UTC hour instead of being failed. If Slack is connected, a notification is posted to the configured Slack channel.

## Elasticsearch search

Emails are indexed in an Elasticsearch index named `emails`.

Search by recipient or subject:

```text
GET /api/emails/search?q=welcome
http://localhost:3001/admin/queues
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET
/api/auth/google/callback
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_CHANNEL_ID
ETHEREAL_HOST
ETHEREAL_PORT
ETHEREAL_USER
ETHEREAL_PASS
DATABASE_URL
REDIS_URL
ELASTICSEARCH_URL

ETHEREAL_HOST
ETHEREAL_PORT
ETHEREAL_USER
ETHEREAL_PASS

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET

SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_CHANNEL_ID

WORKER_CONCURRENCY
MIN_EMAIL_DELAY_MS
HOURLY_EMAIL_LIMIT
npm install
backend/schema.sql
redis://127.0.0.1:6379
http://127.0.0.1:9200
npm run dev:backend
npm run worker --workspace backend
npm run dev:frontend
GET  /api/health
GET  /api/campaigns
POST /api/campaigns
GET  /api/emails/search?q=<text>
GET  /api/auth/me
GET  /api/auth/google
GET  /api/auth/slack
GET  /api/auth/slack/status
POST /api/auth/slack/disconnect

**After that final ` ``` `**, type this on a completely separate new line:

```text
