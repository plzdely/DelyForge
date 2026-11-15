import type { EmbedTemplate } from '@delyforge/shared';
import { renderTemplate } from '@delyforge/shared';
import type { ReactNode } from 'react';

const SAMPLE = {
  user: '@NewMember',
  'user.name': 'NewMember',
  'user.id': '123456789012345678',
  server: 'Your Server',
  memberCount: 128,
  channel: '#general',
  target: '@Someone',
  level: 5,
};

/**
 * The app's security policy only loads images from Discord's CDN, so other image links get a placeholder in the
 * preview (they still show in Discord itself).
 */
function Img({ src, className }: { src: string; className: string }) {
  const ok = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(src);
  return ok ? (
    <img src={src} alt="" className={className} />
  ) : (
    <div className={`flex items-center justify-center bg-black/30 text-[11px] text-[#949ba4] ${className}`} title={src}>
      🖼
    </div>
  );
}

/** Light markdown: **bold**, *italic*, `code`, and mentions/channels shown as Discord-style pills. */
function Markdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|@\w+|#[\w-]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="rounded bg-black/30 px-1 font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : /^[@#]\w/.test(p) ? (
          <span key={i} className="rounded bg-[#5865f2]/30 px-0.5 text-[#c9cdfb]">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Variables filled with example values, the way members will see them. */
export const preview = (text: string, extra: Record<string, string | number> = {}) => renderTemplate(text, { ...SAMPLE, ...extra });

export function EmbedPreview({ e, vars }: { e: EmbedTemplate; vars?: Record<string, string | number> }) {
  const t = (s: string) => preview(s, vars);
  const inlineRows: EmbedTemplate['fields'][] = [];
  for (const f of e.fields) {
    const last = inlineRows.at(-1);
    if (f.inline && last && last.length < 3 && last.every((x) => x.inline)) last.push(f);
    else inlineRows.push([f]);
  }
  return (
    <div className="relative max-w-[520px] overflow-hidden rounded bg-[#2b2d31] py-3 pr-4 pl-4 text-[14px] leading-[1.375] text-[#dbdee1]" style={{ borderLeft: `4px solid ${e.color}` }}>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          {e.authorName ? (
            <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
              {e.authorIconUrl ? <Img src={e.authorIconUrl} className="size-6 rounded-full" /> : null}
              {t(e.authorName)}
            </div>
          ) : null}
          {e.title ? <div className={`font-semibold ${e.url ? 'text-[#00a8fc]' : 'text-white'}`}>{t(e.title)}</div> : null}
          {e.description ? (
            <div className="whitespace-pre-wrap">
              <Markdown text={t(e.description)} />
            </div>
          ) : null}
          {inlineRows.map((row, i) => (
            <div key={i} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
              {row.map((f, j) => (
                <div key={j}>
                  <div className="text-[13px] font-semibold text-white">{t(f.name)}</div>
                  <div className="whitespace-pre-wrap">
                    <Markdown text={t(f.value)} />
                  </div>
                </div>
              ))}
            </div>
          ))}
          {e.imageUrl ? <Img src={e.imageUrl} className="mt-2 max-h-72 rounded" /> : null}
          {e.footerText || e.timestamp ? (
            <div className="flex items-center gap-2 pt-1 text-[12px] text-[#b5bac1]">
              {e.footerIconUrl ? <Img src={e.footerIconUrl} className="size-5 rounded-full" /> : null}
              {e.footerText ? t(e.footerText) : null}
              {e.footerText && e.timestamp ? ' • ' : null}
              {e.timestamp ? 'Today at 12:00' : null}
            </div>
          ) : null}
        </div>
        {e.thumbnailUrl ? <Img src={e.thumbnailUrl} className="size-20 shrink-0 rounded object-cover" /> : null}
      </div>
    </div>
  );
}

/** A Discord-looking message from the bot, for live previews. */
export function DiscordMessage({ botName, avatarUrl, text, children, ephemeral }: { botName: string; avatarUrl?: string | null; text?: string; children?: ReactNode; ephemeral?: boolean }) {
  return (
    <div className="rounded-lg bg-[#313338] p-4 font-[system-ui]">
      <div className="flex gap-3">
        {avatarUrl ? <Img src={avatarUrl} className="size-10 rounded-full" /> : <div className="size-10 shrink-0 rounded-full bg-[#5865f2]" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-medium text-white">{botName}</span>
            <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white">APP</span>
            <span className="text-[12px] text-[#949ba4]">Today at 12:00</span>
          </div>
          {text ? (
            <div className="text-[15px] whitespace-pre-wrap text-[#dbdee1]">
              <Markdown text={preview(text)} />
            </div>
          ) : null}
          {children ? <div className="mt-1 space-y-2">{children}</div> : null}
          {ephemeral ? <div className="mt-1 text-[12px] text-[#949ba4]">👁 Only you can see this</div> : null}
        </div>
      </div>
    </div>
  );
}
