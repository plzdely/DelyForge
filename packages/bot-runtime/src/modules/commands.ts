import { createHash } from 'node:crypto';
import type { ModuleConfigs } from '@delyforge/shared';
import {
  ChannelType,
  PermissionFlagsBits,
  type RESTPostAPIApplicationCommandsJSONBody,
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
    .setDescription('Ban a member (optionally for a while)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .addStringOption((o) => o.setName('duration').setDescription('For how long, e.g. 12h or 3d (empty = permanent, max 30d)').setMaxLength(20))
    .addIntegerOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('Delete their recent messages')
        .addChoices({ name: 'Don’t delete any', value: 0 }, { name: 'Last 24 hours', value: 86400 }, { name: 'Last 7 days', value: 604800 }),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('A member’s moderation history (cases)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose history').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('case')
    .setDescription('Show one moderation case')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add a private staff note to a member’s history')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('About whom').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Stop everyone from sending messages in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('channel').setDescription('Which channel (defaults to this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Let everyone send messages in a channel again')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('channel').setDescription('Which channel (defaults to this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Limit how often members can send messages in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds between messages (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption((o) => o.setName('channel').setDescription('Which channel (defaults to this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
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
    .addBooleanOption((o) => o.setName('bots').setDescription('Only messages from bots'))
    .addStringOption((o) => o.setName('contains').setDescription('Only messages containing this text').setMaxLength(100))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Kick a member and delete their messages from the last 7 days')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who to softban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give or take a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName('give').setDescription('Give a member a role').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('take').setDescription('Take a role from a member').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true)),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Change or reset a member’s nickname')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('nickname').setDescription('New nickname (leave empty to reset)').setMaxLength(32))
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

export function commandHash(c: RESTPostAPIApplicationCommandsJSONBody): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);
}

/** The slash commands a server should have for its module settings. */
const LEVELING: CommandJSON[] = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your level and XP')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose rank (defaults to you)'))
    .toJSON(),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by XP').setDMPermission(false).toJSON(),
  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Staff: give, take or set a member’s XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Give XP').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
    .addSubcommand((s) => s.setName('take').setDescription('Take XP away').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
    .addSubcommand((s) => s.setName('set').setDescription('Set XP to an exact amount').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('New total').setRequired(true).setMinValue(0).setMaxValue(10_000_000)))
    .toJSON(),
];

const STARS: CommandJSON = new SlashCommandBuilder().setName('stars').setDescription('Members whose messages got the most stars').setDMPermission(false).toJSON();

const INVITES: CommandJSON[] = [
  new SlashCommandBuilder()
    .setName('invites')
    .setDescription('How many members someone invited, and who invited them')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose invites (defaults to you)'))
    .toJSON(),
  new SlashCommandBuilder().setName('inviteboard').setDescription('Top inviters in this server').setDMPermission(false).toJSON(),
];

const BIRTHDAY: CommandJSON = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Your birthday in this server')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Save your birthday')
      .addIntegerOption((o) => o.setName('month').setDescription('Month (1–12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((o) => o.setName('day').setDescription('Day (1–31)').setRequired(true).setMinValue(1).setMaxValue(31)),
  )
  .addSubcommand((s) => s.setName('remove').setDescription('Forget your birthday'))
  .addSubcommand((s) => s.setName('upcoming').setDescription('The next birthdays in this server'))
  .toJSON();

const TICKET: CommandJSON = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage the ticket in this channel')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Let another member see this ticket')
      .addUserOption((o) => o.setName('member').setDescription('Who to add').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Take someone out of this ticket')
      .addUserOption((o) => o.setName('member').setDescription('Who to remove').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('rename')
      .setDescription('Rename this ticket channel')
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)),
  )
  .addSubcommand((s) => s.setName('close').setDescription('Close this ticket'))
  .toJSON();

const VOICE: CommandJSON = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Control your temporary voice channel')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('lock').setDescription('Stop new people from joining'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Let people join again'))
  .addSubcommand((s) => s.setName('limit').setDescription('Set how many people can join').addIntegerOption((o) => o.setName('people').setDescription('0 = no limit').setRequired(true).setMinValue(0).setMaxValue(99)))
  .addSubcommand((s) => s.setName('rename').setDescription('Rename your channel').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)))
  .addSubcommand((s) => s.setName('claim').setDescription('Take over the channel if its owner left'))
  .toJSON();

const SUGGEST: CommandJSON = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Share an idea for the server')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMinLength(5).setMaxLength(1500))
  .toJSON();

/** Visible to everyone; the bot checks Manage Server or the configured manager roles when it runs. */
const GIVEAWAY: CommandJSON = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Run giveaways')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What can be won').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 30m, 2h, 1d, 1h30m').setRequired(true).setMaxLength(20))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can enter')),
  )
  .addSubcommand((s) =>
    s
      .setName('end')
      .setDescription('End a giveaway now')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway number (shown at the bottom of it)').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Pick another winner')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway number').setRequired(true).setMinValue(1)),
  )
  .toJSON();

export function desiredCommands(config: ModuleConfigs): CommandJSON[] {
  const out: CommandJSON[] = [];
  if (config.moderation.enabled) out.push(...MODERATION);
  if (config.utility.enabled) {
    for (const [key, enabled] of Object.entries(config.utility.commands)) {
      if (enabled) out.push(UTILITY[key as keyof typeof UTILITY]);
    }
  }
  if (config.leveling.enabled) out.push(...LEVELING);
  if (config.tickets.enabled) out.push(TICKET);
  if (config.suggestions.enabled) out.push(SUGGEST);
  if (config.giveaways.enabled) out.push(GIVEAWAY);
  if (config.invites.enabled) out.push(...INVITES);
  if (config.starboard.enabled) out.push(STARS);
  if (config.tempVoice.enabled && config.tempVoice.ownerCommands) out.push(VOICE);
  if (config.birthdays.enabled) out.push(BIRTHDAY);
  return out;
}
