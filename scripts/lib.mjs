import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const manifest = JSON.parse(readFileSync(path.join(root, 'build-manifest.json')));
export function digest(bytes, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}
export function verifyFile(file, expected) {
  if (digest(readFileSync(file)) !== expected) throw new Error(`Checksum mismatch: ${file}`);
}
export function verifyInputs(source, expected = manifest) {
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== expected.patchedCommit) throw new Error('Unexpected patched commit');
  if (git('rev-parse', 'HEAD^') !== expected.upstreamCommit) throw new Error('Unexpected upstream parent');
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Source checkout must be clean for Next.js filesystem caching');
  verifyFile(path.join(root, expected.patch), expected.patchSha256);
  verifyFile(path.join(source, 'Cargo.lock'), expected.cargoLockSha256);
  verifyFile(path.join(source, expected.sourceFile), expected.patchedSourceSha256);
  const changes = git('diff', '--name-only', expected.upstreamCommit, 'HEAD').split('\n').filter(Boolean);
  if (changes.length !== 1 || changes[0] !== expected.sourceFile) throw new Error(`Unexpected committed source changes: ${changes.join(', ')}`);
}
export function parseArgs(args, allowed) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    if (!allowed.includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${flag}`);
    options[flag.slice(2)] = path.resolve(args[++i]);
  }
  return options;
}
export function assertDarwinArm64(bytes) {
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) {
    throw new Error('Expected a 64-bit ARM64 Mach-O native library');
  }
}

export function assertNativeBindings(bindings) {
  const expectedCacheVersion = `v${manifest.nextVersion}-${manifest.patchedCommit.slice(0, 8)}`;
  if (bindings.getTargetTriple() !== manifest.target || typeof bindings.projectNew !== 'function' || typeof bindings.transformSync !== 'function') {
    throw new Error('Unexpected native binding exports');
  }
  if (bindings.turbopackCacheVersion(manifest.nextVersion) !== expectedCacheVersion) {
    throw new Error('Native binding must use the clean reviewed patch commit with filesystem caching enabled');
  }
  return expectedCacheVersion;
}
