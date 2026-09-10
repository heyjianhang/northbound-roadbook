import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL(
  '../node_modules/.cache/northbound-ui-tests/',
  import.meta.url,
);
await mkdir(new URL('./', output), { recursive: true });
await build({
  entryPoints: [
    fileURLToPath(new URL('../tests/pwa-ui.integration.jsx', import.meta.url)),
    fileURLToPath(
      new URL('../tests/notes-ui.integration.jsx', import.meta.url),
    ),
    fileURLToPath(
      new URL('../tests/agent-ui.integration.jsx', import.meta.url),
    ),
    fileURLToPath(
      new URL('../tests/accounts.integration.jsx', import.meta.url),
    ),
    fileURLToPath(
      new URL('../tests/static-roadbook.integration.jsx', import.meta.url),
    ),
    fileURLToPath(
      new URL('../tests/provider.integration.jsx', import.meta.url),
    ),
    fileURLToPath(
      new URL('../tests/navigation.integration.jsx', import.meta.url),
    ),
  ],
  outdir: fileURLToPath(output),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  alias: { '@': root },
  logLevel: 'warning',
});
const result = spawnSync(
  process.execPath,
  [
    '--test',
    fileURLToPath(new URL('pwa-ui.integration.mjs', output)),
    fileURLToPath(new URL('notes-ui.integration.mjs', output)),
    fileURLToPath(new URL('agent-ui.integration.mjs', output)),
    fileURLToPath(new URL('accounts.integration.mjs', output)),
    fileURLToPath(new URL('provider.integration.mjs', output)),
    fileURLToPath(new URL('navigation.integration.mjs', output)),
    fileURLToPath(new URL('static-roadbook.integration.mjs', output)),
  ],
  {
    stdio: 'inherit',
    cwd: root,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
