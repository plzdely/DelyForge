import { type FeedsConfig, renderTemplate } from '@delyforge/shared';
import type { Guild } from 'discord.js';
import { type ModuleContext, sendableChannel } from './context.js';

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  author: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]!) : '';
};

/** The first `max` <name>…</name> blocks, found with linear scans (no backtracking on hostile feeds), each cut to 20 KB. */
function blocksOf(xml: string, name: string, max: number): { blocks: string[]; first: number } {
  const open = new RegExp(`<${name}[\\s>]`, 'gi');
  const blocks: string[] = [];
  let first = -1;
  for (let m = open.exec(xml); m && blocks.length < max; m = open.exec(xml)) {
    if (first < 0) first = m.index;
    const end = xml.indexOf(`</${name}>`, m.index);
    if (end < 0) break;
    blocks.push(xml.slice(m.index, Math.min(end, m.index + 20_000)));
    open.lastIndex = end;
  }
  return { blocks, first };
}

/** Reads an RSS or Atom feed (YouTube feeds are Atom). Newest first, as feeds list them; at most 15 items. */
export function parseFeed(xml: string): FeedItem[] {
  const atom = blocksOf(xml, 'entry', 15);
  const { blocks, first } = atom.blocks.length ? atom : blocksOf(xml, 'item', 15);
  const feedTitle = tag(xml.slice(0, first < 0 ? 20_000 : Math.min(first, 20_000)), 'title');
  return blocks
    .map((b) => {
      const atomLink = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ?? /<link[^>]*href=["']([^"']+)["']/i.exec(b)?.[1];
      const link = decode(atomLink ?? tag(b, 'link'));
      const id = tag(b, 'yt:videoId') || tag(b, 'id') || tag(b, 'guid') || link;
      const author = tag(tag(b, 'author'), 'name') || tag(b, 'dc:creator') || tag(b, 'author') || feedTitle;
      return { id, title: tag(b, 'title') || '(untitled)', link, author };
    })
    .filter((i) => i.id && i.link);
}

/** A YouTube channel ID (UC…) written anywhere in the text, e.g. youtube.com/channel/UC…, or null. */
export const youtubeChannelId = (source: string) => /\b(UC[\w-]{22})\b/.exec(source)?.[1] ?? null;

/** Downloads at most 1 MB (a feed is a few KB; a YouTube channel page has its ID near the top). */
async function fetchText(url: string, limit = 1_000_000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('the address must start with https://');
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 DelyForge feed reader' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= limit) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, limit);
}

/** youtube.com/@name links are turned into the channel ID once (read from the channel page) and remembered. */
const resolved = new Map<string, string>();
async function feedUrl(feed: FeedsConfig['feeds'][number]): Promise<string> {
  if (feed.kind === 'rss') return feed.source;
  let id = youtubeChannelId(feed.source) ?? resolved.get(feed.source) ?? null;
  if (!id) {
    const handle = /@[\w.-]+/.exec(feed.source)?.[0];
    if (!handle) throw new Error('use a channel link like youtube.com/@name or a channel ID (UC…)');
    const page = await fetchText(`https://www.youtube.com/${handle}`);
    id = /"(?:externalId|channelId)":"(UC[\w-]{22})"/.exec(page)?.[1] ?? youtubeChannelId(page);
    if (!id) throw new Error(`couldn’t find the YouTube channel ${handle}`);
    resolved.set(feed.source, id);
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

/** The newest post of a feed (for the "Send a test" button). */
export async function latestFeedItem(feed: FeedsConfig['feeds'][number]): Promise<FeedItem | null> {
  return parseFeed(await fetchText(await feedUrl(feed)))[0] ?? null;
}

/** Problems are logged at most once an hour per feed, so a dead feed doesn't flood the console. */
const lastWarned = new Map<string, number>();

/** Checks every feed of a server and posts what's new (runs every 10 minutes). */
export async function pollFeeds(ctx: ModuleContext, guild: Guild): Promise<void> {
  const config = ctx.config(guild.id).feeds;
  if (!config.enabled) return;
  for (const feed of config.feeds) {
    const key = `${feed.kind}:${feed.source}`;
    try {
      const items = parseFeed(await fetchText(await feedUrl(feed)));
      const seen = ctx.store.seenFeedItems(guild.id, key);
      // First check: remember what's there already instead of posting the whole history.
      if (seen === null) {
        ctx.store.markFeedItemsSeen(guild.id, key, items.map((i) => i.id));
        continue;
      }
      const fresh = items.filter((i) => !seen.has(i.id)).slice(0, 3).reverse(); // oldest first, at most 3 per check
      if (!fresh.length) continue;
      const channel = await sendableChannel(ctx, guild, feed.channelId, 'Social alerts');
      for (const item of fresh) {
        ctx.store.markFeedItemsSeen(guild.id, key, [item.id]);
        await channel
          ?.send({
            content: renderTemplate(feed.message, { title: item.title, link: item.link, author: item.author, role: feed.roleId ? `<@&${feed.roleId}>` : '' }),
            allowedMentions: { parse: [], roles: feed.roleId ? [feed.roleId] : [] },
          })
          .catch((e: Error) => ctx.log('warn', `Social alerts: could not post: ${e.message}`));
      }
    } catch (e) {
      if (Date.now() - (lastWarned.get(key) ?? 0) > 3_600_000) {
        lastWarned.set(key, Date.now());
        ctx.log('warn', `Social alerts: couldn’t read ${feed.source} — ${(e as Error).message}`);
      }
    }
  }
}
