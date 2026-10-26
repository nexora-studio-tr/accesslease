import { describe, it, expect, vi } from 'vitest';
import { LiveDiscord } from '../src/adapters/discord.js';
import { DiscordUnavailable } from '../src/domain/model.js';
const guild = '610000000000000001',
  user = '910000000000000001',
  bot = '910000000000000099';
const make = () => new LiveDiscord('synthetic-test-token', bot, [guild], 'http://127.0.0.1:4348');
describe('official Discord adapter contract without network', () => {
  it('retains guild channels even when the optional guild_id field is omitted', async () => {
    const adapter = make();
    const get = vi.spyOn(adapter.rest, 'get').mockImplementation(async (route) => {
      if (route.endsWith('/channels'))
        return [
          {
            id: '810000000000000001',
            name: 'private',
            type: 0,
            permission_overwrites: [{ id: guild, type: 0, allow: '0', deny: '1024' }],
          },
        ];
      if (route.endsWith('/roles'))
        return [{ id: guild, name: '@everyone', permissions: '1024', position: 0, managed: false }];
      if (route.includes('/members/'))
        return {
          roles: [],
          user: { id: user, username: 'Test' },
          communication_disabled_until: null,
        };
      return { name: 'Test guild', owner_id: user };
    });
    const snapshot = await adapter.snapshot(guild, user);
    expect(snapshot.channels).toHaveLength(1);
    expect(snapshot.channels[0]!.overwrites[0]!.type).toBe('role');
    expect(get).toHaveBeenCalledTimes(5);
    expect(get.mock.calls.every((c) => c[1]?.signal instanceof AbortSignal)).toBe(true);
    await adapter.close();
  });
  it('rejects an unconfigured guild before making network requests', async () => {
    const adapter = make(),
      get = vi.spyOn(adapter.rest, 'get');
    await expect(adapter.snapshot('620000000000000001', user)).rejects.toMatchObject({
      code: 'workspace_not_found',
    });
    expect(get).not.toHaveBeenCalled();
    await adapter.close();
  });
  it.each([
    [10007, 'member_not_found'],
    [50013, 'bot_permissions_missing'],
    [50001, 'bot_permissions_missing'],
  ])('maps provider error %s safely', async (code, expected) => {
    const adapter = make();
    vi.spyOn(adapter.rest, 'get').mockRejectedValue({ code });
    await expect(adapter.snapshot(guild, user)).rejects.toMatchObject({ code: expected });
    await adapter.close();
  });
  it('classifies an uncertain role write without claiming success', async () => {
    const adapter = make();
    vi.spyOn(adapter.rest, 'put').mockRejectedValue(new Error('synthetic timeout'));
    await expect(adapter.addRole(guild, user, '710000000000000004')).rejects.toMatchObject({
      uncertain: true,
    });
    vi.spyOn(adapter.rest, 'delete').mockRejectedValue(new Error('synthetic timeout'));
    await expect(adapter.removeRole(guild, user, '710000000000000004')).rejects.toBeInstanceOf(
      DiscordUnavailable,
    );
    await adapter.close();
  });
});
