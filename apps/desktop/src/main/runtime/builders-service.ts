import {
  type BotModules,
  type Builders,
  type Entitlements,
  type GuildModules,
  IMPLEMENTED_MODULES,
  TEMPLATES,
  type WorkflowRun,
  buildersSchema,
  lowestPlanWithFeature,
  moduleInfo,
  newItemId,
  type PackageContent,
} from '@delyforge/shared';
import type { BotRepository } from '../db/bots';
import type { LocalDatabase } from '../db/database';
import type { ActivityRepository } from '../db/repositories';
import { AppError } from '../errors';

/** Custom commands, embeds, workflows (Phase 5) and templates — validated and plan-checked before saving. */
export class BuildersService {
  constructor(
    private readonly db: LocalDatabase,
    private readonly bots: BotRepository,
    private readonly activity: ActivityRepository,
    private readonly entitlements: () => Pick<Entitlements, 'features' | 'limits' | 'effectivePlanId'>,
    private readonly apply: { builders: (botId: string) => boolean; modules: (botId: string) => boolean },
  ) {}

  get(botId: string): Builders {
    return this.bots.builders(botId);
  }

  save(botId: string, raw: unknown): Builders {
    const project = this.bots.get(botId);
    const parsed = buildersSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError('VALIDATION_FAILED', `${issue?.message ?? 'Invalid settings'}${issue?.path.length ? ` (${issue.path.join('.')})` : ''}`);
    }
    const next = parsed.data;
    const before = this.bots.builders(botId);
    const ent = this.entitlements();

    // Saved embeds are a paid feature; existing ones are kept after a downgrade, but no new ones can be added.
    const known = new Set(before.embeds.map((e) => e.id));
    if (!ent.features.includes('builder.embeds') && next.embeds.some((e) => !known.has(e.id))) {
      throw new AppError('FORBIDDEN', `Saved embeds are available on the ${lowestPlanWithFeature('builder.embeds')?.name ?? 'Pro'} plan.`);
    }
    const max = ent.limits.maxWorkflows;
    if (max !== null && next.workflows.length > max && next.workflows.length > before.workflows.length) {
      throw new AppError('LIMIT_REACHED', `Your plan includes ${max} automation workflow${max === 1 ? '' : 's'}. Upgrade or delete one to add another.`);
    }

    this.bots.setBuilders(botId, next);
    this.activity.record('workflow', `Updated commands, embeds and automations for “${project.name}”`, botId);
    this.apply.builders(botId);
    return next;
  }

  recordRun(botId: string, run: { workflowId: string; ok: boolean; steps: number; message: string }): void {
    try {
      this.db
        .prepare('INSERT INTO workflow_runs (bot_id, workflow_id, ok, steps, message) VALUES (?, ?, ?, ?, ?)')
        .run(botId, run.workflowId, run.ok ? 1 : 0, run.steps, run.message);
      // Keep the history bounded: newest 500 runs per bot.
      this.db
        .prepare('DELETE FROM workflow_runs WHERE bot_id = ? AND id <= (SELECT id FROM workflow_runs WHERE bot_id = ? ORDER BY id DESC LIMIT 1 OFFSET 500)')
        .run(botId, botId);
    } catch {
      // The bot may have been deleted while a run finished.
    }
  }

  runs(botId: string): WorkflowRun[] {
    this.bots.get(botId);
    const rows = this.db.prepare('SELECT * FROM workflow_runs WHERE bot_id = ? ORDER BY id DESC LIMIT 100').all(botId) as {
      id: number;
      workflow_id: string;
      ok: number;
      steps: number;
      message: string;
      created_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, workflowId: r.workflow_id, ok: r.ok === 1, steps: r.steps, message: r.message, createdAt: r.created_at }));
  }

  /** Applies a built-in template to one server (see `installContent`). */
  applyTemplate(botId: string, guildId: string, templateId: string): { modules: BotModules; builders: Builders } {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new AppError('NOT_FOUND', 'That template doesn’t exist.');
    if (!this.entitlements().features.includes(template.feature)) {
      throw new AppError('FORBIDDEN', `The “${template.name}” template is available on the ${lowestPlanWithFeature(template.feature)?.name ?? 'Pro'} plan.`);
    }
    return this.installContent(botId, guildId, { modules: template.modules, commands: template.commands, embeds: [], workflows: [] }, `the “${template.name}” template`);
  }

  /**
   * Installs a template or marketplace pack into one server: its modules replace that server's settings for those
   * modules (switched off if the plan doesn't include them), and its commands, embeds and workflows are added with new
   * IDs (commands whose name is already used are skipped). Everything goes through `save`, so validation and plan
   * limits apply, and nothing is written if they fail.
   */
  installContent(botId: string, guildId: string, content: PackageContent, label: string): { modules: BotModules; builders: Builders } {
    const project = this.bots.get(botId);
    const ent = this.entitlements();

    const builders = this.bots.builders(botId);
    const next: Builders = { commands: [...builders.commands], embeds: [...builders.embeds], workflows: [...builders.workflows] };
    const embedIds = new Map<string, string>();
    for (const e of content.embeds) {
      const id = newItemId(next.embeds);
      embedIds.set(e.id, id);
      next.embeds.push({ ...e, id });
    }
    const embed = (id: string) => (id ? (embedIds.get(id) ?? '') : '');
    const taken = new Set(next.commands.map((c) => `${c.type}:${c.name}`));
    for (const c of content.commands) {
      if (taken.has(`${c.type}:${c.name}`)) continue;
      next.commands.push({ ...c, id: newItemId(next.commands), response: { ...c.response, embedId: embed(c.response.embedId) } });
    }
    for (const w of content.workflows) {
      next.workflows.push({ ...w, id: newItemId(next.workflows), guildId, steps: w.steps.map((s) => (s.type === 'sendMessage' ? { ...s, embedId: embed(s.embedId) } : s)) });
    }
    const saved = this.save(botId, next);

    const modules = this.bots.modules(botId);
    const guild: GuildModules = { ...(modules[guildId] ?? {}) };
    for (const id of IMPLEMENTED_MODULES) {
      let cfg = content.modules[id] as { enabled: boolean; automod?: { enabled: boolean } } | undefined;
      if (!cfg) continue;
      if (cfg.automod?.enabled && !ent.features.includes('moderation.advanced')) cfg = { ...cfg, automod: { ...cfg.automod, enabled: false } };
      if (!ent.features.includes(moduleInfo(id).feature)) cfg = { ...cfg, enabled: false };
      (guild as Record<string, unknown>)[id] = cfg;
    }
    modules[guildId] = guild;
    this.bots.setModules(botId, modules);

    this.activity.record('module', `Installed ${label} on “${project.name}”`, botId);
    this.apply.modules(botId);
    return { modules, builders: saved };
  }
}
