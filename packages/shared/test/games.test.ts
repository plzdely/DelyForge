import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE_CONFIGS,
  TRIVIA_QUESTIONS,
  checkCount,
  countedNumber,
  dailyReward,
  dehoistedName,
  isZalgo,
  moduleConfigSchemas,
  parseAmount,
  recordNukeAction,
  robOutcome,
  rpsResult,
  shuffleTrivia,
  spinSlots,
} from '../src/index.js';

const DAY = 86_400_000;
const eco = DEFAULT_MODULE_CONFIGS.economy;

describe('economy', () => {
  it('daily: once a day, streak grows within 48 h and resets after', () => {
    expect(dailyReward(eco.daily, null, 0, 0)).toEqual({ ok: true, amount: 200, streak: 1 });
    expect(dailyReward(eco.daily, 0, 1, DAY - 1)).toEqual({ ok: false, nextAt: DAY });
    expect(dailyReward(eco.daily, 0, 1, DAY + 5)).toEqual({ ok: true, amount: 220, streak: 2 });
    expect(dailyReward(eco.daily, 0, 9, 3 * DAY)).toMatchObject({ streak: 1, amount: 200 });
    expect(dailyReward({ ...eco.daily, maxStreak: 3 }, 0, 3, DAY)).toMatchObject({ streak: 3 });
  });

  it('parses amounts like all, half, 50%, 2k', () => {
    expect(parseAmount('all', 500)).toBe(500);
    expect(parseAmount('half', 501)).toBe(250);
    expect(parseAmount('10%', 500)).toBe(50);
    expect(parseAmount('2k', 0)).toBe(2000);
    expect(parseAmount('1,500', 0)).toBe(1500);
    expect(parseAmount('0', 10)).toBeNull();
    expect(parseAmount('-5', 10)).toBeNull();
    expect(parseAmount('all', 0)).toBeNull();
    expect(parseAmount('abc', 10)).toBeNull();
  });

  it('rob: success takes part of the wallet, failure costs a fine', () => {
    expect(robOutcome(eco.rob, 1000, 1000, 0.1, 1)).toEqual({ success: true, amount: 250 });
    expect(robOutcome(eco.rob, 1000, 1000, 0.9, 1)).toEqual({ success: false, amount: 100 });
  });

  it('slots pay for matches only', () => {
    expect(spinSlots([0.99, 0.99, 0.99], 10)).toEqual({ reels: ['💎', '💎', '💎'], payout: 250 });
    expect(spinSlots([0, 0, 0.5], 10).payout).toBe(15);
    expect(spinSlots([0, 0.3, 0.5], 10).payout).toBe(0);
  });

  it('defaults are valid settings', () => {
    for (const id of ['modmail', 'applications', 'economy', 'games'] as const) expect(moduleConfigSchemas[id].safeParse(DEFAULT_MODULE_CONFIGS[id]).success).toBe(true);
  });
});

describe('counting', () => {
  it('reads the number at the start of a message', () => {
    expect(countedNumber('42')).toBe(42);
    expect(countedNumber(' 42 nice')).toBe(42);
    expect(countedNumber('hello 42')).toBeNull();
    expect(countedNumber('4.2')).toBe(4);
  });

  it('wants the next number and no double counting', () => {
    const state = { count: 4, lastUserId: 'a', record: 10 };
    expect(checkCount(state, 5, 'b', { noDoubleCount: true })).toEqual({ ok: true, count: 5, record: false });
    expect(checkCount(state, 5, 'a', { noDoubleCount: true })).toEqual({ ok: false, reason: 'twice', expected: 5 });
    expect(checkCount(state, 5, 'a', { noDoubleCount: false }).ok).toBe(true);
    expect(checkCount(state, 7, 'b', { noDoubleCount: true })).toEqual({ ok: false, reason: 'wrong', expected: 5 });
    expect(checkCount({ count: 10, lastUserId: null, record: 10 }, 11, 'b', { noDoubleCount: true })).toMatchObject({ record: true });
  });
});

describe('games', () => {
  it('trivia: every built-in question has a right and three wrong answers, shuffled correctly', () => {
    expect(TRIVIA_QUESTIONS.length).toBeGreaterThanOrEqual(50);
    for (const q of TRIVIA_QUESTIONS) {
      expect(q.wrong).toHaveLength(3);
      expect(q.wrong).not.toContain(q.correct);
    }
    const s = shuffleTrivia(TRIVIA_QUESTIONS[0]!, [0.1, 0.9, 0.5, 0.3]);
    expect(s.answers).toHaveLength(4);
    expect(s.answers[s.correctIndex]).toBe(TRIVIA_QUESTIONS[0]!.correct);
  });

  it('rock paper scissors', () => {
    expect(rpsResult('rock', 'scissors')).toBe('win');
    expect(rpsResult('rock', 'paper')).toBe('lose');
    expect(rpsResult('paper', 'paper')).toBe('draw');
  });
});

describe('moderation helpers', () => {
  it('spots zalgo text, not normal accents', () => {
    expect(isZalgo('h̸̢̛̛̙̖̝e̷̡̛͙̝͎l̶̨̛̺͍l̴̢̛͍o̵̢̧̙')).toBe(true);
    expect(isZalgo('Crème brûlée à la française')).toBe(false);
  });

  it('dehoists names that start with symbols', () => {
    expect(dehoistedName('!!!Cool')).toBe('Cool');
    expect(dehoistedName('Dely')).toBeNull();
    expect(dehoistedName('!!!')).toBe('Member');
  });

  it('anti-nuke counts actions in a sliding window', () => {
    const t: number[] = [];
    expect(recordNukeAction(t, 0, 3, 10)).toBe(false);
    expect(recordNukeAction(t, 1000, 3, 10)).toBe(false);
    expect(recordNukeAction(t, 2000, 3, 10)).toBe(true);
    expect(recordNukeAction(t, 20_000, 3, 10)).toBe(false);
  });
});
