import { createHash } from 'node:crypto';
import { AppError, type Channel, type Policy, type Snapshot } from './model.js';

export const P = {
  ADMIN: 1n << 3n,
  MANAGE_ROLES: 1n << 28n,
  VIEW: 1n << 10n,
  SEND: 1n << 11n,
  HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  REACT: 1n << 6n,
  EMBED: 1n << 14n,
  ATTACH: 1n << 15n,
  VAD: 1n << 25n,
  COMMANDS: 1n << 31n,
};
const SAFE =
  P.VIEW |
  P.SEND |
  P.HISTORY |
  P.CONNECT |
  P.SPEAK |
  P.REACT |
  P.EMBED |
  P.ATTACH |
  P.VAD |
  P.COMMANDS;
export function guildPermissions(s: Snapshot, ids = s.member.roleIds): bigint {
  if (s.member.id === s.ownerId) return (1n << 64n) - 1n;
  return s.roles
    .filter((r) => r.id === s.guildId || ids.includes(r.id))
    .reduce((p, r) => p | BigInt(r.permissions), 0n);
}
export function permissions(s: Snapshot, c: Channel, ids = s.member.roleIds): bigint {
  let p = guildPermissions(s, ids);
  if (p & P.ADMIN) return (1n << 64n) - 1n;
  const everyone = c.overwrites.find((o) => o.type === 'role' && o.id === s.guildId);
  if (everyone) p = (p & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let deny = 0n,
    allow = 0n;
  for (const o of c.overwrites)
    if (o.type === 'role' && o.id !== s.guildId && ids.includes(o.id)) {
      deny |= BigInt(o.deny);
      allow |= BigInt(o.allow);
    }
  p = (p & ~deny) | allow;
  const personal = c.overwrites.find((o) => o.type === 'member' && o.id === s.member.id);
  if (personal) p = (p & ~BigInt(personal.deny)) | BigInt(personal.allow);
  if (s.member.timedOut) p &= P.VIEW | P.HISTORY;
  return p;
}
function capabilities(bits: bigint, type: number) {
  const view = !!(bits & P.VIEW);
  return {
    view,
    send: type === 0 && view && !!(bits & P.SEND),
    connect: type === 2 && view && !!(bits & P.CONNECT),
    speak: type === 2 && view && !!(bits & P.CONNECT) && !!(bits & P.SPEAK),
  };
}
export function impact(s: Snapshot, roleId: string, channelIds: string[], removing = false) {
  const beforeIds = removing
    ? [...new Set([...s.member.roleIds, roleId])]
    : s.member.roleIds.filter((id) => id !== roleId);
  const afterIds = removing
    ? s.member.roleIds.filter((id) => id !== roleId)
    : [...new Set([...s.member.roleIds, roleId])];
  return s.channels
    .filter((c) => channelIds.includes(c.id))
    .map((c) => {
      const supported = c.type === 0 || c.type === 2;
      const before = capabilities(permissions(s, c, beforeIds), c.type),
        after = capabilities(permissions(s, c, afterIds), c.type);
      const attributionChannel = {
        ...c,
        overwrites: c.overwrites.filter((o) => o.type !== 'member'),
      };
      const remainingRoleIds = (s.member.id === s.ownerId ? [] : afterIds).filter(
        (id) =>
          capabilities(
            permissions({ ...s, member: { ...s.member, roleIds: [id] } }, attributionChannel),
            c.type,
          ).view,
      );
      const otherRoleNames = s.roles
        .filter((r) => remainingRoleIds.includes(r.id))
        .map((r) => r.name);
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        supported,
        before,
        after,
        otherRoleNames,
        memberOverride: c.overwrites.some((o) => o.type === 'member' && o.id === s.member.id),
        changed: JSON.stringify(before) !== JSON.stringify(after),
      };
    });
}
export function fingerprint(s: Snapshot, roleId: string): string {
  // The target membership is tracked separately; timestamps and display names do not change authorization.
  const normalized = {
    guild: s.guildId,
    owner: s.ownerId,
    member: s.member.id,
    timeout: s.member.timedOut,
    ids: s.member.roleIds.filter((id) => id !== roleId).sort(),
    bot: [...s.botRoleIds].sort(),
    roles: [...s.roles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, permissions, position, managed }) => ({ id, permissions, position, managed })),
    channels: [...s.channels]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        type: c.type,
        overwrites: [...c.overwrites].sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id)),
      })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
export function previewHash(s: Snapshot, policy: Policy): string {
  return createHash('sha256')
    .update(fingerprint(s, policy.role_id) + ':' + policy.id + ':' + policy.version)
    .digest('hex');
}
export function assertSafeRole(s: Snapshot, roleId: string, channelIds: string[]) {
  const role = s.roles.find((r) => r.id === roleId);
  if (!role || role.id === s.guildId || role.managed) throw new AppError('unsafe_role');
  // Dedicated roles have no guild-wide permissions. Their explicitly scoped channel overwrites grant access.
  if (BigInt(role.permissions) !== 0n) throw new AppError('role_requires_zero_base_permissions');
  const bot = { ...s, member: { ...s.member, id: s.botId, roleIds: s.botRoleIds } };
  if (!(guildPermissions(bot) & P.MANAGE_ROLES)) throw new AppError('bot_missing_manage_roles');
  const highest = Math.max(
    0,
    ...s.roles.filter((r) => s.botRoleIds.includes(r.id)).map((r) => r.position),
  );
  if (highest <= role.position) throw new AppError('bot_role_hierarchy');
  if (
    !channelIds.length ||
    channelIds.some((id) => !s.channels.some((c) => c.id === id && [0, 2].includes(c.type)))
  )
    throw new AppError('unsupported_channel');
  for (const c of s.channels)
    for (const o of c.overwrites.filter((o) => o.type === 'role' && o.id === roleId)) {
      if (BigInt(o.allow) & ~SAFE) throw new AppError('unsafe_channel_permission');
      if ((BigInt(o.allow) !== 0n || BigInt(o.deny) !== 0n) && !channelIds.includes(c.id))
        throw new AppError('role_scope_mismatch');
    }
}
export function canApprove(s: Snapshot, p: Policy): boolean {
  return (
    s.member.id === s.ownerId || s.member.roleIds.some((id) => p.approver_role_ids.includes(id))
  );
}
export function eligible(s: Snapshot, p: Policy): boolean {
  return (
    !p.eligible_role_ids.length || s.member.roleIds.some((id) => p.eligible_role_ids.includes(id))
  );
}
