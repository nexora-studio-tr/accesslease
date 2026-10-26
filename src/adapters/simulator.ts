import { randomBytes } from 'node:crypto';
import {
  AppError,
  DiscordUnavailable,
  type Actor,
  type Channel,
  type DiscordAdapter,
  type Member,
  type Role,
  type Snapshot,
} from '../domain/model.js';
import { P } from '../domain/permissions.js';
import { Database } from '../store/db.js';
import { Engine } from '../engine/service.js';
export const DEMO_ACTORS: Actor[] = [
  { id: '910000000000000001', name: 'Nora Kaya' },
  { id: '910000000000000002', name: 'Emre Deniz' },
  { id: '910000000000000003', name: 'Mina Aras' },
];
export const IDS = {
  community: '710000000000000001',
  approver: '710000000000000002',
  botRole: '710000000000000003',
  build: '710000000000000004',
  support: '710000000000000005',
  beta: '710000000000000006',
  maintainer: '710000000000000007',
  bot: '910000000000000099',
  text: '810000000000000001',
  voice: '810000000000000002',
};
type World = Omit<Snapshot, 'member'> & { members: Record<string, Member> };
function world(guild: string): World {
  const roles: Role[] = [
    {
      id: guild,
      name: '@everyone',
      permissions: String(P.VIEW | P.SEND | P.HISTORY | P.CONNECT | P.SPEAK),
      position: 0,
      managed: false,
    },
    ...Object.entries({
      community: 'Community',
      approver: 'Access reviewers',
      botRole: 'AccessLease',
      build: 'Build Lab',
      support: 'Support Room',
      beta: 'Beta Circle',
      maintainer: 'Maintainers',
    }).map(([key, name], i) => ({
      id: IDS[key as keyof typeof IDS],
      name,
      permissions: key === 'botRole' ? String(P.MANAGE_ROLES) : '0',
      position: key === 'botRole' ? 50 : key === 'approver' ? 30 : i + 1,
      managed: false,
    })),
  ];
  const channel = (id: string, name: string, type: number, role: string): Channel => ({
    id,
    name,
    type,
    overwrites: [
      { id: guild, type: 'role', deny: String(P.VIEW), allow: '0' },
      {
        id: role,
        type: 'role',
        allow: String(P.VIEW | (type === 0 ? P.SEND | P.HISTORY : P.CONNECT | P.SPEAK)),
        deny: '0',
      },
      ...(role === IDS.build
        ? [
            {
              id: IDS.maintainer,
              type: 'role' as const,
              allow: String(P.VIEW | P.SEND | P.HISTORY),
              deny: '0',
            },
          ]
        : []),
    ],
  });
  const members: Record<string, Member> = {};
  for (const [i, a] of DEMO_ACTORS.entries())
    members[a.id] = {
      id: a.id,
      name: a.name,
      roleIds: [IDS.community, ...(i < 2 ? [IDS.approver] : [])],
      timedOut: false,
    };
  members['910000000000000004'] = {
    id: '910000000000000004',
    name: 'Efe Tan',
    roleIds: [IDS.community],
    timedOut: false,
  };
  return {
    guildId: guild,
    guildName: 'Nexora Collective',
    ownerId: DEMO_ACTORS[0]!.id,
    botId: IDS.bot,
    botRoleIds: [IDS.botRole],
    roles,
    channels: [
      channel(IDS.text, 'build-lab', 0, IDS.build),
      channel(IDS.voice, 'lab-voice', 2, IDS.build),
      channel('810000000000000003', 'support-room', 0, IDS.support),
      channel('810000000000000004', 'beta-circle', 0, IDS.beta),
    ],
    members,
  };
}
export class Simulator implements DiscordAdapter {
  constructor(public db: Database) {}
  async load(guild: string): Promise<World> {
    const r = await this.db.query('SELECT state FROM simulations WHERE guild_id=$1', [guild]);
    if (!r.rows[0]) throw new AppError('workspace_not_found', 404);
    return r.rows[0].state;
  }
  async snapshot(guild: string, user: string): Promise<Snapshot> {
    const { members, ...state } = await this.load(guild);
    const member = members[user];
    if (!member) throw new AppError('member_not_found', 404);
    return { ...state, member };
  }
  async mutate(guild: string, user: string, role: string, add: boolean) {
    const online = await this.db.query('SELECT online FROM simulations WHERE guild_id=$1', [guild]);
    if (!online.rows[0]?.online) throw new DiscordUnavailable();
    const state = await this.load(guild),
      member = state.members[user];
    if (!member) throw new AppError('member_not_found', 404);
    member.roleIds = add
      ? [...new Set([...member.roleIds, role])]
      : member.roleIds.filter((id) => id !== role);
    await this.db.query('UPDATE simulations SET state=$1 WHERE guild_id=$2', [
      JSON.stringify(state),
      guild,
    ]);
  }
  async addRole(g: string, u: string, r: string) {
    await this.mutate(g, u, r, true);
  }
  async removeRole(g: string, u: string, r: string) {
    await this.mutate(g, u, r, false);
  }
}
export async function createDemo(db: Database, engine: Engine) {
  const guild =
    '6' +
    BigInt('0x' + randomBytes(7).toString('hex'))
      .toString()
      .padStart(17, '0');
  await db.guild(guild, async (c) => {
    await db.atomic(c, async () => {
      await c.query(
        "INSERT INTO workspaces(id,name,owner_id,mode) VALUES($1,'Nexora Collective',$2,'demo')",
        [guild, DEMO_ACTORS[0]!.id],
      );
      await c.query('INSERT INTO simulations(guild_id,state) VALUES($1,$2)', [
        guild,
        JSON.stringify(world(guild)),
      ]);
    });
  });
  const policy = await engine.savePolicy(guild, DEMO_ACTORS[0]!, {
    name: 'Build Lab',
    description: 'Private builds, release discussions and the engineering voice room.',
    roleId: IDS.build,
    channelIds: [IDS.text, IDS.voice],
    eligibleRoleIds: [IDS.community],
    approverRoleIds: [IDS.approver],
    maxMinutes: 4320,
    published: true,
  });
  await engine.savePolicy(guild, DEMO_ACTORS[0]!, {
    name: 'Support Room',
    description: 'Collaborate on a support case without permanent access.',
    roleId: IDS.support,
    channelIds: ['810000000000000003'],
    eligibleRoleIds: [IDS.community],
    approverRoleIds: [IDS.approver],
    maxMinutes: 1440,
    published: true,
  });
  const beta = await engine.savePolicy(guild, DEMO_ACTORS[0]!, {
    name: 'Beta Circle',
    description: 'A focused space for external testers and early feedback.',
    roleId: IDS.beta,
    channelIds: ['810000000000000004'],
    eligibleRoleIds: [IDS.community],
    approverRoleIds: [IDS.approver],
    maxMinutes: 10080,
    published: true,
  });
  const active = await engine.submit(
    guild,
    { id: '910000000000000004', name: 'Efe Tan' },
    beta,
    120,
    'Verify the next release with the external testing team.',
  );
  const preview = await engine.preview(guild, DEMO_ACTORS[0]!, active);
  await engine.approve(guild, DEMO_ACTORS[0]!, active, preview.hash);
  await engine.tick();
  await engine.submit(
    guild,
    DEMO_ACTORS[2]!,
    policy,
    2880,
    'Review the build pipeline and reproduce a release issue.',
  );
  return guild;
}
export async function demoScenario(
  db: Database,
  engine: Engine,
  guild: string,
  actor: Actor,
  action: string,
) {
  if (actor.id !== DEMO_ACTORS[0]!.id) throw new AppError('owner_required', 403);
  await db.guild(guild, async (c) => {
    const ws = await engine.workspace(c, guild);
    if (ws.mode !== 'demo') throw new AppError('demo_only', 403);
    const state = (await c.query('SELECT state FROM simulations WHERE guild_id=$1', [guild]))
      .rows[0].state as World;
    if (action === 'advance')
      await c.query('UPDATE workspaces SET clock_offset_ms=clock_offset_ms+176400000 WHERE id=$1', [
        guild,
      ]);
    else if (action === 'offline' || action === 'online')
      await c.query('UPDATE simulations SET online=$1 WHERE guild_id=$2', [
        action === 'online',
        guild,
      ]);
    else if (action === 'external-remove') {
      state.members[DEMO_ACTORS[2]!.id]!.roleIds = state.members[
        DEMO_ACTORS[2]!.id
      ]!.roleIds.filter((id) => id !== IDS.build);
      await c.query('UPDATE simulations SET state=$1 WHERE guild_id=$2', [
        JSON.stringify(state),
        guild,
      ]);
    } else if (action === 'remaining-access') {
      const m = state.members[DEMO_ACTORS[2]!.id]!;
      m.roleIds = [...new Set([...m.roleIds, IDS.maintainer])];
      await c.query('UPDATE simulations SET state=$1 WHERE guild_id=$2', [
        JSON.stringify(state),
        guild,
      ]);
    } else throw new AppError('unknown_scenario');
    // remaining-access is a pre-approval setup scenario; after approval it deliberately triggers drift protection.
    const targets = await c.query('SELECT user_id,role_id FROM bindings WHERE guild_id=$1', [
      guild,
    ]);
    for (const t of targets.rows) await engine.enqueue(c, guild, t.user_id, t.role_id);
    await engine.event(c, guild, actor.id, 'demo_scenario', { action });
  });
  await engine.tick();
}
