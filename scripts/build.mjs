import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { manifest, parseArgs, verifyInputs } from './lib.mjs';

const options = parseArgs(process.argv.slice(2), ['--source']);
if (!options.source) throw new Error('Usage: node scripts/build.mjs --source /path/to/next.js [--dry-run]');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on macOS ARM64');
verifyInputs(options.source);
const args = [`+${manifest.rustToolchain}`, 'build', '--locked', '--release', '-p', 'next-napi-bindings', '--target', manifest.target, '--features', manifest.features];
console.log(JSON.stringify({ source: options.source, command: ['cargo', ...args], RUSTFLAGS: manifest.rustFlags, CARGO_INCREMENTAL: '0' }, null, 2));
if (!options.dryRun) {
  verifyInputs(options.source);
  execFileSync('cargo', args, { cwd: options.source, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: manifest.rustFlags, CARGO_INCREMENTAL: '0' } });
  console.log(`Built ${path.join(options.source, 'target', manifest.target, 'release/libnext_napi_bindings.dylib')}`);
}
