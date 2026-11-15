import { type MemberData, levelFromXp } from '@delyforge/shared';
import { BotStore } from '@delyforge/bot-runtime/store';
import type { BotRepository } from './db/bots';
import { AppError } from './errors';

/**
 * Warnings and levels for the bot's Members tab. Reads the bot's own data file (the same one the running bot uses —
 * SQLite allows both, with a short wait if they write at the same moment), so it works whether the bot is online or not.
 */
export class MembersService {
  constructor(
    private readonly dataDir: string,
    private readonly bots: Pick<BotRepository, 'get'>,
  ) {}

  private use<T>(botId: string, fn: (store: BotStore) => T): T {
    const bot = this.bots.get(botId);
    if (!bot.discordApplicationId) throw new AppError('VALIDATION_FAILED', 'Connect this bot to Discord first.');
    // A bot's user ID is its application ID, which is the name the bot gives its data file.
    const store = BotStore.open(this.dataDir, bot.discordApplicationId);
    try {
      return fn(store);
    } finally {
      store.close();
    }
  }

  data(botId: string, guildId: string): MemberData {
    return this.use(botId, (s) => {
      const names = s.names(guildId);
      return {
        warnings: s.allWarnings(guildId).map((w) => ({
          id: w.id,
          userId: w.userId,
          userName: names.get(w.userId) ?? null,
          moderatorName: names.get(w.moderatorId) ?? null,
          reason: w.reason,
          createdAt: w.createdAt,
        })),
        levels: s.leaderboard(guildId, 100).map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? null, xp: r.xp, level: levelFromXp(r.xp).level })),
      };
    });
  }

  deleteWarning(botId: string, guildId: string, warningId: number): void {
    if (!this.use(botId, (s) => s.deleteWarning(guildId, warningId))) throw new AppError('NOT_FOUND', 'That warning was already removed.');
  }

  clearWarnings(botId: string, guildId: string, userId: string): number {
    return this.use(botId, (s) => s.clearWarnings(guildId, userId));
  }

  /** One member's XP, or everyone's in the server when `userId` is null. */
  resetXp(botId: string, guildId: string, userId: string | null): number {
    return this.use(botId, (s) => s.resetXp(guildId, userId));
  }
}
