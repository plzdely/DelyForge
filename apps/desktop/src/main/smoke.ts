import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, app } from 'electron';
import { PERSONAL_EDITION } from '@delyforge/shared';
import type { Logger } from './logger';

export interface SmokeHooks {
  /**
   * Launches a REAL bot runtime process for the given bot with a deliberately fake token and reports what happened.
   * Proves the utility process, discord.js loading, protocol and error handling all work inside Electron.
   */
  runtimeProbe(botId: string): Promise<{ launched: boolean; errorCode: string | null }>;
}

/**
 * Automated desktop smoke test (`pnpm test:smoke`): drives the real app like a user, checks every screen renders
 * without console errors, saves screenshots, then exits with code 0 (pass) or 1 (fail).
 */
export async function runSmokeTest(win: BrowserWindow, outDir: string, logger: Logger, hooks: SmokeHooks): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const failures: string[] = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') failures.push(`console error: ${details.message}`);
  });

  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = () => sleep(500); // let animations & paint settle
  const capture = async (name: string) => writeFileSync(join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const waitForReady = async (route: string) => {
    for (let i = 0; i < 50; i++) {
      if (await js<boolean>(`document.querySelector('[data-route-ready="${route}"]') !== null`)) return true;
      await sleep(200);
    }
    return false;
  };
  const visit = async (route: string, shot?: string) => {
    await js(`window.location.hash = '#${route}'`);
    if (!(await waitForReady(route))) failures.push(`route ${route} did not render`);
    await settle();
    if (shot) await capture(shot);
  };
  const fill = (selector: string, value: string, proto = 'HTMLInputElement') =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  const loaded = () =>
    new Promise<void>((resolve) => {
      if (!win.webContents.isLoading()) resolve();
      else win.webContents.once('did-finish-load', () => resolve());
    });

  try {
    // Hidden windows are not repainted by Chromium, so show it (without stealing focus) to get real screenshots.
    win.showInactive();
    await loaded();

    await visit('/', 'dashboard');
    await visit('/settings', 'settings');
    await visit('/subscription', 'subscription');
    await visit('/bots', 'bots-empty');
    await visit('/monitoring', 'monitoring-empty');
    await visit('/notifications', 'notifications-empty');

    // ── Create a bot through the real form ──────────────────────────────────────────────────────────────────────
    await visit('/bots/new', 'bots-new');
    await fill('#bot-name', 'Aurora');
    await fill('#bot-description', 'Moderation, welcome messages and leveling for the Aurora gaming community.', 'HTMLTextAreaElement');
    await fill('#bot-group', 'Gaming');
    await js(`document.querySelector('[data-testid="create-bot-submit"]').click()`);
    let botId = '';
    for (let i = 0; i < 50 && !botId; i++) {
      await sleep(100);
      const m = /^#\/bots\/([0-9a-f-]{36})$/.exec(await js<string>('window.location.hash'));
      if (m) botId = m[1]!;
    }
    if (!botId) throw new Error('creating a bot through the form did not open its page');
    if (!(await waitForReady(`/bots/${botId}`))) failures.push('bot overview did not render');
    await settle();
    await capture('bot-overview-unconnected');

    // ── Rename through the settings form ────────────────────────────────────────────────────────────────────────
    await visit(`/bots/${botId}/settings`, 'bot-settings');
    await fill('#bot-name', 'Aurora Prime');
    await sleep(100);
    await js(`[...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent.includes('Save changes')).click()`);
    await sleep(600);
    const renamed = await js<string | false>(`window.delyforge.bots.get('${botId}').then((r) => r.ok && r.data.name)`);
    if (renamed !== 'Aurora Prime') failures.push(`renaming via the form failed (got ${String(renamed)})`);

    // ── Modules: tab and sidebar pages render (needs a real server to configure) ─────────────────────────────────
    await visit(`/bots/${botId}/modules`, 'bot-modules-unconnected');
    await visit('/modules', 'modules-index');
    await visit('/modules/welcome', 'module-directory');
    await visit('/templates', 'templates');
    await visit('/account', 'account-signed-out');
    await visit('/builders/commands', 'builder-directory');
    await visit('/builders/ai', 'ai-builder');
    await visit('/marketplace', 'marketplace');
    await visit('/analytics', 'analytics');
    await visit('/team', 'team-signed-out');
    await visit(`/bots/${botId}/commands`, 'bot-commands-empty');
    await visit(`/bots/${botId}/embeds`, 'bot-embeds-locked');
    await visit(`/bots/${botId}/automations`, 'bot-automations-unconnected');

    // Command builder: create a command through the UI and save it.
    await visit(`/bots/${botId}/commands`);
    await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('New command')).click()`);
    await sleep(300);
    await fill('#cmd-name', 'welcome-info');
    await sleep(100);
    await js(`document.querySelector('[data-testid="builders-save"]').click()`);
    await sleep(800);
    await capture('bot-commands-editor');
    const savedCommands = await js<string | false>(`window.delyforge.builders.get('${botId}').then((r) => r.ok && r.data.commands.map((c) => c.name).join(','))`);
    if (savedCommands !== 'welcome-info') failures.push(`command builder did not save (got ${String(savedCommands)})`);

    // ── Connect wizard: friendly error for a common paste mistake (no network needed) ───────────────────────────
    await visit(`/bots/${botId}/connect`, 'connect-step1');
    await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('I have an application')).click()`);
    await sleep(300);
    await fill('#bot-token', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    await js(`document.querySelector('[data-testid="verify-token"]').click()`);
    await sleep(300);
    const wizardError = await js<string>(`document.querySelector('#bot-token-error')?.textContent ?? ''`);
    if (!/Client Secret/.test(wizardError)) failures.push(`wizard did not explain a Client Secret paste (got "${wizardError}")`);
    await capture('connect-step2-error');

    // ── Main process refuses to start an unconnected bot; plan limit still enforced ─────────────────────────────
    const startRefused = await js<string | false>(`window.delyforge.runtime.start('${botId}').then((r) => !r.ok && r.error.code)`);
    if (startRefused !== 'VALIDATION_FAILED') failures.push(`starting an unconnected bot was not refused (got ${String(startRefused)})`);
    const second = await js<{ ok: true; id: string } | { ok: false; code: string }>(
      `window.delyforge.bots.create({ name: 'Second' }).then((r) => (r.ok ? { ok: true, id: r.data.id } : { ok: false, code: r.error.code }))`,
    );
    if (PERSONAL_EDITION) {
      // No limits in the personal edition: a second bot is allowed (removed again so later steps see one bot).
      if (second.ok) await js(`window.delyforge.bots.remove('${second.id}')`);
      else failures.push(`personal edition refused a second bot (${second.code})`);
    } else if (second.ok || second.code !== 'LIMIT_REACHED') {
      failures.push(`plan limit not enforced (got ${second.ok ? 'created' : second.code})`);
    }

    // ── Real bot process with a fake token ──────────────────────────────────────────────────────────────────────
    const probe = await hooks.runtimeProbe(botId);
    if (!probe.launched) failures.push('bot runtime process did not launch');
    if (probe.errorCode !== 'INVALID_TOKEN' && probe.errorCode !== 'LOGIN_FAILED') {
      failures.push(`fake token should be rejected by Discord or fail offline (got ${String(probe.errorCode)})`);
    }
    logger.info('Runtime probe result', probe);
    await visit(`/bots/${botId}/console`, 'bot-console');
    const consoleText = await js<string>(`document.querySelector('[role="log"]')?.textContent ?? ''`);
    if (!/Connecting to Discord/.test(consoleText)) failures.push('runtime log lines did not reach the console');
    await visit('/notifications', 'notifications');
    await visit('/bots', 'bots-list');
    await visit('/monitoring', 'monitoring');
    await visit('/', 'dashboard-with-bot');

    // ── Settings persist through IPC → SQLite → reload ──────────────────────────────────────────────────────────
    const saved = await js<string | false>(`window.delyforge.settings.update({ theme: 'light' }).then((r) => r.ok && r.data.theme)`);
    if (saved !== 'light') failures.push('settings update via IPC failed');
    const rejected = await js<string | false>(`window.delyforge.settings.update({ theme: 'neon' }).then((r) => !r.ok && r.error.code)`);
    if (rejected !== 'VALIDATION_FAILED') failures.push('invalid settings payload was not rejected');
    await js(`window.location.hash = '#/'`);
    win.webContents.reload();
    await sleep(300);
    await loaded();
    if (!(await waitForReady('/'))) failures.push('dashboard did not render after reload');
    const theme = await js<string>('document.documentElement.dataset.theme');
    if (theme !== 'light') failures.push(`theme did not persist across reload (got ${theme})`);
    await settle();
    await capture('dashboard-light');
  } catch (err) {
    failures.push(`smoke test crashed: ${(err as Error).message}`);
  }

  if (failures.length) logger.error('Smoke test failed', failures);
  else logger.info('Smoke test passed');
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
  app.exit(failures.length === 0 ? 0 : 1);
}
