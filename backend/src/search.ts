import { Client } from "@elastic/elasticsearch";

export const EMAILS_INDEX = "emails";
const elasticsearchUrl =
  process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:9200";

export const elasticsearch = new Client({
  node: elasticsearchUrl
});

let indexReady: Promise<void> | undefined;

export function ensureEmailIndex() {
  if (!indexReady) {
    indexReady = createEmailIndex().catch((error) => {
      indexReady = undefined;
      throw error;
    });
  }

  return indexReady;
}

async function createEmailIndex() {
  const exists = await elasticsearch.indices.exists({ index: EMAILS_INDEX });
  if (exists) {
    return;
  }

  await elasticsearch.indices.create({
    index: EMAILS_INDEX,
    mappings: {
      properties: {
        recipient: {
          type: "text",
          fields: { keyword: { type: "keyword" } }
        },
        subject: { type: "text" },
        status: { type: "keyword" },
        scheduledAt: { type: "date" },
        sentAt: { type: "date" }
      }
    }
  });
}

export async function indexEmail(email: {
  id: string;
  recipientEmail: string;
  subject: string;
  status: string;
  scheduledFor: string | Date;
  sentAt?: string | Date | null;
}) {
  await ensureEmailIndex();
  await elasticsearch.index({
    index: EMAILS_INDEX,
    id: String(email.id),
    document: {
      recipient: email.recipientEmail,
      subject: email.subject,
      status: email.status,
      scheduledAt: email.scheduledFor,
      sentAt: email.sentAt ?? null
    },
    refresh: "wait_for"
  });
}

export async function updateEmail(
  id: string,
  fields: { status: string; sentAt?: string | Date | null }
) {
  await ensureEmailIndex();
  await elasticsearch.update({
    index: EMAILS_INDEX,
    id: String(id),
    doc: {
      status: fields.status,
      ...(fields.sentAt !== undefined ? { sentAt: fields.sentAt } : {})
    },
    refresh: "wait_for"
  });
}

export async function searchEmails(query: string) {
  await ensureEmailIndex();
  const result = await elasticsearch.search({
    index: EMAILS_INDEX,
    query: {
      multi_match: {
        query,
        fields: ["recipient", "subject"]
      }
    },
    sort: [{ scheduledAt: "desc" }]
  });

  return result.hits.hits.map((hit) => ({
    id: hit._id,
    ...(hit._source ?? {})
  }));
}