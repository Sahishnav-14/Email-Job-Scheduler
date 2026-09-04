 Backend

- Express.js REST API
- PostgreSQL database
- BullMQ + Redis email scheduling
- Worker concurrency and rate limiting
- Restart recovery and duplicate protection
- Ethereal SMTP email delivery
- Elasticsearch email search
- Bull Board queue dashboard
- Google OAuth login
- Slack integration

Frontend

- React + TypeScript + Vite
- Google login
- Email scheduling dashboard
- CSV/text recipient upload
- Scheduled and Sent Emails tables
- Slack connect/disconnect
- Ethereal email preview links
- Loading, error and success states
  
When emails are scheduled:

1.The recipient list is parsed in the browser.

2.Scheduled email records are stored in PostgreSQL.

3.A BullMQ delayed job is created for each email.

4.BullMQ keeps the job in Redis until its scheduled time.

5.The worker processes the job when it becomes available.

6.Redis-based delay and hourly rate limits are checked.

7.If allowed, the email is sent through Ethereal SMTP.

8.PostgreSQL is updated with the final status and preview URL.

9.The email is indexed in Elasticsearch.

Persistence and restart handling

Scheduled emails are stored in PostgreSQL and queued using BullMQ/Redis. On restart, pending emails are checked and re-queued if necessary.

Elasticsearch search

Emails are indexed in the emails Elasticsearch index and can be searched by recipient or subject.
