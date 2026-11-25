import { type DoctorIssue, IMPLEMENTED_MODULES, type ImplementedModuleId, MODULES, type ModuleConfigs, PERMISSIONS, modulePermissions } from '@delyforge/shared';
import { ChannelType, type Guild } from 'discord.js';

/** What the doctor needs to know about a server — built from discord.js in `doctorInput`, plain data in tests. */
export interface DoctorInput {
  guildName: string;
  configs: ModuleConfigs;
  botPermissions: bigint;
  botRolePosition: number;
  channel(id: string): { name: string; kind: 'text' | 'voice' | 'category'; perms: bigint } | null;
  role(id: string): { name: string; position: number; managed: boolean } | null;
}

const P = (n: bigint) => 1n << n;
const ADMIN = P(3n), VIEW = P(10n), SEND = P(11n), EMBED = P(14n), CONNECT = P(20n), MOVE = P(24n), MANAGE_CHANNELS = P(4n), MANAGE_ROLES = P(28n);
const names = (bits: bigint) =>
  PERMISSIONS.filter((p) => (bits & p.bit) !== 0n)
    .map((p) => p.label)
    .join(', ');
const moduleName = (id: ImplementedModuleId) => MODULES.find((m) => m.id === id)?.name ?? id;

/** Modules whose roles the bot hands out (so they must sit below the bot's own role). */
const GIVES_ROLES = new Set<ImplementedModuleId>(['welcome', 'leveling', 'verification', 'reactionRoles', 'birthdays']);

/** Channels a module can't work without, when that part is switched on. */
const REQUIRED: { id: ImplementedModuleId; label: string; get: (c: ModuleConfigs) => string | null | false }[] = [
  { id: 'welcome', label: 'welcome channel', get: (c) => c.welcome.welcome.enabled && c.welcome.welcome.channelId },
  { id: 'welcome', label: 'goodbye channel', get: (c) => c.welcome.goodbye.enabled && c.welcome.goodbye.channelId },
  { id: 'logging', label: 'log channel', get: (c) => !Object.keys(c.logging.channelOverrides).length && c.logging.channelId },
  { id: 'starboard', label: 'starboard channel', get: (c) => c.starboard.channelId },
  { id: 'birthdays', label: 'birthday channel', get: (c) => c.birthdays.channelId },
  { id: 'suggestions', label: 'suggestions channel', get: (c) => c.suggestions.channelId },
  { id: 'tempVoice', label: '“join to create” voice channel', get: (c) => c.tempVoice.hubChannelId },
];

/** Every channel and role a module's settings point at (found by field name, e.g. channelId, roleIds). */
function references(config: unknown): { channels: Set<string>; roles: Map<string, string> } {
  const channels = new Set<string>();
  /** Role ID → the field it came from (e.g. noXpRoleIds), so ignore/staff lists aren't treated as roles to give. */
  const roles = new Map<string, string>();
  const walk = (v: unknown, key: string, parent: string) => {
    if (typeof v === 'string') {
      if (/channelid$|categoryid$/i.test(key) || parent === 'channelOverrides') channels.add(v);
      else if (/roleids?$/i.test(key) || /roleids$/i.test(parent)) roles.set(v, key || parent);
    } else if (Array.isArray(v)) {
      // Lists of channels the module ignores (noXpChannelIds…) don't need posting rights, so only roles are taken.
      for (const x of v) walk(x, /roleids$/i.test(key) ? key : '', key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k, key);
    }
  };
  walk(config, '', '');
  return { channels, roles };
}

export function diagnose(input: DoctorInput): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const admin = (input.botPermissions & ADMIN) !== 0n;
  const enabled = IMPLEMENTED_MODULES.filter((id) => input.configs[id].enabled);

  for (const id of enabled) {
    const config = input.configs[id];
    const name = moduleName(id);

    // 1. Server-wide permissions
    const missing = admin ? 0n : modulePermissions(id, config as never) & ~input.botPermissions;
    if (missing) {
      issues.push({ severity: 'error', moduleId: id, title: `${name} needs: ${names(missing)}`, fix: 'Give the bot’s role these permissions in Server Settings → Roles, or re-invite it with the link below.', permissions: missing.toString() });
    }

    // 2. Channels that must be chosen
    for (const r of REQUIRED.filter((x) => x.id === id)) {
      if (r.get(input.configs) === null) issues.push({ severity: 'warning', moduleId: id, title: `${name}: no ${r.label} chosen`, fix: `Open ${name} and pick the ${r.label}.`, permissions: null });
    }

    // 3. Channels it uses: still there, and can the bot use them?
    const refs = references(config);
    for (const channelId of refs.channels) {
      const ch = input.channel(channelId);
      if (!ch) {
        issues.push({ severity: 'error', moduleId: id, title: `${name} uses a channel that was deleted`, fix: `Open ${name} and choose another channel.`, permissions: null });
        continue;
      }
      if (admin) continue;
      const need =
        id === 'serverStats' ? VIEW | MANAGE_CHANNELS
        : ch.kind === 'category' ? VIEW | MANAGE_CHANNELS | (id === 'tickets' ? MANAGE_ROLES : 0n)
        : ch.kind === 'voice' ? VIEW | (id === 'tempVoice' ? CONNECT | MOVE : 0n)
        : VIEW | SEND | EMBED;
      const lacking = need & ~ch.perms;
      if (lacking) {
        issues.push({
          severity: 'error',
          moduleId: id,
          title: `${name}: the bot can’t use #${ch.name} (missing ${names(lacking)})`,
          fix: `Edit #${ch.name} → Permissions, and allow the bot’s role: ${names(lacking)}.`,
          permissions: null,
        });
      }
    }

    // 4. Roles it uses: still there, and can the bot give them?
    for (const [roleId, field] of refs.roles) {
      const role = input.role(roleId);
      if (!role) {
        issues.push({ severity: 'error', moduleId: id, title: `${name} uses a role that was deleted`, fix: `Open ${name} and choose another role.`, permissions: null });
      } else if (GIVES_ROLES.has(id) && !/^(noXp|exempt|staff|manager)/i.test(field) && (role.managed || role.position >= input.botRolePosition)) {
        issues.push({
          severity: 'error',
          moduleId: id,
          title: `${name} can’t give @${role.name}`,
          fix: role.managed
            ? `@${role.name} belongs to an app or Server Boosts and can’t be given by bots. Choose another role.`
            : `Server Settings → Roles: drag the bot’s role above @${role.name}.`,
          permissions: null,
        });
      }
    }
  }
  return issues.slice(0, 100);
}

export function doctorInput(guild: Guild, configs: ModuleConfigs): DoctorInput {
  const me = guild.members.me;
  return {
    guildName: guild.name,
    configs,
    botPermissions: me?.permissions.bitfield ?? 0n,
    botRolePosition: me?.roles.highest.position ?? 0,
    channel: (id) => {
      const ch = guild.channels.cache.get(id);
      if (!ch || !me) return null;
      const kind = ch.type === ChannelType.GuildCategory ? 'category' : ch.isVoiceBased() ? 'voice' : 'text';
      return { name: ch.name, kind, perms: ch.permissionsFor(me)?.bitfield ?? 0n };
    },
    role: (id) => {
      const r = guild.roles.cache.get(id);
      return r ? { name: r.name, position: r.position, managed: r.managed } : null;
    },
  };
}
