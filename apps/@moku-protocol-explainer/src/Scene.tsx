/** One spatial model for request, connection, objects, and transient events. @module */
import * as React from "react";
import * as Connection from "./connection.ts";

/** Details are opt-in; the scene itself only shows identity and relationships. */
export interface Inspection {
  readonly title: string;
  readonly content: string;
}

// Three primary 224px regions and a secondary 144px storage reference, on an 8px baseline.
const regionWidth = 224;
const regionCenter = (region: number) =>
  16 + region * (regionWidth + 16) + regionWidth / 2;
const clientX = regionCenter(0);
const streamX = regionCenter(1);
const hostX = regionCenter(2);
const wireY = 28;
const left = clientX + regionWidth / 2;
const right = hostX - regionWidth / 2;

function recordHeight(record: Connection.RecordEvent, expanded = false) {
  if (record.event !== "cell") return 48;
  return 64 + (expanded ? 16 * (Object.keys(record.data.cell.config).length + 1) : 0);
}

function notebookHeight(
  records: readonly Connection.RecordEvent[],
  isExpanded: (record: Connection.RecordEvent) => boolean,
) {
  if (!records.some((record) => record.event === "notebook")) return 0;
  const children = records.filter((record) => record.event !== "notebook");
  return (
    48 +
    (children.length ? 8 : 0) +
    children.reduce(
      (sum, record) => sum + recordHeight(record, isExpanded(record)) + 8,
      0,
    )
  );
}

function identity(record: Connection.RecordEvent) {
  return record.event === "notebook"
    ? record.data.notebook.id
    : record.event === "cell"
      ? record.data.cell.id
      : record.data.document.notebook_id;
}

function inspectRecord(record: Connection.RecordEvent, side: string): Inspection {
  return {
    title: `${side} · ${Connection.recordKey(record)}`,
    content: JSON.stringify(record.data, null, 2),
  };
}

function activate(action: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: action,
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    },
  };
}

function RecordCard({
  record,
  x,
  top,
  width = regionWidth - 32,
  expanded = false,
  height = recordHeight(record, expanded),
  onInspect,
  onToggleConfig,
  side,
  highlight = 0,
}: {
  record: Connection.RecordEvent;
  x: number;
  top: number;
  width?: number;
  expanded?: boolean;
  height?: number;
  onInspect: (inspection: Inspection) => void;
  onToggleConfig?: () => void;
  side: string;
  highlight?: number;
}) {
  return (
    <g
      className={`record-card ${record.event}`}
      transform={`translate(${x - width / 2} ${top})`}
      data-record={Connection.recordKey(record)}
      data-owner={side}
    >
      <g
        {...activate(() => onInspect(inspectRecord(record, side)))}
        aria-label={`Inspect ${side} ${Connection.recordKey(record)}`}
      >
        <rect className="record-face" width={width} height={height} rx="3" />
        <rect
          className="record-highlight"
          width={width}
          height={height}
          rx="3"
          opacity={highlight}
        />
        <rect className="record-accent" x="0" y="8" width="3" height="16" rx="1.5" />
        <text className="record-kind" x="16" y="16">
          {record.event}
        </text>
        <text className="record-id mono" textAnchor="end" x={width - 16} y="16">
          {identity(record)}
        </text>
        <line className="record-rule" x1="1" x2={width - 1} y1="24" y2="24" />
        {record.event === "document" && (
          <text className="record-body mono" x="16" y="40">
            <tspan className="field-label">order: </tspan>[
            {record.data.document.order.join(", ")}]
          </text>
        )}
        {record.event === "notebook" && (
          <text className="record-body mono" x="16" y="40">
            <tspan className="field-label">name: </tspan>
            {record.data.notebook.name}
          </text>
        )}
        {record.event === "cell" && (
          <text className="record-body mono" x="16" y="40">
            <tspan className="field-label">code: </tspan>
            {record.data.cell.code}
          </text>
        )}
      </g>
      {record.event === "cell" && (
        <>
          <g
            {...activate(() => onToggleConfig?.())}
            className="config-toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${side} cell:${record.data.cell.id} config`}
            aria-expanded={expanded}
          >
            <rect x="4" y="44" width={width - 8} height="20" rx="2" />
            <path d={expanded ? "m7 51 3 4 3-4" : "m8 49 4 4-4 4"} />
            <text className="config-text mono" x="16" y="56">
              <tspan className="field-label">config: </tspan>
              {expanded ? "{" : `{disabled:${record.data.cell.config.disabled},…}`}
            </text>
          </g>
          {expanded && (
            <g className="config-fields">
              {Object.entries(record.data.cell.config).map(([name, value], index) => (
                <text
                  className="config-text mono"
                  x="32"
                  y={72 + index * 16}
                  key={name}
                >
                  <tspan className="field-label">{name}: </tspan>
                  {JSON.stringify(value)}
                </text>
              ))}
              <text
                className="config-text mono"
                x="16"
                y={72 + Object.keys(record.data.cell.config).length * 16}
              >
                {"}"}
              </text>
            </g>
          )}
        </>
      )}
    </g>
  );
}

