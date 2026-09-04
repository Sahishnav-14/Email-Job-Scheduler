import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import session from "express-session";
import { WebClient } from "@slack/web-api";
import { pool } from "./db.js";
import { emailQueue, scheduleEmail } from "./queue.js";
import { ensureEmailIndex, indexEmail, searchEmails } from "./search.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const schemaUrl = new URL("../schema.sql", import.meta.url);
const sessionCookieName = "reachinbox.sid";

type GoogleUser = {
  name: string;
  email: string;
  avatar: string | null;
  googleId: string;
};

declare module "express-session" {
  interface SessionData {
    googleUser?: GoogleUser;
    googleOAuthState?: string;
    slackOAuthState?: string;
  }
}

type CampaignRow = {
  id: string;
  name: string;
  recipient_email?: string | null;
  from_email: string;
  subject: string;
  body: string;
  recipient_count: number;
  scheduled_for?: Date | string | null;
  status: string;
  job_id?: string | null;
  preview_url?: string | null;
  error_message?: string | null;
  sent_at?: Date | string | null;
  created_at: Date | string;
  schedules?: ScheduleRow[] | null;
};

type ScheduleRow = {
  id: string;
  campaign_id: string;
  scheduled_for: Date | string;
  timezone: string;
  status: string;
  job_id?: string | null;
  created_at: Date | string;
  campaign_name?: string;
};

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function requiredString(value: unknown, fieldName: string, maxLength: number) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(
      400,
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }

  return trimmed;
}

function optionalString(
  value: unknown,
  defaultValue: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return requiredString(value, "timezone", maxLength);
}

function parseScheduledFor(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "scheduledFor is required.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "scheduledFor must be a valid date.");
  }
  return date;
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new HttpError(400, "timezone must be a valid IANA timezone.");
  }
  return timezone;
}

function parseRecipientCount(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new HttpError(400, "recipientCount must be a non-negative integer.");
  }
  return count;
}

function toIso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function serializeSchedule(row: ScheduleRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    timezone: row.timezone,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function serializeCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    fromEmail: row.from_email,
    subject: row.subject,
    body: row.body,
    recipientCount: row.recipient_count,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    scheduledFor: toIso(row.scheduled_for),
    previewUrl: row.preview_url ?? null,
    errorMessage: row.error_message ?? null,
    sentAt: toIso(row.sent_at),
    schedules: (row.schedules ?? []).map(serializeSchedule),
  };
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

function getGoogleRedirectUri(request: Request) {
  const configuredRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configuredRedirectUri) return configuredRedirectUri;

  const publicHost = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (publicHost) {
    return `https://${publicHost}/api/auth/google/callback`;
  }

  return `${request.protocol}://${request.get("host")}/api/auth/google/callback`;
}

function getSlackRedirectUri(request: Request) {
  const configuredRedirectUri = process.env.SLACK_REDIRECT_URI?.trim();
  if (configuredRedirectUri) return configuredRedirectUri;

  const publicHost = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (publicHost) {
    return `https://${publicHost}/api/auth/slack/callback`;
  }

  return `${request.protocol}://${request.get("host")}/api/auth/slack/callback`;
}

function sameSecret(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!request.session.googleUser) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

function redirectToLoginWithError(response: Response, message: string) {
  response.redirect(`/?authError=${encodeURIComponent(message)}`);
}

const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullBoardAdapter,
});

app.set("trust proxy", 1);
app.use(
  session({
    name: sessionCookieName,
    secret: process.env.SESSION_SECRET ?? "",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use("/admin/queues", bullBoardAdapter.getRouter());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/auth/google", (request, response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !process.env.SESSION_SECRET) {
    response.status(500).json({ error: "Google OAuth is not configured." });
    return;
  }

  const state = randomBytes(24).toString("hex");
  request.session.googleOAuthState = state;
  const redirectUri = getGoogleRedirectUri(request);
  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();

  request.session.save((error) => {
    if (error) {
      console.error("Unable to save Google OAuth session state");
      response.status(500).json({ error: "Unable to start Google sign-in." });
      return;
    }
    response.redirect(authorizationUrl.toString());
  });
});

app.get("/api/auth/slack", (request, response) => {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();

  if (!clientId || !process.env.SESSION_SECRET) {
    response.status(500).json({ error: "Slack OAuth is not configured." });
    return;
  }

  const state = randomBytes(24).toString("hex");
  request.session.slackOAuthState = state;

  const redirectUri = getSlackRedirectUri(request);

  const authorizationUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "chat:write",
    state,
  }).toString();

  request.session.save((error) => {
    if (error) {
      console.error("Unable to save Slack OAuth session state");
      response.status(500).json({ error: "Unable to start Slack connection." });
      return;
    }

    response.redirect(authorizationUrl.toString());
  });
});

