import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type APIGuild,
  type APIGuildMember,
  type APIRole,
  type APIChannel,
} from 'discord.js';
import {
  AppError,
  DiscordUnavailable,
  type DiscordAdapter,
  type Snapshot,
} from '../domain/model.js';
import type { Engine } from '../engine/service.js';
export class LiveDiscord implements DiscordAdapter {
  rest: REST;
  client: Client;
  guildIds: Set<string>;
  constructor(
    private token: string,
    public applicationId: string,
    guildIds: string[],
    private origin: string,
  ) {
    this.guildIds = new Set(guildIds);
    this.rest = new REST({ version: '10', timeout: 10000, retries: 0 }).setToken(token);
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });
  }
  async snapshot(guildId: string, memberId: string): Promise<Snapshot> {
    if (!this.guildIds.has(guildId)) throw new AppError('workspace_not_found', 404);
    try {
      const [guild, member, roles, channels, bot] = await Promise.all([
        this.rest.get(Routes.guild(guildId), {
          signal: AbortSignal.timeout(12000),
        }) as Promise<APIGuild>,
        this.rest.get(Routes.guildMember(guildId, memberId), {
          signal: AbortSignal.timeout(12000),
        }) as Promise<APIGuildMember>,
        this.rest.get(Routes.guildRoles(guildId), {
          signal: AbortSignal.timeout(12000),
        }) as Promise<APIRole[]>,
        this.rest.get(Routes.guildChannels(guildId), {
          signal: AbortSignal.timeout(12000),
        }) as Promise<APIChannel[]>,
        this.rest.get(Routes.guildMember(guildId, this.applicationId), {
          signal: AbortSignal.timeout(12000),
        }) as Promise<APIGuildMember>,
      ]);
      return {
        guildId,
        guildName: guild.name,
        ownerId: guild.owner_id,
        botId: this.applicationId,
        botRoleIds: bot.roles,
        member: {
          id: memberId,
          name: member.nick ?? member.user?.global_name ?? member.user?.username ?? memberId,
          roleIds: member.roles,
          timedOut:
            !!member.communication_disabled_until &&
            Date.parse(member.communication_disabled_until) > Date.now(),
        },
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          permissions: r.permissions,
          position: r.position,
          managed: r.managed,
        })),
        channels: channels.map((c) => ({
          id: c.id,
          name: ('name' in c ? c.name : null) ?? c.id,
          type: c.type,
          overwrites: ('permission_overwrites' in c ? (c.permission_overwrites ?? []) : []).map(
            (o) => ({
              id: o.id,
              type: o.type === 0 ? 'role' : 'member',
              allow: o.allow,
              deny: o.deny,
            }),
          ),
        })),
      };
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 10007) throw new AppError('member_not_found', 404);
      if (code === 50013 || code === 50001) throw new AppError('bot_permissions_missing', 409);
      throw new DiscordUnavailable();
    }
  }
  async addRole(g: string, u: string, r: string) {
    try {
      await this.rest.put(Routes.guildMemberRole(g, u, r), {
        signal: AbortSignal.timeout(12000),
        reason: 'AccessLease: approved temporary access',
      });
    } catch {
      throw new DiscordUnavailable('Grant outcome uncertain', true);
    }
  }
  async removeRole(g: string, u: string, r: string) {
    try {
      await this.rest.delete(Routes.guildMemberRole(g, u, r), {
        signal: AbortSignal.timeout(12000),
        reason: 'AccessLease: authorization ended',
      });
    } catch {
      throw new DiscordUnavailable('Removal outcome uncertain', true);
    }
  }
  async start(engine: Engine) {
    const command = new SlashCommandBuilder()
      .setName('access')
      .setDescription('Request and manage temporary access / Geçici erişim')
      .addSubcommand((s) =>
        s.setName('panel').setDescription('Open your access dashboard / Paneli aç'),
      )
      .addSubcommand((s) =>
        s
          .setName('request')
          .setDescription('Request access / Erişim iste')
          .addStringOption((o) =>
            o
              .setName('package')
              .setDescription('Access package / Erişim paketi')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addIntegerOption((o) =>
            o
              .setName('minutes')
              .setDescription('Duration in minutes / Dakika')
              .setMinValue(5)
              .setMaxValue(10080)
              .setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName('reason')
              .setDescription('Why do you need access? / Erişim gerekçesi')
              .setMinLength(10)
              .setMaxLength(500)
              .setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s.setName('mine').setDescription('Show your recent requests / Başvurularım'),
      );
    for (const g of this.guildIds) {
      const s = await this.snapshot(g, this.applicationId);
      await engine.db.query(
        "INSERT INTO workspaces(id,name,owner_id,mode) VALUES($1,$2,$3,'live') ON CONFLICT(id) DO UPDATE SET name=$2,owner_id=$3",
        [g, s.guildName, s.ownerId],
      );
      await this.rest.put(Routes.applicationGuildCommands(this.applicationId, g), {
        body: [command.toJSON()],
      });
    }
    this.client.on('interactionCreate', async (i) => {
      if (!i.guildId || !this.guildIds.has(i.guildId)) return;
      try {
        if (i.isAutocomplete()) {
          const s = await this.snapshot(i.guildId, i.user.id);
          const policies = (
            await engine.dashboard(i.guildId, { id: i.user.id, name: i.user.username })
          ).policies.filter(
            (p) =>
              p.canRequest && p.name.toLowerCase().includes(i.options.getFocused().toLowerCase()),
          );
          void s;
          await i.respond(policies.slice(0, 25).map((p) => ({ name: p.name, value: p.id })));
          return;
        }
        if (!i.isChatInputCommand() || i.commandName !== 'access') return;
        await i.deferReply({ flags: 64 });
        const actor = { id: i.user.id, name: i.user.globalName ?? i.user.username },
          sub = i.options.getSubcommand();
        if (sub === 'request') {
          await engine.submit(
            i.guildId,
            actor,
            i.options.getString('package', true),
            i.options.getInteger('minutes', true),
            i.options.getString('reason', true),
          );
          await i.editReply(
            `Request received. A different reviewer must approve it. / Başvuru alındı.\n${this.origin}`,
          );
        } else if (sub === 'mine') {
          const d = await engine.dashboard(i.guildId, actor);
          await i.editReply(
            d.requests
              .filter((r) => r.user_id === actor.id)
              .slice(0, 5)
              .map((r) => `${r.policy_name}: ${r.status}`)
              .join('\n') || 'No requests / Başvuru yok',
          );
        } else
          await i.editReply(
            `AccessLease · ${this.origin}\nSign in with Discord / Discord ile giriş yap.`,
          );
      } catch (e) {
        const message = e instanceof AppError ? e.code : 'service_unavailable';
        if (i.isAutocomplete()) await i.respond([]).catch(() => undefined);
        else if (i.isRepliable()) {
          if (i.deferred || i.replied)
            await i.editReply(`AccessLease: ${message}`).catch(() => undefined);
          else
            await i.reply({ content: `AccessLease: ${message}`, flags: 64 }).catch(() => undefined);
        }
      }
    });
    const reconcile = async (guild: string, user?: string) => {
      if (!this.guildIds.has(guild)) return;
      await engine.db
        .guild(guild, async (c) => {
          const r = await c.query(
            'SELECT user_id,role_id FROM bindings WHERE guild_id=$1 AND ($2::text IS NULL OR user_id=$2)',
            [guild, user ?? null],
          );
          for (const b of r.rows) await engine.enqueue(c, guild, b.user_id, b.role_id);
        })
        .catch(() => undefined);
    };
    this.client.on('guildMemberUpdate', (_old, m) => {
      void reconcile(m.guild.id, m.id);
    });
    this.client.on('guildMemberRemove', (m) => {
      void reconcile(m.guild.id, m.id);
    });
    this.client.on('roleUpdate', (_old, r) => {
      void reconcile(r.guild.id);
    });
    this.client.on('channelUpdate', (_old, c) => {
      if ('guild' in c) void reconcile(c.guild.id);
    });
    this.client.on('error', () => {
      /* No raw Discord errors or tokens enter public logs. Reconciliation retries independently. */
    });
    await this.client.login(this.token);
  }
  async close() {
    this.client.destroy();
  }
}
