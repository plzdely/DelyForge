import { describe, expect, it } from 'vitest';
import { type Builders, blankEmbed, createBotProjectSchema, resolveEntitlements } from '@delyforge/shared';
import { BotRepository } from '../src/main/db/bots';
import { openDatabase } from '../src/main/db/database';
import { ActivityRepository } from '../src/main/db/repositories';
import { AppError } from '../src/main/errors';
import { BuildersService } from '../src/main/runtime/builders-service';

const G = '123456789012345678';

function setup(plan: 'free' | 'pro' | 'business') {
  const db = openDatabase(':memory:');
  const activity = new ActivityRepository(db);
  const ent = resolveEntitlements(plan === 'free' ? { planId: 'free', status: 'none' } : { planId: plan, status: 'active' });
  const bots = new BotRepository(db, activity, () => ent);
  const applied: string[] = [];
  const service = new BuildersService(db, bots, activity, () => ent, { builders: (id) => (applied.push(`b:${id}`), false), modules: (id) => (applied.push(`m:${id}`), false) });
  const id = bots.create(createBotProjectSchema.parse({ name: 'Aurora' })).id;
  return { service, bots, id, applied };
}

const wf = (n: number) => ({ id: `w${n}`, name: `W${n}`, enabled: true, guildId: G, trigger: { type: 'memberJoin' as const }, steps: [{ type: 'sendDM' as const, text: 'hi' }] });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};

describe('BuildersService', () => {
  it('saves valid builders and pushes them to a running bot', () => {
    const { service, id, applied } = setup('pro');
    const b: Builders = { commands: [], embeds: [blankEmbed('e1')], workflows: [wf(1)] };
    expect(service.save(id, b)).toEqual(b);
    expect(service.get(id)).toEqual(b);
    expect(applied).toEqual([`b:${id}`]);
  });

  it('enforces the Free plan: 3 workflows and no new saved embeds', () => {
    const { service, id } = setup('free');
    expect(code(() => service.save(id, { commands: [], embeds: [], workflows: [wf(1), wf(2), wf(3)] }))).toBeNull();
    expect(code(() => service.save(id, { commands: [], embeds: [], workflows: [wf(1), wf(2), wf(3), wf(4)] }))).toBe('LIMIT_REACHED');
    expect(code(() => service.save(id, { commands: [], embeds: [blankEmbed('e1')], workflows: [] }))).toBe('FORBIDDEN');
  });

  it('rejects invalid data with the field path', () => {
    const { service, id } = setup('pro');
    let err: AppError | undefined;
    try {
      service.save(id, { commands: [], embeds: [], workflows: [{ ...wf(1), steps: [] }] });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toMatch(/workflows\.0\.steps/);
  });

  it('records and lists workflow runs', () => {
    const { service, id } = setup('pro');
    service.recordRun(id, { workflowId: 'w1', ok: true, steps: 2, message: 'done' });
    expect(service.runs(id)).toMatchObject([{ workflowId: 'w1', ok: true, steps: 2, message: 'done' }]);
  });

  it('applies templates per plan, switching off modules the plan lacks', () => {
    const free = setup('free');
    expect(code(() => free.service.applyTemplate(free.id, G, 'gaming'))).toBe('FORBIDDEN');
    const res = free.service.applyTemplate(free.id, G, 'moderation');
    expect(res.modules[G]?.moderation?.enabled).toBe(true);
    expect(res.modules[G]?.moderation?.automod.enabled).toBe(false); // auto-moderation is Pro
    expect(res.modules[G]?.logging?.enabled).toBe(false); // Logging is Pro

    const biz = setup('business');
    const all = biz.service.applyTemplate(biz.id, G, 'all-in-one');
    expect(all.modules[G]?.tickets?.enabled).toBe(true);
    expect(all.builders.commands.map((c) => c.name)).toEqual(['rules']);
    // Applying again doesn't duplicate commands.
    expect(biz.service.applyTemplate(biz.id, G, 'all-in-one').builders.commands).toHaveLength(1);
  });
});
