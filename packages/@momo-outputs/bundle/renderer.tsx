/**
 * The embedded marimo renderer, bundled against an upstream frontend checkout.
 *
 * React is supplied by the consuming application. Host interactions require
 * a session connection and currently reject requests.
 *
 * @module
 */
import { Provider } from "jotai";
import type { ComponentProps, ReactElement } from "react";
import { OutputRenderer } from "@/components/editor/Output";
import { TooltipProvider } from "@/components/ui/tooltip";
import { store } from "@/core/state/jotai";
import { useTheme } from "@/theme/useTheme";
import { userConfigAtom } from "@/core/config/config";
import { initialModeAtom } from "@/core/mode";
import { requestClientAtom } from "@/core/network/requests";
import { initializePlugins } from "@/plugins/plugins";
import type { DisplayViewProps, Theme } from "../src/types.ts";
import { normalizeDisplay } from "../src/internal/normalize.ts";
import "@/css/index.css";

initializePlugins();
store.set(initialModeAtom, "edit");

// Interactive output requests require a notebook session, added separately.
const disconnected = () =>
  Promise.reject(new Error("Output interactions are not connected."));
store.set(requestClientAtom, new Proxy({}, { get: () => disconnected }));

export function setTheme(theme: Theme): void {
  store.set(userConfigAtom, (config) => ({
    ...config,
    display: { ...config.display, theme },
  }));
}

export function DisplayRenderer({ data }: DisplayViewProps): ReactElement {
  const { theme } = useTheme();
  const normalized = normalizeDisplay(data);
  // The host protocol permits additional MIME types; marimo provides a fallback.
  const mimetype = normalized.mimetype as ComponentProps<
    typeof OutputRenderer
  >["message"]["mimetype"];

  return (
    <Provider store={store}>
      <TooltipProvider>
        <div className={`marimo ${theme}`}>
          <OutputRenderer
            message={{ channel: "output", mimetype, data: normalized.data }}
            renderFallback={() => <pre>{data.data}</pre>}
          />
        </div>
      </TooltipProvider>
    </Provider>
  );
}
