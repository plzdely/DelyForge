import { describe, expect, it } from 'vitest';
import { waitForDiscordAnswer } from '../src/main/discord-link';

const PORT = 53990;

describe('waitForDiscordAnswer', () => {
  it('ignores other requests and hands back Discord’s code and state once', async () => {
    const { ready, answer } = waitForDiscordAnswer({ port: PORT });
    await ready;
    expect((await fetch(`http://127.0.0.1:${PORT}/something-else?code=x&state=y`)).status).toBe(404);
    const page = await fetch(`http://127.0.0.1:${PORT}/discord-callback?code=abc&state=xyz`);
    expect(await page.text()).toContain('Almost done');
    await expect(answer).resolves.toEqual({ code: 'abc', state: 'xyz' });
    await expect(fetch(`http://127.0.0.1:${PORT}/discord-callback?code=again&state=again`)).rejects.toThrow(); // stopped listening
  });

  it('reports a cancel on Discord as an error', async () => {
    const { ready, answer } = waitForDiscordAnswer({ port: PORT });
    await ready;
    await fetch(`http://127.0.0.1:${PORT}/discord-callback?error=access_denied`);
    await expect(answer).rejects.toThrow('cancelled');
  });
});
