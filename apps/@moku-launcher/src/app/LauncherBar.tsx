import type * as React from "react";
import * as ReactRouter from "react-router";
import type { RegisteredView } from "./Host.ts";

export const HOST_VIEW = "host";
const preferenceKey = "moku:open-with";

export function preferredView() {
  try {
    return localStorage.getItem(preferenceKey) ?? HOST_VIEW;
  } catch {
    return HOST_VIEW;
  }
}

export function rememberView(view: string) {
  try {
    localStorage.setItem(preferenceKey, view);
  } catch {
    // Opening notebooks also works when browser storage is unavailable.
  }
}

export function LauncherBar({
  children,
  actions,
}: {
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="view-header">
      <nav className="view-breadcrumbs" aria-label="Breadcrumb">
        <ReactRouter.Link className="moku-link" to="/">
          moku
        </ReactRouter.Link>
        {children}
      </nav>
      <div className="launcher-actions">{actions}</div>
    </header>
  );
}

export function ViewPicker({
  value,
  views,
  onChange,
  includeHost = true,
}: {
  value: string;
  views: readonly RegisteredView[];
  onChange: (value: string) => void;
  includeHost?: boolean;
}) {
  return (
    <label className="open-with-picker">
      <span>Open with</span>
      <select
        className="view-picker"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {includeHost && <option value={HOST_VIEW}>Host</option>}
        {value !== HOST_VIEW && !views.some((view) => view.key === value) && (
          <option value={value} disabled>
            Unavailable view
          </option>
        )}
        {views.map((view) => (
          <option key={view.key} value={view.key}>
            {view.title}
          </option>
        ))}
      </select>
    </label>
  );
}
