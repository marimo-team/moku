import { HttpClientError } from "effect/http";

export interface Problem {
  readonly category: "authentication" | "unavailable" | "disconnected" | "error";
  readonly title: string;
  readonly description: string;
  readonly details?: string;
  readonly retryable: boolean;
}

function field(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

/** Translate transport/protocol failures once, before choosing their UI. */
export function describe(error: unknown, resource = "request"): Problem {
  const http = HttpClientError.isHttpClientError(error) ? error : undefined;
  const status = http?.response?.status ?? field(error, "status");
  const code = http?.response?.headers["x-momo-error"] ?? field(error, "code");
  const raw =
    field(error, "detail") ?? field(error, "message") ?? field(error, "error");
  // Never stringify a request/cause: it may contain authentication headers.
  const details = typeof raw === "string" ? raw.slice(0, 4000) : undefined;
  const problem = (
    title: string,
    description: string,
    retryable = false,
    category: Problem["category"] = "error",
  ): Problem => ({ title, description, details, retryable, category });
  if (code === "session-required")
    return problem(
      "Workspace locked",
      "Open the launch link printed in your terminal.",
      false,
      "authentication",
    );
  if (code === "host-unavailable")
    return problem(
      "Host unavailable",
      "This host has stopped or restarted. Choose a current host from Notebooks.",
      false,
      "unavailable",
    );
  if (status === 401)
    return problem(
      "Authentication required",
      "Check the server token and reconnect.",
      false,
      "authentication",
    );
  if (status === 403)
    return problem("Access denied", "This host does not allow this request.");
  if (status === 404)
    return problem(
      resource === "notebook" ? "Notebook unavailable" : "Resource unavailable",
      resource === "notebook"
        ? "This notebook may have moved or been removed. Choose another from Notebooks."
        : "The host could not find the requested resource.",
      false,
      "unavailable",
    );
  if (field(error, "_tag") === "NoRuntimeProblem")
    return problem("Runtime not running", "Run the notebook to start its runtime.");
  if (field(error, "_tag") === "DecisionRequiredProblem")
    return problem(
      "Startup needs a choice",
      "The host needs additional startup configuration. Open this notebook in marimo to choose it.",
    );
  if (status === 412 || status === 409)
    return problem(
      "Notebook changed",
      "The host could not apply this request to its current state. Your local edits are retained.",
    );
  if (
    http?.reason._tag === "TransportError" ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
    return problem(
      "Connection interrupted",
      "The host could not be reached. Check that it is running, then reconnect.",
      true,
      "disconnected",
    );
  if (typeof status === "number" && status >= 500)
    return problem(
      "Host request failed",
      "The host encountered an error while handling the request.",
      true,
    );
  if (field(error, "_tag") === "ConnectionClosed")
    return problem(
      "Disconnected",
      "The host closed the connection. Reconnect to continue.",
      true,
      "disconnected",
    );
  if (field(error, "_tag") === "DocumentSyncError")
    return problem(
      "Edits not synced",
      "Your edits are retained in this tab. Reconnect before leaving the notebook.",
      field(error, "retryable") === true,
    );
  return problem(
    "Request failed",
    "The request could not be completed. See details for more information.",
    false,
  );
}
