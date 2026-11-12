import { useAtom } from "@effect/atom-react";
import * as Theme from "./theme.ts";

export function ThemeSelect() {
  const [preference, setPreference] = useAtom(Theme.preference);
  return (
    <select
      className="theme-control"
      aria-label="Appearance"
      title="Catppuccin appearance"
      value={preference}
      onChange={(event) => setPreference(event.target.value as Theme.Preference)}
    >
      <option value="system">System</option>
      <option value="light">Latte</option>
      <option value="dark">Mocha</option>
    </select>
  );
}
