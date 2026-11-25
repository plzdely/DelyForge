import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { type AuditLike, auditCategory, auditEmbed, deleterOf, describeChange, rememberDelete, whoDidIt } from '../src/modules/logging.js';

const BOT = '111111111111111111';
const MOD = '222222222222222222';
const USER = '333333333333333333';
const CHANNEL = '444444444444444444';
const ROLE = '555555555555555555';

const entry = (e: Partial<AuditLike>): AuditLike => ({
  action: AuditLogEvent.ChannelUpdate,
  actionType: 'Update',
  targetType: 'Channel',
  targetId: CHANNEL,
  executorId: MOD,
  reason: null,
  changes: [],
  extra: null,
  ...e,
});
const noRoles = () => false;

describe('audit log categories', () => {
  it('sorts actions into the logging toggles and keeps message deletes for attribution only', () => {
    expect(auditCategory(AuditLogEvent.MemberRoleUpdate)).toBe('memberRoles');
    expect(auditCategory(AuditLogEvent.MemberUpdate)).toBe('members');
    expect(auditCategory(AuditLogEvent.RoleUpdate)).toBe('roles');
    expect(auditCategory(AuditLogEvent.GuildUpdate)).toBe('server');
    expect(auditCategory(AuditLogEvent.WebhookCreate)).toBe('other');
    expect(auditCategory(AuditLogEvent.MessageDelete)).toBeNull();
    expect(auditCategory(AuditLogEvent.AutoModerationBlockMessage)).toBeNull();
  });
});

describe('describeChange', () => {
  it('shows permission changes as additions and removals', () => {
    const old = String(PermissionFlagsBits.SendMessages | PermissionFlagsBits.KickMembers);
    const now = String(PermissionFlagsBits.SendMessages | PermissionFlagsBits.BanMembers);
    expect(describeChange({ key: 'permissions', old, new: now }, 'Update')?.value).toBe('+ Ban Members\n− Kick Members');
  });

  it('shows timeouts, role additions, renames and hides noise', () => {
    expect(describeChange({ key: 'communication_disabled_until', new: '2026-11-25T12:00:00.000Z' }, 'Update')?.value).toContain('<t:');
    expect(describeChange({ key: 'communication_disabled_until', old: '2026-11-25T12:00:00.000Z' }, 'Update')?.value).toBe('removed');
    expect(describeChange({ key: '$add', new: [{ id: ROLE, name: 'Mod' }] }, 'Update')).toMatchObject({ name: 'Added', value: `<@&${ROLE}>` });
    expect(describeChange({ key: 'name', old: 'general', new: 'chat' }, 'Update')).toMatchObject({ name: 'Name', value: 'general → chat' });
    expect(describeChange({ key: 'rate_limit_per_user', old: 0, new: 10 }, 'Update')?.value).toBe('off → 10s');
    expect(describeChange({ key: 'position', old: 1, new: 2 }, 'Update')).toBeNull();
  });
});

describe('who did it', () => {
  it('names the real moderator when they used a DelyForge command', () => {
    expect(whoDidIt({ executorId: BOT, reason: `Spamming (by Mod#0001 · ${MOD})` }, BOT)).toEqual({ by: `<@${MOD}> (using DelyForge)`, reason: 'Spamming' });
    expect(whoDidIt({ executorId: BOT, reason: 'Too many warnings' }, BOT).by).toContain('automatic');
    expect(whoDidIt({ executorId: MOD, reason: null }, BOT).by).toBe(`<@${MOD}>`);
  });
});

describe('auditEmbed', () => {
  it('skips edits that only moved channels around', () => {
    expect(auditEmbed(entry({ changes: [{ key: 'position', old: 1, new: 3 }] }), BOT, noRoles)).toBeNull();
  });

  it('writes a readable message with who did it and the reason', () => {
    const e = auditEmbed(
      entry({ action: AuditLogEvent.MemberUpdate, targetType: 'User', targetId: USER, reason: 'Be nice', changes: [{ key: 'nick', old: 'Bob', new: 'Bobby' }] }),
      BOT,
      noRoles,
    )!;
    expect(e.title).toBe('Nickname changed');
    expect(e.description).toBe(`<@${USER}>\n**By:** <@${MOD}>`);
    expect(e.fields).toEqual([
      { name: 'Nickname', value: 'Bob → Bobby' },
      { name: 'Reason', value: 'Be nice' },
    ]);
  });

  it('names the role a channel permission change was for', () => {
    const e = auditEmbed(entry({ action: AuditLogEvent.ChannelOverwriteUpdate, extra: { id: ROLE }, changes: [{ key: 'deny', old: '0', new: String(PermissionFlagsBits.SendMessages) }] }), BOT, (id) => id === ROLE)!;
    expect(e.description).toContain(`<#${CHANNEL}> for <@&${ROLE}>`);
    expect(e.fields?.[0]).toMatchObject({ name: 'Denied', value: '+ Send Messages' });
  });
});

describe('message delete attribution', () => {
  it('credits the moderator who deleted someone else’s message, only for that author and channel', () => {
    const now = 1_000_000;
    rememberDelete('g1', { executorId: MOD, targetId: USER, channelId: CHANNEL }, now);
    expect(deleterOf('g1', USER, CHANNEL, now + 1000)).toBe(MOD);
    expect(deleterOf('g1', USER, 'other-channel', now + 1000)).toBeNull();
    expect(deleterOf('g1', USER, CHANNEL, now + 60_000)).toBeNull();
  });
});
