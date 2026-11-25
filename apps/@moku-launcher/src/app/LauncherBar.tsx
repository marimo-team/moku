import type * as React from "react";
import * as ReactRouter from "react-router";

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
