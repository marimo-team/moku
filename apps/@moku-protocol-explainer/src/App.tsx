/** An interactive first connection, presented as one continuous illustration. @module */
import * as React from "react";
import * as Connection from "./connection.ts";
import * as Playback from "./Playback.ts";
import { Scene, type Inspection } from "./Scene.tsx";
import { usePlayback } from "./usePlayback.ts";
import { Story } from "./Story.tsx";

function PlayIcon({ paused }: { paused: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {paused ? (
        <path d="M5 3v10M11 3v10" stroke="currentColor" strokeWidth="2" />
      ) : (
        <path d="m5 2 9 6-9 6z" fill="currentColor" />
      )}
    </svg>
  );
}

function ConnectionLesson() {
  const playback = usePlayback();
  const scene = Connection.sceneAt(playback.position);
  const last = Connection.steps.length - 1;
  const inMotion = playback.position !== scene.index;
  const [inspection, setInspection] = React.useState<Inspection | null>(null);
  const caption = inMotion
    ? Connection.steps[scene.index + 1].moving
    : scene.step.title;
  const snapshotStart = Connection.steps.findIndex((step) => step.breakpoint);
  const phase = playback.position < 2 ? 0 : playback.position <= snapshotStart ? 1 : 2;
  const action = playback.running
    ? "Pause"
    : playback.position === 0
      ? "Connect"
      : scene.ready
        ? "Replay"
        : "Continue";

  function inspect(value: Inspection) {
    playback.pause();
    setInspection(value);
  }

  return (
    <>
      <div className="connection-lesson">
        <section className="illustration" aria-label="Connection walkthrough">
          <div className="lesson-toolbar">
            <nav className="chapters" aria-label="Lesson moments">
              {[
                { title: "Connect", position: 0 },
                { title: "Load objects", position: 2 },
                { title: "Send snapshot", position: snapshotStart },
              ].map((chapter, index) => (
                <React.Fragment key={chapter.title}>
                  {index > 0 && <span className="chapter-divider" aria-hidden="true" />}
                  <button
                    type="button"
                    aria-current={phase === index ? "step" : undefined}
                    onClick={() => playback.seek(chapter.position)}
                  >
                    <span className="chapter-number">0{index + 1}</span>
                    {chapter.title}
                  </button>
                </React.Fragment>
              ))}
            </nav>
            <div className="playback">
              <button
                className="play-button"
                type="button"
                onClick={playback.running ? playback.pause : playback.play}
              >
                <PlayIcon paused={playback.running} />
                {action}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Advance one step"
                title="Advance one step"
                onClick={playback.next}
                disabled={scene.ready}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3 3 7 5-7 5z" fill="currentColor" />
                  <path d="M12 3v10" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <div className="scrubber">
                <input
                  aria-label="Timeline"
                  type="range"
                  min="0"
                  max={last}
                  step="0.01"
                  value={playback.position}
                  onChange={(event) => playback.seek(event.currentTarget.valueAsNumber)}
                  style={
                    {
                      "--progress": `${(playback.position / last) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <div className="scrubber-stops" aria-hidden="true">
                  {Connection.steps.map((_, index) => (
                    <i
                      key={index}
                      className={index <= playback.position ? "visited" : ""}
                    />
                  ))}
                </div>
              </div>
              <select
                className="speed-control"
                aria-label="Playback speed"
                title="Playback speed"
                value={playback.speed}
                onChange={(event) => {
                  const speed = Playback.speeds.find(
                    (value) => String(value) === event.currentTarget.value,
                  );
                  if (speed !== undefined) playback.setSpeed(speed);
                }}
              >
                {Playback.speeds.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                type="button"
                aria-label="Reset lesson"
                title="Reset lesson"
                onClick={() => playback.seek(0)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 5a5 5 0 1 1-1 5M3 1v4h4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="scene-viewport">
            <Scene position={playback.position} onInspect={inspect} />
          </div>
          <div className="narration">
            <span
              className={`narration-mark ${scene.step.breakpoint && !inMotion ? "breakpoint" : ""}`}
              aria-hidden="true"
            />
            <p role="status">{caption}</p>
          </div>
        </section>
        {inspection && (
          <section className="inspector" aria-label="Object details">
            <div className="inspector-heading">
              <h2>{inspection.title}</h2>
              <button
                type="button"
                aria-label="Close details"
                onClick={() => setInspection(null)}
              >
                ×
              </button>
            </div>
            <pre>{inspection.content}</pre>
          </section>
        )}
        <footer className="lesson-footer">
          <span>Drag time. Click an object to look inside.</span>
        </footer>
      </div>
    </>
  );
}

/** A guided introduction that opens into an inspectable connection scenario. */
export function App() {
  return (
    <>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Moku protocol explainer">
          moku<span className="wordmark-dot">.</span>
        </a>
        <span className="masthead-divider" />
        <span>Host protocol</span>
        <a className="skip-story" href="#connection">
          Connection example ↗
        </a>
      </header>
      <main className="story-page">
        <Story />
        <section
          className="connection-chapter"
          id="connection"
          aria-labelledby="connection-title"
        >
          <div className="chapter-intro">
            <h2 id="connection-title">Connecting to a notebook</h2>
            <p>
              A client opens an event stream to receive the notebook’s current records.
              The host sends a snapshot, followed by a ready event. Subsequent events
              describe changes to those records over the same connection.
            </p>
            <p>
              This example shows a host loading a notebook from a file when the client
              first connects. Playback pauses after loading, before the host sends the
              snapshot.
            </p>
          </div>
          <ConnectionLesson />
          <p className="story-coda">
            At <code>ready</code>, the snapshot is complete. The connection stays open:
            later record events replace earlier records with the same identity, and
            removal events tell the client what to discard.
          </p>
        </section>
      </main>
    </>
  );
}
