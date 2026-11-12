import { Atom } from "effect/reactivity";

export type Preference = "system" | "light" | "dark";
type Appearance = Exclude<Preference, "system">;
const storageKey = "moku:notebook:theme";

function readPreference(): Preference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Appearance still works when browser storage is unavailable.
  }
  return "system";
}

const selectedPreference = Atom.make(readPreference()).pipe(Atom.keepAlive);
export const preference = Atom.writable(
  (get) => get(selectedPreference),
  (ctx, value: Preference) => {
    ctx.set(selectedPreference, value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Retain the selection for this session.
    }
  },
);

const system = Atom.make((get): Appearance => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const update = () => get.setSelf(media.matches ? "dark" : "light");
  media.addEventListener("change", update);
  get.addFinalizer(() => media.removeEventListener("change", update));
  return media.matches ? "dark" : "light";
});

export const appearance = Atom.make((get) => {
  const selected = get(preference);
  return selected === "system" ? get(system) : selected;
});
