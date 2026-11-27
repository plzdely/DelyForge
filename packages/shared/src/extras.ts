import type { AutoResponder, ChannelRule } from './modules.js';

/** Pure helpers for the 0.5 modules (auto-responder, highlights, channel rules, tickets, games, /calc). */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does a message set off an auto-responder? Returns what came after the trigger ({args}) or null. Case doesn't matter. */
export function matchTrigger(text: string, r: Pick<AutoResponder, 'trigger' | 'match'>): string | null {
  const t = text.trim();
  const lower = t.toLowerCase();
  const trig = r.trigger.trim().toLowerCase();
  if (!trig) return null;
  switch (r.match) {
    case 'exact':
      return lower === trig ? '' : null;
    case 'startsWith':
      return lower.startsWith(trig) ? t.slice(trig.length).trim() : null;
    case 'contains': {
      const at = lower.indexOf(trig);
      return at >= 0 ? t.slice(at + trig.length).trim() : null;
    }
    case 'word': {
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(trig)}($|[^\\p{L}\\p{N}])`, 'u').exec(lower);
      return m ? t.slice(m.index + m[0].length).trim() : null;
    }
  }
}

/** Highlights: is this watched word in the message as a whole word? */
export function highlightHit(text: string, word: string): boolean {
  return matchTrigger(text, { trigger: word, match: 'word' }) !== null;
}

/** Why a message breaks a channel's "only" rule, or null when it's fine. */
export function channelRuleProblem(only: ChannelRule['only'], m: { text: string; attachments: number }): string | null {
  const hasLink = /https?:\/\/\S+/i.test(m.text);
  if (only === 'media' && !m.attachments && !hasLink) return 'only images, videos and files can be posted there';
  if (only === 'text' && m.attachments) return 'only text messages can be posted there (no files)';
  if (only === 'links' && !hasLink) return 'every message there needs a link';
  return null;
}

/** "thanks @x", "thank you @x", "ty @x", "thx @x" — someone thanking the people they mention. */
export function isThanks(text: string): boolean {
  return /(^|\s)(thanks|thank\s*you|thx|ty|tysm|cheers)(\s|$|!|,|\.)/i.test(text);
}

/** "HH:MM" → minutes after midnight. */
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is `time` ("HH:MM") on `day` inside the opening hours? Handles hours past midnight (e.g. 18:00–02:00). */
export function withinHours(h: { from: string; to: string; days: number[] }, day: number, time: string): boolean {
  const now = minutes(time);
  const from = minutes(h.from);
  const to = minutes(h.to);
  if (from === to) return !h.days.length || h.days.includes(day);
  if (from < to) return (!h.days.length || h.days.includes(day)) && now >= from && now < to;
  // Overnight: after `from` counts for today, before `to` belongs to yesterday's opening.
  if (now >= from) return !h.days.length || h.days.includes(day);
  if (now < to) return !h.days.length || h.days.includes((day + 6) % 7);
  return false;
}

// ─── /calc ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A small calculator: + - * / % ^, brackets, decimals and unary minus. No variables or function calls, so nothing
 * typed can run code. Returns null for anything it can't read (or division by zero).
 */
export function calculate(input: string): number | null {
  const src = input.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (!src || src.length > 200 || !/^[\d.+\-*/%^()]+$/.test(src)) return null;
  let pos = 0;
  const peek = () => src[pos];
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = src[pos++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[pos++];
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new Error('div0');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const power = (): number => {
    const base = unary();
    if (peek() === '^') {
      pos++;
      return base ** power(); // right-associative: 2^3^2 = 2^9
    }
    return base;
  };
  const unary = (): number => {
    if (peek() === '-') {
      pos++;
      return -unary();
    }
    if (peek() === '+') {
      pos++;
      return unary();
    }
    return atom();
  };
  const atom = (): number => {
    if (peek() === '(') {
      pos++;
      const v = expr();
      if (src[pos++] !== ')') throw new Error('bracket');
      return v;
    }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(pos));
    if (!m) throw new Error('number');
    pos += m[0].length;
    return Number(m[0]);
  };
  try {
    const v = expr();
    return pos === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// ─── Tic-tac-toe ──────────────────────────────────────────────────────────────────────────────────────────────────

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

/** 'X' or 'O' when someone has three in a row, 'draw' when the board is full, otherwise null. */
export function ticTacToeResult(board: readonly ('X' | 'O' | null)[]): 'X' | 'O' | 'draw' | null {
  for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]!;
  return board.every(Boolean) ? 'draw' : null;
}

export const WOULD_YOU_RATHER = [
  'be able to fly or be invisible?', 'never use social media again or never watch another movie?', 'live in the mountains or by the sea?',
  'have more time or more money?', 'speak every language or play every instrument?', 'always be 10 minutes late or 20 minutes early?',
  'explore space or the deep ocean?', 'lose your phone or your wallet?', 'have a rewind button or a pause button for your life?',
  'be famous or be the best friend of someone famous?', 'eat only pizza or only tacos forever?', 'live without music or without games?',
  'be a wizard or a superhero?', 'have unlimited snacks or unlimited sleep?', 'know the future or change the past?',
  'never be cold or never be hot?', 'have a pet dragon or a pet dinosaur?', 'win the lottery or live twice as long?',
  'be the funniest or the smartest person in the room?', 'only whisper or only shout?',
] as const;

export const TRUTHS = [
  'What’s the most embarrassing thing you’ve done online?', 'What’s a secret talent you have?', 'Who in this server would you trust with a secret?',
  'What’s the last lie you told?', 'What’s your guilty-pleasure song?', 'What’s the weirdest food you actually like?',
  'What’s something you’ve never told anyone here?', 'What was your worst haircut?', 'What’s your most-used emoji and why?',
  'What’s the longest you’ve gone without sleep?', 'Which game have you rage-quit the most?', 'What’s your biggest fear?',
] as const;

export const DARES = [
  'Change your nickname to “Potato” for an hour.', 'Send the 5th photo in your gallery (if it’s safe!).', 'Talk only in emojis for the next 10 minutes.',
  'Write a short poem about the person above you.', 'Use a pirate accent in your next 5 messages.', 'Compliment three people in this channel.',
  'Tell us your best (worst) joke.', 'Set your status to “I lost a dare” for an hour.', 'Describe your day using only movie titles.',
  'Type the next message with your eyes closed.', 'Share your current screen time.', 'Do your best impression of a server staff member.',
] as const;
