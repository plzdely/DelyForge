import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  AI_FEATURES,
  COMMAND_VARIABLES,
  DEFAULT_MODULE_CONFIGS,
  IMPLEMENTED_MODULES,
  MODULES,
  TEMPLATE_VARIABLES,
  type AiFeature,
  type AiGuildContext,
  type AiProposalResult,
  type AiTroubleshootAnswer,
  type AiUsageInfo,
  aiBuilderOutputSchema,
  aiTroubleshootOutputSchema,
  creditsFor,
  customCommandSchema,
  lowestPlanWithFeature,
  moduleConfigSchemas,
  validateProposal,
  workflowSchema,
} from '@delyforge/shared';
import { z } from 'zod';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AI_PROVIDERS, type AiTextProvider } from './provider';

/**
 * Credits held while a request runs (settled to the real amount afterwards). Typical cost, not worst case:
 * shortcut: requests in flight together can overshoot the allowance by (real − reserved) each, a few cents given the
 * per-minute rate limits; reserve creditsFor(input, maxTokens) instead if abuse shows up — at the cost of customers
 * not being able to spend their last ~44 credits.
 */
const RESERVE: Record<AiFeature, number> = { builder: 10, troubleshoot: 3 };

const schemaText = (s: z.ZodType) => JSON.stringify(z.toJSONSchema(s, { unrepresentable: 'any' }));

/** Built once: it never changes, so the provider can cache it. */
let builderSystem: string | null = null;
function builderSystemPrompt(): string {
  builderSystem ??= [
    'You set up Discord bots for DelyForge customers. You never act directly: your answer becomes a proposal the customer reviews and approves.',
    '',
    'Rules:',
    '- Configure only what the request asks for. Leave everything else out.',
    '- Use only channel and role IDs from the lists in the request. Never invent IDs. If something needs a channel or role that does not exist, leave it out and add a note telling the customer what to create.',
    '- `settingsJson` is a JSON object holding only the settings you change; everything you leave out keeps its default. Always include "enabled": true for a module you turn on.',
    '- Built-in modules already provide their slash commands (listed below). Only create custom commands for things the modules do not cover.',
    '- Custom commands and workflows cannot use saved embeds: always use "embedId": "".',
    '- `summary` is two or three plain sentences for a non-technical customer. Notes are short and practical. Write in the language of the request.',
    '',
    'Message templates can use: ' + TEMPLATE_VARIABLES.map((v) => `${v.key} (${v.description})`).join(', ') + '.',
    'Custom command replies can use: ' + COMMAND_VARIABLES.map((v) => `${v.key} (${v.description})`).join(', ') + '.',
    '',
    'Modules (id, what it does, built-in commands, defaults, JSON schema):',
    ...IMPLEMENTED_MODULES.map((id) => {
      const info = MODULES.find((m) => m.id === id)!;
      return `\n## ${id} — ${info.name}\n${info.summary}\nCommands: ${info.commands.join(', ') || 'none'}\nDefaults: ${JSON.stringify(DEFAULT_MODULE_CONFIGS[id])}\nSchema: ${schemaText(moduleConfigSchemas[id])}`;
    }),
    '',
    'Each entry of `commandsJson` is one custom command as JSON (without "id"). Schema:',
    schemaText(customCommandSchema),
    '',
    'Each entry of `workflowsJson` is one automation as JSON (without "id" and "guildId"). Schema:',
    schemaText(workflowSchema),
  ].join('\n');
  return builderSystem;
}

const TROUBLESHOOT_SYSTEM = [
  'You help DelyForge customers fix their Discord bots. DelyForge runs the bot on their PC with built-in, settings-driven features (no custom code).',
  'You get the bot status, its last error and recent log lines (secrets already removed). Find the most likely cause and give short, numbered, beginner-friendly steps.',
  'Common causes: an invalid or reset token (fix: Bot settings → Connect), privileged intents switched off in the Discord Developer Portal (Bot → Privileged Gateway Intents), missing permissions or a bot role placed below the roles it manages (Server Settings → Roles), and rate limits.',
  'Never ask for the bot token. If the logs do not show the cause, say so and suggest what to check. Write in the language of the question.',
].join('\n');

function guildText(g: AiGuildContext): string {
  return [
    `Server: ${g.name} (id ${g.id})`,
    'Channels:',
    ...g.channels.map((c) => `- ${c.id} #${c.name} (${c.kind})`),
    'Roles:',
    ...g.roles.map((r) => `- ${r.id} @${r.name}`),
  ].join('\n');
}

