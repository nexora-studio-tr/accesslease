import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Database } from '../src/store/db.js';
import { Engine } from '../src/engine/service.js';
import { demoScenario } from '../src/adapters/simulator.js';
import { fixture, DEMO_ACTORS, IDS } from './helpers.js';
describe('lease engine / real PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof fixture>>, guild: string, pending: string;
  const owner = DEMO_ACTORS[0]!,
    reviewer = DEMO_ACTORS[1]!,
    member = DEMO_ACTORS[2]!;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f.close();
  });
  beforeEach(async () => {
    await f.reset();
    guild = await f.seed();
    pending = (
      await f.db.query("SELECT id FROM requests WHERE guild_id=$1 AND status='pending'", [guild])
    ).rows[0]!.id;
  });
  const approve = async () => {
    const p = await f.engine.preview(guild, owner, pending);
    await f.engine.approve(guild, owner, pending, p.hash);
  };
  const row = async (id = pending) =>
    (await f.db.query('SELECT * FROM requests WHERE id=$1', [id])).rows[0]!;
  const hasRole = async () =>
    (await f.sim.snapshot(guild, member.id)).member.roleIds.includes(IDS.build);
  it('grants only after a distinct reviewer approves and verifies removal at expiry', async () => {
    expect(await hasRole()).toBe(false);
    await approve();
    await f.engine.tick();
    expect(await hasRole()).toBe(true);
    expect((await row()).status).toBe('active');
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect(await hasRole()).toBe(false);
    expect((await row()).status).toBe('closed');
    expect(
      (await row()).result.channels.every((c: { after: { view: boolean } }) => !c.after.view),
    ).toBe(true);
  });
  it('forbids self approval even for the server owner', async () => {
    const p = (await f.engine.dashboard(guild, owner)).policies[0]!;
    const id = await f.engine.submit(
      guild,
      owner,
      p.id,
      60,
      'Investigate this private build issue.',
    );
    const view = await f.engine.preview(guild, owner, id);
    await expect(f.engine.approve(guild, owner, id, view.hash)).rejects.toMatchObject({
      code: 'self_approval_forbidden',
    });
  });
  it('serializes competing approvals and never duplicates the grant', async () => {
    const p = await f.engine.preview(guild, owner, pending);
    const results = await Promise.allSettled([
      f.engine.approve(guild, owner, pending, p.hash),
      f.engine.approve(guild, reviewer, pending, p.hash),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await Promise.all([f.engine.tick(), f.engine.tick()]);
    expect((await row()).status).toBe('active');
    expect(
      (
        await f.db.query("SELECT * FROM events WHERE request_id=$1 AND kind='access_granted'", [
          pending,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('never adopts or removes a pre-existing manual role', async () => {
    await f.sim.addRole(guild, member.id, IDS.build);
    const p = await f.engine.preview(guild, owner, pending);
    await expect(f.engine.approve(guild, owner, pending, p.hash)).rejects.toMatchObject({
      code: 'preexisting_role',
    });
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect(await hasRole()).toBe(true);
  });
  it('rejects stale permission previews', async () => {
    const p = await f.engine.preview(guild, owner, pending);
    await demoScenario(f.db, f.engine, guild, owner, 'remaining-access');
    await expect(f.engine.approve(guild, owner, pending, p.hash)).rejects.toMatchObject({
      code: 'preview_changed',
    });
    expect(await hasRole()).toBe(false);
  });
  it('protects against changes between approval and execution', async () => {
    await approve();
    await demoScenario(f.db, f.engine, guild, owner, 'remaining-access');
    await f.engine.tick();
    expect((await row()).status).toBe('conflict');
    expect(await hasRole()).toBe(false);
  });
  it('does not recreate a role an administrator removed', async () => {
    await approve();
    await f.engine.tick();
    await demoScenario(f.db, f.engine, guild, owner, 'external-remove');
    expect((await row()).status).toBe('conflict');
    await f.engine.tick();
    expect(await hasRole()).toBe(false);
  });
  it('reports residual access rather than claiming the room was closed', async () => {
    await demoScenario(f.db, f.engine, guild, owner, 'remaining-access');
    await approve();
    await f.engine.tick();
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    const r = await row();
    expect(r.status).toBe('closed');
    expect(r.result.channels.find((c: { id: string }) => c.id === IDS.text).after.view).toBe(true);
    expect(await hasRole()).toBe(false);
  });
  it('retains the role until the final overlapping authorization ends', async () => {
    await approve();
    await f.engine.tick();
    const r = await row();
    const second = await f.engine.submit(
      guild,
      member,
      r.policy_id,
      4320,
      'Continue a second separately approved investigation.',
    );
    const p = await f.engine.preview(guild, owner, second);
    await f.engine.approve(guild, owner, second, p.hash);
    await f.engine.tick();
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect((await row()).result.code).toBe('another_active_lease');
    expect(await hasRole()).toBe(true);
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect(await hasRole()).toBe(false);
  });
  it('preserves the fixed deadline through a restarted engine', async () => {
    await approve();
    const deadline = (await row()).expires_at.toISOString();
    const restarted = new Engine(f.db, f.sim);
    await restarted.tick();
    expect((await row()).expires_at.toISOString()).toBe(deadline);
    expect(await hasRole()).toBe(true);
  });
  it('does not grant a request whose approval expired while queued', async () => {
    await approve();
    await f.db.query('UPDATE workspaces SET clock_offset_ms=200000000 WHERE id=$1', [guild]);
    await f.engine.tick();
    expect(await hasRole()).toBe(false);
    expect((await row()).status).toBe('closed');
  });
  it('keeps unsuccessful expiry visibly pending and resumes after recovery', async () => {
    await approve();
    await f.engine.tick();
    await demoScenario(f.db, f.engine, guild, owner, 'offline');
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect(await hasRole()).toBe(true);
    expect((await row()).status).toBe('revoke_pending');
    await demoScenario(f.db, f.engine, guild, owner, 'online');
    expect(await hasRole()).toBe(false);
    expect((await row()).status).toBe('closed');
  });
  it('pauses writes without claiming existing access ended', async () => {
    await approve();
    await f.engine.pause(guild, owner, true);
    await f.engine.tick();
    expect(await hasRole()).toBe(false);
    expect((await row()).status).toBe('approved');
    await f.engine.pause(guild, owner, false);
    await f.engine.tick();
    expect(await hasRole()).toBe(true);
  });
  it('makes uncertain post-crash grants conflicts, not assumed ownership', async () => {
    await approve();
    const r = await row();
    await f.db.query(
      "INSERT INTO bindings(guild_id,user_id,role_id,phase,fingerprint,channel_ids) VALUES($1,$2,$3,'adding',$4,$5)",
      [guild, member.id, IDS.build, r.approval_fingerprint, JSON.stringify([IDS.text, IDS.voice])],
    );
    await f.sim.addRole(guild, member.id, IDS.build);
    await f.engine.tick();
    expect((await row()).status).toBe('conflict');
    expect(await hasRole()).toBe(true);
  });
  it('reconciles confirmed absence after a crash during removal', async () => {
    await approve();
    await f.engine.tick();
    await f.db.query("UPDATE bindings SET phase='removing' WHERE guild_id=$1 AND user_id=$2", [
      guild,
      member.id,
    ]);
    await f.sim.removeRole(guild, member.id, IDS.build);
    await demoScenario(f.db, f.engine, guild, owner, 'advance');
    expect((await row()).status).toBe('closed');
    expect(await hasRole()).toBe(false);
  });
  it('restricts owner actions and event visibility', async () => {
    await expect(f.engine.pause(guild, member, true)).rejects.toMatchObject({
      code: 'owner_required',
    });
    const d = await f.engine.dashboard(guild, member);
    expect(d.configuration).toBeNull();
    expect(d.requests.every((r) => r.user_id === member.id)).toBe(true);
    expect(d.events.some((e) => e.kind === 'policy_created')).toBe(false);
  });
  it('does not grant after policy edits or privilege escalation', async () => {
    await approve();
    const state = await f.sim.load(guild);
    state.roles.find((r) => r.id === IDS.build)!.permissions = '8';
    await f.db.query('UPDATE simulations SET state=$1 WHERE guild_id=$2', [
      JSON.stringify(state),
      guild,
    ]);
    await f.engine.tick();
    expect((await row()).status).toBe('conflict');
    expect(await hasRole()).toBe(false);
  });
  it('releases management without deleting an externally changed role', async () => {
    await approve();
    await f.engine.tick();
    await demoScenario(f.db, f.engine, guild, owner, 'remaining-access');
    await f.engine.detach(guild, owner, member.id, IDS.build);
    expect(await hasRole()).toBe(true);
    expect((await row()).status).toBe('cancelled');
    expect((await row()).result.roleRemoved).toBe(false);
  });
  it('only resets detached management after observing the old role absent', async () => {
    await approve();
    await f.engine.tick();
    const original = await row();
    await f.engine.detach(guild, owner, member.id, IDS.build);
    await expect(
      f.engine.resetManagement(guild, owner, member.id, IDS.build),
    ).rejects.toMatchObject({ code: 'remove_existing_role_first' });
    await f.sim.removeRole(guild, member.id, IDS.build);
    await f.engine.resetManagement(guild, owner, member.id, IDS.build);
    const id = await f.engine.submit(
      guild,
      member,
      original.policy_id,
      60,
      'A new reviewed investigation after the old role was removed.',
    );
    const p = await f.engine.preview(guild, owner, id);
    await f.engine.approve(guild, owner, id, p.hash);
    await f.engine.tick();
    expect(await hasRole()).toBe(true);
  });
  it('preserves the deadline across repeated harmless worker events', async () => {
    await approve();
    await f.engine.tick();
    const deadline = (await row()).expires_at.toISOString();
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (n) => {
        for (let i = 0; i < n; i++) {
          await f.engine.enqueue(f.db.pool, guild, member.id, IDS.build);
          await f.engine.tick();
        }
        expect((await row()).expires_at.toISOString()).toBe(deadline);
        expect(await hasRole()).toBe(true);
      }),
      { numRuns: 8 },
    );
  });
  it('can reopen the same schema using a new database connection', async () => {
    await approve();
    const duplicate = new Database(f.db.pool.options.connectionString!);
    try {
      const restarted = new Engine(duplicate, f.sim);
      await restarted.tick();
      expect((await row()).status).toBe('active');
    } finally {
      await duplicate.close();
    }
  });
});
