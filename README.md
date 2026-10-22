# Patched Next.js native bindings

A temporary, narrowly scoped patch for Next.js 16.4.2's Turbopack webpack-loader
bridge. Registered additional filesystem roots can already resolve dependencies,
but loaders reject resources that are outside the project filesystem. This patch
passes their absolute disk paths to the existing loader executor. It preserves
Sentry's normal build instrumentation and keeps the project root narrow.

Only macOS ARM64 is packaged here. Other platforms and CI should retain the
ordinary project virtual store and official Next.js bindings. This is an
independently built derivative, not an official Vercel release.

## Build

Requirements: macOS ARM64, Xcode command line tools, Node.js 22+, Git, Rustup,
and enough free space for a release Rust build. Builds can take substantial time.
No application sources or credentials are required.

```sh
git clone --filter=blob:none --single-branch \
  --branch codex/next-16.4.2-loader-roots-r1 \
  https://github.com/JOsacky/next.js.git next-source
git -C next-source checkout 348988a542e4cd6036fe71c7fbc22f297f027bd3
rustup toolchain install nightly-2026-08-20 --profile minimal
rustup target add --toolchain nightly-2026-08-20 aarch64-apple-darwin
node scripts/build.mjs --source ./next-source --dry-run
node scripts/build.mjs --source ./next-source
node scripts/package.mjs --source ./next-source \
  --binary ./next-source/target/aarch64-apple-darwin/release/libnext_napi_bindings.dylib \
  --out ./dist
```

The build script requires the exact clean patched commit, verifies its upstream
parent, restricts its committed diff to the reviewed source file, and verifies
Cargo.lock and source checksums. It uses Cargo's locked release build with the
upstream release features. The exact inputs are in `build-manifest.json`.

The patch is committed before compilation: Next.js embeds the source Git state
in the native binding, and a dirty source checkout disables its persistent
filesystem cache. Building or packaging a dirty checkout is rejected. The
archival patch in this repository is for review, not an uncommitted build step.

The Rust flags preserve upstream's tokio configuration, shared generics, parallel
frontend, unstable flags and fatal warnings. The one linker adjustment is
`-C linker=cc`: Apple's linker supports the current Apple SDK's `arm64e.x1`
objects, which the pinned Rust toolchain's older bundled linker cannot parse.
This adjustment does not change source or instrumentation. Use the same SDK and
linker when comparing binary output. The recipe pins source and dependency
inputs; it does not promise byte-identical binaries across Xcode versions.

Packaging verifies the clean patched source commit, parent, source checksum, patch checksum,
Cargo.lock and upstream package metadata. It rejects unrelated tracked source
changes and wrong architectures, then loads the resulting binding and checks its
Turbopack exports and target. The packager also checks the native cache version against the clean patch commit,
rejecting dirty builds that disable filesystem caching. The tarball keeps the official package name,
version, CPU/OS restrictions and native entrypoint. Its embedded build manifest
identifies the derivative and native binary hash. `dist/release-manifest.json`
adds the final artifact's SHA256 and SHA512 integrity.

```sh
node --test
```

Tests cover package identity, source verification and rejection of changed
lockfiles, extra edits, wrong commits and wrong native architectures. Application
production builds and instrumentation behavior require separate integration
validation before releasing a binary. These scripts do not publish releases.

## Consume a reviewed release

Pin the version-specific Darwin binding override to an immutable public release
tarball in `pnpm-workspace.yaml`. Commit the resulting lockfile integrity. Keep
Next.js pinned to the matching version. No custom-binding environment variable
is needed; Next.js loads the replacement through its ordinary package entrypoint.
Never replace an already released tarball. Publish a new release identifier for
any binary change. Remove the override when an official Next.js version includes
the fix and passes the same integration checks.

Upstream Next.js and this derivative are MIT licensed; see `LICENSE`.
