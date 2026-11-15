import { type BotTemplate, MODULES, TEMPLATES, hasFeature, isImplementedModule, lowestPlanWithFeature } from '@delyforge/shared';
import { Bot, ChevronRight, LayoutTemplate, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BotIdentityAvatar } from '@/components/bots/bot-avatar';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useApplyTemplate } from '@/lib/builders';
import { useEntitlements } from '@/lib/entitlements';
import { useGuilds } from '@/lib/modules';
import { useBots } from '@/lib/queries';
import { RoadmapPage } from './roadmap';

const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;

function ApplyDialog({ template, onClose }: { template: BotTemplate; onClose: () => void }) {
  const navigate = useNavigate();
  const bots = (useBots().data ?? []).filter((b) => b.hasToken);
  const [botId, setBotId] = useState(bots[0]?.id ?? '');
  const guilds = useGuilds(botId, Boolean(botId));
  const [guildId, setGuildId] = useState('');
  const apply = useApplyTemplate();
  const guild = (guilds.data ?? []).find((g) => g.id === guildId) ?? guilds.data?.[0];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Use “${template.name}”`}
      description="Its modules replace this server’s settings for those modules, and its commands are added. Afterwards, pick the channels for each module."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!botId || !guild || apply.isPending}
            onClick={() =>
              guild &&
              apply.mutate(
                { id: botId, guildId: guild.id, templateId: template.id },
                {
                  onSuccess: () => {
                    toast.success(`Applied “${template.name}”`, { description: 'Now choose channels for each module.' });
                    onClose();
                    navigate(`/bots/${botId}/modules?server=${guild.id}`);
                  },
                  onError: (e) => toast.error('Could not apply template', { description: e.message }),
                },
              )
            }
          >
            Apply template
          </Button>
        </>
      }
    >
      {bots.length === 0 ? (
        <p className="text-sm text-fg-muted">Connect a bot to Discord first — templates are applied to one of its servers.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Bot" htmlFor="tpl-bot">
            <Select id="tpl-bot" value={botId} onChange={(e) => setBotId(e.target.value)}>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Server" htmlFor="tpl-guild" hint={guilds.isLoading ? 'Loading servers…' : !guilds.data?.length ? 'Invite the bot to a server first.' : undefined}>
            <Select id="tpl-guild" value={guild?.id ?? ''} onChange={(e) => setGuildId(e.target.value)} disabled={!guilds.data?.length}>
              {(guilds.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function TemplatesPage() {
  const entitlements = useEntitlements();
  const [category, setCategory] = useState('All');
  const [using, setUsing] = useState<BotTemplate | null>(null);
  const categories = ['All', ...new Set(TEMPLATES.map((t) => t.category))];
  const list = TEMPLATES.filter((t) => category === 'All' || t.category === category);

  return (
    <Page route="/templates">
      <PageHeader title="Bot Templates" description="Start from a ready-made setup, then customize anything." />
      <Segmented ariaLabel="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} className="mb-4" />
      <div className="grid grid-cols-2 gap-3">
        {list.map((t) => {
          const locked = !hasFeature(entitlements, t.feature);
          const modules = Object.keys(t.modules).filter(isImplementedModule);
          return (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">{t.name}</h3>
                <Badge>{t.category}</Badge>
                {locked ? (
                  <Badge tone="primary">
                    <Lock /> {lowestPlanWithFeature(t.feature)?.name}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 flex-1 text-xs text-fg-muted">{t.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {modules.map((m) => (
                  <span key={m} className="rounded border border-border px-1.5 py-px text-2xs text-fg-subtle">
                    {moduleName(m)}
                  </span>
                ))}
                {t.commands.map((c) => (
                  <span key={c.name} className="rounded border border-border px-1.5 py-px font-mono text-2xs text-fg-subtle">
                    /{c.name}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                {locked ? (
                  <Button size="sm" asChild>
                    <Link to="/subscription">View plans</Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => setUsing(t)}>
                    Use template
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {using ? <ApplyDialog template={using} onClose={() => setUsing(null)} /> : null}
    </Page>
  );
}

const SECTIONS = {
  commands: { title: 'Command Builder', tab: 'commands', text: 'Custom slash and right-click commands — no code.' },
  embeds: { title: 'Embed Builder', tab: 'embeds', text: 'Design rich message cards with a live Discord preview.' },
  automation: { title: 'Automation Studio', tab: 'automations', text: 'When something happens in Discord, run a series of steps.' },
} as const;

/** Sidebar entry for a builder: pick which bot to open it for. */
export function BuilderDirectoryPage() {
  const { section = '' } = useParams();
  const bots = useBots();
  const s = SECTIONS[section as keyof typeof SECTIONS];
  if (!s) return <RoadmapPage />;
  const list = bots.data ?? [];
  return (
    <Page route={`/builders/${section}`} ready={!bots.isLoading} width="narrow">
      <PageHeader eyebrow="Builder" title={s.title} description={s.text} />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={Bot} title="No bots yet" description="Create a bot first.">
            <Button variant="primary" asChild>
              <Link to="/bots/new">Create bot</Link>
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {list.map((bot) => (
              <li key={bot.id} className="border-b border-border last:border-0">
                <Link to={`/bots/${bot.id}/${s.tab}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover/50">
                  <BotIdentityAvatar bot={bot} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium text-fg">{bot.name}</span>
                  <ChevronRight className="size-4 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
        <LayoutTemplate className="size-3.5" /> Prefer a head start? <Link to="/templates" className="text-primary hover:underline">Browse templates</Link>
      </p>
    </Page>
  );
}
