import { randomUUID } from 'node:crypto';
import {
  AppError,
  DiscordUnavailable,
  type Actor,
  type Binding,
  type DiscordAdapter,
  type LeaseRequest,
  type Policy,
  type Snapshot,
} from '../domain/model.js';
import {
  assertSafeRole,
  canApprove,
  eligible,
  fingerprint,
  impact,
  previewHash,
} from '../domain/permissions.js';
import { Database, type Client } from '../store/db.js';

type Job = {
  id: string;
  guild_id: string;
  user_id: string;
  role_id: string;
  generation: number;
  attempts: number;
};
type InternalRequest = LeaseRequest & { approval_fingerprint: string | null };
export type PolicyInput = {
  name: string;
  description: string;
  roleId: string;
  channelIds: string[];
  eligibleRoleIds: string[];
  approverRoleIds: string[];
  maxMinutes: number;
  published: boolean;
};
export class Engine {
  constructor(
    public db: Database,
    public adapter: DiscordAdapter,
  ) {}
  async workspace(c: Client, guild: string) {
    const r = await c.query('SELECT * FROM workspaces WHERE id=$1', [guild]);
    if (!r.rows[0]) throw new AppError('workspace_not_found', 404);
    return r.rows[0];
  }
  async policy(c: Client, guild: string, id: string): Promise<Policy> {
    const r = await c.query('SELECT * FROM policies WHERE guild_id=$1 AND id=$2', [guild, id]);
    if (!r.rows[0]) throw new AppError('policy_not_found', 404);
    return r.rows[0];
  }
  async request(c: Client, guild: string, id: string): Promise<InternalRequest> {
    const r = await c.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2', [guild, id]);
    if (!r.rows[0]) throw new AppError('request_not_found', 404);
    return r.rows[0];
  }
  async owner(guild: string, actor: Actor) {
    const s = await this.adapter.snapshot(guild, actor.id);
    if (s.ownerId !== actor.id) throw new AppError('owner_required', 403);
    return s;
  }
  async event(
    c: Client,
    guild: string,
    actor: string,
    kind: string,
    detail: unknown,
    request: string | null = null,
  ) {
    await c.query(
      'INSERT INTO events(guild_id,request_id,actor_id,kind,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [guild, request, actor, kind, JSON.stringify(detail), await this.db.now(c, guild)],
    );
  }
  async enqueue(c: Client, guild: string, user: string, role: string, when?: Date) {
    await c.query(
      `INSERT INTO jobs(id,guild_id,user_id,role_id,run_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET run_at=LEAST(jobs.run_at,EXCLUDED.run_at),generation=jobs.generation+1,locked_until=NULL,attempts=0`,
      [randomUUID(), guild, user, role, when ?? (await this.db.now(c, guild))],
    );
  }
  async dashboard(guild: string, actor: Actor) {
    const ws = await this.workspace(this.db.pool, guild),
      s = await this.adapter.snapshot(guild, actor.id);
    const all = (
      await this.db.query<Policy>('SELECT * FROM policies WHERE guild_id=$1 ORDER BY name', [guild])
    ).rows;
    const owner = s.ownerId === actor.id,
      visible = all.filter((p) => owner || canApprove(s, p) || (p.published && eligible(s, p)));
    const reviewIds = all.filter((p) => canApprove(s, p)).map((p) => p.id);
    const rows = (
      await this.db.query<LeaseRequest>(
        'SELECT * FROM requests WHERE guild_id=$1 AND ($2::boolean OR user_id=$3 OR policy_id=ANY($4::uuid[])) ORDER BY created_at DESC LIMIT 250',
        [guild, owner, actor.id, reviewIds],
      )
    ).rows;
    const requests = rows.map(({ ...r }) => {
      delete (r as unknown as Record<string, unknown>).approval_fingerprint;
      return r;
    });
    const bindings = (
      await this.db.query(
        'SELECT * FROM bindings WHERE guild_id=$1 AND ($2::boolean OR user_id=$3 OR role_id=ANY($4::text[]))',
        [guild, owner, actor.id, all.filter((p) => reviewIds.includes(p.id)).map((p) => p.role_id)],
      )
    ).rows;
    const events = (
      await this.db.query(
        `SELECT e.* FROM events e LEFT JOIN requests r ON r.id=e.request_id AND r.guild_id=e.guild_id WHERE e.guild_id=$1 AND ($2::boolean OR r.user_id=$3 OR r.policy_id=ANY($4::uuid[])) ORDER BY e.sequence DESC LIMIT 100`,
        [guild, owner, actor.id, reviewIds],
      )
    ).rows;
    return {
      workspace: {
        id: guild,
        name: ws.name,
        paused: ws.paused,
        mode: ws.mode,
        now: await this.db.now(this.db.pool, guild),
      },
      actor,
      owner,
      policies: visible.map((p) => ({
        ...p,
        canReview: canApprove(s, p),
        canRequest: p.published && eligible(s, p),
        approver_role_ids: owner ? p.approver_role_ids : [],
        eligible_role_ids: owner ? p.eligible_role_ids : [],
        channel_ids: owner ? p.channel_ids : [],
      })),
      requests,
      bindings,
      events,
      configuration: owner
        ? {
            roles: s.roles.filter((r) => r.id !== guild && !r.managed),
            channels: s.channels
              .filter((c) => [0, 2].includes(c.type))
              .map((c) => ({ id: c.id, name: c.name, type: c.type })),
          }
        : null,
    };
  }
  async savePolicy(guild: string, actor: Actor, input: PolicyInput, id?: string) {
    return this.db.guild(guild, async (c) => {
      const s = await this.owner(guild, actor);
      await this.workspace(c, guild);
      assertSafeRole(s, input.roleId, input.channelIds);
      if (
        input.eligibleRoleIds
          .concat(input.approverRoleIds)
          .some((id) => !s.roles.some((r) => r.id === id))
      )
        throw new AppError('unknown_role');
      if (
        !input.name.trim() ||
        input.name.length > 60 ||
        input.description.length > 300 ||
        !Number.isInteger(input.maxMinutes) ||
        input.maxMinutes < 5 ||
        input.maxMinutes > 10080
      )
        throw new AppError('invalid_policy');
      const key = id ?? randomUUID();
      if (id) {
        const old = await this.policy(c, guild, id);
        if (old.role_id !== input.roleId) throw new AppError('policy_role_immutable');
      }
      await this.db.atomic(c, async () => {
        await c.query(
          `INSERT INTO policies(id,guild_id,name,description,role_id,channel_ids,eligible_role_ids,approver_role_ids,max_minutes,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,channel_ids=EXCLUDED.channel_ids,eligible_role_ids=EXCLUDED.eligible_role_ids,approver_role_ids=EXCLUDED.approver_role_ids,max_minutes=EXCLUDED.max_minutes,published=EXCLUDED.published,version=policies.version+1`,
          [
            key,
            guild,
            input.name.trim(),
            input.description.trim(),
            input.roleId,
            JSON.stringify(input.channelIds),
            JSON.stringify(input.eligibleRoleIds),
            JSON.stringify(input.approverRoleIds),
            input.maxMinutes,
            input.published,
          ],
        );
        await this.event(c, guild, actor.id, id ? 'policy_updated' : 'policy_created', {
          policyId: key,
          name: input.name,
        });
        if (id) {
          const targets = await c.query(
            'SELECT user_id,role_id FROM bindings WHERE guild_id=$1 AND role_id=$2',
            [guild, input.roleId],
          );
          for (const t of targets.rows) await this.enqueue(c, guild, t.user_id, t.role_id);
        }
      });
      return key;
    });
  }
  async submit(guild: string, actor: Actor, policyId: string, duration: number, reason: string) {
    return this.submitLease(guild, actor, policyId, duration, reason);
  }
  async renew(guild: string, actor: Actor, originalId: string, duration: number, reason: string) {
    return this.submitLease(guild, actor, undefined, duration, reason, originalId);
  }
  private validateRenewal(
    parent: LeaseRequest,
    userId: string,
    policy: Policy,
    now: Date,
    duration: number,
  ) {
    if (parent.user_id !== userId) throw new AppError('renewal_owner_required', 403);
    if (parent.status !== 'active' || !parent.expires_at || parent.expires_at <= now)
      throw new AppError('renewal_lease_inactive', 409);
    if (
      parent.policy_id !== policy.id ||
      parent.policy_version !== policy.version ||
      parent.role_id !== policy.role_id
    )
      throw new AppError('policy_changed', 409);
    if (now.getTime() + duration * 60000 <= parent.expires_at.getTime())
      throw new AppError('renewal_not_longer', 409);
  }
  private async submitLease(
    guild: string,
    actor: Actor,
    policyId: string | undefined,
    duration: number,
    reason: string,
    originalId?: string,
  ) {
    return this.db.guild(guild, async (c) => {
      const ws = await this.workspace(c, guild);
      if (ws.paused) throw new AppError('workspace_paused', 409);
      const parent = originalId ? await this.request(c, guild, originalId) : undefined;
      if (parent && parent.user_id !== actor.id) throw new AppError('renewal_owner_required', 403);
      const p = await this.policy(c, guild, parent?.policy_id ?? policyId!),
        s = await this.adapter.snapshot(guild, actor.id);
      if (!p.published || !eligible(s, p)) throw new AppError('not_eligible', 403);
      if (
        !Number.isInteger(duration) ||
        duration < 5 ||
        duration > p.max_minutes ||
        reason.trim().length < 10 ||
        reason.trim().length > 500
      )
        throw new AppError('invalid_request');
      assertSafeRole(s, p.role_id, p.channel_ids);
      const id = randomUUID(),
        now = await this.db.now(c, guild);
      if (parent) {
        this.validateRenewal(parent, actor.id, p, now, duration);
        const binding = (
          await c.query(
            'SELECT phase FROM bindings WHERE guild_id=$1 AND user_id=$2 AND role_id=$3',
            [guild, actor.id, p.role_id],
          )
        ).rows[0];
        if (binding?.phase !== 'owned' || !s.member.roleIds.includes(p.role_id))
          throw new AppError('manual_review_required', 409);
      }
      await this.db.atomic(c, async () => {
        await c.query(
          "INSERT INTO requests(id,guild_id,user_id,user_name,policy_id,policy_version,policy_name,role_id,reason,duration_minutes,status,created_at,updated_at,renewal_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$11,$12)",
          [
            id,
            guild,
            actor.id,
            actor.name,
            p.id,
            p.version,
            p.name,
            p.role_id,
            reason.trim(),
            duration,
            now,
            parent?.id ?? null,
          ],
        );
        await this.event(
          c,
          guild,
          actor.id,
          parent ? 'renewal_requested' : 'requested',
          {
            policyName: p.name,
            durationMinutes: duration,
            ...(parent ? { renewalOf: parent.id, previousExpiry: parent.expires_at } : {}),
          },
          id,
        );
      });
      return id;
    });
  }
  async preview(guild: string, actor: Actor, requestId: string) {
    const r = await this.request(this.db.pool, guild, requestId),
      p = await this.policy(this.db.pool, guild, r.policy_id),
      a = await this.adapter.snapshot(guild, actor.id);
    if (!canApprove(a, p)) throw new AppError('approver_required', 403);
    const s = await this.adapter.snapshot(guild, r.user_id);
    assertSafeRole(s, p.role_id, p.channel_ids);
    return {
      hash: previewHash(s, p),
      policyVersion: p.version,
      stalePolicy: r.policy_version !== p.version,
      self: r.user_id === actor.id,
      channels: impact(s, p.role_id, p.channel_ids),
      removal: impact(s, p.role_id, p.channel_ids, true),
      alreadyPresent: s.member.roleIds.includes(p.role_id),
    };
  }
  async approve(guild: string, actor: Actor, requestId: string, hash: string) {
    return this.db.guild(guild, async (c) => {
      const ws = await this.workspace(c, guild);
      if (ws.paused) throw new AppError('workspace_paused', 409);
      const r = await this.request(c, guild, requestId),
        p = await this.policy(c, guild, r.policy_id),
        reviewer = await this.adapter.snapshot(guild, actor.id);
      if (!canApprove(reviewer, p)) throw new AppError('approver_required', 403);
      if (actor.id === r.user_id) throw new AppError('self_approval_forbidden', 403);
      if (r.status !== 'pending') throw new AppError('request_not_pending', 409);
      if (!p.published || p.version !== r.policy_version || r.duration_minutes > p.max_minutes)
        throw new AppError('policy_changed', 409);
      const role = reviewer.roles.find((role) => role.id === p.role_id);
      if (
        actor.id !== reviewer.ownerId &&
        Math.max(
          0,
          ...reviewer.roles
            .filter((role) => reviewer.member.roleIds.includes(role.id))
            .map((role) => role.position),
        ) <= (role?.position ?? Infinity)
      )
        throw new AppError('approver_role_hierarchy', 403);
      const s = await this.adapter.snapshot(guild, r.user_id);
      if (!eligible(s, p)) throw new AppError('not_eligible', 409);
      assertSafeRole(s, p.role_id, p.channel_ids);
      if (hash !== previewHash(s, p)) throw new AppError('preview_changed', 409);
      const binding = (
        await c.query('SELECT * FROM bindings WHERE guild_id=$1 AND user_id=$2 AND role_id=$3', [
          guild,
          r.user_id,
          p.role_id,
        ])
      ).rows[0] as Binding | undefined;
      if (binding && ['conflict', 'detached', 'removing'].includes(binding.phase))
        throw new AppError('manual_review_required', 409);
      if (s.member.roleIds.includes(p.role_id) && binding?.phase !== 'owned')
        throw new AppError('preexisting_role', 409);
      const now = await this.db.now(c, guild),
        expires = new Date(now.getTime() + r.duration_minutes * 60000);
      if (r.renewal_of) {
        const parent = await this.request(c, guild, r.renewal_of);
        this.validateRenewal(parent, r.user_id, p, now, r.duration_minutes);
        if (!s.member.roleIds.includes(p.role_id) || binding?.phase !== 'owned')
          throw new AppError('manual_review_required', 409);
      }
      await this.db.atomic(c, async () => {
        await c.query(
          "UPDATE requests SET status='approved',approved_by=$1,approved_name=$2,expires_at=$3,approval_fingerprint=$4,updated_at=$5 WHERE id=$6 AND guild_id=$7",
          [actor.id, actor.name, expires, fingerprint(s, p.role_id), now, r.id, guild],
        );
        await this.enqueue(c, guild, r.user_id, p.role_id);
        await this.event(
          c,
          guild,
          actor.id,
          'approved',
          { expiresAt: expires, policyVersion: p.version },
          r.id,
        );
      });
    });
  }
  async decide(guild: string, actor: Actor, requestId: string, action: 'deny' | 'cancel' | 'end') {
    return this.db.guild(guild, async (c) => {
      const r = await this.request(c, guild, requestId),
        p = await this.policy(c, guild, r.policy_id),
        s = await this.adapter.snapshot(guild, actor.id);
      if (action === 'deny' ? !canApprove(s, p) : actor.id !== r.user_id && !canApprove(s, p))
        throw new AppError('forbidden', 403);
      if (action === 'deny' && r.status !== 'pending')
        throw new AppError('request_not_pending', 409);
      if (!['pending', 'approved', 'active', 'revoke_pending'].includes(r.status))
        throw new AppError('request_not_actionable', 409);
      const now = await this.db.now(c, guild),
        pending = r.status === 'pending';
      await this.db.atomic(c, async () => {
        await c.query(
          'UPDATE requests SET status=$1,expires_at=CASE WHEN $2 THEN expires_at ELSE $3 END,updated_at=$3 WHERE id=$4 AND guild_id=$5',
          [
            action === 'deny' ? 'denied' : pending ? 'cancelled' : 'revoke_pending',
            pending,
            now,
            r.id,
            guild,
          ],
        );
        if (!pending) await this.enqueue(c, guild, r.user_id, p.role_id);
        await this.event(
          c,
          guild,
          actor.id,
          action === 'deny' ? 'denied' : pending ? 'cancelled' : 'end_requested',
          {},
          r.id,
        );
      });
    });
  }
  async pause(guild: string, actor: Actor, paused: boolean) {
    await this.db.guild(guild, async (c) => {
      await this.owner(guild, actor);
      await this.db.atomic(c, async () => {
        await c.query('UPDATE workspaces SET paused=$1 WHERE id=$2', [paused, guild]);
        if (!paused)
          await c.query(
            'UPDATE jobs SET run_at=$1,generation=generation+1,locked_until=NULL WHERE guild_id=$2',
            [await this.db.now(c, guild), guild],
          );
        await this.event(
          c,
          guild,
          actor.id,
          paused ? 'automation_paused' : 'automation_resumed',
          {},
        );
        const targets = await c.query('SELECT user_id,role_id FROM bindings WHERE guild_id=$1', [
          guild,
        ]);
        for (const t of targets.rows) await this.enqueue(c, guild, t.user_id, t.role_id);
      });
    });
  }
  async detach(guild: string, actor: Actor, user: string, role: string) {
    await this.db.guild(guild, async (c) => {
      await this.owner(guild, actor);
      const b = await c.query(
        'SELECT * FROM bindings WHERE guild_id=$1 AND user_id=$2 AND role_id=$3',
        [guild, user, role],
      );
      if (!b.rows[0]) throw new AppError('binding_not_found', 404);
      await this.db.atomic(c, async () => {
        await c.query(
          "UPDATE bindings SET phase='detached',detail='owner_released_management' WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
          [guild, user, role],
        );
        await c.query(
          "UPDATE requests SET status='cancelled',result=$4,updated_at=$5 WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND status IN ('approved','active','revoke_pending','conflict')",
          [
            guild,
            user,
            role,
            JSON.stringify({ code: 'management_released', roleRemoved: false }),
            await this.db.now(c, guild),
          ],
        );
        await c.query('DELETE FROM jobs WHERE guild_id=$1 AND user_id=$2 AND role_id=$3', [
          guild,
          user,
          role,
        ]);
        await this.event(c, guild, actor.id, 'management_released', {
          userId: user,
          roleId: role,
          roleRemoved: false,
        });
      });
    });
  }
  async resetManagement(guild: string, actor: Actor, user: string, role: string) {
    await this.db.guild(guild, async (c) => {
      await this.owner(guild, actor);
      const binding = (
        await c.query('SELECT * FROM bindings WHERE guild_id=$1 AND user_id=$2 AND role_id=$3', [
          guild,
          user,
          role,
        ])
      ).rows[0] as Binding | undefined;
      if (binding?.phase !== 'detached') throw new AppError('release_management_first', 409);
      const snapshot = await this.adapter.snapshot(guild, user);
      if (snapshot.member.roleIds.includes(role))
        throw new AppError('remove_existing_role_first', 409);
      await this.db.atomic(c, async () => {
        await c.query(
          "UPDATE bindings SET phase='absent',fingerprint=$4,detail=NULL WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
          [guild, user, role, fingerprint(snapshot, role)],
        );
        await this.event(c, guild, actor.id, 'management_reset', {
          userId: user,
          roleId: role,
          observedAbsent: true,
        });
      });
    });
  }
  async conflict(c: Client, job: Job, s: Snapshot | null, detail: string) {
    await this.db.atomic(c, async () => {
      await c.query(
        `INSERT INTO bindings(guild_id,user_id,role_id,phase,fingerprint,channel_ids,detail) VALUES($1,$2,$3,'conflict',$4,'[]',$5) ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET phase='conflict',detail=$5`,
        [job.guild_id, job.user_id, job.role_id, s ? fingerprint(s, job.role_id) : '', detail],
      );
      await c.query(
        "UPDATE requests SET status='conflict',updated_at=$4,result=$5 WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND status IN ('approved','active','revoke_pending')",
        [
          job.guild_id,
          job.user_id,
          job.role_id,
          await this.db.now(c, job.guild_id),
          JSON.stringify({ code: detail, roleRemoved: false }),
        ],
      );
      await this.event(c, job.guild_id, 'system', 'conflict', {
        userId: job.user_id,
        roleId: job.role_id,
        code: detail,
      });
    });
  }
  async process(c: Client, job: Job): Promise<Date | null> {
    const guild = job.guild_id,
      ws = await this.workspace(c, guild),
      now = await this.db.now(c, guild);
    if (ws.paused) return new Date(now.getTime() + 30000);
    const all = (
      await c.query(
        "SELECT * FROM requests WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND status IN ('approved','active','revoke_pending')",
        [guild, job.user_id, job.role_id],
      )
    ).rows as InternalRequest[];
    if (!all.length) return null;
    const binding = (
      await c.query('SELECT * FROM bindings WHERE guild_id=$1 AND user_id=$2 AND role_id=$3', [
        guild,
        job.user_id,
        job.role_id,
      ])
    ).rows[0] as Binding | undefined;
    if (binding && ['conflict', 'detached'].includes(binding.phase)) return null;
    let s: Snapshot;
    try {
      s = await this.adapter.snapshot(guild, job.user_id);
    } catch (e) {
      if (e instanceof AppError && e.code === 'member_not_found') {
        await c.query(
          "UPDATE requests SET status='closed',updated_at=$4,result=$5 WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND status IN ('approved','active','revoke_pending')",
          [
            guild,
            job.user_id,
            job.role_id,
            now,
            JSON.stringify({ code: 'member_left', roleRemoved: false }),
          ],
        );
        await c.query(
          "UPDATE bindings SET phase='absent' WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
          [guild, job.user_id, job.role_id],
        );
        await this.event(c, guild, 'system', 'member_left', { userId: job.user_id });
        return null;
      }
      throw e;
    }
    const fp = fingerprint(s, job.role_id),
      has = s.member.roleIds.includes(job.role_id);
    const valid = all.filter(
        (r) => r.status !== 'revoke_pending' && r.expires_at && r.expires_at > now,
      ),
      expired = all.filter((r) => !valid.includes(r));
    if (binding && binding.phase !== 'absent' && binding.fingerprint !== fp) {
      await this.conflict(c, job, s, 'permissions_changed');
      return null;
    }
    for (const r of valid) {
      const p = await this.policy(c, guild, r.policy_id);
      try {
        assertSafeRole(s, job.role_id, p.channel_ids);
      } catch (e) {
        await this.conflict(c, job, s, e instanceof AppError ? e.code : 'unsafe_role');
        return null;
      }
      if (p.version !== r.policy_version || r.approval_fingerprint !== fp || !eligible(s, p)) {
        await this.conflict(c, job, s, 'approval_changed');
        return null;
      }
    }
    if (binding?.phase === 'adding' && has) {
      await this.conflict(c, job, s, 'unconfirmed_grant');
      return null;
    }
    if (binding?.phase === 'removing' && has) {
      await this.conflict(c, job, s, 'unconfirmed_removal');
      return null;
    }
    if (binding?.phase === 'owned' && !has) {
      await this.conflict(c, job, s, 'external_role_removal');
      return null;
    }
    if (valid.length) {
      const channels = [
        ...new Set(
          (await Promise.all(valid.map((r) => this.policy(c, guild, r.policy_id)))).flatMap(
            (p) => p.channel_ids,
          ),
        ),
      ];
      if (has && binding?.phase !== 'owned') {
        await this.conflict(c, job, s, 'preexisting_role');
        return null;
      }
      if (!has) {
        const beforeWrite = await this.db.now(c, guild);
        if (valid.every((r) => r.expires_at! <= beforeWrite)) return beforeWrite;
        await c.query(
          `INSERT INTO bindings(guild_id,user_id,role_id,phase,fingerprint,channel_ids) VALUES($1,$2,$3,'adding',$4,$5) ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET phase='adding',fingerprint=$4,channel_ids=$5,detail=NULL`,
          [guild, job.user_id, job.role_id, fp, JSON.stringify(channels)],
        );
        try {
          await this.adapter.addRole(guild, job.user_id, job.role_id);
        } catch (e) {
          if (e instanceof DiscordUnavailable && !e.uncertain) throw e;
          await this.conflict(c, job, s, 'grant_not_confirmed');
          return null;
        }
        const after = await this.adapter.snapshot(guild, job.user_id);
        if (!after.member.roleIds.includes(job.role_id) || fingerprint(after, job.role_id) !== fp) {
          await this.conflict(c, job, after, 'grant_not_confirmed');
          return null;
        }
        await c.query(
          "UPDATE bindings SET phase='owned' WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
          [guild, job.user_id, job.role_id],
        );
      }
      await this.db.atomic(c, async () => {
        for (const r of valid)
          if (r.status === 'approved') {
            await c.query("UPDATE requests SET status='active',updated_at=$2 WHERE id=$1", [
              r.id,
              now,
            ]);
            await this.event(c, guild, 'system', 'access_granted', { roleId: job.role_id }, r.id);
          }
        for (const r of expired) {
          await c.query("UPDATE requests SET status='closed',updated_at=$2,result=$3 WHERE id=$1", [
            r.id,
            now,
            JSON.stringify({ code: 'another_active_lease', roleRemoved: false }),
          ]);
          await this.event(c, guild, 'system', 'lease_ended_role_retained', {}, r.id);
        }
      });
      return new Date(
        Math.min(now.getTime() + 30000, ...valid.map((r) => r.expires_at!.getTime())),
      );
    }
    // There is no remaining authorization to grant. Never create a role just to remove it.
    if (has && !binding) {
      await this.conflict(c, job, s, 'preexisting_role');
      return null;
    }
    const channelIds =
      binding?.channel_ids ?? (await this.policy(c, guild, all[0]!.policy_id)).channel_ids;
    if (has && binding?.phase === 'owned') {
      await c.query(
        "UPDATE requests SET status='revoke_pending',updated_at=$4 WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND status IN ('approved','active')",
        [guild, job.user_id, job.role_id, now],
      );
      await c.query(
        "UPDATE bindings SET phase='removing' WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
        [guild, job.user_id, job.role_id],
      );
      try {
        await this.adapter.removeRole(guild, job.user_id, job.role_id);
      } catch (e) {
        if (e instanceof DiscordUnavailable && !e.uncertain) {
          await c.query(
            "UPDATE bindings SET phase='owned' WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
            [guild, job.user_id, job.role_id],
          );
          throw e;
        }
        await this.conflict(c, job, s, 'removal_not_confirmed');
        return null;
      }
      s = await this.adapter.snapshot(guild, job.user_id);
      if (s.member.roleIds.includes(job.role_id)) {
        await this.conflict(c, job, s, 'removal_not_confirmed');
        return null;
      }
    }
    const result = {
      code: 'lease_ended',
      roleRemoved: has,
      channels: impact(s, job.role_id, channelIds, true),
    };
    await this.db.atomic(c, async () => {
      await c.query(
        "UPDATE bindings SET phase='absent',detail=NULL WHERE guild_id=$1 AND user_id=$2 AND role_id=$3",
        [guild, job.user_id, job.role_id],
      );
      for (const r of all) {
        await c.query("UPDATE requests SET status='closed',updated_at=$2,result=$3 WHERE id=$1", [
          r.id,
          now,
          JSON.stringify(result),
        ]);
        await this.event(c, guild, 'system', 'lease_closed', result, r.id);
      }
    });
    return null;
  }
  async tick(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const found = await this.db.query<Job>(
        `UPDATE jobs SET locked_until=clock_timestamp()+interval '60 seconds' WHERE id=(SELECT j.id FROM jobs j JOIN workspaces w ON w.id=j.guild_id WHERE j.run_at<=clock_timestamp()+w.clock_offset_ms*interval '1 millisecond' AND (j.locked_until IS NULL OR j.locked_until<clock_timestamp()) ORDER BY j.run_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING *`,
      );
      const job = found.rows[0];
      if (!job) return;
      try {
        const next = await this.db.guild(job.guild_id, (c) => this.process(c, job));
        if (next)
          await this.db.query(
            'UPDATE jobs SET run_at=$1,locked_until=NULL,attempts=0,last_error=NULL WHERE id=$2 AND generation=$3',
            [next, job.id, job.generation],
          );
        else
          await this.db.query('DELETE FROM jobs WHERE id=$1 AND generation=$2', [
            job.id,
            job.generation,
          ]);
      } catch (e) {
        const code = e instanceof AppError ? e.code : 'discord_unavailable';
        if (job.attempts >= 7 || e instanceof AppError) {
          await this.db.guild(job.guild_id, (c) => this.conflict(c, job, null, code));
          await this.db.query('DELETE FROM jobs WHERE id=$1 AND generation=$2', [
            job.id,
            job.generation,
          ]);
        } else {
          const now = await this.db.now(this.db.pool, job.guild_id);
          await this.db.query(
            'UPDATE jobs SET run_at=$1,locked_until=NULL,attempts=attempts+1,last_error=$2 WHERE id=$3 AND generation=$4',
            [
              new Date(now.getTime() + Math.min(300000, 2000 * 2 ** job.attempts)),
              code,
              job.id,
              job.generation,
            ],
          );
        }
      }
    }
  }
}