app.get("/api/auth/slack/callback", (request, response) => {
  void (async () => {
    try {
      const clientId = process.env.SLACK_CLIENT_ID?.trim();
      const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
      const { code, state, error: oauthError } = request.query;
      const expectedState = request.session.slackOAuthState;

      delete request.session.slackOAuthState;

      if (oauthError || typeof code !== "string" || typeof state !== "string") {
        redirectToLoginWithError(
          response,
          "Slack connection was cancelled or denied.",
        );
        return;
      }

      if (
        !clientId ||
        !clientSecret ||
        !process.env.SESSION_SECRET ||
        !expectedState ||
        !sameSecret(expectedState, state)
      ) {
        redirectToLoginWithError(
          response,
          "Slack connection could not be verified.",
        );
        return;
      }

      if (!request.session.googleUser) {
        redirectToLoginWithError(
          response,
          "Please sign in with Google before connecting Slack.",
        );
        return;
      }

      const redirectUri = getSlackRedirectUri(request);
      const tokenResponse = await fetch(
        "https://slack.com/api/oauth.v2.access",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        },
      );

      if (!tokenResponse.ok) {
        throw new Error("Slack token exchange failed");
      }

      const tokenData = (await tokenResponse.json()) as {
        ok?: boolean;
        access_token?: string;
        authed_user?: { id?: string };
        team?: { id?: string; name?: string };
        error?: string;
      };

      if (!tokenData.ok || !tokenData.access_token) {
        throw new Error(
          tokenData.error ?? "Slack did not return an access token",
        );
      }

      const googleId = request.session.googleUser.googleId;

      await pool.query(
        `INSERT INTO slack_connections
          (id, google_id, slack_user_id, access_token, team_id, team_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (google_id)
         DO UPDATE SET
           slack_user_id = EXCLUDED.slack_user_id,
           access_token = EXCLUDED.access_token,
           team_id = EXCLUDED.team_id,
           team_name = EXCLUDED.team_name`,
        [
          randomUUID(),
          googleId,
          tokenData.authed_user?.id ?? null,
          tokenData.access_token,
          tokenData.team?.id ?? null,
          tokenData.team?.name ?? null,
        ],
      );

      response.redirect("/");
    } catch (error) {
      console.error("Slack OAuth callback failed", error);
      redirectToLoginWithError(
        response,
        "Slack connection failed. Please try again.",
      );
    }
  })();
});

app.get("/api/auth/google/callback", (request, response) => {
  void (async () => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
      const { code, state, error: oauthError } = request.query;
      const expectedState = request.session.googleOAuthState;
      delete request.session.googleOAuthState;

      if (oauthError || typeof code !== "string" || typeof state !== "string") {
        redirectToLoginWithError(
          response,
          "Google sign-in was cancelled or denied.",
        );
        return;
      }
      if (
        !clientId ||
        !clientSecret ||
        !process.env.SESSION_SECRET ||
        !expectedState ||
        !sameSecret(expectedState, state)
      ) {
        redirectToLoginWithError(
          response,
          "Google sign-in could not be verified.",
        );
        return;
      }

      const redirectUri = getGoogleRedirectUri(request);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) {
        throw new Error("Google token exchange failed");
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenData.access_token) {
        throw new Error("Google did not return an access token");
      }

      const profileResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        },
      );
      if (!profileResponse.ok) {
        throw new Error("Google profile request failed");
      }

      const profile = (await profileResponse.json()) as {
        sub?: string;
        name?: string;
        email?: string;
        picture?: string;
      };
      if (!profile.sub || !profile.email) {
        throw new Error("Google profile is missing basic identity information");
      }

      const googleUser: GoogleUser = {
        googleId: profile.sub,
        name: profile.name?.trim() || profile.email,
        email: profile.email,
        avatar: profile.picture ?? null,
      };

      await new Promise<void>((resolve, reject) => {
        request.session.regenerate((sessionError) => {
          if (sessionError) {
            reject(sessionError);
            return;
          }
          request.session.googleUser = googleUser;
          request.session.save((saveError) => {
            if (saveError) reject(saveError);
            else resolve();
          });
        });
      });

      response.redirect("/");
    } catch {
      console.error("Google OAuth callback failed");
      redirectToLoginWithError(
        response,
        "Google sign-in failed. Please try again.",
      );
    }
  })();
});

