import type { ShopCategory, ShopCode, ShopConfig, ShopItem, ShopSale } from './modules.js';

/**
 * Shop maths and the price-list text, shared by the bot (which posts it) and the app (which previews it).
 * Everything here is pure: the same settings and time always give the same text.
 */

/** Sales running at `now`. */
export function activeSales(c: Pick<ShopConfig, 'sales'>, now: number): ShopSale[] {
  return c.sales.filter((s) => s.startsAt <= now && now < s.endsAt);
}

function covers(s: ShopSale, categoryId: string, itemId: string): boolean {
  return s.target === 'all' || s.targetIds.includes(s.target === 'categories' ? categoryId : itemId);
}

/** The biggest running sale on an item, or null. Sales don't add up — the best one wins. */
export function saleFor(c: Pick<ShopConfig, 'sales'>, categoryId: string, itemId: string, now: number): ShopSale | null {
  return activeSales(c, now)
    .filter((s) => covers(s, categoryId, itemId))
    .reduce<ShopSale | null>((best, s) => (!best || s.percentOff > best.percentOff ? s : best), null);
}

/** `amount` minus `percent`%, to the cent. */
export function discounted(amount: number, percent: number): number {
  return Math.round(amount * (100 - percent)) / 100;
}

export function formatMoney(currency: string, amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${currency}${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

/** "$20", "$30-$50" or "$20+", after taking off each percentage in turn (a sale, then a code). */
export function formatPrice(currency: string, item: Pick<ShopItem, 'price' | 'priceTo' | 'plus'>, ...percents: number[]): string {
  const f = (n: number) => formatMoney(currency, percents.reduce((v, p) => (p ? discounted(v, p) : v), n));
  return item.priceTo !== null ? `${f(item.price)}-${f(item.priceTo)}` : `${f(item.price)}${item.plus ? '+' : ''}`;
}

const ts = (ms: number, style: 'R' | 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** "everything", "Weapons, Chains" or "Pistol, SMG and 2 more". */
export function saleTargetLabel(c: Pick<ShopConfig, 'categories'>, s: ShopSale): string {
  if (s.target === 'all') return 'everything';
  const names =
    s.target === 'categories'
      ? c.categories.filter((x) => s.targetIds.includes(x.id)).map((x) => x.name)
      : c.categories.flatMap((x) => x.items).filter((x) => s.targetIds.includes(x.id)).map((x) => x.name);
  if (!names.length) return 'selected items';
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

export function itemLine(c: ShopConfig, category: ShopCategory, item: ShopItem, now: number): string {
  const sale = saleFor(c, category.id, item.id, now);
  const bullet = c.bullet.trim() ? `${c.bullet.trim()} ` : '';
  const price = sale ? `~~${formatPrice(c.currency, item)}~~ \`${formatPrice(c.currency, item, sale.percentOff)}\` 🔥` : `\`${formatPrice(c.currency, item)}\``;
  return `${bullet}**${item.name}** — ${price}`;
}

/** The whole price list as sections (header, sale banners, one per category, footer). */
export function priceListSections(c: ShopConfig, now: number): string[] {
  const divider = c.divider.trim();
  const withDivider = (text: string) => [text, divider].filter(Boolean).join('\n');
  const sections: string[] = [];
  if (c.header.trim()) sections.push(withDivider(c.header.trim()));

  const banner: string[] = [];
  if (!c.ordersOpen) banner.push('## 🔴 ***ORDERS CLOSED***', ...(c.closedMessage.trim() ? [c.closedMessage.trim()] : []));
  for (const s of activeSales(c, now)) {
    banner.push(`## 🔥 ***${s.name.toUpperCase()} — ${s.percentOff}% OFF ${saleTargetLabel(c, s).toUpperCase()}***`, `-# Ends ${ts(s.endsAt, 'R')} (${ts(s.endsAt, 'f')})`);
  }
  if (c.ordersOpen) banner.push('-# 🟢 Orders open');
  sections.push(banner.join('\n'));

  for (const cat of c.categories) {
    const heading = `# ${cat.emoji.trim() ? `${cat.emoji.trim()} ` : ''}***${cat.name}***`;
    sections.push(withDivider([heading, ...cat.items.map((item) => itemLine(c, cat, item, now))].join('\n')));
  }
  if (c.footer.trim()) sections.push(c.footer.trim());
  return sections;
}

/** Joins pieces with `sep` into messages of at most `max` characters (a piece that's too long on its own is cut). */
function pack(pieces: string[], sep: string, max: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of pieces.map((p) => (p.length > max ? `${p.slice(0, max - 1)}…` : p))) {
    if (!current) current = piece;
    else if (current.length + sep.length + piece.length <= max) current += sep + piece;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The price list split into Discord messages (2,000 characters each), keeping categories whole where possible. */
export function renderPriceList(c: ShopConfig, now: number, max = 2000): string[] {
  const pieces = priceListSections(c, now).flatMap((s) => (s.length <= max ? [s] : pack(s.split('\n'), '\n', max)));
  return pack(pieces, '\n\n', max);
}

/** Finds an item by ID, with its category. */
export function findShopItem(c: Pick<ShopConfig, 'categories'>, itemId: string): { category: ShopCategory; item: ShopItem } | null {
  for (const category of c.categories) {
    const item = category.items.find((x) => x.id === itemId);
    if (item) return { category, item };
  }
  return null;
}

/** Checks a discount code someone typed. `uses` = how often it was used so far. */
export function checkShopCode(codes: readonly ShopCode[], typed: string, uses: number, now: number): { ok: true; code: ShopCode } | { ok: false; message: string } {
  const code = codes.find((x) => x.code === typed.trim().toUpperCase());
  if (!code) return { ok: false, message: 'That discount code doesn’t exist.' };
  if (code.endsAt !== null && now >= code.endsAt) return { ok: false, message: 'That discount code has expired.' };
  if (code.maxUses && uses >= code.maxUses) return { ok: false, message: 'That discount code has been used up.' };
  return { ok: true, code };
}

// ─── Import an existing price list ────────────────────────────────────────────────────────────────────────────────

const HEADING = /^#{1,3}\s+(.+)$/;
// "✦ **Pistol** — `$20`", "**Any Car** - $30-$50", "• **Complex** — `$20+`"
const ITEM = /^\s*(?:([^\s*]+)\s+)?\*\*(.+?)\*\*\s*[—–:-]+\s*`?\s*([^\d\s`.]{0,3})\s*(\d+(?:\.\d{1,2})?)\s*(?:-\s*[^\d\s`]{0,3}\s*(\d+(?:\.\d{1,2})?))?\s*(\+)?\s*`?\s*$/u;

/** "👕 ***CLOTHING***" → emoji 👕, name CLOTHING. */
function parseHeading(text: string): { emoji: string; name: string } {
  const clean = text.replace(/[*_~]/g, '').trim();
  const m = /^(\S+)\s+(.+)$/u.exec(clean);
  if (m && (/^<a?:\w+:\d+>$/.test(m[1]!) || !/[\p{L}\p{N}]/u.test(m[1]!))) return { emoji: m[1]!, name: m[2]!.trim() };
  return { emoji: '', name: clean };
}

/**
 * Reads a price list written in Discord (headings with **bold** items and prices) into shop settings, so it doesn't
 * have to be typed in again. Returns null when no priced items were found.
 */
export function parsePriceList(text: string): Pick<ShopConfig, 'header' | 'divider' | 'footer' | 'currency' | 'bullet' | 'categories'> | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const isItem = (l: string) => ITEM.test(l);
  const isHeading = (l: string) => HEADING.test(l.trim());

  // The divider is a decorative line that repeats.
  const counts = new Map<string, number>();
  for (const l of lines.map((x) => x.trim())) if (l && !isItem(l) && !isHeading(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const divider = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const nextContent = (from: number) => {
    for (let j = from; j < lines.length; j++) if (lines[j]!.trim()) return lines[j]!;
    return '';
  };
  const categories: ShopCategory[] = [];
  const header: string[] = [];
  const footer: string[] = [];
  let current: ShopCategory | null = null;
  let currency = '';
  let bullet = '';
  let itemCount = 0;

  for (const [n, raw] of lines.entries()) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading && isItem(nextContent(n + 1))) {
      if (categories.length >= 15) break;
      current = { id: `c${categories.length + 1}`, ...parseHeading(heading[1]!), items: [] };
      current.name = current.name.slice(0, 60) || 'Category';
      categories.push(current);
      footer.length = 0;
      continue;
    }
    const item = ITEM.exec(line);
    if (item && current) {
      if (current.items.length < 25) {
        const [, b, name, cur, from, to, plus] = item;
        currency ||= cur ?? '';
        bullet ||= b ?? '';
        current.items.push({ id: `i${++itemCount}`, name: name!.trim().slice(0, 80), price: Number(from), priceTo: to ? Number(to) : null, plus: !!plus });
      }
      continue;
    }
    if (!line || line === divider) {
      if (line === divider) current = null;
      continue;
    }
    if (!categories.length) header.push(line);
    else {
      current = null;
      footer.push(line);
    }
  }
  if (!itemCount) return null;
  return { header: header.join('\n').slice(0, 1000), divider: divider.slice(0, 200), footer: footer.join('\n').slice(0, 1000), currency: (currency || '$').slice(0, 5), bullet: bullet.slice(0, 16), categories };
}
