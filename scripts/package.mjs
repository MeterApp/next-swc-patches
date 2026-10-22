import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDarwinArm64, assertNativeBindings, digest, manifest, parseArgs, root, verifyFile, verifyInputs } from './lib.mjs';

const options = parseArgs(process.argv.slice(2), ['--binary', '--source', '--out']);
if (!options.binary || !options.source) throw new Error('Usage: node scripts/package.mjs --source /path/to/next.js --binary /path/to/binding [--out ./dist] [--dry-run]');
verifyInputs(options.source);
verifyFile(path.join(root, 'upstream-package.json'), manifest.packageMetadataSha256);
const binary = readFileSync(options.binary);
assertDarwinArm64(binary);
const metadata = JSON.parse(readFileSync(path.join(root, 'upstream-package.json')));
const binarySha256 = digest(binary);
const out = options.out ?? path.join(root, 'dist');
console.log(JSON.stringify({ out, package: metadata.name, version: metadata.version, binarySha256, dryRun: Boolean(options.dryRun) }, null, 2));
if (!options.dryRun) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Package on macOS ARM64 so the native binary can be loaded and checked');
  const stage = mkdtempSync(path.join(os.tmpdir(), 'next-swc-package-'));
  try {
    cpSync(options.binary, path.join(stage, metadata.main));
    const bindings = createRequire(import.meta.url)(path.join(stage, metadata.main));
    const cacheVersion = assertNativeBindings(bindings);
    writeFileSync(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
    cpSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
    const provenance = { ...manifest, binarySha256, cacheVersion };
    writeFileSync(path.join(stage, 'build-manifest.json'), JSON.stringify(provenance, null, 2) + '\n');
    mkdirSync(out, { recursive: true });
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }))[0];
    const filename = 'next-swc-darwin-arm64.tgz';
    renameSync(path.join(out, packed.filename), path.join(out, filename));
    const artifact = readFileSync(path.join(out, filename));
    writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify({ ...provenance, artifact: filename, artifactSha256: digest(artifact), integrity: `sha512-${digest(artifact, 'sha512', 'base64')}` }, null, 2) + '\n');
    console.log(`Packaged ${path.join(out, filename)}`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
