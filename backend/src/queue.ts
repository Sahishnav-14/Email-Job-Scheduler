import { Redis } from "ioredis";
import { Queue } from "bullmq";

export const EMAIL_QUEUE_NAME = "email-sending";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null
});

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redis
});

function readInteger(name: string, fallback: number, minimum: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

const MIN_EMAIL_DELAY_MS = readInteger("MIN_EMAIL_DELAY_MS", 1000, 0);
const HOURLY_EMAIL_LIMIT = readInteger("HOURLY_EMAIL_LIMIT", 100, 1);

const reserveEmailSlotScript = `
  local count = tonumber(redis.call("GET", KEYS[1]) or "0")
  local limit = tonumber(ARGV[1])
  local now = tonumber(ARGV[2])
  local lastSend = tonumber(redis.call("GET", KEYS[2]) or "0")

  if count >= limit then
    return { 0, 3600000 - (now % 3600000) }
  end

  local wait = tonumber(ARGV[3]) - (now - lastSend)
  if wait > 0 then
    return { 0, wait }
  end

  redis.call("INCR", KEYS[1])
  redis.call("EXPIRE", KEYS[1], 7200)
  redis.call("SET", KEYS[2], now, "EX", 7200)
  return { 1, 0 }
`;

export async function getEmailSendDelay() {
  const now = Date.now();
  const hourKey = `reachinbox:email:hour:${new Date(now)
    .toISOString()
    .slice(0, 13)
    .replace("T", ":")}`;
  const result = (await redis.eval(
    reserveEmailSlotScript,
    2,
    hourKey,
    "reachinbox:email:last-send",
    HOURLY_EMAIL_LIMIT,
    now,
    MIN_EMAIL_DELAY_MS
  )) as [number, number];

  return result[0] === 1 ? 0 : result[1];
}

export function scheduleEmail(campaignId: string, scheduledFor: Date) {
  const delay = Math.max(0, scheduledFor.getTime() - Date.now());

  return emailQueue.add(
    "send-email",
    { campaignId },
    {
      jobId: `campaign-${campaignId}`,
      delay,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false
    }
  );
}