import { randomUUID } from 'node:crypto';
import {
  BOT_EXPORT_FORMAT,
  BOT_EXPORT_VERSION,
  BOT_LIMITS,
  type BotProject,
  type BotProjectExport,
  DEFAULT_PLANS,
  type Entitlements,
  botProjectExportSchema,
  type createBotProjectSchema,
  isWithinLimit,
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
  has_token: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT p.*, EXISTS (SELECT 1 FROM bot_secrets s WHERE s.bot_id = p.id) AS has_token
  FROM bot_projects p`;

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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

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
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      values.push(patch.description);
    }
    if (patch.groupName !== undefined) {
      sets.push('group_name = ?');
      values.push(patch.groupName);
    }
    if (patch.isFavorite !== undefined) {
      sets.push('is_favorite = ?');
      values.push(patch.isFavorite ? 1 : 0);
    }
    // Column names above are fixed strings from this function — only values are bound from input.
    this.db
      .prepare(`UPDATE bot_projects SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(...values, id);

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
      .prepare('INSERT INTO bot_projects (id, name, description, group_name, config) VALUES (?, ?, ?, ?, ?)')
      .run(newId, name, source.description, source.group_name, source.config);
    this.activity.record('bot', `Duplicated “${source.name}” as “${name}”`, newId);
    return this.get(newId);
  }

  remove(id: string): void {
    const row = this.getRow(id);
    this.db.prepare('DELETE FROM bot_projects WHERE id = ?').run(id); // bot_secrets cascade
    this.activity.record('bot', `Deleted bot project “${row.name}”`);
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
