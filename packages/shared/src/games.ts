import type { EconomyConfig, GamesConfig } from './modules.js';

/**
 * Economy, counting and trivia rules — pure, so the bot and the tests agree on every number.
 * Randomness is passed in (`roll` between 0 and 1) so outcomes can be tested.
 */

const DAY = 86_400_000;

// ─── Economy ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** /daily: once every 24 hours; claiming again within 48 hours keeps the streak going (each day adds a bonus). */
export function dailyReward(
  c: EconomyConfig['daily'],
  last: number | null,
  streak: number,
  now: number,
): { ok: true; amount: number; streak: number } | { ok: false; nextAt: number } {
  if (last !== null && now - last < DAY) return { ok: false, nextAt: last + DAY };
  const next = last !== null && now - last < 2 * DAY ? Math.min(streak + 1, c.maxStreak) : 1;
  return { ok: true, amount: c.amount + c.streakBonus * (next - 1), streak: next };
}

/** "all", "half", "50%" or a number, checked against what's available. Null when it isn't a usable amount. */
export function parseAmount(input: string, available: number): number | null {
  const t = input.trim().toLowerCase().replace(/[,_\s]/g, '');
  let n: number;
  if (t === 'all' || t === 'max') n = available;
  else if (t === 'half') n = Math.floor(available / 2);
  else if (/^\d{1,3}%$/.test(t)) n = Math.floor((available * Math.min(100, Number(t.slice(0, -1)))) / 100);
  else if (/^\d+k$/.test(t)) n = Number(t.slice(0, -1)) * 1000;
  else if (/^\d+$/.test(t)) n = Number(t);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** /rob: works `successPercent`% of the time and takes up to `maxStealPercent`% of the victim's wallet; failing costs a fine. */
export function robOutcome(c: EconomyConfig['rob'], robberWallet: number, victimWallet: number, roll: number, roll2: number): { success: boolean; amount: number } {
  if (roll * 100 < c.successPercent) {
    const max = Math.floor((victimWallet * c.maxStealPercent) / 100);
    return { success: true, amount: Math.max(1, Math.ceil(max * (0.2 + 0.8 * roll2))) };
  }
  return { success: false, amount: Math.floor((robberWallet * c.finePercent) / 100) };
}

export const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎'] as const;
/** Pay-out for three of a kind (bet × this). Two of a kind pays 1.5×; anything else loses the bet. */
const THREE_OF_A_KIND: Record<(typeof SLOT_SYMBOLS)[number], number> = { '🍒': 3, '🍋': 4, '🔔': 6, '⭐': 10, '💎': 25 };

/** Three reels from three rolls (0–1), and what the bet pays back (0 = lost). */
export function spinSlots(rolls: [number, number, number], bet: number): { reels: string[]; payout: number } {
  const reels = rolls.map((r) => SLOT_SYMBOLS[Math.min(SLOT_SYMBOLS.length - 1, Math.floor(r * SLOT_SYMBOLS.length))]!);
  const [a, b, c] = reels;
  if (a === b && b === c) return { reels, payout: bet * THREE_OF_A_KIND[a!] };
  if (a === b || b === c || a === c) return { reels, payout: Math.floor(bet * 1.5) };
  return { reels, payout: 0 };
}

// ─── Counting ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The number a message starts with ("42", "42 nice"), or null for anything else. */
export function countedNumber(text: string): number | null {
  const m = /^\s*(\d{1,9})(?!\d)/.exec(text);
  return m ? Number(m[1]) : null;
}

export type CountResult = { ok: true; count: number; record: boolean } | { ok: false; reason: 'wrong' | 'twice'; expected: number };

/** Checks a message in the counting channel against the current count. */
export function checkCount(state: { count: number; lastUserId: string | null; record: number }, n: number, userId: string, rules: Pick<GamesConfig['counting'], 'noDoubleCount'>): CountResult {
  const expected = state.count + 1;
  if (rules.noDoubleCount && state.lastUserId === userId) return { ok: false, reason: 'twice', expected };
  if (n !== expected) return { ok: false, reason: 'wrong', expected };
  return { ok: true, count: n, record: n > state.record };
}

// ─── Trivia ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TriviaQuestion {
  question: string;
  correct: string;
  wrong: string[];
}

