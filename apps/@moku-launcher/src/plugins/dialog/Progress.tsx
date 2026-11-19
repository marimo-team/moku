import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type * as Conversation from "./conversation.ts";

/**
 * The agent's reply while its turn runs, shown below the turn's dialog cell.
 *
 * Nothing here is stored. When the turn ends, the reply is written into the
 * dialog cell and renders as its output instead.
 */
export function Progress({ conversation }: { conversation: Conversation.Interface }) {
  const live = useAtomValue(conversation.live);
  const working = useAtomValue(conversation.ask).waiting;
  const cancel = useAtomSet(conversation.cancel);
  const answer = useAtomSet(conversation.answer);
  if (!working && live.permissions.length === 0 && live.error === null) return null;

  return (
    <section className="dialog-progress" aria-label="Agent" aria-busy={working}>
      {working && (
        <div className="dialog-message" aria-live="polite">
          <div className="dialog-message-header">
            <span className="dialog-role">Agent</span>
            <button type="button" onClick={() => cancel()}>
              Stop
            </button>
          </div>
          {live.tools.length > 0 && (
            <ul className="dialog-tools">
              {live.tools.map((tool) => (
                <li key={tool.id} data-status={tool.status}>
                  {tool.title}
                </li>
              ))}
            </ul>
          )}
          {live.reply ? (
            <p className="dialog-reply">{live.reply}</p>
          ) : (
            <p className="dialog-thinking">
              {live.thought ? live.thought.slice(-240) : "Thinking…"}
            </p>
          )}
        </div>
      )}
      {live.permissions.map((permission) => (
        <div key={permission.id} className="dialog-permission" role="alert">
          <span>{permission.title}</span>
          {permission.options.map((option) => (
            <button
              key={option.id}
              className={option.kind.startsWith("allow") ? "primary" : undefined}
              onClick={() => answer({ id: permission.id, optionId: option.id })}
            >
              {option.name}
            </button>
          ))}
        </div>
      ))}
      {live.error !== null && (
        <p className="dialog-error" role="alert">
          {live.error}
        </p>
      )}
    </section>
  );
}
