import { randomInt } from 'node:crypto';
import { checkCount, countedNumber, DARES, EIGHT_BALL, rpsResult, shuffleTrivia, ticTacToeResult, TRIVIA_QUESTIONS, TRUTHS, WOULD_YOU_RATHER } from '@delyforge/shared';
import { type ButtonInteraction, ButtonStyle, type ChatInputCommandInteraction, ComponentType, type Message, MessageFlags } from 'discord.js';
import { COLORS, type ModuleContext, truncate } from './context.js';

export const GAME_COMMANDS = new Set(['count', 'trivia', 'rps', '8ball', 'tictactoe', 'wouldyourather', 'truth', 'dare']);

// ─── Tic-tac-toe ──────────────────────────────────────────────────────────────────────────────────────────────────

interface TttGame {
  players: [string, string];
  board: ('X' | 'O' | null)[];
  turn: 0 | 1;
  at: number;
}
const ttt = new Map<string, TttGame>();

function tttComponents(token: string, g: TttGame, over: boolean) {
  return [0, 1, 2].map((row) => ({
    type: ComponentType.ActionRow as const,
    components: [0, 1, 2].map((col) => {
      const n = row * 3 + col;
      const v = g.board[n];
      return { type: ComponentType.Button as const, style: v === 'X' ? ButtonStyle.Primary : v === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary, label: v ?? '·', custom_id: `df:ttt:${token}:${n}`, disabled: over || v !== null };
    }),
  }));
}

/** A tic-tac-toe square was clicked. */
export async function onTicTacToe(i: ButtonInteraction, token: string, square: number): Promise<void> {
  const g = ttt.get(token);
  if (!g) return void (await i.reply({ content: 'This game is over.', flags: MessageFlags.Ephemeral }));
  if (i.user.id !== g.players[g.turn]) return void (await i.reply({ content: g.players.includes(i.user.id) ? 'It’s not your turn.' : 'You’re not in this game.', flags: MessageFlags.Ephemeral }));
  if (g.board[square]) return void (await i.reply({ content: 'That square is taken.', flags: MessageFlags.Ephemeral }));
  g.board[square] = g.turn === 0 ? 'X' : 'O';
  const result = ticTacToeResult(g.board);
  if (result) ttt.delete(token);
  else g.turn = g.turn === 0 ? 1 : 0;
  const text = result === 'draw' ? '🤝 It’s a draw!' : result ? `🏆 <@${g.players[result === 'X' ? 0 : 1]}> wins!` : `<@${g.players[g.turn]}>’s turn (${g.turn === 0 ? 'X' : 'O'})`;
  await i.update({ content: `❌ <@${g.players[0]}> vs ⭕ <@${g.players[1]}>\n${text}`, components: tttComponents(token, g, !!result), allowedMentions: { parse: [] } });
}

// ─── Counting ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A message in the counting channel. The check and save happen before any await, so two quick messages can't both pass. */
export async function onCountingMessage(ctx: ModuleContext, m: Message): Promise<void> {
  if (!m.inGuild() || m.author.bot) return;
  const c = ctx.config(m.guild.id).games;
  if (!c.enabled || m.channelId !== c.counting.channelId) return;
  const n = countedNumber(m.content);
  if (n === null) return; // chatting in between is fine
  const state = ctx.store.counting(m.guild.id);
  const r = checkCount(state, n, m.author.id, c.counting);
  if (r.ok) {
    ctx.store.setCounting(m.guild.id, r.count, m.author.id);
    await m.react(r.count % 100 === 0 ? '🎉' : '✅').catch(() => null);
    if (r.record && r.count % 50 === 0) await m.reply({ content: `🏆 New record: **${r.count}**!`, allowedMentions: { parse: [] } }).catch(() => null);
    return;
  }
  if (c.counting.onFail === 'delete') return void (await m.delete().catch(() => null));
  ctx.store.setCounting(m.guild.id, 0, null);
  await m.react('❌').catch(() => null);
  const why = r.reason === 'twice' ? 'counted twice in a row' : `wrote ${n} (the next number was ${r.expected})`;
  await m.reply({ content: `💥 <@${m.author.id}> ${why}. We got to **${state.count}** — start again from **1**. (Record: ${Math.max(state.record, state.count)})`, allowedMentions: { parse: [] } }).catch(() => null);
}

