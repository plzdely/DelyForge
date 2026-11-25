import { type GuildInfo, type ModuleConfigs, type ShopCategory, type ShopConfig, type ShopSale, activeSales, parsePriceList, renderPriceList } from '@delyforge/shared';
import { ArrowDown, ArrowUp, FileDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DiscordMessage, DiscordText } from '@/components/builders/discord-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RoleSelect, Section } from './fields';
import { ChannelSelect, NumberField, ToggleRow } from './pickers';

type Props = { c: ShopConfig; set: (c: ShopConfig) => void; guild: GuildInfo; tickets: ModuleConfigs['tickets']; botName: string; avatarUrl: string | null };

/** `p1`, `p2`… the first free one. */
const nextId = (prefix: string, taken: readonly string[]) => {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
};
const DAY = 86_400_000;
/** A datetime-local input works in local time; settings keep Unix milliseconds. */
const toLocal = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fromLocal = (v: string) => (v ? new Date(v).getTime() : NaN);

function saleState(s: ShopSale, now: number): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (now >= s.endsAt) return { label: 'Ended', tone: 'neutral' };
  if (now >= s.startsAt) return { label: 'Running now', tone: 'success' };
  return { label: 'Scheduled', tone: 'warning' };
}

export function ShopForm({ c, set, guild, tickets, botName, avatarUrl }: Props) {
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [previewAt, setPreviewAt] = useState('now');
  const now = Date.now();
  const allItems = c.categories.flatMap((cat) => cat.items);
  const setCategory = (n: number, patch: Partial<ShopCategory>) => set({ ...c, categories: c.categories.map((x, m) => (m === n ? { ...x, ...patch } : x)) });
  const moveCategory = (n: number, by: -1 | 1) => {
    const list = [...c.categories];
    [list[n], list[n + by]] = [list[n + by]!, list[n]!];
    set({ ...c, categories: list });
  };
  const setSale = (n: number, patch: Partial<ShopSale>) => set({ ...c, sales: c.sales.map((x, m) => (m === n ? { ...x, ...patch } : x)) });
  const addSale = (startsAt: number, endsAt: number) =>
    set({ ...c, sales: [...c.sales, { id: nextId('s', c.sales.map((s) => s.id)), name: 'Sale', percentOff: 20, target: 'all', targetIds: [], startsAt, endsAt, announce: true }] });

  const doImport = () => {
    const parsed = parsePriceList(pasted);
    if (!parsed) return void toast.error('No prices found', { description: 'Paste the whole message, with lines like ✦ **Pistol** — `$20`.' });
    // Old sales pointed at the old categories and items, so only "everything" sales are kept.
    set({ ...c, ...parsed, sales: c.sales.filter((s) => s.target === 'all') });
    setImporting(false);
    setPasted('');
    const items = parsed.categories.reduce((n, x) => n + x.items.length, 0);
    toast.success(`Imported ${items} items in ${parsed.categories.length} categories`, { description: 'Check them below, then press Save changes.' });
  };

  const previewSale = c.sales.find((s) => s.id === previewAt);
  const previewTime = previewSale ? Math.max(previewSale.startsAt, Math.min(now, previewSale.endsAt - 1)) : now;
  const messages = renderPriceList(c, previewTime);
  const extraPanels = tickets.extraPanels;

  return (
    <>
      <Section title="Price list" description="The bot posts your list in this channel and edits it by itself whenever prices change or a sale starts or ends. Once it’s posted, delete your old hand-written list.">
        <ChannelSelect id="shop-channel" label="Post the price list in" guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} hint="Best in a channel where only staff can write, so the list stays on top." />
        {importing ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Field label="Paste your current price list" htmlFor="shop-import" hint="In Discord: hover your price list message → ⋯ → Copy Text, then paste it here. This replaces the categories and prices below.">
              <Textarea id="shop-import" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'# 👕 ***CLOTHING***\n✦ **Single Piece** — `$6`'} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setImporting(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!pasted.trim()} onClick={doImport}>
                Import
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={() => setImporting(true)}>
            <FileDown /> Import from an existing Discord message
          </Button>
        )}
        <Field label="Top of the list" htmlFor="shop-header" counter={{ value: c.header.length, max: 1000 }} hint="# makes a big heading, -# makes small grey text.">
          <Textarea id="shop-header" rows={3} maxLength={1000} value={c.header} onChange={(e) => set({ ...c, header: e.target.value })} />
        </Field>
        <Field label="Bottom of the list" htmlFor="shop-footer" counter={{ value: c.footer.length, max: 1000 }} hint="To link a channel, write <#channel ID> (right-click the channel → Copy Channel ID).">
          <Textarea id="shop-footer" rows={2} maxLength={1000} value={c.footer} onChange={(e) => set({ ...c, footer: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_6rem_6rem] gap-3">
          <Field label="Line between sections" htmlFor="shop-divider" hint="Leave empty for none.">
            <Input id="shop-divider" maxLength={200} value={c.divider} onChange={(e) => set({ ...c, divider: e.target.value })} />
          </Field>
          <Field label="Bullet" htmlFor="shop-bullet">
            <Input id="shop-bullet" maxLength={16} value={c.bullet} onChange={(e) => set({ ...c, bullet: e.target.value })} />
          </Field>
          <Field label="Currency" htmlFor="shop-currency">
            <Input id="shop-currency" maxLength={5} value={c.currency} onChange={(e) => set({ ...c, currency: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Prices" description="For a price range like $30-$50 fill in “up to”. Tick “and up” for prices like $20+.">
        {c.categories.map((cat, n) => (
          <div key={cat.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-end gap-2">
              <Field label="Emoji" htmlFor={`shop-cat-emoji-${cat.id}`}>
                <Input id={`shop-cat-emoji-${cat.id}`} className="w-16" maxLength={64} value={cat.emoji} onChange={(e) => setCategory(n, { emoji: e.target.value })} />
              </Field>
              <div className="flex-1">
                <Field label="Category" htmlFor={`shop-cat-name-${cat.id}`}>
                  <Input id={`shop-cat-name-${cat.id}`} maxLength={60} value={cat.name} onChange={(e) => setCategory(n, { name: e.target.value })} />
                </Field>
              </div>
              <Button size="icon" variant="ghost" aria-label="Move category up" disabled={n === 0} onClick={() => moveCategory(n, -1)}>
                <ArrowUp />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Move category down" disabled={n === c.categories.length - 1} onClick={() => moveCategory(n, 1)}>
                <ArrowDown />
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Remove category ${cat.name}`} onClick={() => set({ ...c, categories: c.categories.filter((_, m) => m !== n) })}>
                <Trash2 />
              </Button>
            </div>
            {cat.items.length ? (
              <div className="grid grid-cols-[1fr_6rem_6rem_5rem_auto] gap-2 px-1 text-xs text-fg-subtle">
                <span>Item</span>
                <span>Price</span>
                <span>Up to</span>
                <span>And up</span>
                <span className="w-9" />
              </div>
            ) : null}
            {cat.items.map((item, k) => {
              const setItem = (patch: Partial<typeof item>) => setCategory(n, { items: cat.items.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
              return (
                <div key={item.id} className="grid grid-cols-[1fr_6rem_6rem_5rem_auto] items-center gap-2">
                  <Input aria-label="Item name" maxLength={80} value={item.name} onChange={(e) => setItem({ name: e.target.value })} />
                  <Input aria-label={`Price of ${item.name}`} type="number" min={0} step={0.01} value={item.price} onChange={(e) => setItem({ price: Math.max(0, Number(e.target.value) || 0) })} />
                  <Input
                    aria-label={`Highest price of ${item.name}`}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="—"
                    value={item.priceTo ?? ''}
                    onChange={(e) => setItem({ priceTo: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0), plus: false })}
                  />
                  <input type="checkbox" aria-label={`${item.name} costs this or more`} className="size-4 justify-self-center" checked={item.plus} disabled={item.priceTo !== null} onChange={(e) => setItem({ plus: e.target.checked })} />
                  <Button size="icon" variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => setCategory(n, { items: cat.items.filter((_, j) => j !== k) })}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button
              size="sm"
              variant="ghost"
              disabled={cat.items.length >= 25}
              onClick={() => setCategory(n, { items: [...cat.items, { id: nextId('i', allItems.map((x) => x.id)), name: 'New item', price: 10, priceTo: null, plus: false }] })}
            >
              <Plus /> Add item
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          disabled={c.categories.length >= 15}
          onClick={() => set({ ...c, categories: [...c.categories, { id: nextId('c', c.categories.map((x) => x.id)), emoji: '🛍️', name: 'NEW CATEGORY', items: [] }] })}
        >
          <Plus /> Add category
        </Button>
      </Section>

      <Section title="Orders" description="Members press 🛒 Order under the list, pick an item, describe what they want, and a ticket opens showing the item and its price at that moment (sale and code included).">
        <ToggleRow title="Taking orders" description="Off: the list says “Orders closed” and the Order button is greyed out." checked={c.ordersOpen} onChange={(v) => set({ ...c, ordersOpen: v })} />
        {!c.ordersOpen ? (
          <Field label="Closed message" htmlFor="shop-closed">
            <Input id="shop-closed" maxLength={300} value={c.closedMessage} onChange={(e) => set({ ...c, closedMessage: e.target.value })} />
          </Field>
        ) : null}
        <ToggleRow
          title="Order button"
          description={tickets.enabled ? 'Opens a ticket from the Tickets module.' : 'Turn on the Tickets module too — orders open as tickets.'}
          checked={c.orderButton}
          onChange={(v) => set({ ...c, orderButton: v })}
        />
        {c.orderButton && extraPanels.length ? (
          <Field label="Open orders as" htmlFor="shop-panel" hint="Which ticket panel’s category and staff to use.">
            <Select id="shop-panel" value={c.ticketPanelId} onChange={(e) => set({ ...c, ticketPanelId: e.target.value })}>
              <option value="">Main ticket panel</option>
              {extraPanels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </Section>

      <Section title="Sales" description="Sales start and end by themselves: the list shows ~~old~~ and new prices with a countdown, then goes back to normal. If two sales cover the same item, the bigger discount wins.">
        {c.sales.map((s, n) => {
          const state = saleState(s, now);
          return (
            <div key={s.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Sale name" htmlFor={`shop-sale-name-${s.id}`}>
                    <Input id={`shop-sale-name-${s.id}`} maxLength={60} value={s.name} onChange={(e) => setSale(n, { name: e.target.value })} />
                  </Field>
                </div>
                <NumberField id={`shop-sale-pct-${s.id}`} label="Discount" suffix="% off" min={1} max={95} value={s.percentOff} onChange={(v) => setSale(n, { percentOff: v })} />
                <Badge tone={state.tone} className="mb-2">
                  {state.label}
                </Badge>
                <Button size="icon" variant="ghost" aria-label={`Remove sale ${s.name}`} onClick={() => set({ ...c, sales: c.sales.filter((_, m) => m !== n) })}>
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="On" htmlFor={`shop-sale-target-${s.id}`}>
                  <Select id={`shop-sale-target-${s.id}`} value={s.target} onChange={(e) => setSale(n, { target: e.target.value as ShopSale['target'], targetIds: [] })}>
                    <option value="all">Everything</option>
                    <option value="categories">Some categories</option>
                    <option value="items">Some items</option>
                  </Select>
                </Field>
                <Field label="Starts" htmlFor={`shop-sale-start-${s.id}`}>
                  <Input id={`shop-sale-start-${s.id}`} type="datetime-local" value={toLocal(s.startsAt)} onChange={(e) => Number.isFinite(fromLocal(e.target.value)) && setSale(n, { startsAt: fromLocal(e.target.value) })} />
                </Field>
                <Field label="Ends" htmlFor={`shop-sale-end-${s.id}`}>
                  <Input id={`shop-sale-end-${s.id}`} type="datetime-local" value={toLocal(s.endsAt)} onChange={(e) => Number.isFinite(fromLocal(e.target.value)) && setSale(n, { endsAt: fromLocal(e.target.value) })} />
                </Field>
              </div>
              {s.target !== 'all' ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="What the sale is on">
                  {(s.target === 'categories' ? c.categories.map((x) => ({ id: x.id, name: `${x.emoji} ${x.name}` })) : c.categories.flatMap((x) => x.items.map((i) => ({ id: i.id, name: `${x.emoji} ${i.name}` })))).map((x) => {
                    const on = s.targetIds.includes(x.id);
                    return (
                      <button
                        key={x.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSale(n, { targetIds: on ? s.targetIds.filter((id) => id !== x.id) : [...s.targetIds, x.id] })}
                        className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-primary-border bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg'}`}
                      >
                        {x.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <ToggleRow title="Announce it" description="Posts in the announcement channel below when the sale starts (and pings the sale role)." checked={s.announce} onChange={(v) => setSale(n, { announce: v })} />
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={c.sales.length >= 20} onClick={() => addSale(now, now + 2 * DAY)}>
            <Plus /> Start a sale now
          </Button>
          <Button size="sm" variant="ghost" disabled={c.sales.length >= 20} onClick={() => addSale(new Date(now + DAY).setHours(0, 0, 0, 0), new Date(now + 4 * DAY).setHours(0, 0, 0, 0))}>
            <Plus /> Plan a sale for tomorrow
          </Button>
          {c.sales.some((s) => now >= s.endsAt) ? (
            <Button size="sm" variant="ghost" onClick={() => set({ ...c, sales: c.sales.filter((s) => now < s.endsAt) })}>
              <Trash2 /> Remove ended sales
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ChannelSelect id="shop-announce" label="Announce sales in" emptyLabel="Don’t announce" guild={guild} value={c.announceChannelId} onChange={(v) => set({ ...c, announceChannelId: v })} />
          <RoleSelect id="shop-announce-role" label="Ping this role" hint="Tip: a “Sale alerts” role members pick themselves." guild={guild} value={c.announceRoleId} onChange={(v) => set({ ...c, announceRoleId: v })} />
        </div>
      </Section>

      <Section title="Discount codes" description="Members type a code in the order form; the ticket shows the price with the code taken off (on top of any sale). The Order button only asks for a code when at least one exists.">
        {c.codes.map((code, n) => {
          const setCode = (patch: Partial<typeof code>) => set({ ...c, codes: c.codes.map((x, m) => (m === n ? { ...x, ...patch } : x)) });
          return (
            <div key={n} className="grid grid-cols-[1fr_auto_auto_12rem_auto] items-end gap-2">
              <Field label="Code" htmlFor={`shop-code-${n}`}>
                <Input id={`shop-code-${n}`} maxLength={20} value={code.code} onChange={(e) => setCode({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
              </Field>
              <NumberField id={`shop-code-pct-${n}`} label="Discount" suffix="%" min={1} max={95} value={code.percentOff} onChange={(v) => setCode({ percentOff: v })} />
              <NumberField id={`shop-code-uses-${n}`} label="Max uses" suffix="(0 = no limit)" min={0} max={100000} value={code.maxUses} onChange={(v) => setCode({ maxUses: v })} />
              <Field label="Expires (optional)" htmlFor={`shop-code-end-${n}`}>
                <Input id={`shop-code-end-${n}`} type="datetime-local" value={code.endsAt === null ? '' : toLocal(code.endsAt)} onChange={(e) => setCode({ endsAt: e.target.value ? fromLocal(e.target.value) : null })} />
              </Field>
              <Button size="icon" variant="ghost" aria-label={`Remove code ${code.code}`} onClick={() => set({ ...c, codes: c.codes.filter((_, m) => m !== n) })}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
        <Button size="sm" disabled={c.codes.length >= 25} onClick={() => set({ ...c, codes: [...c.codes, { code: nextId('SAVE', c.codes.map((x) => x.code)), percentOff: 10, maxUses: 0, endsAt: null }] })}>
          <Plus /> Add a code
        </Button>
      </Section>

      <Section title="Vouches" description="Customers use /vouch with 1–5 stars, a review and an optional screenshot; it’s posted as a numbered card. Anyone can also use /price to check what something costs right now.">
        <ChannelSelect id="shop-vouch" label="Post vouches in" emptyLabel="Off (no /vouch command)" guild={guild} value={c.vouchChannelId} onChange={(v) => set({ ...c, vouchChannelId: v })} />
      </Section>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg">Preview</h3>
          {c.sales.length ? (
            <Select aria-label="Preview at" className="w-56" value={previewAt} onChange={(e) => setPreviewAt(e.target.value)}>
              <option value="now">Right now{activeSales(c, now).length ? ' (sale running)' : ''}</option>
              {c.sales.map((s) => (
                <option key={s.id} value={s.id}>
                  During “{s.name}”
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        {c.categories.length ? (
          messages.map((text, n) => (
            <DiscordMessage key={n} botName={botName} avatarUrl={avatarUrl}>
              <DiscordText text={text} />
              {n === messages.length - 1 && c.orderButton && tickets.enabled ? (
                <span className={`mt-2 inline-block rounded px-4 py-1.5 text-sm font-medium text-white ${c.ordersOpen ? 'bg-[#248046]' : 'bg-[#4e5058] opacity-60'}`}>{c.ordersOpen ? '🛒 Order' : '🔴 Orders closed'}</span>
              ) : null}
            </DiscordMessage>
          ))
        ) : (
          <p className="text-xs text-fg-subtle">Add a category or import your list to see it here.</p>
        )}
        {messages.length > 1 ? <p className="text-xs text-fg-subtle">Discord allows 2,000 characters per message, so the list is posted as {messages.length} messages.</p> : null}
      </Card>
    </>
  );
}
