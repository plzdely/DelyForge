import { type SendMessageInput, sendMessageContentSchema } from '@delyforge/shared';
import { ExternalLink, Lock, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DiscordMessage, EmbedPreview } from '@/components/builders/discord-preview';
import { ChannelSelect, GuildPicker, ToggleRow } from '@/components/modules/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { call } from '@/lib/bridge';
import { useBuilders } from '@/lib/builders';
import { useGuilds, useRefreshGuilds } from '@/lib/modules';
import { useRuntimeState } from '@/lib/runtime';
import { useBotContext } from './layout';

type Sent = { at: Date; where: string; url: string | null };

/** Send a message as the bot: to any text channel it can post in, or to someone's DMs. */
export function SendMessageTab() {
  const { bot } = useBotContext();
  const route = `/bots/${bot.id}/send`;
  const state = useRuntimeState(bot.id);
  const guilds = useGuilds(bot.id, bot.hasToken);
  const refresh = useRefreshGuilds(bot.id);
  const builders = useBuilders(bot.id);
  const [kind, setKind] = useState<'channel' | 'dm'>('channel');
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [content, setContent] = useState('');
  const [embedId, setEmbedId] = useState('');
  const [allowPings, setAllowPings] = useState(false);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Sent[]>([]);

  const list = guilds.data ?? [];
  const guild = list.find((g) => g.id === guildId) ?? list[0];
  useEffect(() => setChannelId(null), [guild?.id]);

  if (!bot.hasToken) {
    return (
      <Card data-route-ready={route}>
        <EmptyState icon={Lock} title="Connect this bot first" description="Messages are sent by your bot in your Discord servers." />
      </Card>
    );
  }
  if (guilds.isLoading) return <Skeleton className="h-64 rounded-xl" />;

  const embeds = builders.data?.embeds ?? [];
  const embed = embeds.find((e) => e.id === embedId);
  const online = state.status === 'online';
  const target: SendMessageInput['target'] | null =
    kind === 'dm' ? (/^\d{17,20}$/.test(userId.trim()) ? { kind: 'dm', userId: userId.trim() } : null) : guild && channelId ? { kind: 'channel', guildId: guild.id, channelId } : null;
  const draft = target ? sendMessageContentSchema.safeParse({ target, content, embedId, allowPings }) : null;
  const problem = !online
    ? 'Start the bot to send messages.'
    : !target
      ? kind === 'dm'
        ? 'Paste the person’s user ID.'
        : 'Choose a channel.'
      : draft && !draft.success
        ? (draft.error.issues[0]?.message ?? 'Check the message.')
        : null;

  const send = () => {
    if (!draft?.success) return;
    setSending(true);
    const where = target?.kind === 'dm' ? `DM to ${userId.trim()}` : `#${guild?.channels.find((c) => c.id === channelId)?.name ?? 'channel'} in ${guild?.name ?? 'server'}`;
    call((b) => b.messages.send({ id: bot.id, message: draft.data }))
      .then((r) => {
        if (!r.ok) return void toast.error('Not sent', { description: r.message });
        toast.success('Sent', { description: r.message });
        setHistory((h) => [{ at: new Date(), where, url: r.url }, ...h].slice(0, 10));
        setContent('');
      })
      .catch((e: Error) => toast.error('Not sent', { description: e.message }))
      .finally(() => setSending(false));
  };

  return (
    <div className="grid grid-cols-[1fr_320px] gap-3" data-route-ready={route}>
      <Card>
        <CardHeader title="Send a message as your bot" description="It appears in Discord exactly as if the bot wrote it." />
        <CardBody className="space-y-4">
          <Segmented
            ariaLabel="Where to send it"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'channel', label: 'Server channel' },
              { value: 'dm', label: 'Direct message' },
            ]}
          />
          {kind === 'channel' ? (
            guild ? (
              <div className="space-y-3">
                <GuildPicker guilds={list} value={guild.id} onChange={setGuildId} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
                <ChannelSelect id="send-channel" label="Channel" guild={guild} value={channelId} onChange={setChannelId} />
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Invite the bot to a server first.</p>
            )
          ) : (
            <Field
              label="Their Discord user ID"
              htmlFor="send-user"
              hint="In Discord: User Settings → Advanced → turn on Developer Mode, then right-click the person → Copy User ID. They must share a server with the bot and allow DMs."
            >
              <Input id="send-user" inputMode="numeric" maxLength={20} placeholder="123456789012345678" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <Field label="Message" htmlFor="send-text" counter={{ value: content.length, max: 2000 }}>
            <Textarea id="send-text" rows={6} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write what the bot should say…" />
          </Field>
          <Field label="Embed (optional)" htmlFor="send-embed" hint="Make embeds in the Embeds tab.">
            <Select id="send-embed" value={embedId} onChange={(e) => setEmbedId(e.target.value)}>
              <option value="">— No embed —</option>
              {embeds.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <ToggleRow title="Let mentions ping" description="Off: @names in the text show but don’t notify anyone. On: @user, @role and @everyone really ping." checked={allowPings} onChange={setAllowPings} />
          <div className="flex items-center justify-end gap-3">
            {problem ? <span className="mr-auto text-xs text-fg-subtle">{problem}</span> : null}
            <Button variant="primary" disabled={!!problem || sending} onClick={send}>
              <Send /> {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-3">
        <Card>
          <CardHeader title="Preview" />
          <CardBody>
            {content.trim() || embed ? (
              <DiscordMessage botName={bot.botUsername ?? bot.name} avatarUrl={bot.botAvatarUrl} text={content}>
                {embed ? <EmbedPreview e={embed} /> : null}
              </DiscordMessage>
            ) : (
              <p className="text-xs text-fg-subtle">Start typing to see how it will look.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sent this session" />
          <CardBody className="space-y-2">
            {history.length === 0 ? <p className="text-xs text-fg-subtle">Nothing yet.</p> : null}
            {history.map((h, n) => (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg-muted">{h.where}</span>
                <span className="text-fg-subtle">{h.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                {h.url ? (
                  <button type="button" className="text-primary hover:underline" aria-label="Open in Discord" onClick={() => void call((b) => b.shell.openExternal(h.url!))}>
                    <ExternalLink className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