// ─── Trivia ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Round {
  guildId: string;
  answers: string[];
  correctIndex: number;
  tried: Set<string>;
  done: boolean;
}
/** Running trivia questions, by token; one per channel at a time. */
const rounds = new Map<string, Round>();
const busyChannels = new Set<string>();

export async function handleGameCommand(ctx: ModuleContext, i: ChatInputCommandInteraction): Promise<void> {
  const c = i.guildId ? ctx.config(i.guildId).games : null;
  if (!c?.enabled) return void (await i.reply({ content: 'Games aren’t enabled in this server.', flags: MessageFlags.Ephemeral }));

  if (i.commandName === 'rps') {
    const moves = ['rock', 'paper', 'scissors'] as const;
    const player = i.options.getString('pick', true) as (typeof moves)[number];
    const bot = moves[randomInt(3)]!;
    const icon = { rock: '🪨', paper: '📄', scissors: '✂️' };
    const result = rpsResult(player, bot);
    return void (await i.reply(`${icon[player]} vs ${icon[bot]} — ${result === 'win' ? 'you win! 🎉' : result === 'lose' ? 'I win! 😎' : 'it’s a draw.'}`));
  }
  if (i.commandName === 'tictactoe') {
    const opponent = i.options.getUser('opponent', true);
    if (opponent.bot || opponent.id === i.user.id) return void (await i.reply({ content: 'Pick another member to play against.', flags: MessageFlags.Ephemeral }));
    for (const [k, v] of ttt) if (Date.now() - v.at > 3_600_000) ttt.delete(k);
    const token = randomInt(1, 2 ** 31).toString(36);
    const g: TttGame = { players: [i.user.id, opponent.id], board: Array(9).fill(null), turn: 0, at: Date.now() };
    ttt.set(token, g);
    return void (await i.reply({ content: `❌ <@${i.user.id}> vs ⭕ <@${opponent.id}>\n<@${i.user.id}>’s turn (X)`, components: tttComponents(token, g, false), allowedMentions: { users: [opponent.id] } }));
  }
  if (i.commandName === 'wouldyourather') {
    const q = WOULD_YOU_RATHER[randomInt(WOULD_YOU_RATHER.length)]!;
    const [a, b] = q.replace(/\?$/, '').split(' or ');
    const msg = await i.reply({ embeds: [{ title: '🤔 Would you rather…', description: `🅰️ ${a}\n🅱️ ${b}`, color: COLORS.info }], withResponse: true });
    const sent = msg.resource?.message;
    if (sent) for (const e of ['🅰️', '🅱️']) await sent.react(e).catch(() => null);
    return;
  }
  if (i.commandName === 'truth' || i.commandName === 'dare') {
    const list = i.commandName === 'truth' ? TRUTHS : DARES;
    return void (await i.reply({ embeds: [{ title: i.commandName === 'truth' ? '🗣️ Truth' : '🔥 Dare', description: list[randomInt(list.length)], color: i.commandName === 'truth' ? COLORS.info : COLORS.danger }] }));
  }
  if (i.commandName === '8ball') {
    return void (await i.reply({ content: `🎱 *${truncate(i.options.getString('question', true), 200)}*\n**${EIGHT_BALL[randomInt(EIGHT_BALL.length)]}**`, allowedMentions: { parse: [] } }));
  }
  if (i.commandName === 'count') {
    if (!c.counting.channelId) return void (await i.reply({ content: 'There’s no counting channel set up.', flags: MessageFlags.Ephemeral }));
    const s = ctx.store.counting(i.guildId!);
    const top = ctx.store.topCounters(i.guildId!, 5);
    return void (await i.reply({
      embeds: [{ title: '🔢 Counting', description: `Next number in <#${c.counting.channelId}>: **${s.count + 1}**\nRecord: **${Math.max(s.record, s.count)}**${top.length ? `\n\n**Top counters**\n${top.map((t, n) => `${n + 1}. <@${t.userId}> — ${t.n}`).join('\n')}` : ''}`, color: COLORS.brand }],
      allowedMentions: { parse: [] },
    }));
  }

  // trivia
  if (!c.trivia.enabled) return void (await i.reply({ content: 'Trivia is turned off here.', flags: MessageFlags.Ephemeral }));
  if (busyChannels.has(i.channelId)) return void (await i.reply({ content: 'A trivia question is already running here.', flags: MessageFlags.Ephemeral }));
  const pool = [...TRIVIA_QUESTIONS, ...c.trivia.custom];
  const q = shuffleTrivia(pool[randomInt(pool.length)]!, [0, 1, 2, 3].map(() => randomInt(0, 1_000_000) / 1_000_000));
  const token = randomInt(1, 2 ** 31).toString(36);
  rounds.set(token, { guildId: i.guildId!, answers: q.answers, correctIndex: q.correctIndex, tried: new Set(), done: false });
  busyChannels.add(i.channelId);
  const endsAt = Date.now() + c.trivia.seconds * 1000;
  const reward = c.trivia.reward && ctx.config(i.guildId!).economy.enabled ? ` · prize: ${c.trivia.reward} ${ctx.config(i.guildId!).economy.currencyName}` : '';
  const buttons = (disabled: boolean, highlight = -1) => [
    {
      type: ComponentType.ActionRow as const,
      components: q.answers.map((a, n) => ({ type: ComponentType.Button as const, style: n === highlight ? ButtonStyle.Success : ButtonStyle.Secondary, label: truncate(a, 80), custom_id: `df:triv:${token}:${n}`, disabled })),
    },
  ];
  await i.reply({ embeds: [{ title: '🧠 Trivia', description: `**${q.question}**\n\nEnds <t:${Math.floor(endsAt / 1000)}:R>${reward}`, color: COLORS.info }], components: buttons(false) });
  setTimeout(() => {
    busyChannels.delete(i.channelId);
    const round = rounds.get(token);
    rounds.delete(token);
    if (!round || round.done) return;
    void i.editReply({ embeds: [{ title: '🧠 Trivia', description: `**${q.question}**\n\n⏰ Time’s up! The answer was **${q.answers[q.correctIndex]}**.`, color: COLORS.warn }], components: buttons(true, q.correctIndex) }).catch(() => null);
  }, c.trivia.seconds * 1000);
}