/** Built-in general-knowledge questions (custom ones from the settings are mixed in). */
export const TRIVIA_QUESTIONS: readonly TriviaQuestion[] = [
  { question: 'What is the largest planet in our solar system?', correct: 'Jupiter', wrong: ['Saturn', 'Neptune', 'Earth'] },
  { question: 'How many continents are there?', correct: '7', wrong: ['5', '6', '8'] },
  { question: 'What is the chemical symbol for gold?', correct: 'Au', wrong: ['Ag', 'Go', 'Gd'] },
  { question: 'Which ocean is the largest?', correct: 'Pacific', wrong: ['Atlantic', 'Indian', 'Arctic'] },
  { question: 'How many sides does a hexagon have?', correct: '6', wrong: ['5', '7', '8'] },
  { question: 'What is the capital of Japan?', correct: 'Tokyo', wrong: ['Kyoto', 'Osaka', 'Seoul'] },
  { question: 'Which planet is known as the Red Planet?', correct: 'Mars', wrong: ['Venus', 'Mercury', 'Jupiter'] },
  { question: 'What gas do plants take in from the air?', correct: 'Carbon dioxide', wrong: ['Oxygen', 'Nitrogen', 'Helium'] },
  { question: 'How many minutes are in a day?', correct: '1440', wrong: ['1200', '1600', '1080'] },
  { question: 'Who painted the Mona Lisa?', correct: 'Leonardo da Vinci', wrong: ['Michelangelo', 'Van Gogh', 'Picasso'] },
  { question: 'What is the fastest land animal?', correct: 'Cheetah', wrong: ['Lion', 'Horse', 'Greyhound'] },
  { question: 'What is the boiling point of water at sea level in °C?', correct: '100', wrong: ['90', '110', '120'] },
  { question: 'How many players are on a soccer team on the field?', correct: '11', wrong: ['9', '10', '12'] },
  { question: 'What is the hardest natural substance?', correct: 'Diamond', wrong: ['Iron', 'Quartz', 'Granite'] },
  { question: 'Which country has the most people?', correct: 'India', wrong: ['China', 'USA', 'Indonesia'] },
  { question: 'What is the smallest prime number?', correct: '2', wrong: ['1', '3', '0'] },
  { question: 'Which instrument has 88 keys?', correct: 'Piano', wrong: ['Organ', 'Accordion', 'Harp'] },
  { question: 'What is the capital of Australia?', correct: 'Canberra', wrong: ['Sydney', 'Melbourne', 'Perth'] },
  { question: 'How many legs does a spider have?', correct: '8', wrong: ['6', '10', '12'] },
  { question: 'What is H2O better known as?', correct: 'Water', wrong: ['Salt', 'Hydrogen', 'Steam'] },
  { question: 'Which year did the first person walk on the Moon?', correct: '1969', wrong: ['1959', '1972', '1965'] },
  { question: 'What is the longest river in the world?', correct: 'Nile', wrong: ['Amazon', 'Yangtze', 'Mississippi'] },
  { question: 'Which animal is known as the King of the Jungle?', correct: 'Lion', wrong: ['Tiger', 'Elephant', 'Gorilla'] },
  { question: 'What does “www” stand for?', correct: 'World Wide Web', wrong: ['Web Wide World', 'World Web Wide', 'Wide World Web'] },
  { question: 'How many bones are in the adult human body?', correct: '206', wrong: ['186', '226', '256'] },
  { question: 'What color do you get by mixing blue and yellow?', correct: 'Green', wrong: ['Purple', 'Orange', 'Brown'] },
  { question: 'Which planet has the most visible rings?', correct: 'Saturn', wrong: ['Jupiter', 'Uranus', 'Neptune'] },
  { question: 'What is the main language spoken in Brazil?', correct: 'Portuguese', wrong: ['Spanish', 'English', 'French'] },
  { question: 'How many hours are in a week?', correct: '168', wrong: ['144', '172', '160'] },
  { question: 'What is the freezing point of water in °F?', correct: '32', wrong: ['0', '10', '40'] },
  { question: 'Which shape has three sides?', correct: 'Triangle', wrong: ['Square', 'Pentagon', 'Circle'] },
  { question: 'What is the largest mammal?', correct: 'Blue whale', wrong: ['Elephant', 'Giraffe', 'Orca'] },
  { question: 'Which company makes the iPhone?', correct: 'Apple', wrong: ['Samsung', 'Google', 'Sony'] },
  { question: 'What is 12 × 12?', correct: '144', wrong: ['124', '132', '154'] },
  { question: 'Which element does “O” stand for?', correct: 'Oxygen', wrong: ['Osmium', 'Gold', 'Ozone'] },
  { question: 'What is the capital of Canada?', correct: 'Ottawa', wrong: ['Toronto', 'Vancouver', 'Montreal'] },
  { question: 'How many days are in a leap year?', correct: '366', wrong: ['365', '364', '367'] },
  { question: 'Which bird is a symbol of peace?', correct: 'Dove', wrong: ['Eagle', 'Owl', 'Parrot'] },
  { question: 'What is the tallest mountain on Earth?', correct: 'Mount Everest', wrong: ['K2', 'Kilimanjaro', 'Mont Blanc'] },
  { question: 'In which game do you say “checkmate”?', correct: 'Chess', wrong: ['Checkers', 'Poker', 'Go'] },
  { question: 'What is the square root of 81?', correct: '9', wrong: ['8', '7', '11'] },
  { question: 'Which sense is linked to the nose?', correct: 'Smell', wrong: ['Taste', 'Touch', 'Hearing'] },
  { question: 'What do bees make?', correct: 'Honey', wrong: ['Milk', 'Silk', 'Wax only'] },
  { question: 'Which is the closest star to Earth?', correct: 'The Sun', wrong: ['Sirius', 'Polaris', 'Alpha Centauri'] },
  { question: 'How many strings does a standard guitar have?', correct: '6', wrong: ['4', '5', '7'] },
  { question: 'What is the largest desert in the world?', correct: 'Antarctica', wrong: ['Sahara', 'Gobi', 'Arabian'] },
  { question: 'Which metal is liquid at room temperature?', correct: 'Mercury', wrong: ['Lead', 'Tin', 'Aluminium'] },
  { question: 'Which country is home to the kangaroo?', correct: 'Australia', wrong: ['New Zealand', 'South Africa', 'Brazil'] },
  { question: 'What is the currency of the United Kingdom?', correct: 'Pound sterling', wrong: ['Euro', 'Dollar', 'Franc'] },
  { question: 'How many colors are in a rainbow?', correct: '7', wrong: ['5', '6', '8'] },
];

