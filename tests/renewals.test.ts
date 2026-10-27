import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { fixture, DEMO_ACTORS, IDS } from './helpers.js';

describe('reviewed renewals / real PostgreSQL and simulator', () => {
  let f: Awaited<ReturnType<typeof fixture>>, guild: string, original: string;
  const owner = DEMO_ACTORS[0]!,
    reviewer = DEMO_ACTORS[1]!,
    member = DEMO_ACTORS[2]!;
  const reason = 'Continue investigating the release with the same team.';
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await f.reset();
    guild = await f.seed();
    original = (
      await f.db.query("SELECT id FROM requests WHERE guild_id=$1 AND status='pending'", [guild])
    ).rows[0]!.id;
    const preview = await f.engine.preview(guild, owner, original);
    await f.engine.approve(guild, owner, original, preview.hash);
    await f.engine.tick();
  });
  const row = async (id = original) =>
    (await f.db.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2', [guild, id])).rows[0]!;
  const approve = async (id: string) => {
    const preview = await f.engine.preview(guild, owner, id);
    await f.engine.approve(guild, owner, id, preview.hash);
  };
  it('creates a linked pending request without changing the existing expiry or role', async () => {
    const before = await row(),
      add = vi.spyOn(f.sim, 'addRole');
    const id = await f.engine.renew(guild, member, original, 4320, reason);
    expect(await row(id)).toMatchObject({
      status: 'pending',
      renewal_of: original,
      user_id: member.id,
      policy_id: before.policy_id,
      expires_at: null,
    });
    expect((await row()).expires_at).toEqual(before.expires_at);
    expect(add).not.toHaveBeenCalled();
    expect((await f.db.query('SELECT kind FROM events WHERE request_id=$1', [id])).rows).toEqual([
      { kind: 'renewal_requested' },
    ]);
  });
  it('keeps the role while an independently approved renewal survives the original expiry', async () => {
    const oldExpiry = (await row()).expires_at,
      add = vi.spyOn(f.sim, 'addRole');
    const id = await f.engine.renew(guild, member, original, 4320, reason);
    await approve(id);
    await f.engine.tick();
    expect((await row(id)).status).toBe('active');
    expect((await row()).expires_at).toEqual(oldExpiry);
    expect(add).not.toHaveBeenCalled();
    await f.db.query('UPDATE workspaces SET clock_offset_ms=clock_offset_ms+$1 WHERE id=$2', [
      2880 * 60000 + 1000,
      guild,
    ]);
    await f.engine.tick();
    expect((await row()).status).toBe('closed');
    expect((await row(id)).status).toBe('active');
    expect((await f.sim.snapshot(guild, member.id)).member.roleIds).toContain(IDS.build);
    await f.db.query('UPDATE workspaces SET clock_offset_ms=clock_offset_ms+$1 WHERE id=$2', [
      1440 * 60000,
      guild,
    ]);
    await f.engine.tick();
    expect((await row(id)).status).toBe('closed');
    expect((await f.sim.snapshot(guild, member.id)).member.roleIds).not.toContain(IDS.build);
  });
  it('forbids someone else requesting a renewal and forbids owner self approval', async () => {
    await expect(f.engine.renew(guild, owner, original, 4320, reason)).rejects.toMatchObject({
      code: 'renewal_owner_required',
    });
    const policy = (await row()).policy_id;
    const own = await f.engine.submit(guild, owner, policy, 5, reason);
    const preview = await f.engine.preview(guild, reviewer, own);
    await f.engine.approve(guild, reviewer, own, preview.hash);
    await f.engine.tick();
    const id = await f.engine.renew(guild, owner, own, 60, reason);
    const self = await f.engine.preview(guild, owner, id);
    await expect(f.engine.approve(guild, owner, id, self.hash)).rejects.toMatchObject({
      code: 'self_approval_forbidden',
    });
  });
  it('rejects late approval even when the expired original still has a stale active status', async () => {
    const id = await f.engine.renew(guild, member, original, 4320, reason);
    await f.db.query('UPDATE workspaces SET clock_offset_ms=$1 WHERE id=$2', [
      2880 * 60000 + 1000,
      guild,
    ]);
    expect((await row()).status).toBe('active');
    await expect(approve(id)).rejects.toMatchObject({ code: 'renewal_lease_inactive' });
    expect((await row(id)).expires_at).toBeNull();
    await f.engine.tick();
    expect((await f.sim.snapshot(guild, member.id)).member.roleIds).not.toContain(IDS.build);
  });
  it('rejects approval after early revocation or observed manual role removal', async () => {
    const id = await f.engine.renew(guild, member, original, 4320, reason);
    await f.sim.removeRole(guild, member.id, IDS.build);
    await expect(approve(id)).rejects.toMatchObject({ code: 'manual_review_required' });
    await f.sim.addRole(guild, member.id, IDS.build);
    await f.engine.decide(guild, owner, original, 'end');
    await expect(approve(id)).rejects.toMatchObject({ code: 'renewal_lease_inactive' });
    expect((await row(id)).status).toBe('pending');
  });
  it('preserves policy limits, version checks and pending-request uniqueness under concurrency', async () => {
    await expect(f.engine.renew(guild, member, original, 60, reason)).rejects.toMatchObject({
      code: 'renewal_not_longer',
    });
    await expect(f.engine.renew(guild, member, original, 10080, reason)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const results = await Promise.allSettled([
      f.engine.renew(guild, member, original, 4320, reason),
      f.engine.renew(guild, member, original, 4320, reason),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const id = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>)
      .value;
    await f.db.query('UPDATE policies SET version=version+1 WHERE id=$1', [
      (await row()).policy_id,
    ]);
    await expect(approve(id)).rejects.toMatchObject({ code: 'policy_changed' });
    expect((await row(id)).status).toBe('pending');
  });
  it('enforces the same workspace for renewal links in both the service and database', async () => {
    const foreign = await f.seed();
    await expect(f.engine.renew(foreign, member, original, 4320, reason)).rejects.toMatchObject({
      code: 'request_not_found',
    });
    const target = (
      await f.db.query("SELECT id FROM requests WHERE guild_id=$1 AND status='pending'", [foreign])
    ).rows[0]!.id;
    await expect(
      f.db.query('UPDATE requests SET renewal_of=$1 WHERE id=$2', [original, target]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'requests_renewal_scope' });
  });
  it('upgrades populated version-one data without changing leases and is idempotent', async () => {
    const before = (await f.db.query('SELECT id,status,expires_at FROM requests ORDER BY id')).rows;
    await f.db.query(
      'ALTER TABLE requests DROP COLUMN renewal_of; DROP INDEX requests_id_guild; DELETE FROM schema_version WHERE version=2',
    );
    await f.db.migrate();
    await f.db.migrate();
    expect(
      (await f.db.query('SELECT id,status,expires_at FROM requests ORDER BY id')).rows,
    ).toEqual(before);
    expect((await f.db.query('SELECT version FROM schema_version WHERE version=2')).rowCount).toBe(
      1,
    );
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM pg_constraint WHERE conname='requests_renewal_scope' AND conrelid='requests'::regclass",
        )
      ).rows[0]!.n,
    ).toBe(1);
  });
});
