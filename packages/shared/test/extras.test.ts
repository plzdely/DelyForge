import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULE_CONFIGS, calculate, channelRuleProblem, highlightHit, isThanks, matchTrigger, moduleConfigSchemas, ticTacToeResult, withinHours } from '../src/index.js';

describe('auto-responder triggers', () => {
  it('matches in four ways and returns what came after', () => {
    expect(matchTrigger('How do I apply?', { trigger: 'apply', match: 'contains' })).toBe('?');
    expect(matchTrigger('!ip', { trigger: '!ip', match: 'exact' })).toBe('');
    expect(matchTrigger('!ip please', { trigger: '!ip', match: 'exact' })).toBeNull();
    expect(matchTrigger('!price pistol', { trigger: '!price', match: 'startsWith' })).toBe('pistol');
    expect(matchTrigger('i love cats', { trigger: 'cat', match: 'word' })).toBeNull();
    expect(matchTrigger('my CAT is cute', { trigger: 'cat', match: 'word' })).toBe('is cute');
  });
  it('highlights whole words only', () => {
    expect(highlightHit('ping dely about it', 'dely')).toBe(true);
    expect(highlightHit('delyforge rocks', 'dely')).toBe(false);
  });
});

describe('channel rules, thanks and opening hours', () => {
  it('media, text and link-only channels', () => {
    expect(channelRuleProblem('media', { text: 'hi', attachments: 0 })).toMatch(/images/);
    expect(channelRuleProblem('media', { text: 'https://x.com/a', attachments: 0 })).toBeNull();
    expect(channelRuleProblem('text', { text: 'hi', attachments: 1 })).toMatch(/text/);
    expect(channelRuleProblem('links', { text: 'no link', attachments: 0 })).toMatch(/link/);
    expect(channelRuleProblem('any', { text: '', attachments: 5 })).toBeNull();
  });
  it('spots thank-yous', () => {
    for (const t of ['thanks <@1>', 'thank you <@1>!', 'ty <@1>', '<@1> thx']) expect(isThanks(t)).toBe(true);
    expect(isThanks('this is tyrannical')).toBe(false);
  });
  it('opening hours, including overnight', () => {
    const day = { from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] };
    expect(withinHours(day, 1, '10:00')).toBe(true);
    expect(withinHours(day, 1, '17:00')).toBe(false);
    expect(withinHours(day, 6, '10:00')).toBe(false);
    const night = { from: '18:00', to: '02:00', days: [5] };
    expect(withinHours(night, 5, '23:00')).toBe(true);
    expect(withinHours(night, 6, '01:00')).toBe(true); // Friday night continues into Saturday
    expect(withinHours(night, 6, '03:00')).toBe(false);
  });
});

describe('calculator', () => {
  it('does maths without running code', () => {
    expect(calculate('2+3*4')).toBe(14);
    expect(calculate('(2+3)*4')).toBe(20);
    expect(calculate('2^3^2')).toBe(512);
    expect(calculate('-5 + 10 / 4')).toBe(-2.5);
    expect(calculate('10 % 3')).toBe(1);
    expect(calculate('1/0')).toBeNull();
    expect(calculate('process.exit()')).toBeNull();
    expect(calculate('2+')).toBeNull();
    expect(calculate('(1')).toBeNull();
  });
});

describe('tic-tac-toe and defaults', () => {
  it('finds winners and draws', () => {
    expect(ticTacToeResult(['X', 'X', 'X', null, 'O', 'O', null, null, null])).toBe('X');
    expect(ticTacToeResult(['O', 'X', 'X', null, 'O', 'X', null, null, 'O'])).toBe('O');
    expect(ticTacToeResult(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])).toBe('draw');
    expect(ticTacToeResult(Array(9).fill(null))).toBeNull();
  });
  it('every new module’s defaults are valid', () => {
    for (const id of ['autoResponder', 'confessions', 'highlights', 'channelTools', 'activity', 'reputation', 'memberTools'] as const) {
      expect(moduleConfigSchemas[id].safeParse(DEFAULT_MODULE_CONFIGS[id]).success).toBe(true);
    }
  });
});