/** A question with its answers shuffled; `correctIndex` says which button is right. `rolls` are 0–1 numbers. */
export function shuffleTrivia(q: TriviaQuestion, rolls: number[]): { question: string; answers: string[]; correctIndex: number } {
  const answers = [q.correct, ...q.wrong.slice(0, 3)];
  for (let n = answers.length - 1; n > 0; n--) {
    const j = Math.floor((rolls[n] ?? 0) * (n + 1)) % (n + 1);
    [answers[n], answers[j]] = [answers[j]!, answers[n]!];
  }
  return { question: q.question, answers, correctIndex: answers.indexOf(q.correct) };
}

export const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes — definitely.', 'You may rely on it.', 'Most likely.', 'Outlook good.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.',
  'Don’t count on it.', 'My reply is no.', 'My sources say no.', 'Outlook not so good.', 'Very doubtful.',
] as const;

/** Rock-paper-scissors: 'win', 'lose' or 'draw' for the player. */
export function rpsResult(player: 'rock' | 'paper' | 'scissors', bot: 'rock' | 'paper' | 'scissors'): 'win' | 'lose' | 'draw' {
  if (player === bot) return 'draw';
  return (player === 'rock' && bot === 'scissors') || (player === 'paper' && bot === 'rock') || (player === 'scissors' && bot === 'paper') ? 'win' : 'lose';
}

// ─── Moderation helpers added in 0.5 ──────────────────────────────────────────────────────────────────────────────

/** "Zalgo" text: letters buried under stacks of combining marks. */
export function isZalgo(text: string): boolean {
  const marks = text.match(/\p{M}/gu)?.length ?? 0;
  return marks >= 8 && marks / Math.max(1, text.replace(/\p{M}/gu, '').length) > 0.5;
}

/** A nickname without the symbols people put in front to sit at the top of the member list (null = it's fine). */
export function dehoistedName(name: string): string | null {
  if (!/^[!-/:-@[-`{-~\s]/.test(name)) return null;
  const clean = name.replace(/^[!-/:-@[-`{-~\s]+/, '').slice(0, 32);
  return clean || 'Member';
}

/** Anti-nuke: records one destructive action and says whether `max` happened within the window. */
export function recordNukeAction(times: number[], now: number, max: number, perSeconds: number): boolean {
  while (times.length && times[0]! <= now - perSeconds * 1000) times.shift();
  times.push(now);
  return times.length >= max;
}
