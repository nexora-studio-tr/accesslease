import { describe, it, expect } from 'vitest';
import { config } from '../src/config.js';
const base = { DATABASE_URL: 'postgresql://example.invalid/test' },
  live = {
    ...base,
    APP_MODE: 'live',
    DISCORD_APPLICATION_ID: '910000000000000099',
    DISCORD_CLIENT_SECRET: 'synthetic-test-secret',
    DISCORD_BOT_TOKEN: 'synthetic-test-token',
    DISCORD_GUILD_IDS: '610000000000000001',
  };
describe('deployment boundaries', () => {
  it('defaults to simulation without Discord credentials', () => {
    expect(config(base).APP_MODE).toBe('demo');
  });
  it('requires dedicated live configuration', () => {
    expect(() => config({ ...base, APP_MODE: 'live' })).toThrow('dedicated');
  });
  it('rejects using an application ID as a client secret', () => {
    expect(() => config({ ...live, DISCORD_CLIENT_SECRET: live.DISCORD_APPLICATION_ID })).toThrow(
      'actual secret',
    );
  });
  it('requires HTTPS for a production live deployment', () => {
    expect(() => config({ ...live, NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(
      config({ ...live, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://access.example.com' })
        .guildIds,
    ).toHaveLength(1);
  });
  it.each([
    'https://example.com/path',
    'https://user:pass@example.com',
    'https://example.com/?secret=bad',
  ])('rejects non-origin configuration %s', (origin) => {
    expect(() => config({ ...base, PUBLIC_ORIGIN: origin })).toThrow('origin');
  });
});
