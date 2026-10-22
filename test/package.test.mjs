import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertDarwinArm64, assertNativeBindings, digest, manifest, parseArgs, root, verifyFile, verifyInputs } from '../scripts/lib.mjs';

test('pinned patch and package metadata retain reviewed hashes and platform identity', () => {
  verifyFile(path.join(root, manifest.patch), manifest.patchSha256);
  verifyFile(path.join(root, 'upstream-package.json'), manifest.packageMetadataSha256);
  const metadata = JSON.parse(readFileSync(path.join(root, 'upstream-package.json')));
  assert.equal(metadata.name, '@next/swc-darwin-arm64');
  assert.equal(metadata.version, manifest.nextVersion);
  assert.equal(metadata.main, 'next-swc.darwin-arm64.node');
  assert.deepEqual(metadata.os, ['darwin']);
  assert.deepEqual(metadata.cpu, ['arm64']);
});

test('reject wrong architectures and malformed native libraries', () => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  assert.doesNotThrow(() => assertDarwinArm64(bytes));
  bytes.writeUInt32LE(0x01000007, 4);
  assert.throws(() => assertDarwinArm64(bytes), /ARM64 Mach-O/);
  assert.throws(() => assertDarwinArm64(Buffer.from('invalid')), /ARM64 Mach-O/);
});

test('source verification requires a clean pinned patch commit with only the reviewed change', () => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'next-swc-source-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    writeFileSync(path.join(source, 'Cargo.lock'), 'locked dependencies');
    writeFileSync(path.join(source, 'source.rs'), 'original source');
    writeFileSync(path.join(source, 'other.rs'), 'unchanged');
    const upstreamCommit = commit();
    writeFileSync(path.join(source, 'source.rs'), 'patched source');
    const patchedCommit = commit();
    const expected = { ...manifest, upstreamCommit, patchedCommit, cargoLockSha256: digest('locked dependencies'), sourceFile: 'source.rs', patchedSourceSha256: digest('patched source') };
    assert.doesNotThrow(() => verifyInputs(source, expected));
    writeFileSync(path.join(source, 'Cargo.lock'), 'changed dependencies');
    assert.throws(() => verifyInputs(source, expected), /must be clean/);
    git('restore', 'Cargo.lock');
    writeFileSync(path.join(source, 'other.rs'), 'unreviewed edit');
    assert.throws(() => verifyInputs(source, expected), /must be clean/);
    git('add', 'other.rs');
    assert.throws(() => verifyInputs(source, expected), /must be clean/);
    git('restore', '--staged', 'other.rs');
    git('restore', 'other.rs');
    assert.throws(() => verifyInputs(source, { ...expected, patchedCommit: '0'.repeat(40) }), /Unexpected patched commit/);
    assert.throws(() => verifyInputs(source, { ...expected, upstreamCommit: '0'.repeat(40) }), /Unexpected upstream parent/);
    assert.throws(() => verifyInputs(source, { ...expected, patchedSourceSha256: '0'.repeat(64) }), /Checksum mismatch/);
    git('checkout', '--detach', upstreamCommit);
    writeFileSync(path.join(source, 'source.rs'), 'patched source');
    writeFileSync(path.join(source, 'other.rs'), 'unreviewed edit');
    const unrelatedCommit = commit();
    assert.throws(() => verifyInputs(source, { ...expected, patchedCommit: unrelatedCommit }), /Unexpected committed source changes/);
  } finally { rmSync(source, { recursive: true, force: true }); }
});

test('commands reject unknown flags and accept explicit dry runs', () => {
  assert.deepEqual(parseArgs(['--dry-run'], ['--source']), { dryRun: true });
  assert.throws(() => parseArgs(['--source'], ['--source']), /Invalid argument/);
  assert.throws(() => parseArgs(['--publish'], ['--source']), /Invalid argument/);
});

test('the native binary identifies the reviewed clean commit and keeps persistent caching enabled', () => {
  const expected = `v${manifest.nextVersion}-${manifest.patchedCommit.slice(0, 8)}`;
  const binding = {
    getTargetTriple: () => manifest.target,
    projectNew() {},
    transformSync() {},
    turbopackCacheVersion: () => expected,
  };
  assert.equal(assertNativeBindings(binding), expected);
  for (const version of [`${expected}-dirty`, `v${manifest.nextVersion}-2864b177`]) {
    assert.throws(() => assertNativeBindings({ ...binding, turbopackCacheVersion: () => version }), /clean reviewed patch commit/);
  }
});
