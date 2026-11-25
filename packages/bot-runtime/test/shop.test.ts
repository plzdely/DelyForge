import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODULE_CONFIGS, type ModuleConfigs, type ShopConfig } from '@delyforge/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { desiredCommands } from '../src/modules/commands.js';
import { CID, desiredPanels } from '../src/modules/panels.js';
import { BotStore } from '../src/store.js';

const C = '123456789012345678';
const base = DEFAULT_MODULE_CONFIGS;
const shop = (patch: Partial<ShopConfig> = {}): ShopConfig => ({
  ...base.shop,
  enabled: true,
  channelId: C,
  categories: [{ id: 'c1', emoji: '🔫', name: 'WEAPONS', items: [{ id: 'i1', name: 'Pistol', price: 20, priceTo: null, plus: false }] }],
  ...patch,
});
const config = (s: ShopConfig, ticketsOn = true): ModuleConfigs => ({ ...base, shop: s, tickets: { ...base.tickets, enabled: ticketsOn } });
const shopPanels = (c: ModuleConfigs, now = 0) => desiredPanels(c, now).filter((p) => p.key.startsWith('shop:'));
const button = (p: ReturnType<typeof shopPanels>[number]) => (p.payload.components?.[0] as { components: { custom_id: string; disabled?: boolean }[] } | undefined)?.components[0];

describe('shop price list', () => {
  it('posts the list as text with an Order button (only when Tickets is on)', () => {
    const [panel] = shopPanels(config(shop()));
    expect(panel!.payload.content).toContain('**Pistol** — `$20`');
    expect(button(panel!)).toMatchObject({ custom_id: CID.shopOrder });
    expect(button(shopPanels(config(shop(), false))[0]!)).toBeUndefined();
    expect(button(shopPanels(config(shop({ ordersOpen: false })))[0]!)).toMatchObject({ disabled: true });
  });

  it('changes when a sale starts and ends, so the bot edits the message', () => {
    const c = config(shop({ sales: [{ id: 's1', name: 'Sale', percentOff: 25, target: 'all', targetIds: [], startsAt: 1000, endsAt: 2000, announce: false }] }));
    const before = shopPanels(c, 999)[0]!.hash;
    const during = shopPanels(c, 1500)[0]!;
    expect(during.hash).not.toBe(before);
    expect(during.payload.content).toContain('~~$20~~ `$15`');
    expect(shopPanels(c, 2000)[0]!.hash).toBe(before);
  });

  it('adds /price, and /vouch only when a vouch channel is set', () => {
    const names = (c: ModuleConfigs) => desiredCommands(c).map((x) => x.name);
    expect(names(config(shop()))).toContain('price');
    expect(names(config(shop()))).not.toContain('vouch');
    expect(names(config(shop({ vouchChannelId: C })))).toContain('vouch');
    expect(names(base)).not.toContain('price');
  });
});

describe('shop counters', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  it('counts per server and key (code uses, one announcement per sale)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'df-shop-'));
    dirs.push(dir);
    const s = BotStore.open(dir, '1');
    expect(s.shopCount('g', 'code:SAVE')).toBe(0);
    expect(s.bumpShopCount('g', 'code:SAVE')).toBe(1);
    expect(s.bumpShopCount('g', 'code:SAVE')).toBe(2);
    expect(s.bumpShopCount('h', 'code:SAVE')).toBe(1);
    s.close();
  });
});
