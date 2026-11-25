/** A progressively revealed notebook model, before the connection scenario. @module */
import * as React from "react";

const passages = [
  {
    title: "Cells",
    body: (
      <>
        A <strong>cell</strong> is a unit of source code with an identity and
        configuration. For example, this cell defines a variable, <code>x</code>, with
        the value 10.
      </>
    ),
    note: (
      <>
        The host represents the <strong>cell</strong> as a record. Alongside the code,
        the record contains an ID and settings that control how the cell is presented
        and executed.
      </>
    ),
  },
  {
    title: "Identity and configuration",
    body: (
      <>
        The host assigns each <strong>cell</strong> an ID. Here, <code>c1</code>{" "}
        identifies the cell before and after an edit. Configuration records settings
        such as whether the cell is disabled or its code is hidden in the interface.
      </>
    ),
    note: (
      <>
        Expand config to inspect these settings, or change the value to see an update to
        the same <strong>cell</strong>. This illustration does not execute the code.
      </>
    ),
  },
  {
    title: "Documents and notebooks",
    body: (
      <>
        A <strong>document</strong> specifies the order of its <strong>cells</strong>{" "}
        using their IDs. In this example, <code>c1</code> assigns <code>x</code> and{" "}
        <code>c2</code> prints it. Both <strong>cells</strong> and the{" "}
        <strong>document</strong> belong to <strong>notebook</strong> <code>n1</code>,
        named hello.
      </>
    ),
    note: (
      <>
        The <strong>notebook</strong>, <strong>document</strong>, and{" "}
        <strong>cells</strong> are linked by IDs, although the diagram groups them
        together to show which notebook they belong to.
      </>
    ),
  },
  {
    title: "Host ownership",
    body: (
      <>
        A <strong>host</strong> can serve multiple <strong>notebooks</strong>. It owns
        their objects and handles requests through the operations it exposes, such as
        editing, saving, or running <strong>cells</strong>.
      </>
    ),
    note: (
      <>
        Ownership describes the host’s responsibility for these objects. The protocol
        does not prescribe how the host implements or stores them.
      </>
    ),
  },
  {
    title: "Loading and saving",
    body: (
      <>
        A marimo host can parse a Python file to create the <strong>notebook</strong>,{" "}
        <strong>document</strong>, and <strong>cell</strong> records. Other hosts can
        use different storage, such as a database. The protocol does not require a
        particular storage format.
      </>
    ),
    note: (
      <>
        An accepted edit changes the <strong>document</strong>. Saving persists it
        through the host’s storage implementation.
      </>
    ),
  },
];

/** Reveals concepts on ordinary, reversible scroll without driving protocol time. */
export function Story() {
  const root = React.useRef<HTMLDivElement>(null);
  const [step, setStep] = React.useState(0);
  const [edited, setEdited] = React.useState(false);

  React.useEffect(() => {
    const elements = root.current?.querySelectorAll<HTMLElement>("[data-passage]");
    if (!elements) return;
    let frame = 0;
    function update() {
      frame = 0;
      let current = 0;
      elements?.forEach((element, index) => {
        if (element.getBoundingClientRect().top <= window.innerHeight * 0.55) {
          current = index;
        }
      });
      setStep(current);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section aria-labelledby="story-title">
      <div className="story-opening">
        <h1 id="story-title">The host protocol</h1>
        <p className="story-subtitle">An interactive introduction</p>
        <h2>Overview</h2>
        <p>
          The host protocol defines an API for observing and interacting with reactive
          programs. It represents a program’s source, execution state, and retained
          results as a collection of related objects.
        </p>
        <p>
          A <strong>host</strong> maintains these objects and exposes operations that
          clients can request. A <strong>client</strong> obtains their current state
          through an event stream and follows subsequent changes to maintain a local
          replica. This separates the client’s view of the program from the host’s
          choices about storage and execution.
        </p>
        <p>
          The protocol calls a <strong>document</strong> together with its retained
          execution results a<strong> notebook</strong>. A <strong>notebook</strong> may
          be backed by files or a database, and it can remain available without an
          attached <strong>runtime</strong>.
        </p>
        <h2>The object model</h2>
        <p>
          The protocol represents a <strong>notebook</strong> through a set of related
          objects. Some describe its source, such as <strong>cells</strong> and the{" "}
          <strong>document</strong> that orders them. Others describe execution:{" "}
          <strong>runs</strong>, individual cell evaluations called{" "}
          <strong>executions</strong>, and the results they produce. Each object records
          part of the notebook’s state, with references connecting it to other objects.
        </p>
        <p>
          We will introduce these objects in turn, using a small program to show how
          they fit together. Then we will examine how a host creates and updates them,
          and how clients follow those changes.
        </p>
      </div>
      <div className="story-layout" ref={root}>
        <div className="story-passages">
          {passages.map((passage) => (
            <section className="story-passage" data-passage key={passage.title}>
              <h2>{passage.title}</h2>
              <p>{passage.body}</p>
              <p className="passage-note">{passage.note}</p>
            </section>
          ))}
        </div>
        <div className="story-visual">
          <div className="model" data-step={step}>
            <div className="model-host" aria-hidden={step < 3}>
              <span>Host</span>
            </div>
            <div className="model-notebook" aria-hidden={step < 2}>
              <div className="model-heading">
                <span>notebook</span>
                <code>n1</code>
              </div>
              <div className="model-name">
                <span>name</span> hello
              </div>
            </div>
            <div className="model-document model-card" aria-hidden={step < 2}>
              <div className="model-heading">
                <span>document</span>
                <code>notebook_id: n1</code>
              </div>
              <div className="model-order">
                <span>order</span> [<code>c1</code>, <code>c2</code>]
              </div>
            </div>
            <div className="model-cell model-card">
              <div className="model-heading">
                <span>cell</span>
                <code className="model-cell-id" aria-hidden={step < 1}>
                  c1
                </code>
              </div>
              <pre>
                x ={" "}
                <span className={step === 1 && edited ? "changed-value" : ""}>
                  {step === 1 && edited ? "20" : "10"}
                </span>
              </pre>
              <details aria-hidden={step < 1}>
                <summary>
                  config <code>{"{ … }"}</code>
                </summary>
                <pre>
                  {
                    "disabled: false\nhide_code: false\ncolumn: null\nexpand_output: false"
                  }
                </pre>
              </details>
            </div>
            <div className="model-second model-card" aria-hidden={step < 2}>
              <div className="model-heading">
                <span>cell</span>
                <code>c2</code>
              </div>
              <pre>print(x)</pre>
            </div>
            {step >= 3 && (
              <div
                className="model-other-notebooks"
                aria-label="Other notebooks owned by the host"
              >
                {["n2", "n3"].map((id) => (
                  <div className="model-heading model-notebook-summary" key={id}>
                    <span>notebook</span>
                    <code>{id}</code>
                  </div>
                ))}
              </div>
            )}
            <div className="model-storage" aria-hidden={step < 4}>
              <span className="model-load">load</span>
              <span>Storage</span>
              <code>hello.py</code>
            </div>
          </div>
          <div className="model-caption">
            {step === 1 && (
              <button type="button" onClick={() => setEdited(!edited)}>
                Change to x = {edited ? "10" : "20"} <span aria-hidden="true">↔</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
