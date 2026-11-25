import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE_CONFIGS,
  type ShopConfig,
  checkShopCode,
  discounted,
  formatPrice,
  parsePriceList,
  renderPriceList,
  saleFor,
  shopConfigSchema,
} from '../src/index.js';

const LIST = `# 💸 ***PRICE LIST***
-# All prices in USD • Custom work is quoted in a ticket
✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦

# 👕 ***CLOTHING***
✦ **Single Piece** — \`$6\`
✦ **Full Fit (Top + Bottom)** — \`$10\`
✦ **Custom Hand Made** — \`$30\`
✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦

# 🔫 ***WEAPONS***
✦ **Pistol** — \`$20\`
✦ **SMG** — \`$30\`
✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦

# 🚗 ***VEHICLES***
✦ **Reskin / Livery** — \`$10\`
✦ **Any Car** — \`$30-$50\`
✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦

# 🔊 ***SOUND PACKS***
✦ **Complex** — \`$20+\`
✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦

-# Final price depends on difficulty • Payment info in <#1575029051288977478> • Open a ticket to order`;

function shop(patch: Partial<ShopConfig> = {}): ShopConfig {
  return { ...DEFAULT_MODULE_CONFIGS.shop, ...parsePriceList(LIST)!, enabled: true, ...patch };
}

describe('shop: importing a price list', () => {
  it('reads categories, items, ranges and "and up" prices', () => {
    const p = parsePriceList(LIST)!;
    expect(p.categories.map((c) => [c.emoji, c.name, c.items.length])).toEqual([
      ['👕', 'CLOTHING', 3],
      ['🔫', 'WEAPONS', 2],
      ['🚗', 'VEHICLES', 2],
      ['🔊', 'SOUND PACKS', 1],
    ]);
    expect(p.categories[0]!.items[1]).toMatchObject({ name: 'Full Fit (Top + Bottom)', price: 10, priceTo: null, plus: false });
    expect(p.categories[2]!.items[1]).toMatchObject({ name: 'Any Car', price: 30, priceTo: 50 });
    expect(p.categories[3]!.items[0]).toMatchObject({ price: 20, plus: true });
    expect(p.currency).toBe('$');
    expect(p.bullet).toBe('✦');
    expect(p.divider).toBe('✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦');
    expect(p.header).toBe('# 💸 ***PRICE LIST***\n-# All prices in USD • Custom work is quoted in a ticket');
    expect(p.footer).toContain('<#1575029051288977478>');
    // Item IDs are unique across the whole shop (sales can target single items).
    const ids = p.categories.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(shopConfigSchema.safeParse(shop()).success).toBe(true);
  });

  it('returns null for text without prices', () => {
    expect(parsePriceList('# Hello\njust words')).toBeNull();
  });

  it('renders back to the same layout when nothing is on sale', () => {
    const text = renderPriceList(shop(), 0).join('\n\n');
    expect(text).toContain('# 🔫 ***WEAPONS***\n✦ **Pistol** — `$20`\n✦ **SMG** — `$30`\n✦ ･ﾟ: *✧･ﾟ:* ✦ *:･ﾟ✧*:･ﾟ ✦');
    expect(text).toContain('✦ **Any Car** — `$30-$50`');
    expect(text).toContain('-# 🟢 Orders open');
  });
});

describe('shop: sales', () => {
  const now = 1_000_000;
  const sale = (patch: Partial<ShopConfig['sales'][number]> = {}) => ({ id: 's1', name: 'Black Friday', percentOff: 20, target: 'all' as const, targetIds: [], startsAt: now - 1, endsAt: now + 60_000, announce: false, ...patch });

  it('strikes the old price and shows the sale price while it runs', () => {
    const c = shop({ sales: [sale()] });
    const text = renderPriceList(c, now).join('\n\n');
    expect(text).toContain('✦ **Pistol** — ~~$20~~ `$16` 🔥');
    expect(text).toContain('✦ **Single Piece** — ~~$6~~ `$4.80` 🔥');
    expect(text).toContain('✦ **Any Car** — ~~$30-$50~~ `$24-$40` 🔥');
    expect(text).toContain('BLACK FRIDAY — 20% OFF EVERYTHING');
    expect(text).toContain(`<t:${Math.floor((now + 60_000) / 1000)}:R>`);
    // Before and after the sale, the normal prices are back.
    expect(renderPriceList(c, now - 10).join()).not.toContain('~~');
    expect(renderPriceList(c, now + 60_000).join()).not.toContain('~~');
  });

  it('only discounts the chosen categories or items, and the best sale wins', () => {
    const p = parsePriceList(LIST)!;
    const weapons = p.categories[1]!.id;
    const pistol = p.categories[1]!.items[0]!.id;
    const c = shop({ sales: [sale({ target: 'categories', targetIds: [weapons] }), sale({ id: 's2', percentOff: 50, target: 'items', targetIds: [pistol] })] });
    expect(saleFor(c, weapons, pistol, now)?.percentOff).toBe(50);
    expect(saleFor(c, weapons, p.categories[1]!.items[1]!.id, now)?.percentOff).toBe(20);
    expect(saleFor(c, p.categories[0]!.id, p.categories[0]!.items[0]!.id, now)).toBeNull();
  });

  it('rejects a sale that ends before it starts', () => {
    expect(shopConfigSchema.safeParse(shop({ sales: [sale({ endsAt: now - 5 })] })).success).toBe(false);
  });

  it('rounds to the cent and stacks a code on top of a sale', () => {
    expect(discounted(5.1, 20)).toBe(4.08);
    expect(formatPrice('$', { price: 20, priceTo: null, plus: true }, 20, 10)).toBe('$14.40+');
  });
});

describe('shop: discount codes and message size', () => {
  const codes = [{ code: 'SAVE10', percentOff: 10, maxUses: 2, endsAt: 500 }];
  it('checks codes: unknown, expired, used up', () => {
    expect(checkShopCode(codes, ' save10 ', 0, 100)).toMatchObject({ ok: true });
    expect(checkShopCode(codes, 'NOPE', 0, 100).ok).toBe(false);
    expect(checkShopCode(codes, 'SAVE10', 0, 500).ok).toBe(false);
    expect(checkShopCode(codes, 'SAVE10', 2, 100).ok).toBe(false);
  });

  it('splits a long list into messages Discord accepts', () => {
    const big = shop({
      categories: Array.from({ length: 10 }, (_, n) => ({ id: `c${n}`, emoji: '🔫', name: `CATEGORY ${n}`, items: Array.from({ length: 20 }, (_, m) => ({ id: `i${n}x${m}`, name: `A fairly long item name ${m}`, price: 20, priceTo: null, plus: false })) })),
    });
    const messages = renderPriceList(big, 0);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((m) => m.length <= 2000)).toBe(true);
    expect(messages.join('\n\n')).toContain('CATEGORY 9');
  });
});
