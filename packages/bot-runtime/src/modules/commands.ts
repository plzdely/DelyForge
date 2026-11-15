import { createHash } from 'node:crypto';
import type { ModuleConfigs } from '@delyforge/shared';
import {
  PermissionFlagsBits,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';

type CommandJSON = RESTPostAPIChatInputApplicationCommandsJSONBody;

/** Staff-only commands use `default_member_permissions`, so Discord hides them from members without the permission. */
const MODERATION: CommandJSON[] = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Show a member’s warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose warnings').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Remove all of a member’s warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose warnings').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Temporarily stop a member from chatting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to time out').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long (max 40320 = 28 days)').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member’s timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Remove a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .addIntegerOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('Delete their recent messages')
        .addChoices({ name: 'Don’t delete any', value: 0 }, { name: 'Last 24 hours', value: 86400 }, { name: 'Last 7 days', value: 604800 }),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Lift a ban')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('user_id').setDescription('ID of the banned user').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('amount').setDescription('How many (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('member').setDescription('Only messages from this member'))
    .toJSON(),
];

const UTILITY: Record<keyof ModuleConfigs['utility']['commands'], CommandJSON> = {
  serverinfo: new SlashCommandBuilder().setName('serverinfo').setDescription('Information about this server').setDMPermission(false).toJSON(),
  userinfo: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Information about a member')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who (defaults to you)'))
    .toJSON(),
  avatar: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show someone’s avatar')
    .addUserOption((o) => o.setName('user').setDescription('Who (defaults to you)'))
    .toJSON(),
  poll: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Start a poll')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('options').setDescription('Answers separated by | e.g. Yes | No | Maybe').setRequired(true).setMaxLength(500))
    .addIntegerOption((o) => o.setName('hours').setDescription('How long it runs (default 24)').setMinValue(1).setMaxValue(768))
    .addBooleanOption((o) => o.setName('multiple').setDescription('Allow picking more than one answer'))
    .toJSON(),
};

export function commandHash(c: CommandJSON): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);
}

/** The slash commands a server should have for its module settings. */
export function desiredCommands(config: ModuleConfigs): CommandJSON[] {
  const out: CommandJSON[] = [];
  if (config.moderation.enabled) out.push(...MODERATION);
  if (config.utility.enabled) {
    for (const [key, enabled] of Object.entries(config.utility.commands)) {
      if (enabled) out.push(UTILITY[key as keyof typeof UTILITY]);
    }
  }
  return out;
}
