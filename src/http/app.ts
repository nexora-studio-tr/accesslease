import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError, DiscordUnavailable, type Actor } from '../domain/model.js';
import type { Config } from '../config.js';
import { Database } from '../store/db.js';
import { Engine } from '../engine/service.js';
import { createDemo, DEMO_ACTORS, demoScenario } from '../adapters/simulator.js';
type Session = {
  token_hash: string;
  user_id: string;
  user_name: string;
  demo_guild_id: string | null;
  csrf: string;
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const snowflake = z.string().regex(/^\d{17,20}$/),
  uuid = z.uuid();
const policyInput = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300),
    roleId: snowflake,
    channelIds: z.array(snowflake).min(1).max(50),
    eligibleRoleIds: z.array(snowflake).max(20),
    approverRoleIds: z.array(snowflake).max(20),
    maxMinutes: z.number().int().min(5).max(10080),
    published: z.boolean(),
  })
  .strict();
export async function buildApp(cfg: Config, db: Database, engine: Engine) {
  const app = Fastify({
    logger:
      cfg.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'],
            serializers: { req: (r) => ({ method: r.method, url: r.url?.split('?')[0] }) },
          },
    bodyLimit: 16384,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 180, timeWindow: 60000 });
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cfg.PUBLIC_ORIGIN.startsWith('https:'),
    path: '/',
  };
  const sessions = new WeakMap<FastifyRequest, Session>();
  const actor = (r: FastifyRequest): Actor => {
    const s = sessions.get(r);
    if (!s) throw new AppError('login_required', 401);
    return { id: s.user_id, name: s.user_name };
  };
  async function session(r: FastifyRequest) {
    const value = r.cookies.al_session;
    if (!value || value.length !== 64) return;
    const row = await db.query<Session>(
      "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now() AND (($2='demo' AND demo_guild_id IS NOT NULL) OR ($2='live' AND demo_guild_id IS NULL))",
      [hash(value), cfg.APP_MODE],
    );
    return row.rows[0];
  }
  app.addHook('onRequest', async (req, reply) => {
    // Reverse proxies must preserve the configured public Host; forwarded headers are not trusted.
    if (req.headers.host !== new URL(cfg.PUBLIC_ORIGIN).host)
      throw new AppError('invalid_host', 400);
    const s = await session(req);
    if (s) sessions.set(req, s);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== cfg.PUBLIC_ORIGIN) throw new AppError('invalid_origin', 403);
      if (s && req.url !== '/api/demo/login') {
        const supplied = req.headers['x-csrf-token'];
        if (
          typeof supplied !== 'string' ||
          !timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(s.csrf)))
        )
          throw new AppError('csrf_invalid', 403);
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new AppError('json_required', 415);
    }
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.status).send({ error: error.code });
    if (error instanceof z.ZodError)
      return reply
        .status(400)
        .send({ error: 'invalid_input', fields: error.issues.map((i) => i.path.join('.')) });
    if (error instanceof DiscordUnavailable)
      return reply.status(503).send({ error: 'discord_unavailable' });
    if ((error as { code?: string }).code === '23505')
      return reply.status(409).send({ error: 'duplicate_request_or_role' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply
        .status(status)
        .send({ error: status === 429 ? 'rate_limited' : 'invalid_input' });
    app.log.error(
      { code: (error as { code?: string }).code ?? 'internal_error' },
      'Request failed',
    );
    return reply.status(500).send({ error: 'internal_error' });
  });
  async function setSession(
    reply: import('fastify').FastifyReply,
    user: Actor,
    demoGuild: string | null,
    previous?: Session,
  ) {
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    const c = await db.pool.connect();
    try {
      await db.atomic(c, async () => {
        if (previous)
          await c.query('DELETE FROM sessions WHERE token_hash=$1', [previous.token_hash]);
        await c.query(
          "INSERT INTO sessions(token_hash,user_id,user_name,demo_guild_id,csrf,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '8 hours')",
          [hash(token), user.id, user.name, demoGuild, csrf],
        );
      });
    } finally {
      c.release();
    }
    reply.setCookie('al_session', token, { ...cookieOptions, maxAge: 28800 });
    return {
      actor: user,
      csrf,
      mode: cfg.APP_MODE,
      actors: cfg.APP_MODE === 'demo' ? DEMO_ACTORS : [],
    };
  }
  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', version: '0.1.0-alpha.2', mode: cfg.APP_MODE };
  });
  app.get('/api/session', async (req) => {
    const s = sessions.get(req);
    return {
      mode: cfg.APP_MODE,
      actor: s ? actor(req) : null,
      csrf: s?.csrf ?? null,
      actors: cfg.APP_MODE === 'demo' ? DEMO_ACTORS : [],
    };
  });
  app.post(
    '/api/demo/login',
    { config: { rateLimit: { max: 20, timeWindow: 60000 } } },
    async (req, reply) => {
      if (cfg.APP_MODE !== 'demo') throw new AppError('demo_disabled', 404);
      const { persona } = z
          .object({ persona: z.number().int().min(0).max(2) })
          .strict()
          .parse(req.body),
        previous = sessions.get(req);
      const guild = previous?.demo_guild_id ?? (await createDemo(db, engine));
      return setSession(reply, DEMO_ACTORS[persona]!, guild, previous);
    },
  );
  app.post('/api/logout', async (req, reply) => {
    actor(req);
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [sessions.get(req)!.token_hash]);
    reply.clearCookie('al_session', cookieOptions);
    return { ok: true };
  });
  app.get('/auth/discord', async (_req, reply) => {
    if (cfg.APP_MODE !== 'live') throw new AppError('live_only', 404);
    const state = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO oauth_states(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')",
      [hash(state)],
    );
    reply.setCookie('al_oauth', state, { ...cookieOptions, maxAge: 600 });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: cfg.DISCORD_APPLICATION_ID!,
      response_type: 'code',
      redirect_uri: cfg.PUBLIC_ORIGIN + '/auth/callback',
      scope: 'identify',
      state,
    }).toString();
    return reply.redirect(url.toString());
  });
  app.get('/auth/callback', async (req, reply) => {
    if (cfg.APP_MODE !== 'live') throw new AppError('live_only', 404);
    const q = z
        .object({ state: z.string().length(64), code: z.string().min(1).max(2048) })
        .parse(req.query),
      stored = req.cookies.al_oauth;
    if (!stored || !timingSafeEqual(Buffer.from(hash(stored)), Buffer.from(hash(q.state))))
      throw new AppError('oauth_state_invalid', 403);
    reply.clearCookie('al_oauth', cookieOptions);
    const used = await db.query(
      'DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash',
      [hash(q.state)],
    );
    if (!used.rowCount) throw new AppError('oauth_state_invalid', 403);
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.DISCORD_APPLICATION_ID!,
        client_secret: cfg.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code: q.code,
        redirect_uri: cfg.PUBLIC_ORIGIN + '/auth/callback',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new AppError('oauth_exchange_failed', 502);
    const token = z.object({ access_token: z.string() }).parse(await tokenResponse.json());
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bearer ' + token.access_token },
      signal: AbortSignal.timeout(10000),
    });
    if (!userResponse.ok) throw new AppError('oauth_identity_failed', 502);
    const user = z
      .object({
        id: snowflake,
        username: z.string(),
        global_name: z.string().nullable().optional(),
      })
      .parse(await userResponse.json());
    await setSession(
      reply,
      { id: user.id, name: user.global_name ?? user.username },
      null,
      sessions.get(req),
    );
    return reply.redirect('/');
  });
  app.get('/api/workspaces', async (req) => {
    const who = actor(req),
      s = sessions.get(req)!;
    if (cfg.APP_MODE === 'demo')
      return (await db.query('SELECT id,name FROM workspaces WHERE id=$1', [s.demo_guild_id])).rows;
    const rows = (await db.query("SELECT id,name FROM workspaces WHERE mode='live' ORDER BY name"))
      .rows;
    const visible = [];
    for (const row of rows) {
      try {
        await engine.adapter.snapshot(row.id, who.id);
        visible.push(row);
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'member_not_found')) throw e;
      }
    }
    return visible;
  });
  app.register(
    async (scoped) => {
      scoped.addHook('preHandler', async (req) => {
        actor(req);
        const { guild } = z.object({ guild: snowflake }).parse(req.params);
        if (cfg.APP_MODE === 'demo' && sessions.get(req)!.demo_guild_id !== guild)
          throw new AppError('forbidden', 403);
        if (cfg.APP_MODE === 'live' && !cfg.guildIds.includes(guild))
          throw new AppError('workspace_not_found', 404);
      });
      const guild = (req: FastifyRequest) => z.object({ guild: snowflake }).parse(req.params).guild;
      const requestId = (req: FastifyRequest) => z.object({ id: uuid }).parse(req.params).id;
      scoped.get('/', async (req) => engine.dashboard(guild(req), actor(req)));
      scoped.post('/policies', async (req) => ({
        id: await engine.savePolicy(guild(req), actor(req), policyInput.parse(req.body)),
      }));
      scoped.put('/policies/:id', async (req) => ({
        id: await engine.savePolicy(
          guild(req),
          actor(req),
          policyInput.parse(req.body),
          requestId(req),
        ),
      }));
      scoped.post('/requests', async (req) => {
        const b = z
          .object({
            policyId: uuid,
            durationMinutes: z.number().int().min(5).max(10080),
            reason: z.string().trim().min(10).max(500),
          })
          .strict()
          .parse(req.body);
        return {
          id: await engine.submit(guild(req), actor(req), b.policyId, b.durationMinutes, b.reason),
        };
      });
      scoped.get('/requests/:id/preview', async (req) =>
        engine.preview(guild(req), actor(req), requestId(req)),
      );
      scoped.post('/requests/:id/renew', async (req) => {
        const b = z
          .object({
            durationMinutes: z.number().int().min(5).max(10080),
            reason: z.string().trim().min(10).max(500),
          })
          .strict()
          .parse(req.body);
        return {
          id: await engine.renew(
            guild(req),
            actor(req),
            requestId(req),
            b.durationMinutes,
            b.reason,
          ),
        };
      });
      scoped.post('/requests/:id/approve', async (req) => {
        const b = z
          .object({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .parse(req.body);
        await engine.approve(guild(req), actor(req), requestId(req), b.previewHash);
        return { ok: true };
      });
      scoped.post('/requests/:id/decision', async (req) => {
        const b = z
          .object({ action: z.enum(['deny', 'cancel', 'end']) })
          .strict()
          .parse(req.body);
        await engine.decide(guild(req), actor(req), requestId(req), b.action);
        return { ok: true };
      });
      scoped.post('/pause', async (req) => {
        const { paused } = z.object({ paused: z.boolean() }).strict().parse(req.body);
        await engine.pause(guild(req), actor(req), paused);
        return { ok: true };
      });
      scoped.post('/detach', async (req) => {
        const b = z
          .object({
            userId: snowflake,
            roleId: snowflake,
            confirmation: z.literal('release-management'),
          })
          .strict()
          .parse(req.body);
        await engine.detach(guild(req), actor(req), b.userId, b.roleId);
        return { ok: true };
      });
      scoped.post('/reset-management', async (req) => {
        const b = z
          .object({
            userId: snowflake,
            roleId: snowflake,
            confirmation: z.literal('verify-absence'),
          })
          .strict()
          .parse(req.body);
        await engine.resetManagement(guild(req), actor(req), b.userId, b.roleId);
        return { ok: true };
      });
      scoped.get('/export', async (req, reply) => {
        const g = guild(req);
        await engine.owner(g, actor(req));
        const format = z
          .object({ format: z.enum(['json', 'csv']).default('json') })
          .parse(req.query).format;
        const rows = (
          await db.query(
            'SELECT sequence,created_at,actor_id,kind,request_id,detail FROM events WHERE guild_id=$1 ORDER BY sequence DESC LIMIT 10000',
            [g],
          )
        ).rows;
        reply.header('Content-Disposition', `attachment; filename="accesslease-events.${format}"`);
        if (format === 'json') return rows;
        const cell = (v: unknown) => {
          const s = String(v ?? '');
          return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
        };
        reply.type('text/csv; charset=utf-8');
        return [
          'sequence,created_at,actor_id,kind,request_id,detail',
          ...rows.map((r) =>
            [
              r.sequence,
              new Date(r.created_at).toISOString(),
              r.actor_id,
              r.kind,
              r.request_id,
              JSON.stringify(r.detail),
            ]
              .map(cell)
              .join(','),
          ),
        ].join('\r\n');
      });
      scoped.get('/demo', async (req) => {
        if (cfg.APP_MODE !== 'demo') throw new AppError('demo_disabled', 404);
        return {
          online:
            (await db.query('SELECT online FROM simulations WHERE guild_id=$1', [guild(req)]))
              .rows[0]?.online ?? false,
        };
      });
      scoped.post('/demo', async (req) => {
        if (cfg.APP_MODE !== 'demo') throw new AppError('demo_disabled', 404);
        const { action } = z
          .object({
            action: z.enum(['advance', 'offline', 'online', 'external-remove', 'remaining-access']),
          })
          .strict()
          .parse(req.body);
        await demoScenario(db, engine, guild(req), actor(req), action);
        return { ok: true };
      });
    },
    { prefix: '/api/w/:guild' },
  );
  const root = resolve('web-dist');
  if (existsSync(root)) {
    await app.register(staticFiles, {
      root,
      index: ['index.html'],
      cacheControl: false,
      preCompressed: true,
      dotfiles: 'deny',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/auth/'))
        return reply.status(404).send({ error: 'not_found' });
      if (req.method !== 'GET') return reply.status(404).send({ error: 'not_found' });
      return reply.type('text/html').sendFile('index.html');
    });
  }
  return app;
}