app.get(
  "/api/auth/slack/status",
  requireAuth,
  asyncRoute(async (request, response) => {
    const googleId = request.session.googleUser!.googleId;
    const result = await pool.query<{
      team_name: string | null;
    }>("SELECT team_name FROM slack_connections WHERE google_id = $1 LIMIT 1", [
      googleId,
    ]);

    response.json({
      connected: result.rowCount !== 0,
      teamName: result.rows[0]?.team_name ?? null,
    });
  }),
);

app.post(
  "/api/auth/slack/disconnect",
  requireAuth,
  asyncRoute(async (request, response) => {
    const googleId = request.session.googleUser!.googleId;
    await pool.query("DELETE FROM slack_connections WHERE google_id = $1", [
      googleId,
    ]);
    response.status(204).end();
  }),
);

app.get("/api/auth/me", (request, response) => {
  if (!request.session.googleUser) {
    response.status(401).json({ error: "Not authenticated." });
    return;
  }
  response.json({ user: request.session.googleUser });
});

app.post("/api/auth/logout", (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      console.error("Unable to destroy authentication session");
      response.status(500).json({ error: "Unable to log out." });
      return;
    }
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    response.status(204).end();
  });
});

app.get(
  "/api/emails/search",
  requireAuth,
  asyncRoute(async (request, response) => {
    const query = String(request.query.q ?? "").trim();
    if (!query) {
      throw new HttpError(400, "A search query is required.");
    }
    response.json(await searchEmails(query));
  }),
);

app.get(
  "/api/campaigns",
  requireAuth,
  asyncRoute(async (_request, response) => {
    const result = await pool.query<CampaignRow>(`
      SELECT
        c.id,
        c.name,
        c.recipient_email,
        c.from_email,
        c.subject,
        c.body,
        c.recipient_count,
        c.scheduled_for,
        c.status,
        c.job_id,
        c.preview_url,
        c.error_message,
        c.sent_at,
        c.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'campaign_id', s.campaign_id,
              'scheduled_for', s.scheduled_for,
              'timezone', s.timezone,
              'status', s.status,
              'job_id', s.job_id,
              'created_at', s.created_at
            ) ORDER BY s.scheduled_for
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS schedules
      FROM campaigns c
      LEFT JOIN schedules s ON s.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

    response.json({ campaigns: result.rows.map(serializeCampaign) });
  }),
);

app.get(
  "/api/campaigns/:campaignId",
  requireAuth,
  asyncRoute(async (request, response) => {
    const result = await pool.query<CampaignRow>(
      `
        SELECT
          c.id,
          c.name,
          c.recipient_email,
          c.from_email,
          c.subject,
          c.body,
          c.recipient_count,
          c.scheduled_for,
          c.status,
          c.job_id,
          c.preview_url,
          c.error_message,
          c.sent_at,
          c.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', s.id,
                'campaign_id', s.campaign_id,
                'scheduled_for', s.scheduled_for,
                'timezone', s.timezone,
                'status', s.status,
                'job_id', s.job_id,
                'created_at', s.created_at
              ) ORDER BY s.scheduled_for
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'::json
          ) AS schedules
        FROM campaigns c
        LEFT JOIN schedules s ON s.campaign_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [request.params.campaignId],
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, "Campaign not found.");
    }
    response.json({ campaign: serializeCampaign(result.rows[0]) });
  }),
);

app.post(
  "/api/campaigns",
  requireAuth,
  asyncRoute(async (request, response) => {
    const payload = request.body ?? {};
    const isLegacyRequest =
      typeof payload.recipientEmail === "string" &&
      payload.name === undefined &&
      payload.fromEmail === undefined;
    const name = isLegacyRequest
      ? requiredString(payload.recipientEmail, "recipientEmail", 320)
      : requiredString(payload.name, "name", 120);
    const recipientEmail = isLegacyRequest
      ? requiredString(payload.recipientEmail, "recipientEmail", 320)
      : null;
    const fromEmail = isLegacyRequest
      ? "no-reply@reachinbox.test"
      : requiredString(payload.fromEmail, "fromEmail", 320);
    const subject = requiredString(payload.subject, "subject", 200);
    const body = requiredString(payload.body, "body", 100_000);
    const recipientCount = isLegacyRequest
      ? 1
      : parseRecipientCount(payload.recipientCount);
    const scheduledFor =
      payload.scheduledFor === undefined
        ? null
        : parseScheduledFor(payload.scheduledFor);

    if (!isLegacyRequest && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      throw new HttpError(400, "fromEmail must be a valid email address.");
    }
    if (isLegacyRequest && scheduledFor === null) {
      throw new HttpError(400, "scheduledFor is required.");
    }

    const campaignId = randomUUID();
    const result = await pool.query<CampaignRow>(
      `
        INSERT INTO campaigns
          (id, name, recipient_email, from_email, subject, body,
           recipient_count, scheduled_for, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, name, recipient_email, from_email, subject, body,
          recipient_count, scheduled_for, status, job_id, preview_url,
          error_message, sent_at, created_at
      `,
      [
        campaignId,
        name,
        recipientEmail,
        fromEmail,
        subject,
        body,
        recipientCount,
        scheduledFor,
        scheduledFor ? "scheduled" : "draft",
      ],
    );

    const campaign = result.rows[0];
    if (scheduledFor) {
      await saveSchedule(campaign.id, scheduledFor, "UTC");
    }

    if (isLegacyRequest) {
      response.status(201).json({
        ...serializeCampaign(campaign),
        recipientEmail,
        scheduledFor: scheduledFor?.toISOString(),
      });
      return;
    }

    response.status(201).json({ campaign: serializeCampaign(campaign) });
  }),
);

