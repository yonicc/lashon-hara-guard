// Reproducible browser bundle: canonical TS engine/rules, no dist edits.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'engine/package.json'));
const { build } = require('esbuild');
const assets = JSON.parse(execFileSync(process.platform === 'win32' ? 'py' : 'python3',
  [path.join(root, 'scripts/export-ollama-prompt.py')], { encoding: 'utf8' }));
const result = await build({
  absWorkingDir: root, entryPoints: ['extension/ollama-engine.ts'],
  outfile: 'extension/ollama-engine.bundle.js', bundle: true, platform: 'browser',
  format: 'iife', target: 'chrome116', legalComments: 'inline',
  define: { __LHG_OLLAMA_ASSETS__: JSON.stringify(assets) },
  write: !process.argv.includes('--check'),
});
if (process.argv.includes('--check') &&
    readFileSync(path.join(root, 'extension/ollama-engine.bundle.js'), 'utf8').replace(/\r\n/g, '\n') !==
      result.outputFiles[0].text.replace(/\r\n/g, '\n')) {
  throw new Error('Ollama bundle is stale; run node scripts/build-ollama.mjs');
}
