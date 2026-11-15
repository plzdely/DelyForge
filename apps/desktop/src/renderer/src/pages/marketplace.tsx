import { LISTING_TYPE_NAMES, type ListingSummary, type ListingType, MODULES, hasFeature, lowestPlanWithFeature } from '@delyforge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search, Star, Store } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useAccount } from '@/lib/account';
import { call } from '@/lib/bridge';
import { builderKeys, useBuilders } from '@/lib/builders';
import { useEntitlements } from '@/lib/entitlements';
import { moduleKeys, useGuilds } from '@/lib/modules';
import { useBots } from '@/lib/queries';

const keys = {
  list: (f: object) => ['market', 'list', f] as const,
  detail: (slug: string) => ['market', 'detail', slug] as const,
  developer: ['market', 'developer'] as const,
  mine: ['market', 'mine'] as const,
  queue: ['market', 'queue'] as const,
};
const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;
const errorToast = (title: string) => (e: Error) => toast.error(title, { description: e.message });

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-fg-muted tabular-nums" aria-label={`${value.toFixed(1)} out of 5`}>
      <Star className="size-3.5 fill-warning text-warning" /> {value ? value.toFixed(1) : '–'}
    </span>
  );
}

// ─── Browse ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function InstallBox({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const signedIn = useAccount().data?.signedIn ?? false;
  const allowed = hasFeature(useEntitlements(), 'marketplace.access');
  const bots = (useBots().data ?? []).filter((b) => b.hasToken);
  const [botId, setBotId] = useState('');
  const activeBot = botId || bots[0]?.id || '';
  const guilds = useGuilds(activeBot, Boolean(activeBot) && signedIn && allowed);
  const [guildId, setGuildId] = useState('');
  const guild = (guilds.data ?? []).find((g) => g.id === guildId) ?? guilds.data?.[0];
  const install = useMutation({
    mutationFn: () => call((b) => b.marketplace.install({ slug, id: activeBot, guildId: guild!.id })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: moduleKeys.modules(activeBot) });
      void qc.invalidateQueries({ queryKey: builderKeys.builders(activeBot) });
      void qc.invalidateQueries({ queryKey: keys.detail(slug) });
      toast.success('Installed', { description: 'Open the bot’s Modules and Commands tabs to choose channels and fine-tune it.' });
    },
    onError: errorToast('Couldn’t install'),
  });

  if (!signedIn) return <p className="text-xs text-fg-muted"><Link to="/account" className="text-primary hover:underline">Sign in</Link> to install.</p>;
  if (!allowed) {
    return (
      <p className="text-xs text-fg-muted">
        Installing is included in {lowestPlanWithFeature('marketplace.access')?.name ?? 'Pro'}. <Link to="/subscription" className="text-primary hover:underline">View plans</Link>
      </p>
    );
  }
  if (!bots.length) return <p className="text-xs text-fg-muted">Connect a bot to Discord first.</p>;
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
      <Field label="Bot" htmlFor="mk-bot">
        <Select id="mk-bot" value={activeBot} onChange={(e) => (setBotId(e.target.value), setGuildId(''))}>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Server" htmlFor="mk-guild">
        <Select id="mk-guild" value={guild?.id ?? ''} onChange={(e) => setGuildId(e.target.value)} disabled={!guilds.data?.length}>
          {(guilds.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
      </Field>
      <Button variant="primary" disabled={!guild || install.isPending} onClick={() => install.mutate()}>
        <Download /> Install
      </Button>
    </div>
  );
}

function ReviewForm({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState('5');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => call((b) => b.marketplace.review({ slug, rating: Number(rating), body })),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: keys.detail(slug) });
      toast.success('Thanks for your review');
    },
    onError: errorToast('Couldn’t save your review'),
  });
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-end gap-2">
      <Field label="Your rating" htmlFor="mk-rating">
        <Select id="mk-rating" value={rating} onChange={(e) => setRating(e.target.value)}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>{'★'.repeat(n)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Review (optional)" htmlFor="mk-review">
        <Input id="mk-review" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Button disabled={send.isPending} onClick={() => send.mutate()}>Post</Button>
    </div>
  );
}

function DetailDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const account = useAccount().data;
  const signedIn = account?.signedIn ?? false;
  const staff = account?.profile?.role === 'ADMIN' || account?.profile?.role === 'SUPPORT';
  const hide = useMutation({
    mutationFn: (id: string) => call((b) => b.admin.setReviewHidden({ id, hidden: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.detail(slug) }),
    onError: errorToast('Couldn’t hide the review'),
  });
  const { data: l, error } = useQuery({ queryKey: keys.detail(slug), queryFn: () => call((b) => b.marketplace.detail(slug)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={l?.title ?? 'Loading…'} description={l ? `${LISTING_TYPE_NAMES[l.type]} by ${l.developer} · v${l.version} · reviewed and signed by DelyForge` : undefined} className="max-w-2xl">
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {l ? (
        <div className="space-y-4 text-sm">
          <p className="text-fg">{l.summary}</p>
          {l.description ? <p className="whitespace-pre-wrap text-fg-muted">{l.description}</p> : null}
          <div className="flex flex-wrap gap-1">
            {l.contents.modules.map((m) => <Badge key={m}>{moduleName(m)}</Badge>)}
            {l.contents.commands.map((c) => <Badge key={c}><span className="font-mono">{c}</span></Badge>)}
            {l.contents.embeds ? <Badge>{l.contents.embeds} embed{l.contents.embeds === 1 ? '' : 's'}</Badge> : null}
            {l.contents.workflows.map((w) => <Badge key={w}>{w}</Badge>)}
          </div>
          {l.changelog ? <p className="text-xs text-fg-subtle">What’s new: {l.changelog}</p> : null}
          <InstallBox slug={slug} />
          <section>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-fg-muted">
              Reviews <Stars value={l.ratingAvg} /> <span className="text-fg-subtle">({l.ratingCount})</span>
            </h4>
            {signedIn ? <ReviewForm slug={slug} /> : null}
            <ul className="mt-3 space-y-2">
              {l.reviews.map((r) => (
                <li key={r.id} className="text-xs">
                  <span className="text-warning">{'★'.repeat(r.rating)}</span> <span className="font-medium text-fg">{r.author}</span>
                  {staff ? <Button size="sm" variant="ghost" onClick={() => hide.mutate(r.id)}>Hide</Button> : null}
                  {r.body ? <p className="text-fg-muted">{r.body}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}

function BrowseTab() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'ALL' | ListingType>('ALL');
  const [sort, setSort] = useState<'popular' | 'rating' | 'new'>('popular');
  const [open, setOpen] = useState<string | null>(null);
  const filter = { ...(type === 'ALL' ? {} : { type }), ...(q.trim() ? { q: q.trim() } : {}), sort };
  const list = useQuery({ queryKey: keys.list(filter), queryFn: () => call((b) => b.marketplace.list(filter)), retry: false });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input aria-label="Search the marketplace" placeholder="Search…" className="h-8 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          ariaLabel="Type"
          value={type}
          onChange={setType}
          options={[{ value: 'ALL' as const, label: 'All' }, ...Object.entries(LISTING_TYPE_NAMES).map(([value, label]) => ({ value: value as ListingType, label }))]}
        />
        <Select aria-label="Sort" className="ml-auto h-8 w-40" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="popular">Most installed</option>
          <option value="rating">Top rated</option>
          <option value="new">Newest</option>
        </Select>
      </div>
      {list.error ? (
        <Card><EmptyState icon={Store} title="The marketplace couldn’t be reached" description={list.error.message} /></Card>
      ) : !list.isLoading && !list.data?.length ? (
        <Card><EmptyState icon={Store} title="Nothing here yet" description="Packs appear here once DelyForge has reviewed them." /></Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {(list.data ?? []).map((l: ListingSummary) => (
            <button key={l.slug} type="button" onClick={() => setOpen(l.slug)} className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover/50 focus-visible:outline-2 focus-visible:outline-primary">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-fg">{l.title}</h3>
                <Badge>{LISTING_TYPE_NAMES[l.type]}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{l.summary}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-fg-subtle">
                <Stars value={l.ratingAvg} />
                <span className="tabular-nums">{l.downloads} installs</span>
                <span className="ml-auto truncate">{l.developer}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {open ? <DetailDialog slug={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

// ─── Publish ────────────────────────────────────────────────────────────────────────────────────────────────────────

function DeveloperSignup() {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const create = useMutation({
    mutationFn: () => call((b) => b.marketplace.becomeDeveloper({ displayName, slug })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.developer }),
    onError: errorToast('Couldn’t create your profile'),
  });
  return (
    <Card>
      <CardHeader title="Become a marketplace developer" description="Share commands and embeds you built. Every version is reviewed by DelyForge before it’s public." />
      <CardBody className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="Display name" htmlFor="dev-name"><Input id="dev-name" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Profile address" htmlFor="dev-slug" hint="lowercase-letters-and-dashes"><Input id="dev-slug" maxLength={32} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></Field>
        <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>Create profile</Button>
      </CardBody>
    </Card>
  );
}

const STATUS_TONE = { PUBLISHED: 'success', IN_REVIEW: 'primary', REJECTED: 'danger', SUSPENDED: 'danger', DRAFT: 'neutral', APPROVED: 'success', PENDING: 'primary' } as const;

function SubmitForm() {
  const qc = useQueryClient();
  const bots = useBots().data ?? [];
  const [botId, setBotId] = useState('');
  const activeBot = botId || bots[0]?.id || '';
  const builders = useBuilders(activeBot);
  const [commandIds, setCommandIds] = useState<string[]>([]);
  const [embedIds, setEmbedIds] = useState<string[]>([]);
  const [f, setF] = useState({ slug: '', title: '', summary: '', description: '', category: 'Utility', tags: '', version: '1.0.0', changelog: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const submit = useMutation({
    mutationFn: () =>
      call((b) =>
        b.marketplace.submit({
          id: activeBot,
          commandIds,
          embedIds,
          listing: { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5) },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.mine });
      toast.success('Submitted for review', { description: 'You’ll see the result under “Your listings”.' });
    },
    onError: errorToast('Couldn’t submit'),
  });

  return (
    <Card className="mt-4">
      <CardHeader title="Submit a pack" description="Pick commands and embeds from one of your bots. To publish a new version, use the same address with a higher version number." />
      <CardBody className="space-y-3">
        <Field label="From bot" htmlFor="sub-bot">
          <Select id="sub-bot" value={activeBot} onChange={(e) => (setBotId(e.target.value), setCommandIds([]), setEmbedIds([]))}>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-muted">Commands</legend>
            {(builders.data?.commands ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={commandIds.includes(c.id)} onChange={() => setCommandIds(toggle(commandIds, c.id))} />
                <span className="font-mono text-xs">{c.type === 'slash' ? `/${c.name}` : c.name}</span>
              </label>
            ))}
            {!builders.data?.commands.length ? <p className="text-xs text-fg-subtle">No custom commands on this bot.</p> : null}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-muted">Embeds</legend>
            {(builders.data?.embeds ?? []).map((e) => (
              <label key={e.id} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={embedIds.includes(e.id)} onChange={() => setEmbedIds(toggle(embedIds, e.id))} />
                <span className="text-xs">{e.name}</span>
              </label>
            ))}
            {!builders.data?.embeds.length ? <p className="text-xs text-fg-subtle">No saved embeds on this bot.</p> : null}
          </fieldset>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" htmlFor="sub-title"><Input id="sub-title" maxLength={60} value={f.title} onChange={set('title')} /></Field>
          <Field label="Address" htmlFor="sub-slug" hint="lowercase-letters-and-dashes"><Input id="sub-slug" maxLength={48} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
        </div>
        <Field label="Short summary" htmlFor="sub-summary"><Input id="sub-summary" maxLength={160} value={f.summary} onChange={set('summary')} /></Field>
        <Field label="Description" htmlFor="sub-desc"><Textarea id="sub-desc" rows={3} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category" htmlFor="sub-cat"><Input id="sub-cat" maxLength={30} value={f.category} onChange={set('category')} /></Field>
          <Field label="Tags (comma separated)" htmlFor="sub-tags"><Input id="sub-tags" value={f.tags} onChange={set('tags')} /></Field>
          <Field label="Version" htmlFor="sub-ver"><Input id="sub-ver" value={f.version} onChange={set('version')} /></Field>
        </div>
        <Field label="What’s new (optional)" htmlFor="sub-log"><Input id="sub-log" maxLength={1000} value={f.changelog} onChange={set('changelog')} /></Field>
        <Button variant="primary" disabled={submit.isPending || !activeBot} onClick={() => submit.mutate()}>Submit for review</Button>
      </CardBody>
    </Card>
  );
}

function PublishTab() {
  const developer = useQuery({ queryKey: keys.developer, queryFn: () => call((b) => b.marketplace.developer()) });
  const mine = useQuery({ queryKey: keys.mine, queryFn: () => call((b) => b.marketplace.mine()), enabled: Boolean(developer.data) });
  if (developer.isLoading) return null;
  if (developer.error) return <p className="text-sm text-danger">{developer.error.message}</p>;
  if (!developer.data) return <DeveloperSignup />;
  return (
    <>
      <Card>
        <CardHeader title="Your listings" description={`Publishing as ${developer.data.displayName}`} />
        <CardBody>
          {!mine.data?.length ? <p className="text-sm text-fg-subtle">Nothing submitted yet.</p> : null}
          <ul className="space-y-2 text-sm">
            {(mine.data ?? []).map((l) => (
              <li key={l.slug}>
                <span className="font-medium text-fg">{l.title}</span> <Badge tone={STATUS_TONE[l.status]}>{l.status.replace('_', ' ').toLowerCase()}</Badge>
                <ul className="mt-1 space-y-0.5 pl-4 text-xs text-fg-muted">
                  {l.versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} — <Badge tone={STATUS_TONE[v.reviewStatus]}>{v.reviewStatus.toLowerCase()}</Badge>
                      {v.reviewNotes ? <span> · {v.reviewNotes}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <SubmitForm />
    </>
  );
}

// ─── Staff review ───────────────────────────────────────────────────────────────────────────────────────────────────

function QueueTab() {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: keys.queue, queryFn: () => call((b) => b.marketplace.queue()) });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (input: { versionId: string; approve: boolean }) => call((b) => b.marketplace.moderate({ ...input, notes: notes[input.versionId] ?? '' })),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: keys.queue });
      toast.success(v.approve ? 'Approved and signed' : 'Rejected');
    },
    onError: errorToast('Couldn’t save the decision'),
  });
  if (queue.error) return <p className="text-sm text-danger">{queue.error.message}</p>;
  if (queue.data && !queue.data.length) return <Card><EmptyState icon={Store} title="Nothing to review" description="New submissions appear here." /></Card>;
  return (
    <div className="space-y-3">
      {(queue.data ?? []).map((item) => (
        <Card key={item.versionId}>
          <CardHeader title={`${item.title} v${item.version}`} description={`${LISTING_TYPE_NAMES[item.type]} by ${item.developer} · ${new Date(item.submittedAt).toLocaleString()}`} />
          <CardBody className="space-y-3">
            {/* Staff see the full package as data before signing it. */}
            <pre className="max-h-64 overflow-auto rounded-lg bg-bg-subtle p-3 text-2xs text-fg-muted" data-selectable>{JSON.stringify(item.content, null, 2)}</pre>
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Field label="Notes for the developer" htmlFor={`n-${item.versionId}`}>
                <Input id={`n-${item.versionId}`} value={notes[item.versionId] ?? ''} onChange={(e) => setNotes({ ...notes, [item.versionId]: e.target.value })} />
              </Field>
              <Button variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ versionId: item.versionId, approve: true })}>Approve & sign</Button>
              <Button disabled={decide.isPending} onClick={() => decide.mutate({ versionId: item.versionId, approve: false })}>Reject</Button>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function MarketplacePage() {
  const account = useAccount().data;
  const staff = account?.profile?.role === 'ADMIN' || account?.profile?.role === 'SUPPORT';
  const [tab, setTab] = useState<'browse' | 'publish' | 'queue'>('browse');
  const tabs = [
    { value: 'browse' as const, label: 'Browse' },
    ...(account?.signedIn ? [{ value: 'publish' as const, label: 'Publish' }] : []),
    ...(staff ? [{ value: 'queue' as const, label: 'Review queue' }] : []),
  ];
  return (
    <Page route="/marketplace">
      <PageHeader
        title="Marketplace"
        description="Command packs, embed packs and templates from the community — every version reviewed and signed by DelyForge."
        actions={tabs.length > 1 ? <Segmented ariaLabel="Section" value={tab} onChange={setTab} options={tabs} /> : null}
      />
      {tab === 'publish' && account?.signedIn ? <PublishTab /> : tab === 'queue' && staff ? <QueueTab /> : <BrowseTab />}
    </Page>
  );
}
