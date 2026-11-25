// Builds the Windows installer: pnpm --filter @delyforge/desktop dist
//
// A customer build must talk to your real server and trust only your signing key, so this refuses to build without:
//   DELYFORGE_API_URL                  e.g. https://api.yourdomain.com   (must be https)
//   DELYFORGE_ENTITLEMENT_PUBLIC_KEY   base64 public key printed by `pnpm --filter @delyforge/api keys:generate`
//   DELYFORGE_UPDATE_URL               https folder where you upload the installer + latest.yml for auto-updates
// Optional: CSC_LINK + CSC_KEY_PASSWORD (code-signing certificate). `dist:unsigned --allow-unconfigured` makes a local
// test installer without them (it talks to http://localhost:4000 and never auto-updates).
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const allowUnconfigured = process.argv.includes('--allow-unconfigured');
const required = ['DELYFORGE_API_URL', 'DELYFORGE_ENTITLEMENT_PUBLIC_KEY', 'DELYFORGE_UPDATE_URL'];
const missing = required.filter((k) => !process.env[k]);
const notHttps = ['DELYFORGE_API_URL', 'DELYFORGE_UPDATE_URL'].filter((k) => process.env[k] && !process.env[k].startsWith('https://'));

if (!allowUnconfigured && (missing.length || notHttps.length)) {
  if (missing.length) console.error(`Missing: ${missing.join(', ')}`);
  if (notHttps.length) console.error(`Must start with https://: ${notHttps.join(', ')}`);
  console.error('See the comment at the top of apps/desktop/scripts/release.mjs.');
  process.exit(1);
}
if (!process.env.CSC_LINK) console.warn('⚠ No code-signing certificate (CSC_LINK): Windows will show a SmartScreen warning to customers.');

// Personal/test builds update themselves from this PC's installer folder (the app watches it for newer versions).
if (allowUnconfigured) process.env.DELYFORGE_LOCAL_UPDATE_DIR = fileURLToPath(new URL('../release/', import.meta.url));

const run = (cmd, env = process.env) => execSync(cmd, { stdio: 'inherit', env });
run('pnpm --filter @delyforge/shared build');
run('pnpm --filter @delyforge/bot-runtime build');
run('pnpm exec electron-vite build');
// Updates come from GitHub Releases (see electron-builder.yml); upload the .exe, .blockmap and latest.yml to a release.
run('pnpm exec electron-builder --win --publish never');
console.log('\n✔ Installer written to apps/desktop/release/');
