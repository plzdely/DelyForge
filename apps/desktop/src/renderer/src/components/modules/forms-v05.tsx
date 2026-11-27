import type { GuildInfo, ModuleConfigs } from '@delyforge/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RoleSelect, RoleValueRows, Section, TemplateField } from './fields';
import { PanelFields } from './forms';
import { ChannelSelect, NumberField, RoleChecklist, ToggleRow } from './pickers';

type Props<K extends keyof ModuleConfigs> = { c: ModuleConfigs[K]; set: (c: ModuleConfigs[K]) => void; guild: GuildInfo };

const nextId = (prefix: string, taken: readonly string[]) => {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
};

// ─── Modmail ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function ModmailForm({ c, set, guild }: Props<'modmail'>) {
  return (
    <>
      <Section title="Where conversations go" description="Members DM the bot. Each conversation becomes a thread in this channel — make it a channel only staff can see. Staff reply by typing in the thread; messages starting with // stay between staff.">
        <ChannelSelect id="mm-channel" label="Modmail channel" kinds={['text']} guild={guild} value={c.channelId} onChange={(v) => set({ ...c, channelId: v })} />
        <Field label="Staff roles" htmlFor="mm-staff" hint="Can use /modmail open, close, block and unblock (Manage Messages always can).">
          <RoleChecklist guild={guild} value={c.staffRoleIds} onChange={(ids) => set({ ...c, staffRoleIds: ids })} />
        </Field>
        <ToggleRow title="Ping the staff roles" description="When a new conversation starts." checked={c.pingStaff} onChange={(v) => set({ ...c, pingStaff: v })} />
        <ToggleRow title="Anonymous replies" description="Replies show as “Staff Team” instead of the staff member’s name." checked={c.anonymous} onChange={(v) => set({ ...c, anonymous: v })} />
      </Section>
      <Section title="Messages to the member" description="Needs Message Content Intent switched on in the Developer Portal, so the bot can read DMs and staff replies.">
        <TemplateField id="mm-greet" label="When they start a conversation" max={1000} value={c.greeting} onChange={(v) => set({ ...c, greeting: v })} variables={[]} />
        <TemplateField id="mm-close" label="When staff close it" max={1000} value={c.closingMessage} onChange={(v) => set({ ...c, closingMessage: v })} variables={[]} />
      </Section>
      <Section title="Closing and records">
        <NumberField id="mm-auto" label="Close conversations after" suffix="hours without messages (0 = never)" min={0} max={720} value={c.autoCloseHours} onChange={(v) => set({ ...c, autoCloseHours: v })} />
        <ChannelSelect id="mm-log" label="Save transcripts in" emptyLabel="Don’t save transcripts" guild={guild} value={c.logChannelId} onChange={(v) => set({ ...c, logChannelId: v })} />
      </Section>
      <Section title="Snippets" description="Saved replies staff send with /modmail snippet (e.g. rules, “we’ll get back to you”).">
        {c.snippets.map((s, n) => (
          <div key={n} className="grid grid-cols-[10rem_1fr_auto] items-start gap-2">
            <Input aria-label="Snippet name" maxLength={32} value={s.name} onChange={(e) => set({ ...c, snippets: c.snippets.map((x, i) => (i === n ? { ...x, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') } : x)) })} />
            <Input aria-label="Snippet text" maxLength={2000} value={s.text} onChange={(e) => set({ ...c, snippets: c.snippets.map((x, i) => (i === n ? { ...x, text: e.target.value } : x)) })} />
            <Button size="icon" variant="ghost" aria-label={`Remove snippet ${s.name}`} onClick={() => set({ ...c, snippets: c.snippets.filter((_, i) => i !== n) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button size="sm" disabled={c.snippets.length >= 25} onClick={() => set({ ...c, snippets: [...c.snippets, { name: nextId('reply', c.snippets.map((s) => s.name)), text: 'Thanks for reaching out — a staff member will look into this shortly.' }] })}>
          <Plus /> Add a snippet
        </Button>
      </Section>
    </>
  );
}

// ─── Applications ─────────────────────────────────────────────────────────────────────────────────────────────────

const APP_VARIABLES = [
  { key: '{user}', description: 'Mentions the applicant' },
  { key: '{user.name}', description: 'Their display name' },
  { key: '{server}', description: 'Server name' },
  { key: '{reason}', description: 'The reason staff gave (deny only)' },
] as const;

export function ApplicationsForm({ c, set, guild }: Props<'applications'>) {
  type Form = (typeof c.forms)[number];
  const update = (n: number, patch: Partial<Form>) => set({ ...c, forms: c.forms.map((f, i) => (i === n ? { ...f, ...patch } : f)) });
  return (
    <>
      {c.forms.map((f, n) => (
        <Card key={f.id} className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">{f.name || 'Application'} application</h3>
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => set({ ...c, forms: c.forms.filter((_, i) => i !== n) })}>
              <Trash2 /> Remove
            </Button>
          </div>
          <Field label="Name" htmlFor={`app-name-${f.id}`}>
            <Input id={`app-name-${f.id}`} maxLength={40} value={f.name} onChange={(e) => update(n, { name: e.target.value })} />
          </Field>
          <PanelFields prefix={`app-${f.id}`} p={f.panel} set={(panel) => update(n, { panel })} guild={guild} note="Members press the button here to apply." />
          <ChannelSelect id={`app-review-${f.id}`} label="Send answers for review to" hint="A staff-only channel. Each application gets Accept and Deny buttons." guild={guild} value={f.reviewChannelId} onChange={(v) => update(n, { reviewChannelId: v })} />
          <Field label="Reviewers" htmlFor={`app-rev-${f.id}`} hint="Can accept or deny (Manage Server always can).">
            <RoleChecklist guild={guild} value={f.reviewerRoleIds} onChange={(ids) => update(n, { reviewerRoleIds: ids })} />
          </Field>
          <Field label="Questions" htmlFor={`app-q-${f.id}`} hint="Discord’s pop-up holds up to 5 questions of 45 characters.">
            <div className="space-y-2">
              {f.questions.map((q, k) => {
                const setQ = (patch: Partial<typeof q>) => update(n, { questions: f.questions.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                return (
                  <div key={k} className="grid grid-cols-[1fr_9rem_auto_auto] items-center gap-2">
                    <Input aria-label={`Question ${k + 1}`} maxLength={45} value={q.label} onChange={(e) => setQ({ label: e.target.value })} />
                    <Select aria-label="Answer length" value={q.style} onChange={(e) => setQ({ style: e.target.value as 'short' | 'paragraph' })}>
                      <option value="short">Short answer</option>
                      <option value="paragraph">Long answer</option>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <input type="checkbox" className="size-4" checked={q.required} onChange={(e) => setQ({ required: e.target.checked })} /> Required
                    </label>
                    <Button size="icon" variant="ghost" aria-label={`Remove question ${k + 1}`} disabled={f.questions.length <= 1} onClick={() => update(n, { questions: f.questions.filter((_, j) => j !== k) })}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
              {f.questions.length < 5 ? (
                <Button size="sm" variant="ghost" onClick={() => update(n, { questions: [...f.questions, { label: 'New question', style: 'paragraph', required: true }] })}>
                  <Plus /> Add a question
                </Button>
              ) : null}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <RoleSelect id={`app-role-${f.id}`} label="Give this role when accepted" assignableOnly guild={guild} value={f.acceptRoleId} onChange={(v) => update(n, { acceptRoleId: v })} />
            <RoleSelect id={`app-rm-${f.id}`} label="Take this role when accepted" assignableOnly guild={guild} value={f.removeRoleId} onChange={(v) => update(n, { removeRoleId: v })} />
          </div>
          <TemplateField id={`app-acc-${f.id}`} label="DM when accepted" max={1000} value={f.acceptMessage} onChange={(v) => update(n, { acceptMessage: v })} variables={APP_VARIABLES} />
          <TemplateField id={`app-den-${f.id}`} label="DM when denied" max={1000} value={f.denyMessage} onChange={(v) => update(n, { denyMessage: v })} variables={APP_VARIABLES} />
          <NumberField id={`app-cool-${f.id}`} label="Can apply again after" suffix="hours (0 = straight away)" hint="Counted from the decision. Nobody can have two applications waiting at once." min={0} max={720} value={f.cooldownHours} onChange={(v) => update(n, { cooldownHours: v })} />
          <ToggleRow title="Discussion thread" description="Opens a thread on each application so staff can talk about it." checked={f.thread} onChange={(v) => update(n, { thread: v })} />
          <ToggleRow title="Accepting applications" description="Off: the button says “Applications closed”." checked={f.open} onChange={(v) => update(n, { open: v })} />
          <ToggleRow title="Ping reviewers" description="Mention the reviewer roles when a new application comes in." checked={f.pingReviewers} onChange={(v) => update(n, { pingReviewers: v })} />
          <NumberField id={`app-age-${f.id}`} label="Account at least" suffix="days old (0 = any)" min={0} max={365} value={f.minAccountAgeDays} onChange={(v) => update(n, { minAccountAgeDays: v })} />
        </Card>
      ))}
      {c.forms.length < 10 ? (
        <Button
          onClick={() =>
            set({
              ...c,
              forms: [
                ...c.forms,
                {
                  id: nextId('f', c.forms.map((f) => f.id)),
                  name: 'Staff',
                  panel: { channelId: null, title: 'Staff applications', description: 'Want to join the team? Press the button and answer a few questions.', buttonLabel: 'Apply', color: '#7c5cff' },
                  reviewChannelId: null,
                  reviewerRoleIds: [],
                  questions: [
                    { label: 'How old are you?', style: 'short', required: true },
                    { label: 'Why do you want to join the team?', style: 'paragraph', required: true },
                    { label: 'How many hours a week can you help?', style: 'short', required: true },
                  ],
                  acceptRoleId: null,
                  removeRoleId: null,
                  acceptMessage: 'Congratulations {user.name}! Your application in {server} was accepted. 🎉',
                  denyMessage: 'Thanks for applying to {server}, {user.name}. Unfortunately it wasn’t accepted this time.',
                  cooldownHours: 72,
                  thread: false,
                  open: true,
                  minAccountAgeDays: 0,
                  pingReviewers: true,
                },
              ],
            })
          }
        >
          <Plus /> Add an application form
        </Button>
      ) : null}
    </>
  );
}

// ─── Economy ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function EconomyForm({ c, set, guild }: Props<'economy'>) {
  return (
    <>
      <Section title="Currency" description="Coins are kept per server in the bot’s own data. Staff can use /eco give, take, set and reset.">
        <div className="grid grid-cols-[1fr_6rem_auto] gap-3">
          <Field label="Name" htmlFor="eco-name">
            <Input id="eco-name" maxLength={20} value={c.currencyName} onChange={(e) => set({ ...c, currencyName: e.target.value })} />
          </Field>
          <Field label="Emoji" htmlFor="eco-emoji">
            <Input id="eco-emoji" maxLength={64} value={c.currencyEmoji} onChange={(e) => set({ ...c, currencyEmoji: e.target.value })} />
          </Field>
          <NumberField id="eco-start" label="Starting coins" min={0} max={1_000_000_000} value={c.startingBalance} onChange={(v) => set({ ...c, startingBalance: v })} />
        </div>
      </Section>
      <Section title="Earning" description="/daily once a day (claiming again within 48 h keeps the streak), /work on a cooldown, and coins for chatting.">
        <div className="grid grid-cols-3 gap-3">
          <NumberField id="eco-daily" label="Daily coins" min={0} max={1_000_000_000} value={c.daily.amount} onChange={(v) => set({ ...c, daily: { ...c.daily, amount: v } })} />
          <NumberField id="eco-streak" label="Extra per streak day" min={0} max={1_000_000} value={c.daily.streakBonus} onChange={(v) => set({ ...c, daily: { ...c.daily, streakBonus: v } })} />
          <NumberField id="eco-streak-max" label="Longest streak" suffix="days" min={1} max={365} value={c.daily.maxStreak} onChange={(v) => set({ ...c, daily: { ...c.daily, maxStreak: v } })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <NumberField id="eco-work-min" label="Work pays from" min={0} max={1_000_000_000} value={c.work.min} onChange={(v) => set({ ...c, work: { ...c.work, min: v } })} />
          <NumberField id="eco-work-max" label="up to" min={0} max={1_000_000_000} value={c.work.max} onChange={(v) => set({ ...c, work: { ...c.work, max: v } })} />
          <NumberField id="eco-work-cd" label="Every" suffix="minutes" min={1} max={1440} value={c.work.cooldownMinutes} onChange={(v) => set({ ...c, work: { ...c.work, cooldownMinutes: v } })} />
        </div>
        <ToggleRow title="Coins for chatting" description={`${c.chat.min}–${c.chat.max} coins for a message, at most once every ${c.chat.cooldownSeconds} seconds.`} checked={c.chat.enabled} onChange={(v) => set({ ...c, chat: { ...c.chat, enabled: v } })} />
        {c.chat.enabled ? (
          <div className="grid grid-cols-3 gap-3">
            <NumberField id="eco-chat-min" label="From" min={0} max={1_000_000} value={c.chat.min} onChange={(v) => set({ ...c, chat: { ...c.chat, min: v } })} />
            <NumberField id="eco-chat-max" label="up to" min={0} max={1_000_000} value={c.chat.max} onChange={(v) => set({ ...c, chat: { ...c.chat, max: v } })} />
            <NumberField id="eco-chat-cd" label="Every" suffix="seconds" min={10} max={3600} value={c.chat.cooldownSeconds} onChange={(v) => set({ ...c, chat: { ...c.chat, cooldownSeconds: v } })} />
          </div>
        ) : null}
      </Section>
      <Section title="Robbing" description="/rob tries to take coins from someone’s wallet. Coins in the bank (/deposit) are safe.">
        <ToggleRow title="Allow /rob" checked={c.rob.enabled} onChange={(v) => set({ ...c, rob: { ...c.rob, enabled: v } })} />
        {c.rob.enabled ? (
          <div className="grid grid-cols-3 gap-3">
            <NumberField id="rob-chance" label="Works" suffix="% of the time" min={1} max={90} value={c.rob.successPercent} onChange={(v) => set({ ...c, rob: { ...c.rob, successPercent: v } })} />
            <NumberField id="rob-steal" label="Takes up to" suffix="% of their wallet" min={1} max={100} value={c.rob.maxStealPercent} onChange={(v) => set({ ...c, rob: { ...c.rob, maxStealPercent: v } })} />
            <NumberField id="rob-fine" label="Caught: pays" suffix="% of own wallet" min={0} max={100} value={c.rob.finePercent} onChange={(v) => set({ ...c, rob: { ...c.rob, finePercent: v } })} />
            <NumberField id="rob-cd" label="Every" suffix="minutes" min={1} max={1440} value={c.rob.cooldownMinutes} onChange={(v) => set({ ...c, rob: { ...c.rob, cooldownMinutes: v } })} />
            <NumberField id="rob-min" label="Victim needs at least" suffix="coins" min={0} max={1_000_000_000} value={c.rob.minWallet} onChange={(v) => set({ ...c, rob: { ...c.rob, minWallet: v } })} />
          </div>
        ) : null}
      </Section>
      <Section title="Gambling" description="/coinflip doubles the bet or loses it; /slots pays 1.5× for two of a kind and up to 25× for three diamonds.">
        <ToggleRow title="Allow /coinflip and /slots" checked={c.gambling.enabled} onChange={(v) => set({ ...c, gambling: { ...c.gambling, enabled: v } })} />
        {c.gambling.enabled ? <NumberField id="eco-maxbet" label="Biggest bet" suffix="coins" min={1} max={1_000_000_000} value={c.gambling.maxBet} onChange={(v) => set({ ...c, gambling: { ...c.gambling, maxBet: v } })} /> : null}
      </Section>
      <Section title="More ways to earn" description="/beg every 10 minutes for a few coins; /crime every 2 hours — 45% chance of big pay, otherwise a fine.">
        <ToggleRow title="Allow /beg" checked={c.beg} onChange={(v) => set({ ...c, beg: v })} />
        <ToggleRow title="Allow /crime" checked={c.crime} onChange={(v) => set({ ...c, crime: v })} />
        <NumberField id="eco-interest" label="Daily bank interest" suffix="% (0 = none)" hint="Paid once a day to everyone’s bank balance — a reason to /deposit." min={0} max={10} value={c.interestPercent} onChange={(v) => set({ ...c, interestPercent: v })} />
        <Field label="Pay boosts" htmlFor="eco-boost" hint="Members with these roles earn more from /daily, /work and /crime (the biggest counts).">
          <RoleValueRows id="eco-boost" guild={guild} rows={c.payMultipliers.map((p) => ({ roleId: p.roleId, value: p.multiplier }))} onChange={(rows) => set({ ...c, payMultipliers: rows.map((r) => ({ roleId: r.roleId, multiplier: r.value })) })} valueLabel="Boost" min={1} max={5} choices={[1.5, 2, 3].map((v) => ({ value: v, label: `${v}×` }))} addLabel="Add a pay boost" maxRows={10} defaultValue={2} />
        </Field>
      </Section>
      <Section title="Coin shop" description="Members see it with /shopitems and buy with /buy. An item can give a role (the bot refunds if it can’t), or just sit in their /inventory.">
        {c.shop.map((s, n) => {
          const setS = (patch: Partial<typeof s>) => set({ ...c, shop: c.shop.map((x, i) => (i === n ? { ...x, ...patch } : x)) });
          return (
            <div key={s.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                <Field label="Item" htmlFor={`eco-item-${s.id}`}>
                  <Input id={`eco-item-${s.id}`} maxLength={40} value={s.name} onChange={(e) => setS({ name: e.target.value })} />
                </Field>
                <NumberField id={`eco-price-${s.id}`} label="Price" min={1} max={1_000_000_000} value={s.price} onChange={(v) => setS({ price: v })} />
                <Button size="icon" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => set({ ...c, shop: c.shop.filter((_, i) => i !== n) })}>
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <RoleSelect id={`eco-role-${s.id}`} label="Gives role (optional)" assignableOnly guild={guild} value={s.roleId} onChange={(v) => setS({ roleId: v })} />
                <Field label="Description (optional)" htmlFor={`eco-desc-${s.id}`}>
                  <Input id={`eco-desc-${s.id}`} maxLength={100} value={s.description} onChange={(e) => setS({ description: e.target.value })} />
                </Field>
              </div>
            </div>
          );
        })}
        <Button size="sm" disabled={c.shop.length >= 25} onClick={() => set({ ...c, shop: [...c.shop, { id: nextId('i', c.shop.map((x) => x.id)), name: 'VIP', price: 5000, roleId: null, description: '' }] })}>
          <Plus /> Add an item
        </Button>
      </Section>
    </>
  );
}

// ─── Counting & games ─────────────────────────────────────────────────────────────────────────────────────────────

export function GamesForm({ c, set, guild }: Props<'games'>) {
  const t = c.trivia;
  return (
    <>
      <Section title="Counting" description="Members count up one number at a time. The bot reacts ✅ (🎉 every 100) and keeps a record; /count shows the next number and top counters. Needs Message Content Intent.">
        <ChannelSelect id="count-channel" label="Counting channel" emptyLabel="Off" kinds={['text']} guild={guild} value={c.counting.channelId} onChange={(v) => set({ ...c, counting: { ...c.counting, channelId: v } })} />
        {c.counting.channelId ? (
          <>
            <ToggleRow title="No counting twice in a row" description="The same person can’t post two numbers after each other." checked={c.counting.noDoubleCount} onChange={(v) => set({ ...c, counting: { ...c.counting, noDoubleCount: v } })} />
            <Field label="When someone gets it wrong" htmlFor="count-fail">
              <Select id="count-fail" value={c.counting.onFail} onChange={(e) => set({ ...c, counting: { ...c.counting, onFail: e.target.value as 'reset' | 'delete' } })}>
                <option value="reset">Start again from 1 (the classic way)</option>
                <option value="delete">Just delete the wrong number</option>
              </Select>
            </Field>
          </>
        ) : null}
      </Section>
      <Section title="Trivia" description="/trivia posts a question with four buttons; the first right answer wins. Over 50 questions are built in.">
        <ToggleRow title="Allow /trivia" checked={t.enabled} onChange={(v) => set({ ...c, trivia: { ...t, enabled: v } })} />
        {t.enabled ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumberField id="triv-sec" label="Time to answer" suffix="seconds" min={10} max={120} value={t.seconds} onChange={(v) => set({ ...c, trivia: { ...t, seconds: v } })} />
              <NumberField id="triv-reward" label="Prize" suffix="coins (needs Economy)" min={0} max={1_000_000} value={t.reward} onChange={(v) => set({ ...c, trivia: { ...t, reward: v } })} />
            </div>
            {t.custom.map((q, n) => {
              const setQ = (patch: Partial<typeof q>) => set({ ...c, trivia: { ...t, custom: t.custom.map((x, i) => (i === n ? { ...x, ...patch } : x)) } });
              return (
                <div key={n} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={`Your question ${n + 1}`} htmlFor={`triv-q-${n}`}>
                        <Input id={`triv-q-${n}`} maxLength={200} value={q.question} onChange={(e) => setQ({ question: e.target.value })} />
                      </Field>
                    </div>
                    <Button size="icon" variant="ghost" aria-label="Remove question" onClick={() => set({ ...c, trivia: { ...t, custom: t.custom.filter((_, i) => i !== n) } })}>
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Input aria-label="Right answer" placeholder="Right answer" maxLength={80} value={q.correct} onChange={(e) => setQ({ correct: e.target.value })} className="border-success/50" />
                    {[0, 1, 2].map((k) => (
                      <Input
                        key={k}
                        aria-label={`Wrong answer ${k + 1}`}
                        placeholder={`Wrong answer ${k + 1}`}
                        maxLength={80}
                        value={q.wrong[k] ?? ''}
                        onChange={(e) => {
                          const wrong = [...q.wrong];
                          wrong[k] = e.target.value;
                          setQ({ wrong: wrong.filter((w, j) => w.trim() || j === 0) });
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <Button size="sm" disabled={t.custom.length >= 100} onClick={() => set({ ...c, trivia: { ...t, custom: [...t.custom, { question: 'What is our server’s mascot?', correct: 'A fox', wrong: ['A cat', 'A dog', 'A bird'] }] } })}>
              <Plus /> Add your own question
            </Button>
          </>
        ) : null}
      </Section>
      <Section title="Fun commands">
        <ToggleRow title="/rps and /8ball" description="Rock-paper-scissors against the bot, and the magic 8-ball." checked={c.fun} onChange={(v) => set({ ...c, fun: v })} />
      </Section>
    </>
  );
}
