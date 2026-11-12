import { Atom, type AtomRegistry } from "effect/reactivity";
import { RequestError, failure } from "./transport.ts";

export type Status = "connecting" | "connected" | "reconnecting" | "closed" | "error";
export interface Observation<A> {
  readonly value: A;
  readonly status: Status;
  readonly error: RequestError | null;
}
interface Events<E> {
  subscribe(onEvent: (event: E) => void, onError: (error: unknown) => void): () => void;
  close(): void;
}

export function observe<A, E>(options: {
  registry: AtomRegistry.AtomRegistry;
  signal: AbortSignal;
  initial: A;
  reduce: (state: A, event: E) => A;
  resume: (state: A) => A;
  open: (
    onStatus: (status: "connecting" | "connected" | "closed") => void,
  ) => Events<E>;
}): Atom.Atom<Observation<A>> {
  return Atom.make((get): Observation<A> => {
    if (get.registry !== options.registry)
      throw new Error("Read this model with the AtomRegistry that created it.");
    let observation: Observation<A> = {
      value: options.initial,
      status: options.signal.aborted ? "closed" : "connecting",
      error: null,
    };
    if (options.signal.aborted) return observation;
    let active = true;
    let connected = false;
    const publish = () => {
      if (active) get.setSelf(observation);
    };
    const events = options.open((status) => {
      if (!active || observation.error) return;
      if (status === "connecting") {
        observation = {
          ...observation,
          value: options.resume(observation.value),
          status: connected ? "reconnecting" : "connecting",
        };
      } else {
        connected ||= status === "connected";
        observation = { ...observation, status };
      }
      publish();
    });
    const fail = (cause: unknown) => {
      observation = { ...observation, status: "error", error: failure(cause) };
      publish();
      events.close();
    };
    const unsubscribe = events.subscribe((event) => {
      if (!active || observation.error) return;
      try {
        observation = {
          ...observation,
          value: options.reduce(observation.value, event),
        };
        publish();
      } catch (error) {
        fail(error);
      }
    }, fail);
    get.addFinalizer(() => {
      active = false;
      unsubscribe();
      events.close();
    });
    return observation;
  }).pipe(Atom.setIdleTTL(0));
}