function NotebookGroup({
  records,
  x,
  side,
  highlighted,
  highlight = 1,
  loadHighlight = false,
  expandedKeys,
  onToggleConfig,
  onInspect,
}: {
  records: readonly Connection.RecordEvent[];
  x: number;
  side: "host" | "client";
  highlighted: string | null;
  highlight?: number;
  loadHighlight?: boolean;
  expandedKeys: ReadonlySet<string>;
  onToggleConfig: (key: string) => void;
  onInspect: (inspection: Inspection) => void;
}) {
  const notebook = records.find((record) => record.event === "notebook");
  if (!notebook) return null;
  const children = records
    .filter((record) => record.event !== "notebook")
    .toSorted((a, b) => Number(a.event === "cell") - Number(b.event === "cell"));
  const keyFor = (record: Connection.RecordEvent) =>
    `${side}:${Connection.recordKey(record)}`;
  const isExpanded = (record: Connection.RecordEvent) =>
    expandedKeys.has(keyFor(record));
  const height = notebookHeight(records, isExpanded);
  let top = 120;
  return (
    <g
      className={`notebook-group ${loadHighlight ? "load-target" : ""}`}
      data-notebook-owner={side}
    >
      <RecordCard
        record={notebook}
        x={x}
        top={64}
        width={regionWidth}
        height={height}
        side={side}
        highlight={highlighted === Connection.recordKey(notebook) ? highlight : 0}
        onInspect={onInspect}
      />
      {children.map((record) => {
        const rowTop = top;
        top += recordHeight(record, isExpanded(record)) + 8;
        return (
          <RecordCard
            key={Connection.recordKey(record)}
            record={record}
            x={x}
            top={rowTop}
            expanded={isExpanded(record)}
            onToggleConfig={() => onToggleConfig(keyFor(record))}
            side={side}
            highlight={highlighted === Connection.recordKey(record) ? highlight : 0}
            onInspect={onInspect}
          />
        );
      })}
    </g>
  );
}

