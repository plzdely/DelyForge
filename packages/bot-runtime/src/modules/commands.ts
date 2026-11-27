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
    .setName('unwarn')
    .setDescription('Remove one warning (see the numbers in /warnings)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Whose warning').setRequired(true))
    .addIntegerOption((o) => o.setName('number').setDescription('Which warning, as numbered in /warnings').setRequired(true).setMinValue(1).setMaxValue(25))
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
    .addBooleanOption((o) => o.setName('links').setDescription('Only messages with links'))
    .addBooleanOption((o) => o.setName('attachments').setDescription('Only messages with files or images'))
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
  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock every text channel at once (raids, emergencies)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlockdown')
    .setDescription('Unlock every channel that /lockdown locked')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Give a member a role for a while (taken back automatically)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 2h, 7d (max 30d)').setRequired(true).setMaxLength(20))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('reason')
    .setDescription('Change the reason of a moderation case')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('case').setDescription('Case number').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('The new reason').setRequired(true).setMaxLength(400))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('modstats')
    .setDescription('How many actions a moderator took')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('moderator').setDescription('Who (defaults to you)'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('dehoist')
    .setDescription('Remove symbols from the start of nicknames (stops hoisting to the top of the list)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
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
  remind: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Get a reminder later')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('in').setDescription('When, e.g. 10m, 2h, 1d or 1h30m (up to 30 days)').setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(500))
    .toJSON(),
  roll: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice')
    .addIntegerOption((o) => o.setName('sides').setDescription('Sides per die (default 6)').setMinValue(2).setMaxValue(1000))
    .addIntegerOption((o) => o.setName('dice').setDescription('How many dice (default 1)').setMinValue(1).setMaxValue(10))
    .toJSON(),
  afk: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Tell people you’re away; it’s cleared when you talk again')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('reason').setDescription('Why (optional)').setMaxLength(200))
    .toJSON(),
  roleinfo: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Information about a role')
    .setDMPermission(false)
    .addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
    .toJSON(),
  channelinfo: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Information about a channel')
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('channel').setDescription('Which channel (defaults to this one)'))
    .toJSON(),
  membercount: new SlashCommandBuilder().setName('membercount').setDescription('How many members, people and bots this server has').setDMPermission(false).toJSON(),
  choose: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Let the bot pick for you')
    .addStringOption((o) => o.setName('options').setDescription('Choices separated by | e.g. pizza | tacos | sushi').setRequired(true).setMaxLength(500))
    .toJSON(),
  emoji: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Add an emoji from another server to this one')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('emoji').setDescription('Paste the emoji (or its image link)').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('name').setDescription('Name for it here').setMinLength(2).setMaxLength(32))
    .toJSON(),
  timestamp: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Make a time that shows in everyone’s own time zone')
    .addStringOption((o) => o.setName('in').setDescription('From now, e.g. 2h, 1d, 1h30m').setRequired(true).setMaxLength(20))
    .toJSON(),
  banner: new SlashCommandBuilder()
    .setName('banner')
    .setDescription('Show someone’s profile banner')
    .addUserOption((o) => o.setName('user').setDescription('Who (defaults to you)'))
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
  new SlashCommandBuilder().setName('rewards').setDescription('The roles you get for reaching levels').setDMPermission(false).toJSON(),
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

const PRICE: CommandJSON = new SlashCommandBuilder()
  .setName('price')
  .setDescription('What something in the shop costs right now')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('item').setDescription('Start typing an item').setRequired(true).setAutocomplete(true).setMaxLength(100))
  .toJSON();

const VOUCH: CommandJSON = new SlashCommandBuilder()
  .setName('vouch')
  .setDescription('Leave a review of your order')
  .setDMPermission(false)
  .addIntegerOption((o) => o.setName('stars').setDescription('1 to 5 stars').setRequired(true).setMinValue(1).setMaxValue(5))
  .addStringOption((o) => o.setName('review').setDescription('How was it?').setRequired(true).setMaxLength(1000))
  .addAttachmentOption((o) => o.setName('image').setDescription('A screenshot of what you got (optional)'))
  .toJSON();