/** A trivia answer button. */
export async function onTriviaAnswer(ctx: ModuleContext, i: ButtonInteraction, token: string, pick: number): Promise<void> {
  const round = rounds.get(token);
  if (!round || round.done) return void (await i.reply({ content: 'This question is over.', flags: MessageFlags.Ephemeral }));
  if (round.tried.has(i.user.id)) return void (await i.reply({ content: 'You already answered.', flags: MessageFlags.Ephemeral }));
  round.tried.add(i.user.id);
  if (pick !== round.correctIndex) return void (await i.reply({ content: '❌ Wrong — you’re out for this one.', flags: MessageFlags.Ephemeral }));
  round.done = true;
  const games = ctx.config(round.guildId).games;
  const eco = ctx.config(round.guildId).economy;
  const paid = games.trivia.reward && eco.enabled && ctx.store.addCoins(round.guildId, i.user.id, games.trivia.reward, eco.startingBalance);
  const embed = i.message.embeds[0];
  await i.update({
    embeds: [{ title: '🧠 Trivia', description: `${embed?.description?.split('\n')[0] ?? ''}\n\n🏆 <@${i.user.id}> got it: **${round.answers[pick]}**${paid ? ` and won ${games.trivia.reward} ${eco.currencyName}!` : '!'}`, color: COLORS.success }],
    components: [{ type: ComponentType.ActionRow, components: round.answers.map((a, n) => ({ type: ComponentType.Button, style: n === pick ? ButtonStyle.Success : ButtonStyle.Secondary, label: truncate(a, 80), custom_id: `df:triv:${token}:${n}`, disabled: true })) }],
    allowedMentions: { parse: [] },
  });
}
