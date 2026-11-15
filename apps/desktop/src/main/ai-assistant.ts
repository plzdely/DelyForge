import {
  type AiApplyResult,
  type AiGuildContext,
  type AiProposal,
  type AiProposalResult,
  type AiTroubleshootAnswer,
  type AiUsageInfo,
  MODULES,
  newItemId,
  redactSecrets,
} from '@delyforge/shared';
import type { AccountService } from './account';
import type { BotRepository } from './db/bots';
import type { LogRepository } from './db/logs';
import { AppError } from './errors';
import type { BuildersService } from './runtime/builders-service';
import type { ModulesService } from './runtime/modules-service';

const AI_TIMEOUT_MS = 180_000;
const MAX_PENDING = 20;

type Api = Pick<AccountService, 'authed'>;

/**
 * The desktop half of the AI features. The AI itself runs on the DelyForge API; this class sends it server names and
 * redacted logs (never tokens), keeps each proposal until the user decides, and applies approved proposals through
 * the same validated, plan-checked services the settings screens use.
 */
export class AiAssistant {
  private readonly pending = new Map<string, { botId: string; guildId: string; proposal: AiProposal }>();

  constructor(
    private readonly api: Api,
    private readonly bots: BotRepository,
    private readonly modules: Pick<ModulesService, 'guilds' | 'update'>,
    private readonly builders: Pick<BuildersService, 'get' | 'save'>,
    private readonly logs: Pick<LogRepository, 'list'>,
    private readonly runtimeState: (botId: string) => { status: string; lastError: { message: string } | null },
  ) {}

  usage(): Promise<AiUsageInfo> {
    return this.api.authed<AiUsageInfo>('GET', '/v1/ai/usage');
  }

  async build(botId: string, guildId: string, prompt: string): Promise<AiProposalResult> {
    this.bots.get(botId);
    const guild = (await this.modules.guilds(botId)).find((g) => g.id === guildId);
    if (!guild) throw new AppError('NOT_FOUND', 'The bot isn’t in that server any more.');
    const context: AiGuildContext = {
      id: guild.id,
      name: guild.name.slice(0, 100),
      channels: guild.channels.slice(0, 500).map((c) => ({ id: c.id, name: c.name.slice(0, 100), kind: c.kind })),
      // Bot/integration roles can't be assigned, so the AI shouldn't use them.
      roles: guild.roles.filter((r) => !r.managed && r.id !== guild.id).slice(0, 250).map((r) => ({ id: r.id, name: r.name.slice(0, 100) })),
    };
    const result = await this.api.authed<AiProposalResult>('POST', '/v1/ai/bot-builder', { prompt, guild: context }, AI_TIMEOUT_MS);
    if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(result.proposalId, { botId, guildId, proposal: result.proposal });
    return result;
  }

  /** Applies a proposal the user approved. Each item goes through normal validation; ones that fail are reported, not forced. */
  async apply(proposalId: string): Promise<AiApplyResult> {
    const item = this.pending.get(proposalId);
    if (!item) throw new AppError('NOT_FOUND', 'That proposal has expired. Generate a new one.');
    const { botId, guildId, proposal } = item;
    const applied: string[] = [];
    const skipped: string[] = [];
    let restartRequired = false;

    for (const m of proposal.modules) {
      const name = MODULES.find((x) => x.id === m.moduleId)?.name ?? m.moduleId;
      try {
        restartRequired = this.modules.update(botId, guildId, m.moduleId, m.config).restartRequired || restartRequired;
        applied.push(`${name} module`);
      } catch (e) {
        skipped.push(`${name} module: ${(e as Error).message}`);
      }
    }

    if (proposal.commands.length || proposal.workflows.length) {
      const current = this.builders.get(botId);
      const next = { ...current, commands: [...current.commands], workflows: [...current.workflows] };
      const added: string[] = [];
      for (const c of proposal.commands) {
        if (next.commands.some((x) => x.type === c.type && x.name === c.name)) {
          skipped.push(`Command “${c.name}”: you already have a command with that name`);
          continue;
        }
        next.commands.push({ ...c, id: newItemId(next.commands) });
        added.push(c.type === 'slash' ? `Command /${c.name}` : `Command “${c.name}”`);
      }
      for (const w of proposal.workflows) {
        next.workflows.push({ ...w, id: newItemId(next.workflows), guildId });
        added.push(`Automation “${w.name}”`);
      }
      if (added.length) {
        try {
          this.builders.save(botId, next);
          applied.push(...added);
        } catch (e) {
          skipped.push(`Commands and automations: ${(e as Error).message}`);
        }
      }
    }

    this.pending.delete(proposalId);
    await this.decide(proposalId, 'applied');
    return { applied, skipped, restartRequired };
  }

  async reject(proposalId: string): Promise<null> {
    this.pending.delete(proposalId);
    await this.decide(proposalId, 'rejected');
    return null;
  }

  async troubleshoot(botId: string, question: string): Promise<{ answer: AiTroubleshootAnswer; creditsUsed: number; usage: AiUsageInfo }> {
    const bot = this.bots.get(botId);
    const state = this.runtimeState(botId);
    // Log lines are redacted when written; redacting again costs nothing and protects older lines.
    const logs = this.logs.list(botId, 120).map((l) => redactSecrets(`${l.createdAt} ${l.level} ${l.message}`).slice(0, 500));
    return this.api.authed('POST', '/v1/ai/troubleshoot', {
      question,
      botName: bot.name.slice(0, 80),
      status: state.status,
      lastError: state.lastError ? redactSecrets(state.lastError.message).slice(0, 1000) : null,
      logs,
    }, AI_TIMEOUT_MS);
  }

  /** Records the decision on the server for the audit trail; a failure here must not undo what was applied. */
  private async decide(proposalId: string, decision: 'applied' | 'rejected'): Promise<void> {
    await this.api.authed('POST', `/v1/ai/proposals/${encodeURIComponent(proposalId)}/decision`, { decision }).catch(() => null);
  }
}
