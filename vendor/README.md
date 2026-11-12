# Pinned marimo client

`marimo-client-d0495d6.tgz` contains DAG's existing `@marimo-team/client` build
from `marimo-team/marimo` commit `d0495d66839b13d34624a8a4dac16f23637cbb4e`,
including experimental analysis events.

Bun does not support the previous pnpm Git-subdirectory dependency. This local
archive preserves its installed `dist` files byte-for-byte while the shared
client is migrated. The package manifest omits build scripts and development
dependencies because this is an already-built dependency. The upstream Apache
2.0 license is included.

SHA-256: `da409d048cd768bea135784ad9b005c5db4a339eb3d02e74c5a54f8c7530b236`

Source: https://github.com/marimo-team/marimo/tree/d0495d66839b13d34624a8a4dac16f23637cbb4e/packages/client

To replace this archive, build that upstream package with experimental analysis
enabled, verify DAG's graph/model tests against it, and record the new revision
and archive checksum here. Do not substitute a newer stable-only protocol.