/** Render only objects that exist at this position, with a persistent open stream. */
export function Scene({
  position,
  onInspect,
}: {
  position: number;
  onInspect: (inspection: Inspection) => void;
}) {
  const [expandedKeys, setExpandedKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleConfig = (key: string) =>
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const scene = Connection.sceneAt(position);
  const sceneHeight = Math.max(
    328,
    72 +
      notebookHeight(scene.hostRecords, (record) =>
        expandedKeys.has(`host:${Connection.recordKey(record)}`),
      ),
    72 +
      notebookHeight(scene.received, (record) =>
        expandedKeys.has(`client:${Connection.recordKey(record)}`),
      ),
  );
  const transit = Connection.transitAt(position);
  const loading = transit?.kind === "load" ? transit.progress : null;
  const loadActive =
    loading !== null || (scene.step.created !== undefined && transit === null);
  const opening = transit?.kind === "open" ? transit.progress : 0;
  const open = scene.connectionOpen;
  const sending =
    transit?.kind === "event" && transit.message.event !== "ready"
      ? Connection.recordKey(transit.message)
      : null;
  const delivered = scene.step.message;
  const arriving =
    delivered && delivered.event !== "ready" ? Connection.recordKey(delivered) : null;
  // Derive emphasis from timeline time so pausing and reverse scrubbing are exact.
  const arrivalHighlight = Math.max(0, 1 - (position - scene.index) / 0.35);
  let envelope: { x: number; y: number; label: string; inspection: Inspection } | null =
    null;

  if (transit?.kind === "request") {
    envelope = {
      x: left + (right - left) * transit.progress,
      y: wireY,
      label: "GET /events →",
      inspection: {
        title: "Client request",
        content: JSON.stringify(Connection.request, null, 2),
      },
    };
  } else if (transit?.kind === "open") {
    envelope = {
      x: right - (right - left) * transit.progress,
      y: wireY,
      label: "← 200 OK",
      inspection: {
        title: "Streaming response",
        content:
          "HTTP/1.1 200 OK\nContent-Type: text/event-stream\n\nThe response body stays open for server-sent events.",
      },
    };
  } else if (transit?.kind === "event") {
    envelope = {
      x: right - (right - left) * transit.progress,
      y: wireY,
      label:
        transit.message.event === "ready"
          ? "event: ready"
          : `${transit.message.event} · ${identity(transit.message)}`,
      inspection: {
        title: "In flight · SSE frame",
        content: Connection.frame(transit.message),
      },
    };
  }

  return (
    <svg
      className="scene"
      viewBox={`0 0 896 ${sceneHeight}`}
      aria-label="The host owns notebook objects in memory and streams copies to the client. A small storage reference shows the saved Python source used by this host."
    >
      <g transform="translate(736 64)">
        <g
          {...activate(() =>
            onInspect({ title: "Storage · hello.py", content: Connection.source }),
          )}
          aria-label="Inspect stored source hello.py"
          className={`storage-reference ${loadActive ? "loading" : ""}`}
          data-load-state={
            loading !== null ? "reading" : scene.hostLoaded ? "read" : "unread"
          }
        >
          <rect width="144" height="48" rx="2" />
          <text className="storage-label" x="12" y="16">
            Storage
          </text>
          <text className="file-name mono" x="12" y="34">
            hello.py
          </text>
          {(loading !== null || scene.hostLoaded) && (
            <text className="storage-read-status" x="132" y="34" textAnchor="end">
              {loading !== null ? "reading…" : "read"}
            </text>
          )}
        </g>
        <text className="storage-note" x="0" y="68">
          Host chooses what to persist
        </text>
        <text className="storage-note mono" x="0" y="84">
          on notebook.save
        </text>
      </g>
      {loadActive && (
        <g
          className="storage-load"
          role="img"
          aria-label="Load from storage into host objects"
          data-testid="storage-load"
        >
          <text x="728" y="44" textAnchor="middle">
            load
          </text>
          <path className="load-path" d="M704 64V52H752V64" />
        </g>
      )}
      <text className="actor" x={clientX} y="24" textAnchor="middle">
        Client
      </text>
      <text className="actor" x={hostX} y="24" textAnchor="middle">
        Host
      </text>
      <text className="actor-detail" x={clientX} y="40" textAnchor="middle">
        {scene.ready ? "replica · ready" : "replica"}
      </text>
      <text className="actor-detail" x={hostX} y="40" textAnchor="middle">
        {scene.step.created ? "loaded into memory" : "in memory"}
      </text>
      {(open || opening > 0) && (
        <g data-testid="open-connection">
          <line
            className="connection-halo"
            x1={right - (right - left) * (open ? 1 : opening)}
            x2={right}
            y1={wireY}
            y2={wireY}
          />
          <line
            className="connection-wire"
            x1={right - (right - left) * (open ? 1 : opening)}
            x2={right}
            y1={wireY}
            y2={wireY}
          />
          {open && (
            <text
              className="connection-label mono"
              x={streamX}
              y="12"
              textAnchor="middle"
            >
              text/event-stream
            </text>
          )}
        </g>
      )}
      <circle
        className={`port ${open ? "connected" : ""}`}
        cx={left}
        cy={wireY}
        r="4"
      />
      <circle
        className={`port ${open || opening ? "connected" : ""}`}
        cx={right}
        cy={wireY}
        r="4"
      />
      {scene.ready && (
        <g className="live-label">
          <circle cx={streamX - 29} cy="48" r="3" />
          <text x={streamX - 18} y="52">
            still open
          </text>
        </g>
      )}

      <NotebookGroup
        records={scene.hostRecords}
        x={hostX}
        side="host"
        loadHighlight={loadActive}
        expandedKeys={expandedKeys}
        onToggleConfig={toggleConfig}
        highlighted={sending}
        onInspect={onInspect}
      />
      <NotebookGroup
        records={scene.received}
        x={clientX}
        side="client"
        expandedKeys={expandedKeys}
        onToggleConfig={toggleConfig}
        highlighted={arriving}
        highlight={arrivalHighlight}
        onInspect={onInspect}
      />
      {envelope && (
        <g
          {...activate(() => onInspect(envelope.inspection))}
          aria-label={`Inspect in-flight ${envelope.label}`}
          className={`envelope ${transit?.kind === "event" ? transit.message.event : transit?.kind}`}
          transform={`translate(${envelope.x} ${envelope.y})`}
          data-testid="in-flight"
        >
          <rect x="-81" y="-14" width="162" height="28" rx="3" />
          <text className="mono" textAnchor="middle" y="4">
            {envelope.label}
          </text>
        </g>
      )}
    </svg>
  );
}
