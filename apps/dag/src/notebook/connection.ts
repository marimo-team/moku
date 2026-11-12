import { useEffect, useMemo, useReducer, useState } from "react";
import { Client } from "@marimo-team/client";
import type * as Protocol from "@marimo-team/client/protocol";
import { emptyNotebook, reduceNotebook } from "./model.ts";

export function useCatalog(hostId: string) {
  const client = useMemo(
    () =>
      hostId ? new Client(new URL(`/api/hosts/${hostId}`, location.origin)) : null,
    [hostId],
  );
  const [notebooks, setNotebooks] = useState<Record<string, Protocol.NotebookOutput>>(
    {},
  );
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setNotebooks({});
    setError("");
    setReady(false);
    if (!client) return;
    const events = client.events({ types: ["notebook"] });
    events.subscribe(
      (event) => {
        if (event.event === "reset") {
          setNotebooks({});
          setReady(false);
        }
        if (event.event === "ready") setReady(true);
        if (event.event === "notebook")
          setNotebooks((current) => ({
            ...current,
            [event.data.notebook.id]: event.data.notebook,
          }));
        if (event.event === "notebook.removed")
          setNotebooks((current) => {
            const next = { ...current };
            delete next[event.data.id];
            return next;
          });
      },
      (error) => setError(String(error)),
    );
    return () => events.close();
  }, [client]);
  return { client, notebooks: Object.values(notebooks), error, ready };
}

export function useNotebook(client: Client | null, id: string) {
  const notebook = useMemo(
    () => (client && id ? client.notebook(id) : null),
    [client, id],
  );
  const [state, dispatch] = useReducer(reduceNotebook, undefined, emptyNotebook);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  useEffect(() => {
    dispatch({ event: "reset", data: {} });
    setError("");
    setStatus("connecting");
    if (!notebook) return;
    const events = notebook.events({
      types: [
        "notebook",
        "document",
        "cell",
        "analysis",
        "runtime",
        "run",
        "execution",
        "console",
        "display",
        "variable",
        "input",
      ],
      onStatus: setStatus,
    });
    events.subscribe(dispatch, (error) => setError(String(error)));
    return () => events.close();
  }, [notebook]);
  return { notebook, state, status, error };
}
