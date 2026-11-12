import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import type * as Notifications from "./Notifications.ts";
import { dismissAtom, messagesAtom, actionAtom } from "./useNotifications.ts";

export function NotificationList() {
  const result = useAtomValue(messagesAtom);
  const messages = Option.getOrElse(AsyncResult.value(result), () => []);
  return (
    <section className="notifications" aria-label="Notifications">
      <ol>
        {messages.map((message) => (
          <NotificationItem key={message.id} message={message} />
        ))}
      </ol>
    </section>
  );
}

function NotificationItem({ message }: { message: Notifications.Notification }) {
  const dismiss = useAtomSet(dismissAtom);
  const act = useAtomSet(actionAtom, { mode: "promise" });
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const { id, revision, kind, action } = message;
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (kind === "error" || action || hovered || focused || hidden) return;
    const timer = setTimeout(() => dismiss({ id, revision }), 8_000);
    return () => clearTimeout(timer);
  }, [id, revision, kind, action, hovered, focused, hidden, dismiss]);
  return (
    <li
      className="notification"
      data-kind={kind}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          dismiss({ id, revision });
        }
      }}
    >
      <div role={kind === "error" ? "alert" : "status"}>
        <strong>{message.title}</strong>
        {message.description && <p>{message.description}</p>}
      </div>
      {message.details && (
        <details>
          <summary>Details</summary>
          <pre>{message.details}</pre>
        </details>
      )}
      {action && (
        <button
          className="notification-action"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await act(message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : action.label}
        </button>
      )}
      <button
        className="notification-dismiss"
        aria-label={`Dismiss ${message.title}`}
        onClick={() => dismiss({ id, revision })}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
    </li>
  );
}
