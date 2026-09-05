import * as Sentry from "@sentry/react";
import posthog from "posthog-js";

Sentry.init({
  dsn: "https://84ded2bb97d8494ffa70426df7145fc1@o4512032628670464.ingest.us.sentry.io/4512032670154752",
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
  beforeSend(event) {
    if (event.request?.url) {
      try {
        const url = new URL(event.request.url);
        for (const key of ["session_id", "token", "code"]) {
          if (url.searchParams.has(key)) url.searchParams.set(key, "[Filtered]");
        }
        event.request.url = url.toString();
      } catch {
        event.request.url = event.request.url.split("?")[0];
      }
    }
    if (event.request) {
      delete event.request.query_string;
      delete event.request.cookies;
      delete event.request.data;
    }
    delete event.user;
    return event;
  },
});

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!projectToken) {
  if (process.env.NODE_ENV === "development") {
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
    );
  }
} else if (!host) {
  if (process.env.NODE_ENV === "development") {
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured",
    );
  }
} else {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-01-30",
    capture_exceptions: true,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      blockAllMedia: true,
    },
    debug: process.env.NODE_ENV === "development",
  });
}
