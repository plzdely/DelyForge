import { randomUUID } from 'node:crypto';
import {
  BOT_EXPORT_FORMAT,
  BOT_EXPORT_VERSION,
  BOT_LIMITS,
  type BotPresence,
  type BotProject,
  type BotProjectExport,
  DEFAULT_PLANS,
  DEFAULT_PRESENCE,
  type BotModules,
  type Entitlements,
  type RuntimeOptions,
  botModulesSchema,
  botProjectExportSchema,
  type createBotProjectSchema,
  isWithinLimit,
  presenceSchema,
  privilegedIntentsFromFlags,
  type updateBotProjectSchema,
} from '@delyforge/shared';
import type { z } from 'zod';
import { AppError } from '../errors';
import type { LocalDatabase } from './database';
import type { ActivityRepository } from './repositories';

type CreateInput = z.output<typeof createBotProjectSchema>;
type UpdateInput = z.output<typeof updateBotProjectSchema>;

interface BotRow {
  id: string;
  name: string;
  description: string;
  group_name: string | null;
  discord_application_id: string | null;
  config: string;
  is_favorite: number;
  is_enabled: number;
  auto_start: number;
  auto_restart: number;
  bot_username: string | null;
  bot_avatar_url: string | null;
  application_flags: number | null;
  presence: string;
  permissions: string;
  intents: number;
  builtin_ping: number;
  guild_count: number;
  commands_executed: number;
  token_hint: string | null;
  has_token: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT p.*, s.token_hint AS token_hint, (s.bot_id IS NOT NULL) AS has_token
  FROM bot_projects p LEFT JOIN bot_secrets s ON s.bot_id = p.id`;

function parsePresence(raw: string): BotPresence {
  try {
    const parsed = presenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PRESENCE;
  } catch {
    return DEFAULT_PRESENCE;
  }
}

function toProject(r: BotRow): BotProject {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    groupName: r.group_name,
    discordApplicationId: r.discord_application_id,
    isFavorite: r.is_favorite === 1,
    isEnabled: r.is_enabled === 1,
    hasToken: r.has_token === 1,
    tokenHint: r.token_hint,
    botUsername: r.bot_username,
    botAvatarUrl: r.bot_avatar_url,
    privilegedIntents: r.application_flags === null ? null : privilegedIntentsFromFlags(r.application_flags),
    presence: parsePresence(r.presence),
    permissions: r.permissions,
    autoStart: r.auto_start === 1,
    autoRestart: r.auto_restart === 1,
    builtinPing: r.builtin_ping === 1,
    guildCount: r.guild_count,
    commandsExecuted: r.commands_executed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const TOUCH = `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/**
 * Bot projects in the local database. Enforces plan limits on every path that adds a project
 * (create, duplicate, import). Projects above the limit after a downgrade are kept, never deleted.
 */
export class BotRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly activity: ActivityRepository,
    private readonly entitlements: () => Pick<Entitlements, 'limits' | 'effectivePlanId'>,
  ) {}

  list(): BotProject[] {
    const rows = this.db.prepare(`${SELECT} ORDER BY p.updated_at DESC, p.rowid DESC`).all() as unknown as BotRow[];
    return rows.map(toProject);
  }

  get(id: string): BotProject {
    return toProject(this.getRow(id));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM bot_projects').get() as { n: number }).n;
  }

  create(input: CreateInput): BotProject {
    this.assertCanAdd();
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO bot_projects (id, name, description, group_name) VALUES (?, ?, ?, ?)')
      .run(id, input.name, input.description, input.groupName);
    this.activity.record('bot', `Created bot project “${input.name}”`, id);
    return this.get(id);
  }

  update({ id, patch }: UpdateInput): BotProject {
    const before = this.getRow(id);
    // Column names are fixed strings from this map — only values are bound from input.
    const columns: Record<string, (v: never) => string | number | null> = {
      name: (v: string) => v,
      description: (v: string) => v,
      groupName: (v: string | null) => v,
      isFavorite: (v: boolean) => (v ? 1 : 0),
      presence: (v: BotPresence) => JSON.stringify(v),
      permissions: (v: string) => v,
      autoStart: (v: boolean) => (v ? 1 : 0),
      autoRestart: (v: boolean) => (v ? 1 : 0),
      builtinPing: (v: boolean) => (v ? 1 : 0),
    };
    const names: Record<string, string> = {
      name: 'name',
      description: 'description',
      groupName: 'group_name',
      isFavorite: 'is_favorite',
      presence: 'presence',
      permissions: 'permissions',
      autoStart: 'auto_start',
      autoRestart: 'auto_restart',
      builtinPing: 'builtin_ping',
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !(key in names)) continue;
      sets.push(`${names[key]} = ?`);
      values.push(columns[key]!(value as never));
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE bot_projects SET ${sets.join(', ')}, ${TOUCH} WHERE id = ?`).run(...values, id);
    }
    if (patch.name !== undefined && patch.name !== before.name) {
      this.activity.record('bot', `Renamed “${before.name}” to “${patch.name}”`, id);
    }
    return this.get(id);
  }

  /** Copies name, description, group and configuration — never the token or Discord application. */
  duplicate(id: string): BotProject {
    const source = this.getRow(id);
    this.assertCanAdd();
    const newId = randomUUID();
    const name = this.uniqueName(source.name, 'copy');
    this.db
      .prepare(
        `INSERT INTO bot_projects (id, name, description, group_name, config, presence, permissions, intents, builtin_ping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId, name, source.description, source.group_name, source.config, source.presence, source.permissions, source.intents, source.builtin_ping);
    this.activity.record('bot', `Duplicated “${source.name}” as “${name}”`, newId);
    return this.get(newId);
  }

  remove(id: string): void {
    const row = this.getRow(id);
    this.db.prepare('DELETE FROM bot_projects WHERE id = ?').run(id); // secrets & logs cascade
    this.activity.record('bot', `Deleted bot project “${row.name}”`);
  }

  // ─── Discord connection ──────────────────────────────────────────────────────────────────────────────────────────

  /** Another project already using this Discord application (running both would fight over one bot account). */
  findByApplicationId(applicationId: string, excludeId: string): BotProject | null {
    const row = this.db
      .prepare(`${SELECT} WHERE p.discord_application_id = ? AND p.id <> ?`)
      .get(applicationId, excludeId) as BotRow | undefined;
    return row ? toProject(row) : null;
  }

  setConnection(
    id: string,
    info: { applicationId: string; username: string; avatarUrl: string | null; applicationFlags: number },
  ): BotProject {
    this.db
      .prepare(
        `UPDATE bot_projects SET discord_application_id = ?, bot_username = ?, bot_avatar_url = ?, application_flags = ?, ${TOUCH} WHERE id = ?`,
      )
      .run(info.applicationId, info.username, info.avatarUrl, info.applicationFlags, id);
    return this.get(id);
  }

  clearConnection(id: string): BotProject {
    this.db
      .prepare(
        `UPDATE bot_projects SET discord_application_id = NULL, bot_username = NULL, bot_avatar_url = NULL, application_flags = NULL, guild_count = 0, ${TOUCH} WHERE id = ?`,
      )
      .run(id);
    return this.get(id);
  }

  /** Presence and built-ins; the supervisor adds modules, intents and the data folder. */
  runtimeBasics(id: string): Pick<RuntimeOptions, 'presence' | 'builtinPing'> {
    const row = this.getRow(id);
    return { presence: parsePresence(row.presence), builtinPing: row.builtin_ping === 1 };
  }

  /** Module settings per server. Invalid stored data is ignored rather than crashing the bot. */
  modules(id: string): BotModules {
    const config = parseConfig(this.getRow(id).config);
    const parsed = botModulesSchema.safeParse(config['guilds'] ?? {});
    return parsed.success ? parsed.data : {};
  }

  setModules(id: string, modules: BotModules): void {
    const config = parseConfig(this.getRow(id).config);
    config['guilds'] = botModulesSchema.parse(modules);
    this.db.prepare(`UPDATE bot_projects SET config = ?, ${TOUCH} WHERE id = ?`).run(JSON.stringify(config), id);
  }

  /** Called when the running bot reports in — keeps the stored identity and server count fresh. */
  recordReady(id: string, username: string, avatarUrl: string | null, guildCount: number): void {
    this.db
      .prepare('UPDATE bot_projects SET bot_username = ?, bot_avatar_url = COALESCE(?, bot_avatar_url), guild_count = ? WHERE id = ?')
      .run(username, avatarUrl, guildCount, id);
  }

  recordGuildCount(id: string, guildCount: number): void {
    this.db.prepare('UPDATE bot_projects SET guild_count = ? WHERE id = ? AND guild_count <> ?').run(guildCount, id, guildCount);
  }

  incrementCommands(id: string): void {
    this.db.prepare('UPDATE bot_projects SET commands_executed = commands_executed + 1 WHERE id = ?').run(id);
  }

  totals(): { servers: number; commands: number } {
    const r = this.db
      .prepare('SELECT COALESCE(SUM(guild_count), 0) AS servers, COALESCE(SUM(commands_executed), 0) AS commands FROM bot_projects')
      .get() as { servers: number; commands: number };
    return r;
  }

  // ─── Export / import ─────────────────────────────────────────────────────────────────────────────────────────────

  exportProject(id: string, appVersion: string): BotProjectExport {
    const row = this.getRow(id);
    const data: BotProjectExport = {
      format: BOT_EXPORT_FORMAT,
      version: BOT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
      project: {
        name: row.name,
        description: row.description,
        groupName: row.group_name,
        config: parseConfig(row.config),
        presence: parsePresence(row.presence),
        permissions: row.permissions,
        builtinPing: row.builtin_ping === 1,
      },
    };
    this.activity.record('bot', `Exported “${row.name}”`, id);
    return botProjectExportSchema.parse(data);
  }

  /** Validates an export file's text and creates a new project from it. */
  importProject(text: string): BotProject {
    if (Buffer.byteLength(text, 'utf8') > BOT_LIMITS.importMaxBytes) {
      throw new AppError('VALIDATION_FAILED', 'This file is too large to be a DelyForge bot export.');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'This file isn’t a valid DelyForge bot export (it is not JSON).');
    }
    const parsed = botProjectExportSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
      throw new AppError('VALIDATION_FAILED', `This file isn’t a valid DelyForge bot export: ${issue?.message ?? 'unknown problem'}${where}.`);
    }
    this.assertCanAdd();
    const p = parsed.data.project;
    const id = randomUUID();
    const name = this.isNameTaken(p.name) ? this.uniqueName(p.name, 'imported') : p.name;
    this.db
      .prepare('INSERT INTO bot_projects (id, name, description, group_name, config) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, p.description, p.groupName, JSON.stringify(p.config));
    if (p.presence) this.db.prepare('UPDATE bot_projects SET presence = ? WHERE id = ?').run(JSON.stringify(p.presence), id);
    if (p.permissions) this.db.prepare('UPDATE bot_projects SET permissions = ? WHERE id = ?').run(p.permissions, id);
    if (p.builtinPing !== undefined) this.db.prepare('UPDATE bot_projects SET builtin_ping = ? WHERE id = ?').run(p.builtinPing ? 1 : 0, id);
    this.activity.record('bot', `Imported bot project “${name}”`, id);
    return this.get(id);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private getRow(id: string): BotRow {
    const row = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as BotRow | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'That bot project no longer exists.');
    return row;
  }

  private assertCanAdd(): void {
    const ent = this.entitlements();
    if (!isWithinLimit(ent, 'maxBotProjects', this.count() + 1)) {
      const plan = DEFAULT_PLANS[ent.effectivePlanId];
      const max = ent.limits.maxBotProjects;
      throw new AppError(
        'LIMIT_REACHED',
        `Your ${plan.name} plan includes ${max} bot project${max === 1 ? '' : 's'}. Upgrade your plan or delete a project to add another.`,
      );
    }
  }

  private isNameTaken(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM bot_projects WHERE name = ? COLLATE NOCASE').get(name) !== undefined;
  }

  /** "Aurora" → "Aurora (copy)", "Aurora (copy 2)", … kept within the name length limit. */
  private uniqueName(base: string, suffix: string): string {
    const root = base.replace(new RegExp(`\\s\\(${suffix}(?: \\d+)?\\)$`), '');
    for (let n = 1; n < 1000; n++) {
      const tail = n === 1 ? ` (${suffix})` : ` (${suffix} ${n})`;
      const candidate = root.slice(0, BOT_LIMITS.nameMax - tail.length).trimEnd() + tail;
      if (!this.isNameTaken(candidate)) return candidate;
    }
    return root.slice(0, BOT_LIMITS.nameMax);
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
