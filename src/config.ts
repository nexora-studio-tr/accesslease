import { z } from 'zod';
export function config(env = process.env) {
  const raw = z
    .object({
      APP_MODE: z.enum(['demo', 'live']).default('demo'),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4348),
      PUBLIC_ORIGIN: z.string().url().default('http://127.0.0.1:4348'),
      DATABASE_URL: z.string().min(1),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DISCORD_APPLICATION_ID: z.string().optional(),
      DISCORD_CLIENT_SECRET: z.string().optional(),
      DISCORD_BOT_TOKEN: z.string().optional(),
      DISCORD_GUILD_IDS: z.string().default(''),
    })
    .parse(env);
  const origin = new URL(raw.PUBLIC_ORIGIN);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    throw new Error('PUBLIC_ORIGIN must be an origin without path or credentials');
  if (
    raw.APP_MODE === 'live' &&
    (!raw.DISCORD_APPLICATION_ID ||
      !raw.DISCORD_CLIENT_SECRET ||
      !raw.DISCORD_BOT_TOKEN ||
      !raw.DISCORD_GUILD_IDS)
  )
    throw new Error(
      'Live mode requires a dedicated Discord application, secret, token and guild allow-list',
    );
  if (raw.NODE_ENV === 'production' && raw.APP_MODE === 'live' && origin.protocol !== 'https:')
    throw new Error('Live production requires HTTPS');
  if (raw.APP_MODE === 'live') {
    if (
      !/^\d{17,20}$/.test(raw.DISCORD_APPLICATION_ID!) ||
      raw.DISCORD_GUILD_IDS.split(',').some((id) => !/^\d{17,20}$/.test(id.trim()))
    )
      throw new Error('Live application and guild IDs must be valid Discord snowflakes');
    if (/^\d+$/.test(raw.DISCORD_CLIENT_SECRET!))
      throw new Error(
        'OAuth Client Secret must be the actual secret, not the numeric application ID',
      );
  }
  return {
    ...raw,
    PUBLIC_ORIGIN: origin.origin,
    guildIds: raw.DISCORD_GUILD_IDS.split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}
export type Config = ReturnType<typeof config>;
