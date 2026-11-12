import { Atom } from "effect/reactivity";
import * as Notifications from "./Notifications.ts";

export const runtime = Atom.runtime(Notifications.layer);