const MODMAIL: CommandJSON = new SlashCommandBuilder()
  .setName('modmail')
  .setDescription('Staff: manage modmail conversations')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('open').setDescription('Start a conversation with a member').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .addSubcommand((s) => s.setName('close').setDescription('Close the conversation in this thread').addStringOption((o) => o.setName('reason').setDescription('Why (sent to the member)').setMaxLength(300)))
  .addSubcommand((s) => s.setName('block').setDescription('Stop a member from using modmail').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .addSubcommand((s) => s.setName('unblock').setDescription('Let a member use modmail again').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .toJSON();

const amount = (o: import('discord.js').SlashCommandStringOption) => o.setName('amount').setDescription('A number, or all / half / 50%').setRequired(true).setMaxLength(20);
const ECONOMY: Record<string, CommandJSON> = {
  balance: new SlashCommandBuilder().setName('balance').setDescription('Your coins (wallet and bank)').setDMPermission(false).addUserOption((o) => o.setName('member').setDescription('Whose (defaults to you)')).toJSON(),
  daily: new SlashCommandBuilder().setName('daily').setDescription('Collect your daily coins (keep your streak going!)').setDMPermission(false).toJSON(),
  work: new SlashCommandBuilder().setName('work').setDescription('Work for some coins').setDMPermission(false).toJSON(),
  pay: new SlashCommandBuilder().setName('pay').setDescription('Give coins to someone').setDMPermission(false).addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addStringOption(amount).toJSON(),
  deposit: new SlashCommandBuilder().setName('deposit').setDescription('Put coins in the bank (safe from /rob)').setDMPermission(false).addStringOption(amount).toJSON(),
  withdraw: new SlashCommandBuilder().setName('withdraw').setDescription('Take coins out of the bank').setDMPermission(false).addStringOption(amount).toJSON(),
  rob: new SlashCommandBuilder().setName('rob').setDescription('Try to steal from someone’s wallet (risky!)').setDMPermission(false).addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).toJSON(),
  rich: new SlashCommandBuilder().setName('rich').setDescription('The richest members').setDMPermission(false).toJSON(),
  shopitems: new SlashCommandBuilder().setName('shopitems').setDescription('What you can buy with coins').setDMPermission(false).toJSON(),
  buy: new SlashCommandBuilder().setName('buy').setDescription('Buy something from the coin shop').setDMPermission(false).addStringOption((o) => o.setName('item').setDescription('Start typing an item').setRequired(true).setAutocomplete(true).setMaxLength(40)).toJSON(),
  inventory: new SlashCommandBuilder().setName('inventory').setDescription('What you bought').setDMPermission(false).addUserOption((o) => o.setName('member').setDescription('Whose (defaults to you)')).toJSON(),
  coinflip: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Bet coins on heads or tails')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
    .addStringOption(amount)
    .toJSON(),
  slots: new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine').setDMPermission(false).addStringOption(amount).toJSON(),
  eco: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Staff: change members’ coins')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Give coins').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
    .addSubcommand((s) => s.setName('take').setDescription('Take coins').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
    .addSubcommand((s) => s.setName('set').setDescription('Set a wallet to an exact amount').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('New wallet').setRequired(true).setMinValue(0).setMaxValue(1_000_000_000)))
    .addSubcommand((s) => s.setName('reset').setDescription('Wipe a member’s coins and items').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
    .toJSON(),
};

const GAMES = {
  count: new SlashCommandBuilder().setName('count').setDescription('The counting channel’s current number, record and top counters').setDMPermission(false).toJSON(),
  trivia: new SlashCommandBuilder().setName('trivia').setDescription('Start a trivia question — first right answer wins').setDMPermission(false).toJSON(),
  rps: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Rock, paper, scissors against the bot')
    .addStringOption((o) => o.setName('pick').setDescription('Your move').setRequired(true).addChoices({ name: '🪨 Rock', value: 'rock' }, { name: '📄 Paper', value: 'paper' }, { name: '✂️ Scissors', value: 'scissors' }))
    .toJSON(),
  eightball: new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball a question').addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)).toJSON(),
} satisfies Record<string, CommandJSON>;

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
      .setDescription('Let a member — or everyone with a role — see this ticket')
      .addMentionableOption((o) => o.setName('who').setDescription('A member or a role').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Take a member or role out of this ticket')
      .addMentionableOption((o) => o.setName('who').setDescription('A member or a role').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Take this ticket'))
  .addSubcommand((s) => s.setName('unclaim').setDescription('Give this ticket back so someone else can take it'))
  .addSubcommand((s) =>
    s
      .setName('transfer')
      .setDescription('Hand this ticket to another staff member')
      .addUserOption((o) => o.setName('member').setDescription('Who takes over').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('priority')
      .setDescription('Mark how urgent this ticket is (shown in the channel name)')
      .addStringOption((o) =>
        o.setName('level').setDescription('How urgent').setRequired(true).addChoices({ name: '🟢 Low', value: 'low' }, { name: '🟡 Medium', value: 'medium' }, { name: '🔴 High', value: 'high' }, { name: 'None', value: 'none' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('closerequest')
      .setDescription('Ask the member if the ticket can be closed')
      .addStringOption((o) => o.setName('reason').setDescription('Why (optional)').setMaxLength(300)),
  )
  .addSubcommand((s) => s.setName('stats').setDescription('Open tickets and who handled the most this week'))
  .addSubcommand((s) =>
    s
      .setName('rename')
      .setDescription('Rename this ticket channel')
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)),
  )
  .addSubcommand((s) =>
    s
      .setName('close')
      .setDescription('Close this ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the transcript and the DM)').setMaxLength(300)),
  )
  .toJSON();

const VOICE: CommandJSON = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Control your temporary voice channel')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('lock').setDescription('Stop new people from joining'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Let people join again'))
  .addSubcommand((s) => s.setName('hide').setDescription('Hide the channel from everyone who isn’t in it'))
  .addSubcommand((s) => s.setName('unhide').setDescription('Show the channel again'))
  .addSubcommand((s) => s.setName('permit').setDescription('Let someone join even when locked').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .addSubcommand((s) => s.setName('kick').setDescription('Disconnect someone from your channel').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .addSubcommand((s) => s.setName('ban').setDescription('Disconnect someone and stop them joining again').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
  .addSubcommand((s) => s.setName('transfer').setDescription('Give your channel to someone in it').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))
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
  .addSubcommand((s) => s.setName('list').setDescription('Show the giveaways that are running'))
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
  if (config.shop.enabled) out.push(PRICE);
  if (config.shop.enabled && config.shop.vouchChannelId) out.push(VOUCH);
  if (config.modmail.enabled) out.push(MODMAIL);
  if (config.economy.enabled) {
    const e = config.economy;
    for (const [name, def] of Object.entries(ECONOMY)) {
      if (name === 'rob' && !e.rob.enabled) continue;
      if ((name === 'coinflip' || name === 'slots') && !e.gambling.enabled) continue;
      if ((name === 'shopitems' || name === 'buy' || name === 'inventory') && !e.shop.length) continue;
      out.push(def);
    }
  }
  if (config.games.enabled) {
    if (config.games.counting.channelId) out.push(GAMES.count);
    if (config.games.trivia.enabled) out.push(GAMES.trivia);
    if (config.games.fun) out.push(GAMES.rps, GAMES.eightball);
  }
  return out;
}
