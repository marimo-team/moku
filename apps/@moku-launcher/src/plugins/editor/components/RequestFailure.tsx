import type { ReactNode } from "react";
import * as Problems from "../lib/problems.ts";

export function RequestFailure({
  error,
  resource,
  retry,
  children,
}: {
  error: unknown;
  resource?: string;
  retry?: () => void;
  children?: ReactNode;
}) {
  const problem = Problems.describe(error, resource);
  return (
    <div className="request-failure" role="alert">
      <strong>{problem.title}</strong>
      <p>{problem.description}</p>
      <div className="request-failure-actions">
        {retry && problem.retryable && <button onClick={retry}>Try again</button>}
        {children}
      </div>
      {problem.details && (
        <details>
          <summary>Details</summary>
          <pre>{problem.details}</pre>
        </details>
      )}
    </div>
  );
}
