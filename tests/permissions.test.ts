import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  assertSafeRole,
  fingerprint,
  guildPermissions,
  impact,
  P,
  permissions,
} from '../src/domain/permissions.js';
import type { Snapshot } from '../src/domain/model.js';
const baseline = (): Snapshot => ({
  guildId: 'guild',
  guildName: 'Test',
  ownerId: 'owner',
  botId: 'bot',
  botRoleIds: ['bot-role'],
  member: { id: 'user', name: 'User', roleIds: [], timedOut: false },
  roles: [
    {
      id: 'guild',
      name: 'everyone',
      permissions: String(P.VIEW | P.SEND),
      position: 0,
      managed: false,
    },
    { id: 'access', name: 'Access', permissions: '0', position: 2, managed: false },
    { id: 'other', name: 'Other', permissions: '0', position: 3, managed: false },
    {
      id: 'bot-role',
      name: 'Bot',
      permissions: String(P.MANAGE_ROLES),
      position: 10,
      managed: false,
    },
  ],
  channels: [
    {
      id: 'channel',
      name: 'private',
      type: 0,
      overwrites: [
        { id: 'guild', type: 'role', deny: String(P.VIEW), allow: '0' },
        { id: 'access', type: 'role', allow: String(P.VIEW), deny: '0' },
      ],
    },
  ],
});
describe('Discord permission model', () => {
  it('applies everyone deny then role allow', () => {
    const s = baseline();
    expect(impact(s, 'access', ['channel'])[0]?.before.view).toBe(false);
    expect(impact(s, 'access', ['channel'])[0]?.after.view).toBe(true);
  });
  it('merges role overwrites collectively; position does not determine channel precedence', () => {
    const s = baseline();
    s.member.roleIds = ['access', 'other'];
    s.channels[0]!.overwrites.push({ id: 'other', type: 'role', allow: '0', deny: String(P.VIEW) });
    expect(permissions(s, s.channels[0]!) & P.VIEW).toBe(P.VIEW);
  });
  it('applies member overwrite last', () => {
    const s = baseline();
    s.member.roleIds = ['access'];
    s.channels[0]!.overwrites.push({
      id: 'user',
      type: 'member',
      allow: '0',
      deny: String(P.VIEW),
    });
    expect(permissions(s, s.channels[0]!) & P.VIEW).toBe(0n);
  });
  it('honors administrator and owner bypass', () => {
    const s = baseline();
    s.member.id = 'owner';
    expect(permissions(s, s.channels[0]!) & P.VIEW).toBe(P.VIEW);
    s.member.id = 'user';
    s.roles[2]!.permissions = String(P.ADMIN);
    s.member.roleIds = ['other'];
    expect(permissions(s, s.channels[0]!) & P.VIEW).toBe(P.VIEW);
  });
  it('limits timed-out non-admin members', () => {
    const s = baseline();
    s.member.roleIds = ['access'];
    s.member.timedOut = true;
    expect(permissions(s, s.channels[0]!) & P.SEND).toBe(0n);
  });
  it('reports residual access after the managed role ends', () => {
    const s = baseline();
    s.member.roleIds = ['access', 'other'];
    s.channels[0]!.overwrites.push({ id: 'other', type: 'role', allow: String(P.VIEW), deny: '0' });
    const r = impact(s, 'access', ['channel'], true)[0]!;
    expect(r.after.view).toBe(true);
    expect(r.otherRoleNames).toContain('Other');
  });
  it('does not attribute a personal channel allow to an unrelated role', () => {
    const s = baseline();
    s.member.roleIds = ['access', 'other'];
    s.channels[0]!.overwrites.push({
      id: 'user',
      type: 'member',
      allow: String(P.VIEW),
      deny: '0',
    });
    const result = impact(s, 'access', ['channel'], true)[0]!;
    expect(result.after.view).toBe(true);
    expect(result.otherRoleNames).not.toContain('Other');
    expect(result.memberOverride).toBe(true);
  });
  it('suppresses write and voice capabilities without view', () => {
    const s = baseline();
    s.channels[0]!.overwrites = [];
    s.roles[0]!.permissions = String(P.SEND);
    const r = impact(s, 'access', ['channel'])[0]!;
    expect(r.after.send).toBe(false);
  });
  it('marks unsupported channel types explicitly', () => {
    const s = baseline();
    s.channels[0]!.type = 11;
    expect(impact(s, 'access', ['channel'])[0]!.supported).toBe(false);
  });
  it('does not include unrelated private channel names in previews', () => {
    const s = baseline();
    s.channels.push({ ...s.channels[0]!, id: 'finance', name: 'Secret finance' });
    expect(impact(s, 'access', ['channel']).map((c) => c.name)).not.toContain('Secret finance');
  });
  it('keeps fingerprints stable across order and target role membership', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (reverse, hasRole) => {
        const a = baseline(),
          b = baseline();
        if (reverse) {
          b.roles.reverse();
          b.channels[0]!.overwrites.reverse();
        }
        if (hasRole) b.member.roleIds.push('access');
        expect(fingerprint(a, 'access')).toBe(fingerprint(b, 'access'));
      }),
      { numRuns: 100 },
    );
  });
  it('detects authorization drift, including other roles and bot hierarchy', () => {
    const s = baseline(),
      original = fingerprint(s, 'access');
    s.member.roleIds = ['other'];
    expect(fingerprint(s, 'access')).not.toBe(original);
    s.member.roleIds = [];
    s.roles[3]!.position = 1;
    expect(fingerprint(s, 'access')).not.toBe(original);
  });
  it.each(['global', 'managed', 'higher', 'outside', 'unsafe', 'unsupported'])(
    'rejects unsafe role setup: %s',
    (type) => {
      const s = baseline();
      if (type === 'global') s.roles[1]!.permissions = String(P.ADMIN);
      if (type === 'managed') s.roles[1]!.managed = true;
      if (type === 'higher') s.roles[1]!.position = 20;
      if (type === 'outside') s.channels.push({ ...s.channels[0]!, id: 'other-channel' });
      if (type === 'unsafe') s.channels[0]!.overwrites[1]!.allow = String(P.MANAGE_ROLES);
      if (type === 'unsupported') s.channels[0]!.type = 11;
      expect(() => assertSafeRole(s, 'access', ['channel'])).toThrow();
    },
  );
  it('accepts a scoped, dedicated low-privilege role', () => {
    expect(() => assertSafeRole(baseline(), 'access', ['channel'])).not.toThrow();
  });
  it('uses bigint for permission bits beyond 32 bits', () => {
    const s = baseline();
    s.roles[0]!.permissions = String(1n << 50n);
    expect(guildPermissions(s) & (1n << 50n)).toBe(1n << 50n);
  });
});
