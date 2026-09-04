import { ChangeEvent, FormEvent, useEffect, useState } from "react";

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

type Schedule = {
  scheduledFor: string;
  status: string;
};

type Campaign = {
  id: string;
  name: string;
  recipientEmail?: string | null;
  subject: string;
  body: string;
  status: CampaignStatus;
  scheduledFor?: string | null;
  sentAt?: string | null;
  previewUrl?: string | null;
  errorMessage?: string | null;
  schedules: Schedule[];
};

type ComposeForm = {
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: string;
  hourlyLimit: string;
};

type Tab = "scheduled" | "sent";
type AuthStatus = "loading" | "authenticated" | "logged-out" | "error";

type AuthUser = {
  name: string;
  email: string;
  avatar: string | null;
};

const emptyComposeForm: ComposeForm = {
  subject: "",
  body: "",
  startTime: "",
  delaySeconds: "1",
  hourlyLimit: "100",
};

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function formatDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function statusClasses(status: CampaignStatus) {
  if (status === "sent") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (status === "sending") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-blue-50 text-blue-700 ring-blue-200";
}

function LoginPage({ error }: { error: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-600">
          ReachInbox
        </p>

        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          ReachInbox Email Scheduler
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-500">
          Sign in with Google to schedule and track your email campaigns.
        </p>

        {error && (
          <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-left text-sm text-rose-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => window.location.assign("/api/auth/google")}
          className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
            <path
              fill="#4285F4"
              d="M21.35 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z"
            />

            <path
              fill="#34A853"
              d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.55 0-4.7-1.72-5.47-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.6Z"
            />

            <path
              fill="#FBBC05"
              d="M6.53 13.68A5.86 5.86 0 0 1 6.22 12c0-.58.1-1.15.31-1.68V7.79H3.29A9.6 9.6 0 0 0 2.25 12c0 1.52.36 2.96 1.04 4.21l3.24-2.53Z"
            />

            <path
              fill="#EA4335"
              d="M12 6.29c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.38 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.71 5.39l3.24 2.53C7.3 8.01 9.45 6.29 12 6.29Z"
            />
          </svg>
          Continue with Google
        </button>

        <p className="mt-5 text-xs text-slate-400">
          We only request your basic Google profile and email identity.
        </p>
      </section>
    </main>
  );
}

async function readError(response: Response) {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  return data?.error ?? "The request could not be completed.";
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const [authError, setAuthError] = useState(
    () => new URLSearchParams(window.location.search).get("authError") ?? "",
  );

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("scheduled");

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState(emptyComposeForm);

  const [detectedEmails, setDetectedEmails] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  const [loadError, setLoadError] = useState("");
  const [composeError, setComposeError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Slack state
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackTeamName, setSlackTeamName] = useState("");
  const [isSlackLoading, setIsSlackLoading] = useState(true);

  async function loadCampaigns() {
    try {
      const response = await fetch("/api/campaigns");

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as {
        campaigns: Campaign[];
      };

      setCampaigns(data.campaigns);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load campaigns. Is the backend running?",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSlackStatus() {
    try {
      const response = await fetch("/api/auth/slack/status");

      if (!response.ok) {
        setSlackConnected(false);
        setSlackTeamName("");
        return;
      }

      const data = (await response.json()) as {
        connected?: boolean;
        teamName?: string | null;
      };

      setSlackConnected(Boolean(data.connected));
      setSlackTeamName(data.teamName ?? "");
    } catch {
      setSlackConnected(false);
      setSlackTeamName("");
    } finally {
      setIsSlackLoading(false);
    }
  }

  function connectSlack() {
    window.location.assign("/api/auth/slack");
  }

  async function disconnectSlack() {
    setAuthError("");

    try {
      const response = await fetch("/api/auth/slack/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        setAuthError("Unable to disconnect Slack. Please try again.");
        return;
      }

      setSlackConnected(false);
      setSlackTeamName("");
      setSuccessMessage("Slack disconnected successfully.");
    } catch {
      setAuthError("Unable to disconnect Slack. Please try again.");
    }
  }

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/me");

        if (response.status === 401) {
          setAuthStatus("logged-out");
          return;
        }

        if (!response.ok) {
          throw new Error("Unable to check authentication.");
        }

        const data = (await response.json()) as {
          user: AuthUser;
        };

        setUser(data.user);
        setAuthStatus("authenticated");

        if (window.location.search) {
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }
      } catch {
        setAuthError("Unable to check your session. Please try again.");
        setAuthStatus("error");
      }
    }

    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    void loadCampaigns();
    void loadSlackStatus();

    const refresh = window.setInterval(() => {
      void loadCampaigns();
      void loadSlackStatus();
    }, 5000);

    return () => window.clearInterval(refresh);
  }, [authStatus]);

  async function logout() {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });

    if (!response.ok) {
      setAuthError("Unable to log out. Please try again.");
      return;
    }

    setUser(null);
    setCampaigns([]);
    setSlackConnected(false);
    setSlackTeamName("");
    setAuthStatus("logged-out");
  }

  function updateComposeForm(field: keyof ComposeForm, value: string) {
    setComposeForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function readEmailFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setIsReadingFile(true);
    setComposeError("");
    setFileName(file.name);

    try {
      const matches = (await file.text()).match(emailPattern) ?? [];

      const uniqueEmails = [
        ...new Set(matches.map((email) => email.toLowerCase())),
      ];

      setDetectedEmails(uniqueEmails);

      if (uniqueEmails.length === 0) {
        setComposeError("No email addresses were found in that file.");
      }
    } catch {
      setDetectedEmails([]);
      setComposeError("Could not read that file.");
    } finally {
      setIsReadingFile(false);
    }
  }

  function resetCompose() {
    setComposeForm(emptyComposeForm);
    setDetectedEmails([]);
    setFileName("");
    setComposeError("");
  }

  async function scheduleCampaigns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setComposeError("");
    setSuccessMessage("");

    if (detectedEmails.length === 0) {
      setComposeError(
        "Choose a CSV or text file with at least one email address.",
      );
      return;
    }

    const startDate = new Date(composeForm.startTime);
    const delaySeconds = Number(composeForm.delaySeconds);

    if (Number.isNaN(startDate.getTime())) {
      setComposeError("Choose a valid start time.");
      return;
    }

    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
      setComposeError("Delay must be zero or more seconds.");
      return;
    }

    setIsSubmitting(true);

    try {
      for (const [index, recipientEmail] of detectedEmails.entries()) {
        const scheduledFor = new Date(
          startDate.getTime() + index * delaySeconds * 1000,
        ).toISOString();

        const response = await fetch("/api/campaigns", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipientEmail,
            subject: composeForm.subject,
            body: composeForm.body,
            scheduledFor,
          }),
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }
      }

      await loadCampaigns();

      setActiveTab("scheduled");
      setIsComposeOpen(false);
      resetCompose();

      setSuccessMessage(
        `${detectedEmails.length} email${
          detectedEmails.length === 1 ? "" : "s"
        } scheduled successfully.`,
      );
    } catch (error) {
      setComposeError(
        error instanceof Error
          ? error.message
          : "Could not schedule campaigns.",
      );

      await loadCampaigns();
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleCampaigns = campaigns
    .filter((campaign) =>
      activeTab === "scheduled"
        ? campaign.status === "scheduled" ||
          campaign.status === "sending" ||
          campaign.status === "draft"
        : campaign.status === "sent" || campaign.status === "failed",
    )
    .sort((first, second) => {
      const firstDate =
        activeTab === "scheduled"
          ? (first.scheduledFor ?? first.schedules[0]?.scheduledFor)
          : first.sentAt;

      const secondDate =
        activeTab === "scheduled"
          ? (second.scheduledFor ?? second.schedules[0]?.scheduledFor)
          : second.sentAt;

      return (
        new Date(secondDate ?? 0).getTime() - new Date(firstDate ?? 0).getTime()
      );
    });

  if (authStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] text-sm text-slate-500">
        Checking your session…
      </main>
    );
  }

  if (authStatus !== "authenticated" || !user) {
    return <LoginPage error={authError} />;
  }

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-900">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
        <header className="flex flex-col gap-6 border-b border-slate-200 pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-600">
              ReachInbox
            </p>

            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              ReachInbox Email Scheduler
            </h1>

            <p className="mt-2 max-w-xl text-sm text-slate-500 sm:text-base">
              Schedule outreach to multiple recipients and watch delivery status
              from one dashboard.
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-4 sm:items-end">
            <div className="flex items-center gap-3">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={`${user.name}'s avatar`}
                  className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                />
              ) : (
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700"
                  aria-hidden="true"
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 text-left sm:text-right">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {user.name}
                </p>

                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>

              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                Logout
              </button>
            </div>

            {/* Slack connection */}
            <div className="flex items-center justify-end gap-3">
              {slackConnected && slackTeamName && (
                <span className="text-xs text-emerald-600">
                  Connected to {slackTeamName}
                </span>
              )}

              {isSlackLoading ? (
                <span className="text-xs text-slate-400">Checking Slack…</span>
              ) : slackConnected ? (
                <button
                  type="button"
                  onClick={() => void disconnectSlack()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  Disconnect Slack
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connectSlack}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Connect Slack
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setComposeError("");
                setSuccessMessage("");
                setIsComposeOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <span className="text-lg leading-none">+</span>
              Compose New Email
            </button>
          </div>
        </header>

        {authError && (
          <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {authError}
          </p>
        )}

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-6" role="tablist" aria-label="Email views">
              {(["scheduled", "sent"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`border-b-2 pb-3 text-sm font-semibold transition ${
                    activeTab === tab
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab === "scheduled" ? "Scheduled Emails" : "Sent Emails"}
                </button>
              ))}
            </div>

            <p className="text-sm text-slate-500">
              {visibleCampaigns.length}{" "}
              {visibleCampaigns.length === 1 ? "email" : "emails"}
            </p>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {isLoading ? (
              <div className="px-5 py-14 text-center text-sm text-slate-500">
                Loading campaigns…
              </div>
            ) : loadError ? (
              <div className="px-5 py-14 text-center text-sm text-rose-600">
                {loadError}
              </div>
            ) : visibleCampaigns.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">
                  {activeTab === "scheduled" ? "◷" : "✓"}
                </div>

                <h2 className="mt-4 text-base font-semibold text-slate-800">
                  {activeTab === "scheduled"
                    ? "No scheduled emails yet"
                    : "No sent emails yet"}
                </h2>

                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                  {activeTab === "scheduled"
                    ? "Compose an email and upload a recipient list to get started."
                    : "Completed and failed campaigns will appear here."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Email</th>

                      <th className="px-5 py-4 font-semibold">Subject</th>

                      <th className="px-5 py-4 font-semibold">
                        {activeTab === "scheduled"
                          ? "Scheduled time"
                          : "Sent time"}
                      </th>

                      <th className="px-5 py-4 font-semibold">Status</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {visibleCampaigns.map((campaign) => {
                      const email = campaign.recipientEmail ?? campaign.name;

                      return (
                        <tr key={campaign.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-800">
                            {email}
                          </td>

                          <td className="max-w-xs truncate px-5 py-4 text-slate-600">
                            {campaign.subject}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                            {formatDate(
                              activeTab === "scheduled"
                                ? (campaign.scheduledFor ??
                                    campaign.schedules[0]?.scheduledFor)
                                : campaign.sentAt,
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${statusClasses(
                                campaign.status,
                              )}`}
                            >
                              {campaign.status}
                            </span>

                            {campaign.errorMessage && (
                              <p className="mt-1 max-w-xs text-xs text-rose-600">
                                {campaign.errorMessage}
                              </p>
                            )}

                            {campaign.previewUrl && (
                              <a
                                href={campaign.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block text-xs font-medium text-blue-600 hover:underline"
                              >
                                Ethereal preview
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {successMessage && (
          <p className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {successMessage}
          </p>
        )}

        {isComposeOpen && (
          <div
            className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-title"
          >
            <form
              onSubmit={scheduleCampaigns}
              className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
                    New campaign
                  </p>

                  <h2 id="compose-title" className="mt-1 text-2xl font-bold">
                    Compose New Email
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Upload a recipient list and schedule one message for
                    everyone.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!isSubmitting) {
                      setIsComposeOpen(false);
                      setComposeError("");
                    }
                  }}
                  className="rounded-md px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close compose form"
                >
                  ×
                </button>
              </div>

              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Subject
                  <input
                    required
                    value={composeForm.subject}
                    onChange={(event) =>
                      updateComposeForm("subject", event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Body
                  <textarea
                    required
                    rows={5}
                    value={composeForm.body}
                    onChange={(event) =>
                      updateComposeForm("body", event.target.value)
                    }
                    className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Recipient CSV or text file
                  <input
                    required
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={readEmailFile}
                    className="mt-2 block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-2 file:font-medium file:text-blue-700 hover:file:bg-blue-200"
                  />
                  <span className="mt-2 block text-xs font-normal text-slate-500">
                    {isReadingFile
                      ? "Reading file…"
                      : fileName
                        ? `${detectedEmails.length} email${
                            detectedEmails.length === 1 ? "" : "s"
                          } detected in ${fileName}`
                        : "The file is read in your browser and is not uploaded."}
                  </span>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Start time
                  <input
                    required
                    type="datetime-local"
                    value={composeForm.startTime}
                    onChange={(event) =>
                      updateComposeForm("startTime", event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Delay between emails (seconds)
                  <input
                    required
                    min="0"
                    step="1"
                    type="number"
                    value={composeForm.delaySeconds}
                    onChange={(event) =>
                      updateComposeForm("delaySeconds", event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Hourly email limit
                  <input
                    required
                    min="1"
                    step="1"
                    type="number"
                    value={composeForm.hourlyLimit}
                    onChange={(event) =>
                      updateComposeForm("hourlyLimit", event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <span className="mt-2 block text-xs font-normal text-slate-500">
                    The existing backend configuration controls delivery limits.
                  </span>
                </label>
              </div>

              {composeError && (
                <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {composeError}
                </p>
              )}

              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!isSubmitting) {
                      setIsComposeOpen(false);
                    }
                  }}
                  disabled={isSubmitting}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting || isReadingFile}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Scheduling…" : "Schedule emails"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
