// Desktop smoke test: builds nothing itself — run `pnpm build` first.
// Launches the real Electron app with a throw-away profile, renders each main screen,
// saves screenshots to out/smoke/, and fails if any screen does not render or logs an error.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smoke');
const profile = mkdtempSync(join(tmpdir(), 'delyforge-smoke-'));

const child = spawn(electronPath, [root], {
  env: { ...process.env, DELYFORGE_SMOKE_DIR: outDir, DELYFORGE_USER_DATA: profile, ELECTRON_RENDERER_URL: '' },
  stdio: 'inherit',
});

const timeout = setTimeout(() => {
  console.error('Smoke test timed out after 60s');
  child.kill();
}, 60_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  rmSync(profile, { recursive: true, force: true });
  let result = { ok: false, failures: ['no result written'] };
  try {
    result = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
  } catch {
    /* keep default */
  }
  if (code === 0 && result.ok) {
    console.log(`\n✔ Desktop smoke test passed. Screenshots: ${outDir}`);
    process.exit(0);
  }
  console.error('\n✖ Desktop smoke test failed:', result.failures);
  process.exit(1);
});
