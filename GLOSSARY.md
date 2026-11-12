# Moku

Moku is a playground of clients for browsing and working with notebooks presented
by marimo-compatible hosts.

## Language

**Workspace**:
The host connections available to a person in a client and the notebooks
accessible through them. A workspace may span several hosts.
_Avoid_: Project, directory

**Host connection**:
Access to a host known to a client, discovered locally or added explicitly. A
host connection can exist without an active notebook attachment.
_Avoid_: Host, attachment

**Catalog**:
The inventory of projects and notebooks presented by a host.

**Host**:
A program that presents projects and notebooks to clients. A host determines
which operations are available on each project and notebook.
_Avoid_: Runtime, workspace

**Project**:
A group of notebooks presented together by a host, often associated with a
directory. A project may have no directory.
_Avoid_: Workspace

**Notebook**:
A document and its results as known by a host. Its identity is meaningful within
that host, and it can exist without a running kernel.
_Avoid_: Session, file

**Document**:
The ordered cells, source code, and configuration of a notebook. Results and
runtime state are separate from the document.

**Confirmed revision**:
A document revision and its matching cell records acknowledged by the host.
_Avoid_: Draft, partially received document

**Draft**:
Local document changes that have not yet been incorporated into a confirmed
revision. A draft is not a saved notebook.

**Editing session**:
One local editable view of a notebook's document, including its draft changes.
Several cell editors can participate in the same editing session.
_Avoid_: Runtime, attachment

**Cell**:
A named or anonymous unit of code and configuration within a notebook's document.

**Display data**:
A rendered value expressed as a MIME type and embedded data. It may be a result's
value or the content of a display item produced during execution.

**Console output**:
Text emitted on a named console channel during execution, such as standard
output or standard error.

**Runtime**:
A kernel attached to a notebook. A notebook has at most one runtime at a time,
and restarting it creates a new runtime.
_Avoid_: Host, notebook

**Attachment**:
A consumer currently connected to a notebook. Its lifetime is independent of
the notebook's runtime.
_Avoid_: Runtime, editing session

**Run cancellation**:
A request to cancel one queued or running run without targeting other runs.
_Avoid_: Runtime interruption, runtime shutdown

**Runtime interruption**:
A request to interrupt active work in a notebook's runtime while leaving the
runtime alive.
_Avoid_: Run cancellation, runtime shutdown
