import { describe, expect, it } from 'vitest';
import {
  BOT_EXPORT_FORMAT,
  BOT_LIMITS,
  botProjectExportSchema,
  createBotProjectSchema,
  slugify,
  updateBotProjectSchema,
} from '../src/index.js';

const ID = '3b241101-e2bb-4255-8caf-4136c566a962';

describe('createBotProjectSchema', () => {
  it('trims input and applies defaults', () => {
    expect(createBotProjectSchema.parse({ name: '  Aurora  ' })).toEqual({
      name: 'Aurora',
      description: '',
      groupName: null,
    });
  });

  it('turns an empty group into no group', () => {
    expect(createBotProjectSchema.parse({ name: 'A', groupName: '   ' }).groupName).toBeNull();
  });

  it('rejects empty or too-long names and unknown fields', () => {
    expect(createBotProjectSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createBotProjectSchema.safeParse({ name: 'x'.repeat(BOT_LIMITS.nameMax + 1) }).success).toBe(false);
    expect(createBotProjectSchema.safeParse({ name: 'A', token: 'abc' }).success).toBe(false);
  });
});

describe('updateBotProjectSchema', () => {
  it('accepts a partial patch', () => {
    expect(updateBotProjectSchema.safeParse({ id: ID, patch: { isFavorite: true } }).success).toBe(true);
  });

  it('rejects empty patches, bad ids and unknown fields', () => {
    expect(updateBotProjectSchema.safeParse({ id: ID, patch: {} }).success).toBe(false);
    expect(updateBotProjectSchema.safeParse({ id: 'nope', patch: { name: 'A' } }).success).toBe(false);
    expect(updateBotProjectSchema.safeParse({ id: ID, patch: { isEnabled: false } }).success).toBe(false);
  });
});

describe('botProjectExportSchema', () => {
  const valid = {
    format: BOT_EXPORT_FORMAT,
    version: 1,
    exportedAt: '2026-11-14T12:00:00.000Z',
    appVersion: '0.2.0',
    project: { name: 'Aurora', description: 'Gaming bot', groupName: 'Gaming', config: { modules: {} } },
  };

  it('accepts a valid export', () => {
    expect(botProjectExportSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects files that carry a token or other unexpected data', () => {
    expect(botProjectExportSchema.safeParse({ ...valid, project: { ...valid.project, token: 'x' } }).success).toBe(false);
    expect(botProjectExportSchema.safeParse({ ...valid, token: 'x' }).success).toBe(false);
  });

  it('rejects other formats and future versions', () => {
    expect(botProjectExportSchema.safeParse({ ...valid, format: 'something-else' }).success).toBe(false);
    expect(botProjectExportSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
  });
});

describe('slugify', () => {
  it('produces safe file names', () => {
    expect(slugify('My Cool Bot!')).toBe('my-cool-bot');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('🔥🔥')).toBe('bot');
  });
});
