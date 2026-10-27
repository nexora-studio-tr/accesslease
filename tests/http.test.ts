import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../src/http/app.js';
import { config } from '../src/config.js';
import { fixture } from './helpers.js';
describe('HTTP trust boundaries / PostgreSQL sessions', () => {
  let f: Awaited<ReturnType<typeof fixture>>, app: Awaited<ReturnType<typeof buildApp>>;
  const host = '127.0.0.1:4348',
    origin = 'http://' + host;
  beforeAll(async () => {
    f = await fixture();
    app = await buildApp(
      config({ APP_MODE: 'demo', DATABASE_URL: 'unused', NODE_ENV: 'test' }),
      f.db,
      f.engine,
    );
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await f.close();
  });
  async function login(persona = 0, previous?: { cookie: string; csrf: string }) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: {
        host,
        origin,
        ...(previous ? { cookie: previous.cookie, 'x-csrf-token': previous.csrf } : {}),
      },
      payload: { persona },
    });
    expect(r.statusCode).toBe(200);
    const json = r.json();
    expect(json.actors).toHaveLength(3);
    return {
      cookie: 'al_session=' + r.cookies.find((c) => c.name === 'al_session')!.value,
      csrf: json.csrf,
      actor: json.actor,
    };
  }
  async function world(s: { cookie: string }) {
    const r = await app.inject({ url: '/api/workspaces', headers: { host, cookie: s.cookie } });
    return r.json()[0].id as string;
  }
  it('serves a minimal health endpoint without credentials', async () => {
    const r = await app.inject({ url: '/health', headers: { host } });
    expect(r.json().status).toBe('ok');
    expect(JSON.stringify(r.json())).not.toContain('DATABASE');
  });
  it('scopes renewal requests to the holder, current session and strict input', async () => {
    const o = await login(),
      g = await world(o);
    const original = (
      await f.db.query("SELECT id FROM requests WHERE guild_id=$1 AND status='pending'", [g])
    ).rows[0]!.id;
    const preview = await f.engine.preview(g, o.actor, original);
    await f.engine.approve(g, o.actor, original, preview.hash);
    await f.engine.tick();
    const before = (await f.db.query('SELECT expires_at FROM requests WHERE id=$1', [original]))
      .rows[0]!.expires_at;
    const request = (s: { cookie: string; csrf: string }, payload: unknown, token = s.csrf) =>
      app.inject({
        method: 'POST',
        url: `/api/w/${g}/requests/${original}/renew`,
        headers: {
          host,
          origin,
          cookie: s.cookie,
          'x-csrf-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });
    const body = {
      durationMinutes: 4320,
      reason: 'Continue investigating the release with this team.',
    };
    expect((await request(o, body)).statusCode).toBe(403);
    const m = await login(2, o);
    expect((await request(m, body, 'wrong')).statusCode).toBe(403);
    expect((await request(m, { ...body, policyId: original })).statusCode).toBe(400);
    const result = await request(m, body);
    expect(result.statusCode).toBe(200);
    const renewed = (await f.db.query('SELECT * FROM requests WHERE id=$1', [result.json().id]))
      .rows[0]!;
    expect(renewed).toMatchObject({
      user_id: m.actor.id,
      renewal_of: original,
      status: 'pending',
      expires_at: null,
    });
    expect(
      (await f.db.query('SELECT expires_at FROM requests WHERE id=$1', [original])).rows[0]!
        .expires_at,
    ).toEqual(before);
    expect((await request(m, body)).statusCode).toBe(409);
    const foreign = await login();
    expect((await request(foreign, body)).statusCode).toBe(403);
  });
  it('serves the built application without exposing private source files', async () => {
    const r = await app.inject({ url: '/', headers: { host } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    const missing = await app.inject({ url: '/.env', headers: { host } });
    expect(missing.body).not.toContain('DATABASE_URL=');
  });
  it('rejects DNS rebinding Host and foreign Origins', async () => {
    expect(
      (await app.inject({ url: '/health', headers: { host: 'evil.invalid' } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/demo/login',
          headers: { host, origin: 'https://evil.invalid' },
          payload: { persona: 0 },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('requires an authenticated session', async () => {
    expect((await app.inject({ url: '/api/workspaces', headers: { host } })).statusCode).toBe(401);
  });
  it('uses HttpOnly, SameSite session cookies and stores only hashed tokens', async () => {
    const s = await login();
    const tokens = (await f.db.query('SELECT token_hash FROM sessions')).rows;
    expect(tokens.some((t) => s.cookie.includes(t.token_hash))).toBe(false);
    const r = await app.inject({
      method: 'POST',
      url: '/api/demo/login',
      headers: { host, origin },
      payload: { persona: 0 },
    });
    expect(r.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'));
    expect(r.headers['set-cookie']).toEqual(expect.stringContaining('SameSite=Lax'));
  });
  it('isolates demo workspaces, including read and mutation endpoints', async () => {
    const a = await login(),
      b = await login(),
      g = await world(a);
    const r = await app.inject({ url: `/api/w/${g}/`, headers: { host, cookie: b.cookie } });
    expect(r.statusCode).toBe(403);
    const write = await app.inject({
      method: 'POST',
      url: `/api/w/${g}/pause`,
      headers: { host, origin, cookie: b.cookie, 'x-csrf-token': b.csrf },
      payload: { paused: true },
    });
    expect(write.statusCode).toBe(403);
  });
  it('rejects mutations without a matching CSRF token', async () => {
    const s = await login(),
      g = await world(s);
    const r = await app.inject({
      method: 'POST',
      url: `/api/w/${g}/pause`,
      headers: { host, origin, cookie: s.cookie },
      payload: { paused: true },
    });
    expect(r.statusCode).toBe(403);
  });
  it('rotates and invalidates sessions on persona switches', async () => {
    const a = await login();
    const b = await login(2, a);
    expect(await world(b)).toBeTruthy();
    expect(
      (await app.inject({ url: '/api/workspaces', headers: { host, cookie: a.cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it('does not leak owner configuration, other requests, or policy channel names to members', async () => {
    const o = await login(),
      g = await world(o),
      m = await login(2, o);
    const r = (
      await app.inject({ url: `/api/w/${g}/`, headers: { host, cookie: m.cookie } })
    ).json();
    expect(r.configuration).toBeNull();
    expect(r.requests.every((q: { user_id: string }) => q.user_id === m.actor.id)).toBe(true);
    expect(r.policies.every((p: { channel_ids: string[] }) => p.channel_ids.length === 0)).toBe(
      true,
    );
    expect(JSON.stringify(r)).not.toContain('lab-voice');
  });
  it('forbids member preview and export of reviewer evidence', async () => {
    const o = await login(),
      g = await world(o);
    const d = (
        await app.inject({ url: `/api/w/${g}/`, headers: { host, cookie: o.cookie } })
      ).json(),
      pending = d.requests.find((r: { status: string }) => r.status === 'pending');
    const m = await login(2, o);
    expect(
      (
        await app.inject({
          url: `/api/w/${g}/requests/${pending.id}/preview`,
          headers: { host, cookie: m.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `/api/w/${g}/export`, headers: { host, cookie: m.cookie } }))
        .statusCode,
    ).toBe(403);
  });
  it('round-trips review and expiry via the actual API', async () => {
    const s = await login(),
      g = await world(s),
      headers = { host, origin, cookie: s.cookie, 'x-csrf-token': s.csrf };
    const d = (await app.inject({ url: `/api/w/${g}/`, headers })).json();
    const pending = d.requests.find((r: { status: string }) => r.status === 'pending');
    const p = (
      await app.inject({ url: `/api/w/${g}/requests/${pending.id}/preview`, headers })
    ).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/w/${g}/requests/${pending.id}/approve`,
          headers,
          payload: { previewHash: p.hash },
        })
      ).statusCode,
    ).toBe(200);
    await f.engine.tick();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/w/${g}/demo`,
          headers,
          payload: { action: 'advance' },
        })
      ).statusCode,
    ).toBe(200);
    const after = (await app.inject({ url: `/api/w/${g}/`, headers })).json();
    expect(after.requests.find((r: { id: string }) => r.id === pending.id).status).toBe('closed');
  });
  it('rejects unknown fields and invalid identifiers without database errors', async () => {
    const s = await login(),
      g = await world(s),
      headers = { host, origin, cookie: s.cookie, 'x-csrf-token': s.csrf };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/w/${g}/pause`,
          headers,
          payload: { paused: true, owner: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: `/api/w/${g}/requests/not-a-uuid/preview`, headers })).statusCode,
    ).toBe(400);
  });
  it('exports scoped, downloadable evidence and logs out persistently', async () => {
    const s = await login(),
      g = await world(s),
      headers = { host, origin, cookie: s.cookie, 'x-csrf-token': s.csrf };
    const exportResult = await app.inject({ url: `/api/w/${g}/export?format=csv`, headers });
    expect(exportResult.statusCode).toBe(200);
    expect(exportResult.headers['content-disposition']).toContain('attachment');
    expect(exportResult.body).toContain('sequence,created_at');
    await app.inject({ method: 'POST', url: '/api/logout', headers, payload: {} });
    expect((await app.inject({ url: '/api/workspaces', headers })).statusCode).toBe(401);
  });
  it('blocks demo endpoints in live mode and rejects invalid OAuth state', async () => {
    const demoSession = await login();
    const live = await buildApp(
      config({
        APP_MODE: 'live',
        DATABASE_URL: 'unused',
        NODE_ENV: 'test',
        DISCORD_APPLICATION_ID: '910000000000000099',
        DISCORD_CLIENT_SECRET: 'test-only',
        DISCORD_BOT_TOKEN: 'test-only',
        DISCORD_GUILD_IDS: '610000000000000001',
      }),
      f.db,
      f.engine,
    );
    try {
      expect(
        (
          await live.inject({ url: '/api/session', headers: { host, cookie: demoSession.cookie } })
        ).json().actor,
      ).toBeNull();
      expect(
        (
          await live.inject({
            url: '/api/workspaces',
            headers: { host, cookie: demoSession.cookie },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await live.inject({
            method: 'POST',
            url: '/api/demo/login',
            headers: { host, origin },
            payload: { persona: 0 },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await live.inject({
            url: '/auth/callback?code=bad&state=' + 'a'.repeat(64),
            headers: { host },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await live.close();
    }
  });
});
