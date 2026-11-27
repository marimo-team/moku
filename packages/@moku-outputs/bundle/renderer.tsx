/**
 * The embedded marimo renderer and its runtime callbacks.
 *
 * @module
 */
import { Provider } from "jotai";
import type { ComponentProps, ReactElement } from "react";

import { OutputRenderer } from "@/components/editor/Output";
import { TooltipProvider } from "@/components/ui/tooltip";
import { userConfigAtom } from "@/core/config/config";
import { UI_ELEMENT_REGISTRY } from "@/core/dom/uiregistry";
import { FUNCTIONS_REGISTRY } from "@/core/functions/FunctionRegistry";
import { RuntimeState } from "@/core/kernel/RuntimeState";
import { initialModeAtom } from "@/core/mode";
import { requestClientAtom } from "@/core/network/requests";
import { store } from "@/core/state/jotai";
import {
  handleWidgetMessage,
  WIDGET_REGISTRY,
} from "@/plugins/impl/anywidget/registry";
import { initializePlugins } from "@/plugins/plugins";
import { useTheme } from "@/theme/useTheme";
import { safeExtractSetUIElementMessageBuffers } from "@/utils/json/base64";

import { normalizeDisplay } from "../src/internal/normalize.ts";
import type * as RendererSession from "../src/internal/RendererSession.ts";
import type { Theme } from "../src/types.ts";

import "@/css/index.css";

initializePlugins();
store.set(initialModeAtom, "edit");
let current: RendererSession.Interface | undefined;
const disconnected = () =>
  Promise.reject(new Error("Output interactions are not connected."));
const requestClient = (methods: Record<string, unknown>) =>
  new Proxy(methods, {
    get: (target, key) =>
      typeof key === "string" ? (target[key] ?? disconnected) : undefined,
  });
store.set(requestClientAtom, requestClient({}));

export function setTheme(theme: Theme): void {
  store.set(userConfigAtom, (config) => ({
    ...config,
    display: { ...config.display, theme },
  }));
}

export function createSession(
  options: RendererSession.Options,
): RendererSession.Interface {
  if (current) throw new Error("A notebook already owns the output renderer.");
  const models = new Set<string>();
  let active = true;
  const requireActive = () => {
    if (!active) throw new Error("The output session has ended.");
  };
  const session: RendererSession.Interface = {
    runtimeId: options.runtimeId,
    assetUrl: options.assetUrl,
    async handle(notification) {
      if (!active) return;
      switch (notification.op) {
        case "kernel-ready":
          for (const [id, value] of Object.entries(notification.ui_values ?? {})) {
            if (!UI_ELEMENT_REGISTRY.has(id)) UI_ELEMENT_REGISTRY.set(id, value);
            UI_ELEMENT_REGISTRY.broadcastMessage(
              id,
              { type: "marimo-ui-value-update", value },
              [],
            );
          }
          break;
        case "send-ui-element-message":
          if (
            !UI_ELEMENT_REGISTRY.has(notification.ui_element) &&
            notification.message.type === "marimo-ui-value-update"
          )
            UI_ELEMENT_REGISTRY.set(
              notification.ui_element,
              notification.message.value,
            );
          UI_ELEMENT_REGISTRY.broadcastMessage(
            notification.ui_element,
            notification.message,
            safeExtractSetUIElementMessageBuffers(notification),
          );
          break;
        case "remove-ui-elements":
          UI_ELEMENT_REGISTRY.removeElementsByCell(notification.cell_id);
          break;
        case "model-lifecycle": {
          models.add(notification.model_id);
          const spec =
            "esm_spec" in notification.message ? notification.message.esm_spec : null;
          const message = spec?.url.startsWith("./@file/")
            ? {
                ...notification,
                message: {
                  ...notification.message,
                  esm_spec: { ...spec, url: options.assetUrl(spec.url) },
                },
              }
            : notification;
          await handleWidgetMessage(WIDGET_REGISTRY, message);
          break;
        }
      }
    },
    dispose() {
      if (!active) return;
      active = false;
      RuntimeState.INSTANCE.stop();
      for (const id of models) WIDGET_REGISTRY.delete(id);
      models.clear();
      UI_ELEMENT_REGISTRY.entries.clear();
      for (const id of FUNCTIONS_REGISTRY.requests.keys())
        FUNCTIONS_REGISTRY.reject(id, new Error("The output session ended."));
      store.set(requestClientAtom, requestClient({}));
      if (current === session) current = undefined;
    },
  };
  const sendComponentValues = async (
    request: Parameters<RendererSession.Options["sendComponentValues"]>[0],
  ) => {
    requireActive();
    await options.sendComponentValues(request);
  };
  store.set(
    requestClientAtom,
    requestClient({
      sendComponentValues,
      sendModelValue: async (
        request: Parameters<RendererSession.Options["sendModelValue"]>[0],
      ) => {
        requireActive();
        await options.sendModelValue(request);
      },
      sendFunctionRequest: async (
        request: Parameters<RendererSession.Options["invoke"]>[0],
      ) => {
        requireActive();
        const value = await options.invoke(request);
        if (!active) return;
        FUNCTIONS_REGISTRY.resolve(request.functionCallId, {
          function_call_id: request.functionCallId,
          return_value: value,
          found: true,
          status: { code: "ok", title: null, message: null },
        });
      },
    }),
  );
  current = session;
  RuntimeState.INSTANCE.start(sendComponentValues);
  return session;
}

export function DisplayRenderer({
  data,
  runtimeId,
  session,
}: RendererSession.DisplayProps): ReactElement {
  const { theme } = useTheme();
  const connected =
    session != null && current === session && runtimeId === session.runtimeId;
  // Historical widgets must not register their IDs in a replacement kernel's session.
  if (!connected && (session != null || /<marimo-/.test(data.data))) {
    return data.mimetype === "text/html" ? (
      <iframe
        title="Read-only output"
        sandbox=""
        srcDoc={data.data}
        style={{ width: "100%", border: 0 }}
      />
    ) : (
      <pre>{data.data}</pre>
    );
  }
  const content =
    connected && data.mimetype === "text/html"
      ? {
          ...data,
          data: data.data.replaceAll("./@file/", session.assetUrl("./@file/")),
        }
      : data;
  const normalized = normalizeDisplay(content);
  const mimetype = normalized.mimetype as ComponentProps<
    typeof OutputRenderer
  >["message"]["mimetype"];
  return (
    <Provider store={store}>
      <TooltipProvider>
        <div key={session?.runtimeId ?? "static"} className={`marimo ${theme}`}>
          <OutputRenderer
            message={{ channel: "output", mimetype, data: normalized.data }}
            renderFallback={() => <pre>{data.data}</pre>}
          />
        </div>
      </TooltipProvider>
    </Provider>
  );
}