/**
 * The AI gateway: checks the plan and the monthly credit allowance, calls the configured provider, records usage,
 * and validates what comes back. Provider keys never leave this server.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AI_PROVIDERS) private readonly providers: Record<string, AiTextProvider>,
  ) {}

  get configured(): boolean {
    return Object.keys(this.providers).length > 0;
  }

  private static monthStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private async usedThisMonth(workspaceId: string, now: Date, db: Pick<PrismaService, 'aiUsage'> = this.prisma): Promise<number> {
    const sum = await db.aiUsage.aggregate({ where: { workspaceId, createdAt: { gte: AiService.monthStart(now) } }, _sum: { credits: true } });
    return sum._sum.credits ?? 0;
  }

  async usage(userId: string, workspaceId: string, now = new Date()): Promise<AiUsageInfo> {
    const [{ claims }, used] = await Promise.all([this.billing.entitlements(userId, workspaceId, now), this.usedThisMonth(workspaceId, now)]);
    const start = AiService.monthStart(now);
    return {
      configured: this.configured,
      used,
      limit: claims.limits.aiCreditsPerMonth,
      resetsAt: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString(),
    };
  }

  private async run<S extends z.ZodType>(
    feature: AiFeature,
    userId: string,
    workspaceId: string,
    req: { schema: S; system: string; user: string; maxTokens: number },
  ): Promise<{ output: z.infer<S>; credits: number }> {
    if (!this.configured) throw new ServiceUnavailableException('AI isn’t set up on this server yet.');
    const now = new Date();
    const { claims } = await this.billing.entitlements(userId, workspaceId, now);
    const key = AI_FEATURES[feature];
    if (!claims.features.includes(key)) {
      throw new ForbiddenException(`AI features are available on the ${lowestPlanWithFeature(key)?.name ?? 'Pro'} plan.`);
    }
    const limit = claims.limits.aiCreditsPerMonth;
    const model = await this.prisma.aiModel.findFirst({
      where: { enabled: true, provider: { enabled: true }, providerId: { in: Object.keys(this.providers) }, features: { array_contains: [feature] } },
      orderBy: { isDefault: 'desc' },
    });
    const provider = model ? this.providers[model.providerId] : undefined;
    if (!model || !provider) throw new ServiceUnavailableException('No AI model is enabled for this feature. Run the database seed (pnpm db:seed).');

    // Check the allowance and reserve credits under a per-workspace lock, so parallel requests can't all slip through.
    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      if ((await this.usedThisMonth(workspaceId, now, tx)) >= limit) {
        throw new ForbiddenException(`You’ve used all ${limit} AI credits for this month. They reset on the 1st.`);
      }
      return tx.aiUsage.create({
        data: { workspaceId, userId, modelId: model.id, feature, inputTokens: 0, outputTokens: 0, credits: RESERVE[feature], costMicroCents: 0, success: false },
      });
    });
    const settle = (inputTokens: number, outputTokens: number, credits: number, success: boolean) =>
      this.prisma.aiUsage.update({
        where: { id: reservation.id },
        data: {
          inputTokens,
          outputTokens,
          credits,
          success,
          // hundredths of a cent = tokens × (cents per million tokens) / 1,000,000 × 100
          costMicroCents: Math.round((inputTokens * model.inputCostPerMTokCents + outputTokens * model.outputCostPerMTokCents) / 10_000),
        },
      });

    let result;
    try {
      result = await provider.complete({ model: model.modelKey, ...req });
    } catch (e) {
      this.logger.error(`AI provider ${provider.id} failed: ${(e as Error).message}`);
      await settle(0, 0, 0, false); // nothing was generated, nothing is charged
      throw new ServiceUnavailableException('The AI service is busy or unavailable. Please try again in a minute.');
    }
    // Whatever the model generated is counted, usable or not — otherwise refusals would be free to repeat at our cost.
    const credits = creditsFor(result.inputTokens, result.outputTokens);
    await settle(result.inputTokens, result.outputTokens, credits, result.output !== null);
    if (result.output === null) {
      throw new UnprocessableEntityException(result.refused ? 'The AI declined this request. Try describing it differently.' : 'The AI’s answer couldn’t be used. Please try again.');
    }
    return { output: result.output, credits };
  }

  async buildBot(userId: string, workspaceId: string, input: { prompt: string; guild: AiGuildContext }): Promise<AiProposalResult> {
    const { output, credits } = await this.run('builder', userId, workspaceId, {
      schema: aiBuilderOutputSchema,
      system: builderSystemPrompt(),
      user: `${guildText(input.guild)}\n\nWhat the customer wants:\n<request>\n${input.prompt}\n</request>`,
      maxTokens: 16_000,
    });
    const proposal = validateProposal(output, input.guild);
    const row = await this.prisma.aiChangeProposal.create({
      data: { userId, prompt: input.prompt, summary: proposal.summary, changeSet: proposal as unknown as object },
    });
    return { proposalId: row.id, proposal, creditsUsed: credits, usage: await this.usage(userId, workspaceId) };
  }

  async troubleshoot(
    userId: string,
    workspaceId: string,
    input: { question: string; botName: string; status: string; lastError: string | null; logs: string[] },
  ): Promise<{ answer: AiTroubleshootAnswer; creditsUsed: number; usage: AiUsageInfo }> {
    const { output, credits } = await this.run('troubleshoot', userId, workspaceId, {
      schema: aiTroubleshootOutputSchema,
      system: TROUBLESHOOT_SYSTEM,
      user: [
        `Bot: ${input.botName}`,
        `Status: ${input.status}`,
        `Last error: ${input.lastError ?? 'none'}`,
        `Question: ${input.question || 'Why isn’t my bot working?'}`,
        'Recent logs (oldest first):',
        '<logs>',
        ...input.logs,
        '</logs>',
      ].join('\n'),
      maxTokens: 4_000,
    });
    return { answer: output, creditsUsed: credits, usage: await this.usage(userId, workspaceId) };
  }

  /** Records whether the customer applied or rejected a proposal (only their own, only once). */
  async decide(userId: string, proposalId: string, decision: 'applied' | 'rejected'): Promise<void> {
    const updated = await this.prisma.aiChangeProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { status: decision === 'applied' ? 'APPLIED' : 'REJECTED', decidedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException('That proposal doesn’t exist or was already decided.');
  }
}