app.get(
  "/api/schedules",
  requireAuth,
  asyncRoute(async (_request, response) => {
    const result = await pool.query<ScheduleRow>(`
      SELECT
        s.id,
        s.campaign_id,
        s.scheduled_for,
        s.timezone,
        s.status,
        s.job_id,
        s.created_at,
        c.name AS campaign_name
      FROM schedules s
      INNER JOIN campaigns c ON c.id = s.campaign_id
      ORDER BY s.scheduled_for ASC
    `);

    response.json({
      schedules: result.rows.map((schedule) => ({
        ...serializeSchedule(schedule),
        campaignName: schedule.campaign_name,
      })),
    });
  }),
);

app.get(
  "/api/campaigns/:campaignId/schedules",
  requireAuth,
  asyncRoute(async (request, response) => {
    const result = await pool.query<ScheduleRow>(
      `
        SELECT id, campaign_id, scheduled_for, timezone, status, job_id, created_at
        FROM schedules
        WHERE campaign_id = $1
        ORDER BY scheduled_for ASC
      `,
      [request.params.campaignId],
    );

    response.json({ schedules: result.rows.map(serializeSchedule) });
  }),
);

async function saveSchedule(
  campaignId: string,
  scheduledFor: Date,
  timezone: string,
) {
  const scheduleId = randomUUID();
  const result = await pool.query<ScheduleRow>(
    `
      INSERT INTO schedules (id, campaign_id, scheduled_for, timezone)
      VALUES ($1, $2, $3, $4)
      RETURNING id, campaign_id, scheduled_for, timezone, status, job_id, created_at
    `,
    [scheduleId, campaignId, scheduledFor, timezone],
  );

  const job = await scheduleEmail(campaignId, scheduledFor);
  await pool.query("UPDATE schedules SET job_id = $1 WHERE id = $2", [
    job.id,
    scheduleId,
  ]);
  await pool.query(
    "UPDATE campaigns SET job_id = $1, status = 'scheduled' WHERE id = $2",
    [job.id, campaignId],
  );

  try {
    await indexEmail({
      id: campaignId,
      recipientEmail: "recipient@example.invalid",
      subject: campaignId,
      status: "scheduled",
      scheduledFor,
    });
  } catch (error) {
    console.error("Failed to index scheduled campaign", error);
  }

  return result.rows[0];
}

app.post(
  "/api/campaigns/:campaignId/schedules",
  requireAuth,
  asyncRoute(async (request, response) => {
    const campaign = await pool.query(
      "SELECT id FROM campaigns WHERE id = $1",
      [request.params.campaignId],
    );
    if (campaign.rowCount === 0) {
      throw new HttpError(404, "Campaign not found.");
    }

    const payload = request.body ?? {};
    const scheduledFor = parseScheduledFor(payload.scheduledFor);
    const timezone = validateTimezone(
      optionalString(payload.timezone, "UTC", 80),
    );
    const schedule = await saveSchedule(
      String(request.params.campaignId),
      scheduledFor,
      timezone,
    );

    response.status(201).json({ schedule: serializeSchedule(schedule) });
  }),
);

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    if (error instanceof HttpError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("Request failed:", error);
    response.status(500).json({ error: "The request could not be completed." });
  },
);

async function initializeDatabase() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error(
      "Database configuration is missing. Set DATABASE_URL or the standard PG* variables.",
    );
  }

  const schema = await readFile(schemaUrl, "utf8");
  await pool.query(schema);
}

async function start() {
  try {
    await initializeDatabase();
    app.listen(port, "0.0.0.0", () => {
      console.log(`Backend server listening on port ${port}`);
    });
    void ensureEmailIndex().catch((error) => {
      console.error(
        "Elasticsearch is unavailable; email search will be unavailable",
        error,
      );
    });
  } catch (error) {
    console.error("Unable to initialize the database:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

void start();
