import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotStore } from '@delyforge/bot-runtime/store';
import { describe, expect, it } from 'vitest';
import { MembersService } from '../src/main/members-service';

const APP = '100000000000000009';
const G = '100000000000000001';
const U = '200000000000000002';

describe('MembersService', () => {
  it('reads and changes the data the bot wrote, by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'df-members-'));
    const bot = BotStore.open(dir, APP); // what the running bot does
    bot.addWarning(G, U, '300000000000000003', 'spam');
    bot.addWarning(G, U, '300000000000000003', 'rude');
    bot.rememberName(G, U, 'Dely');
    bot.addXp(G, U, 420, 0, 0);
    bot.close();

    const svc = new MembersService(dir, { get: () => ({ discordApplicationId: APP }) as never });
    const data = svc.data('b', G);
    expect(data.warnings).toHaveLength(2);
    expect(data.warnings[0]).toMatchObject({ userName: 'Dely', moderatorName: null, reason: 'rude' });
    expect(data.levels[0]).toMatchObject({ name: 'Dely', xp: 420 });

    svc.deleteWarning('b', G, data.warnings[0]!.id);
    expect(() => svc.deleteWarning('b', G, data.warnings[0]!.id)).toThrow(/already removed/);
    expect(svc.clearWarnings('b', G, U)).toBe(1);
    expect(svc.resetXp('b', G, null)).toBe(1);
    expect(svc.data('b', G)).toEqual({ warnings: [], levels: [] });
  });

  it('asks to connect the bot first', () => {
    const svc = new MembersService(mkdtempSync(join(tmpdir(), 'df-members-')), { get: () => ({ discordApplicationId: null }) as never });
    expect(() => svc.data('b', G)).toThrow(/Connect this bot/);
  });
});
