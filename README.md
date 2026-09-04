**Backend**

* Express.js REST API
* PostgreSQL database
* BullMQ + Redis email scheduling
* Worker concurrency and rate limiting
* Restart recovery and duplicate protection
* Ethereal SMTP email delivery
* Elasticsearch email search
* Bull Board queue dashboard
* Google OAuth login
* Slack integration

**Frontend**

* React + TypeScript + Vite
* Google login
* Email scheduling dashboard
* CSV/text recipient upload
* Scheduled and Sent Emails tables
* Slack connect/disconnect
* Ethereal email preview links
* Loading, error and success states

**When emails are scheduled**

1. The recipient list is parsed in the browser.
2. Scheduled email records are stored in PostgreSQL.
3. A BullMQ delayed job is created for each email.
4. BullMQ keeps the job in Redis until its scheduled time.
5. The worker processes the job when it becomes available.
6. Redis-based delay and hourly rate limits are checked.
7. If allowed, the email is sent through Ethereal SMTP.
8. PostgreSQL is updated with the final status and preview URL.
9. The email is indexed in Elasticsearch.

**Persistence and restart handling**

Scheduled emails are stored in PostgreSQL and queued using BullMQ/Redis. On restart, pending emails are checked and re-queued if necessary.

**Elasticsearch search**

Emails are indexed in the `emails` Elasticsearch index and can be searched by recipient or subject.

**Ethereal Email**

Ethereal is used for test email delivery. Configure the Ethereal SMTP credentials in `.env`. Sent emails provide an Ethereal preview URL.

**Backend Run**

1. Install dependencies: npm install
2. Start PostgreSQL and Redis.
3. Start backend: npm run dev:backend
4. Start BullMQ worker: npm run worker --workspace backend

**Frontend Run**

1. Start frontend: npm run dev:frontend
2. Open the frontend in the browser.

**Environment Variables**

Configure these in .env using .env.example:

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
```

**Rate Limiting**

Redis tracks the hourly email count and send timing. When the hourly limit is reached, the BullMQ job is delayed until the next UTC hour.

**Concurrency**

WORKER_CONCURRENCY controls how many email jobs the worker processes simultaneously.
