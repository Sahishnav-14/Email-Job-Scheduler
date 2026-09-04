import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { WebClient } from "@slack/web-api";
import { DelayedError, Worker, type Job } from "bullmq";
import { pool } from "./db.js";
import {
  emailQueue,
  EMAIL_QUEUE_NAME,
  getEmailSendDelay,
  scheduleEmail,
  redis,
} from "./queue.js";
import { updateEmail } from "./search.js";

type Campaign = {
  id: string;
  recipient_email: string | null;
  subject: string;
  body: string;
  scheduled_for: Date | null;
  status: "scheduled" | "sending" | "sent" | "failed";
};

let transporter: Promise<Transporter> | undefined;

const configuredConcurrency = Number.parseInt(
  process.env.WORKER_CONCURRENCY ?? "",
  10,
);

const workerConcurrency =
  Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : 2;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTestAccount().then((account) =>
      nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: account.user,
          pass: account.pass,
        },
      }),
    );
  }

  return transporter;
}

async function notifySlackRateLimit(waitMs: number) {
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!channelId) {
    console.log(
      "Slack notification skipped: SLACK_CHANNEL_ID is not configured",
    );
    return;
  }

  try {
    // Send only one notification per UTC hour.
    // This prevents multiple delayed emails from creating many Slack messages.
    const hourKey = new Date().toISOString().slice(0, 13);
    const notificationKey = `slack-rate-limit-notified:${hourKey}`;

    const shouldNotify = await redis.set(
      notificationKey,
      "1",
      "EX",
      3700,
      "NX",
    );

    if (shouldNotify !== "OK") {
      return;
    }

    const result = await pool.query<{
      access_token: string;
      team_name: string | null;
    }>(
      `SELECT access_token, team_name
       FROM slack_connections
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    const connection = result.rows[0];

    if (!connection) {
      console.log("Slack notification skipped: no Slack connection found");
      return;
    }

    const slack = new WebClient(connection.access_token);

    const nextHour = new Date(Date.now() + waitMs);

    await slack.chat.postMessage({
      channel: channelId,
      text:
        `⚠️ ReachInbox email rate limit reached.\n` +
        `Emails are temporarily delayed and will continue after the limit resets.\n` +
        `Next retry: ${nextHour.toISOString()}` +
        (connection.team_name ? `\nWorkspace: ${connection.team_name}` : ""),
    });

    console.log("Slack rate-limit notification sent");
  } catch (error) {
    // Slack must never stop email scheduling/delivery.
    console.error("Failed to send Slack rate-limit notification", error);
  }
}

async function sendCampaign(job: Job<{ campaignId: string }>) {
  const waitMs = await getEmailSendDelay();

  if (waitMs > 0) {
    await notifySlackRateLimit(waitMs);

    if (!job.token) {
      throw new Error("BullMQ job token is missing");
    }

    await job.moveToDelayed(Date.now() + waitMs, job.token);

    console.log(`Job ${job.id} delayed for ${waitMs}ms by email limits`);

    throw new DelayedError();
  }

  const result = await pool.query<Campaign>(
    `SELECT id, recipient_email, subject, body, scheduled_for, status
     FROM campaigns
     WHERE id = $1`,
    [job.data.campaignId],
  );

  const campaign = result.rows[0];

  if (
    !campaign ||
    campaign.status !== "scheduled" ||
    !campaign.recipient_email
  ) {
    return;
  }

  await pool.query(
    "UPDATE campaigns SET status = 'sending', error_message = NULL WHERE id = $1",
    [campaign.id],
  );

  try {
    const mailer = await getTransporter();

    const info = await mailer.sendMail({
      from: "ReachInbox <no-reply@reachinbox.test>",
      to: campaign.recipient_email,
      subject: campaign.subject,
      text: campaign.body,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) ?? null;

    await pool.query(
      `UPDATE campaigns
       SET status = 'sent', sent_at = NOW(), preview_url = $1
       WHERE id = $2`,
      [previewUrl, campaign.id],
    );

    try {
      await updateEmail(campaign.id, {
        status: "sent",
        sentAt: new Date(),
      });
    } catch (error) {
      console.error(
        `Failed to update search record for campaign ${campaign.id}`,
        error,
      );
    }

    console.log(
      `Campaign ${campaign.id} sent${previewUrl ? `: ${previewUrl}` : ""}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await pool.query(
      `UPDATE campaigns
       SET status = 'failed', error_message = $1
       WHERE id = $2`,
      [message, campaign.id],
    );

    try {
      await updateEmail(campaign.id, {
        status: "failed",
      });
    } catch (searchError) {
      console.error(
        `Failed to update search record for campaign ${campaign.id}`,
        searchError,
      );
    }

    throw error;
  }
}

async function recoverScheduledCampaigns() {
  const result = await pool.query<{
    id: string;
    scheduled_for: Date;
  }>(
    `SELECT id, scheduled_for
     FROM campaigns
     WHERE status = 'scheduled' AND job_id IS NULL`,
  );

  for (const campaign of result.rows) {
    const job = await scheduleEmail(campaign.id, campaign.scheduled_for);

    await pool.query("UPDATE campaigns SET job_id = $1 WHERE id = $2", [
      job.id,
      campaign.id,
    ]);

    console.log(`Recovered campaign ${campaign.id}`);
  }
}

const worker = new Worker(EMAIL_QUEUE_NAME, sendCampaign, {
  connection: redis,
  concurrency: workerConcurrency,
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id ?? "unknown"} failed`, error.message);
});

await recoverScheduledCampaigns();

console.log(`Email worker is running with concurrency ${workerConcurrency}`);

async function shutdown() {
  await worker.close();
  await emailQueue.close();
  await redis.quit();
  await pool.end();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
