# Historical Next.js native binding workaround

**Superseded for our applications on 2026-10-22.** We now use official Next.js
16.4.2 platform packages and one global pnpm virtual-store configuration on every
platform. The release below remains immutable for historical branches and source
review; new applications should use supported framework configuration first.

For Sentry-instrumented AI/MCP SDKs, Next.js
[`serverExternalPackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)
lets Node load the SDKs and Sentry instrument them at runtime while keeping Sentry
build instrumentation enabled. With Sentry 11, declare the matching
`@sentry/server-runtime-injection` runtime dependency and include its dynamic
worker using `outputFileTracingIncludes` when producing traced deployment
artifacts. Validate actual automatic spans from the copied deployment artifact
on each supported Node version; our Node 22 and Node 26 tests captured OpenAI,
Anthropic and MCP spans without a custom native binding or manual tracing wrapper.

The general external-loader limitation remains in the stable/canary releases
checked on that date; [the upstream fix](https://github.com/vercel/next.js/pull/100598)
is still open. The application-side solution avoids that loader path rather than
requiring a framework fork. The rest of this document records the old workaround.

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

## Historical consumption of a reviewed release

Keep the exact reviewed Next.js version pinned and declare the native artifact as
an explicit root optional dependency:

```json
{
  "optionalDependencies": {
    "@next/swc-darwin-arm64": "https://github.com/MeterApp/next-swc-patches/releases/download/next-16.4.2-loader-roots-r1/next-swc-darwin-arm64.tgz"
  }
}
```

pnpm 12 correctly blocks URL subdependencies by default. Do not disable
`blockExoticSubdeps` and do not use a URL override of Next's optional child.
Instead, the bounded `readPackage` hook in [examples/pnpmfile.mjs](examples/pnpmfile.mjs)
connects only Next 16.4.2 to the explicitly reviewed root dependency as an optional
peer, preserving the other platform children and OS/CPU filtering. Copy that file
to the application's `.pnpmfile.mjs`; keep `virtualStoreType: project` as the YAML
fallback. Commit the resulting frozen lockfile and artifact integrity.

The example enables the shared graph only for Apple Silicon development when
both the framework and artifact declarations exactly match the reviewed pair.
Other platforms, CI and changed versions use the supported project layout. Next
should use its `turbopackAdditionalRoots()` export only in shared mode. That helper
reads the installed graph's `virtualStoreDir`, supporting custom stores and CLI
layout overrides without broadening the project root. A monorepo must validate
all Next workspace versions and declare the optional binding in each consuming
workspace so its native peer resolves there.

No custom-binding environment variable is needed. Next loads the replacement
through its ordinary native package entrypoint. Never replace an already released
tarball. Publish a new release identifier for any binary change. Remove the native
hook and artifact when an official Next.js version includes the fix and passes
the same integration checks. The source fix is submitted as
[vercel/next.js#100598](https://github.com/vercel/next.js/pull/100598).

Validation includes the failing-before/passing-after external-loader fixture,
production and development requests, external-resource edit invalidation, and a
mocked OpenAI call emitting an automatic Sentry `gen_ai.chat` span with origin
`auto.ai.openai`. The mock uses local fetch and a no-op telemetry transport: no
paid provider request or telemetry upload is required.

Upstream Next.js and this derivative are MIT licensed; see `LICENSE`.
