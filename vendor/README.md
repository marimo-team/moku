# Pinned marimo client

`marimo-client-29327a665.tgz` is built from the local marimo integration commit
`29327a665d69810fcb7f5d879eb98b217661b15e`, including its generated
experimental analysis protocol. This revision is local, not a published release.

The archive includes compiled `dist`, the upstream README and Apache 2.0 license.
Build scripts and development dependencies are omitted from the package manifest.
Bun consumes this archive because it does not support the former pnpm
Git-subdirectory dependency.

SHA-256: `6e09f8557675fcfe1b7e07dc9314c407a5ae4bf91dbb3654209fca03b91d5f33`

To update, build `packages/client` at the desired marimo revision with
`bun run build`, archive its `dist` with the manifest, README, and license,
and update both workspace dependencies and this revision/checksum. The generated
protocol must include experimental analysis. Run the model and DAG tests after
updating; runtime interruption and individual run cancellation are distinct.

`marimo-smart-cells-29327a665.tgz` contains smart-cell parser source from the same revision,
with its README and Apache 2.0 license. Development dependencies and scripts are
omitted. SHA-256: `b1a7449679507ed7af0ce66e3548f4be9d0821fbafbf95b4b6dc22bd05916b59`.
