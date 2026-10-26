import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  IconButton,
  Select,
  Switch,
  SegmentedControl,
  TextArea,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  FileClock,
  Globe2,
  KeyRound,
  Layers3,
  LockKeyhole,
  LogOut,
  Pause,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { copy, type Language } from './i18n';
type Actor = { id: string; name: string };
type Session = {
  mode: 'demo' | 'live';
  actor: Actor | null;
  csrf: string | null;
  actors?: Actor[];
};
type Policy = {
  id: string;
  name: string;
  description: string;
  role_id: string;
  channel_ids: string[];
  eligible_role_ids: string[];
  approver_role_ids: string[];
  max_minutes: number;
  published: boolean;
  version: number;
  canReview: boolean;
  canRequest: boolean;
};
type Cap = { view: boolean; send: boolean; connect: boolean; speak: boolean };
type ChannelImpact = {
  id: string;
  name: string;
  type: number;
  supported: boolean;
  before: Cap;
  after: Cap;
  changed: boolean;
  otherRoleNames: string[];
  memberOverride: boolean;
};
type Lease = {
  id: string;
  user_id: string;
  user_name: string;
  policy_id: string;
  policy_name: string;
  role_id: string;
  reason: string;
  duration_minutes: number;
  status: string;
  created_at: string;
  expires_at: string | null;
  approved_name: string | null;
  result: { code?: string; roleRemoved?: boolean; channels?: ChannelImpact[] } | null;
};
type Event = {
  sequence: string;
  kind: string;
  created_at: string;
  actor_id: string;
  request_id: string | null;
  detail: Record<string, unknown>;
};
type Data = {
  workspace: { id: string; name: string; mode: string; now: string; paused: boolean };
  actor: Actor;
  owner: boolean;
  policies: Policy[];
  requests: Lease[];
  bindings: { user_id: string; role_id: string; phase: string; detail: string | null }[];
  events: Event[];
  configuration: {
    roles: { id: string; name: string; permissions: string }[];
    channels: { id: string; name: string; type: number }[];
  } | null;
};
type Preview = {
  hash: string;
  self: boolean;
  stalePolicy: boolean;
  alreadyPresent: boolean;
  channels: ChannelImpact[];
  removal: ChannelImpact[];
};
let csrf: string | null = null;
async function call<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers:
      body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'internal_error');
  return data as T;
}
const errorText: Record<string, [string, string]> = {
  login_required: ['Sign in to continue.', 'Devam etmek için giriş yap.'],
  self_approval_forbidden: [
    'A different person must approve this request.',
    'Başvuruyu farklı bir kişi onaylamalı.',
  ],
  preview_changed: [
    'Permissions changed. Open a fresh preview and review again.',
    'İzinler değişti. Yeni önizlemeyi açıp yeniden incele.',
  ],
  policy_changed: [
    'This policy changed. Cancel and submit a new request.',
    'Politika değişti. Başvuruyu iptal edip yeniden gönder.',
  ],
  preexisting_role: [
    'The member already has this role. Existing access is left unchanged.',
    'Üyede bu rol zaten var. Mevcut erişim değiştirilmiyor.',
  ],
  workspace_paused: ['The owner paused automation.', 'Alan sahibi otomasyonu duraklattı.'],
  duplicate_request_or_role: [
    'A pending request or policy for this role already exists.',
    'Bu rol için bekleyen bir başvuru veya politika zaten var.',
  ],
  discord_unavailable: [
    'Discord could not be reached. No successful change is claimed.',
    'Discord’a ulaşılamadı. İşlemin başarılı olduğu varsayılmıyor.',
  ],
  role_requires_zero_base_permissions: [
    'Use a dedicated role with no server-wide permissions.',
    'Sunucu genelinde yetkisi olmayan özel bir rol kullan.',
  ],
  role_scope_mismatch: [
    'This role changes permissions outside the selected channels.',
    'Bu rol seçilen kanallar dışında da izinleri değiştiriyor.',
  ],
  unsafe_channel_permission: [
    'This role grants management or unsupported permissions.',
    'Bu rol yönetim veya desteklenmeyen yetkiler veriyor.',
  ],
  bot_role_hierarchy: [
    'Move the bot role above the access role in Discord.',
    'Discord’da bot rolünü erişim rolünün üstüne taşı.',
  ],
  bot_missing_manage_roles: [
    'The bot needs Manage Roles, without Administrator.',
    'Bota Administrator vermeden Rolleri Yönet yetkisi tanımla.',
  ],
  approver_role_hierarchy: [
    'Your reviewer role must be above the access role.',
    'Onaylayıcı rolün erişim rolünün üzerinde olmalı.',
  ],
  manual_review_required: [
    'An owner must review this role before another grant.',
    'Yeni erişim öncesinde alan sahibi bu rolü incelemeli.',
  ],
  not_eligible: [
    'This member is not eligible for this package.',
    'Üye bu pakete başvurabilecek rollerden birine sahip değil.',
  ],
  invalid_request: [
    'Choose an allowed duration and enter a reason of 10–500 characters.',
    'İzin verilen süreyi seç ve 10–500 karakterlik gerekçe gir.',
  ],
  owner_required: [
    'Only the Discord server owner can change this setting.',
    'Bu ayarı yalnızca Discord sunucusunun sahibi değiştirebilir.',
  ],
  approver_required: [
    'You are not a reviewer for this package.',
    'Bu paket için onaylayıcı değilsin.',
  ],
  forbidden: ['You do not have access to this action.', 'Bu işlemi yapma yetkin yok.'],
  csrf_invalid: ['Your session changed. Refresh the page.', 'Oturumun değişti. Sayfayı yenile.'],
  invalid_input: [
    'Check the form fields and try again.',
    'Form alanlarını kontrol edip yeniden dene.',
  ],
  request_not_pending: ['This request has already been reviewed.', 'Bu başvuru zaten incelenmiş.'],
  request_not_actionable: [
    'This lease can no longer be changed.',
    'Bu izin artık değiştirilemiyor.',
  ],
  unsupported_channel: [
    'Choose standard text or voice channels.',
    'Standart metin veya ses kanalı seç.',
  ],
  unsafe_role: [
    'Choose a dedicated, non-managed access role.',
    'Entegrasyona ait olmayan özel bir erişim rolü seç.',
  ],
  bot_permissions_missing: [
    'Check the bot permissions and role order in Discord.',
    'Discord’da bot izinlerini ve rol sıralamasını kontrol et.',
  ],
  member_not_found: ['This person is no longer in the server.', 'Bu kişi artık sunucuda değil.'],
  rate_limited: [
    'Too many requests. Please wait a moment.',
    'Çok fazla istek gönderildi. Biraz bekle.',
  ],
};
export function App() {
  const [lang, setLang] = useState<Language>(() =>
      localStorage.getItem('al-language') === 'tr' ? 'tr' : 'en',
    ),
    t = copy[lang];
  const [session, setSession] = useState<Session | null>(null),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [guild, setGuild] = useState(''),
    [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState('ledger'),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<Lease | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewError, setPreviewError] = useState(''),
    [previewLoading, setPreviewLoading] = useState(false),
    [requestPolicy, setRequestPolicy] = useState<Policy | null>(null),
    [requestOpen, setRequestOpen] = useState(false),
    [policyEditor, setPolicyEditor] = useState<Policy | 'new' | null>(null),
    [scenarioOpen, setScenarioOpen] = useState(false),
    [confirmation, setConfirmation] = useState<{
      title: string;
      text: string;
      label: string;
      run: () => Promise<unknown>;
    } | null>(null);
  const notify = useCallback(
    (e: unknown) => {
      const code = e instanceof Error ? e.message : 'internal_error';
      setNotice({
        error: true,
        message:
          errorText[code]?.[lang === 'en' ? 0 : 1] ??
          (lang === 'en'
            ? 'The action could not be completed. Please try again.'
            : 'İşlem tamamlanamadı. Lütfen yeniden dene.'),
      });
    },
    [lang],
  );
  const installSession = (s: Session) => {
    csrf = s.csrf;
    setSession(s);
    setData(null);
    setGuild('');
    setSelected(null);
    setPage('ledger');
    setPolicyEditor(null);
    setScenarioOpen(false);
    setConfirmation(null);
  };
  useEffect(() => {
    let done = false;
    (async () => {
      let s = await call<Session>('/api/session');
      if (s.mode === 'demo' && !s.actor) s = await call<Session>('/api/demo/login', { persona: 0 });
      if (!done) {
        csrf = s.csrf;
        setSession(s);
        setReady(true);
      }
    })().catch((e) => {
      if (!done) {
        notify(e);
        setReady(true);
      }
    });
    return () => {
      done = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('al-language', lang);
  }, [lang]);
  useEffect(() => {
    if (!session?.actor) return;
    let done = false;
    call<{ id: string; name: string }[]>('/api/workspaces')
      .then((rows) => {
        if (!done) {
          setWorkspaces(rows);
          setGuild(rows[0]?.id ?? '');
        }
      })
      .catch(notify);
    return () => {
      done = true;
    };
  }, [session]);
  const load = useCallback(async () => {
    if (!guild) return;
    const d = await call<Data>(`/api/w/${guild}/`);
    setData(d);
    if (d.workspace.mode === 'demo') {
      const state = await call<{ online: boolean }>(`/api/w/${guild}/demo`);
      setOnline(state.online);
    }
  }, [guild]);
  useEffect(() => {
    if (!guild) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const d = await call<Data>(`/api/w/${guild}/`);
        if (mounted) setData(d);
        if (d.workspace.mode === 'demo') {
          const s = await call<{ online: boolean }>(`/api/w/${guild}/demo`);
          if (mounted) setOnline(s.online);
        }
      } catch (e) {
        if (mounted) notify(e);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [guild, notify]);
  const act = async (fn: () => Promise<unknown>, close?: () => void) => {
    setBusy(true);
    try {
      await fn();
      close?.();
      await load();
      setNotice({ error: false, message: t.success });
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  };
  const path = `/api/w/${guild}`;
  const status = (r: Lease) =>
    ['active', 'approved'].includes(r.status) &&
    r.expires_at &&
    Date.parse(r.expires_at) <= Date.parse(data?.workspace.now ?? '')
      ? 'revoke_pending'
      : r.status;
  const label = (state: string) => t[state as keyof typeof t] ?? state;
  const date = (s: string | null) =>
    s
      ? new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(s))
      : '—';
  const openDetail = async (r: Lease) => {
    setSelected(r);
    setPreview(null);
    setPreviewError('');
    if (!data?.policies.find((p) => p.id === r.policy_id)?.canReview) return;
    setPreviewLoading(true);
    try {
      setPreview(await call<Preview>(`${path}/requests/${r.id}/preview`));
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setPreviewError(errorText[code]?.[lang === 'en' ? 0 : 1] ?? t.unsupported);
    } finally {
      setPreviewLoading(false);
    }
  };
  const selectedFresh = selected
    ? (data?.requests.find((r) => r.id === selected.id) ?? selected)
    : null;
  const counts = {
    pending: data?.requests.filter((r) => status(r) === 'pending').length ?? 0,
    active:
      data?.requests.filter((r) => ['active', 'approved', 'revoke_pending'].includes(status(r)))
        .length ?? 0,
    conflict: data?.requests.filter((r) => r.status === 'conflict').length ?? 0,
  };
  const visible =
    data?.requests.filter(
      (r) =>
        (filter === 'all' ||
          (filter === 'pending' && status(r) === 'pending') ||
          (filter === 'active' && ['active', 'approved', 'revoke_pending'].includes(status(r)))) &&
        `${r.user_name} ${r.policy_name} ${r.reason}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const nav = [
    { id: 'ledger', name: t.overview, icon: Layers3 },
    { id: 'catalog', name: t.catalog, icon: KeyRound },
    { id: 'activity', name: t.activity, icon: FileClock },
    ...(data?.owner ? [{ id: 'policies', name: t.settings, icon: SlidersHorizontal }] : []),
  ];
  const language = (
    <Tooltip content={t.language}>
      <Button
        variant="ghost"
        color="gray"
        className="language"
        onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
        aria-label={t.language}
      >
        <Globe2 size={15} />
        {lang === 'en' ? 'TR' : 'EN'}
      </Button>
    </Tooltip>
  );
  const stamp = (state: string) => (
    <Badge className={`status status-${state}`} variant="soft">
      <span className="status-dot" />
      {label(state)}
    </Badge>
  );
  const permissionRows = (channels: ChannelImpact[], removing = false) => (
    <div className="permission-list">
      {channels.map((c) => (
        <div className="permission-item" key={c.id}>
          <div className="permission-heading">
            <span>
              {c.type === 2 ? '◉' : '#'} {c.name}
            </span>
            <Badge color="gray" variant="outline">
              {!c.supported ? t.unsupported : c.changed ? t.changed : t.noChange}
            </Badge>
          </div>
          {c.supported && (
            <>
              <div className="permission-comparison">
                <span>
                  {removing ? t.before : t.before}
                  <strong>{c.before.view ? t.visible : t.hidden}</strong>
                </span>
                <ArrowRight size={16} />
                <span>
                  {t.after}
                  <strong className={c.after.view ? 'mint' : ''}>
                    {c.after.view ? t.visible : t.hidden}
                  </strong>
                </span>
              </div>
              <div className="capabilities">
                {(['send', 'connect', 'speak'] as const)
                  .filter((k) => (k === 'send' ? c.type === 0 : c.type === 2))
                  .map((k) => (
                    <span key={k} className={c.after[k] ? 'allowed' : 'not-allowed'}>
                      {c.after[k] ? <Check size={12} /> : <X size={12} />}{' '}
                      {k === 'send' ? t.write : k === 'connect' ? t.voice : t.speak}
                    </span>
                  ))}
              </div>
              {removing && c.after.view && (
                <p className="remaining-note">
                  {t.remaining}
                  {c.otherRoleNames.length ? ` (${c.otherRoleNames.join(', ')})` : ''}
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
  const eventName = (kind: string) =>
    ({
      requested: lang === 'en' ? 'Access requested' : 'Erişim istendi',
      approved: lang === 'en' ? 'Reviewed and approved' : 'İncelendi ve onaylandı',
      access_granted: lang === 'en' ? 'Role granted and verified' : 'Rol verildi ve doğrulandı',
      lease_closed: lang === 'en' ? 'Lease ended; result recorded' : 'İzin bitti, sonuç kaydedildi',
      conflict: t.conflict,
      policy_created: lang === 'en' ? 'Access policy created' : 'Erişim politikası oluşturuldu',
      policy_updated: lang === 'en' ? 'Policy version changed' : 'Politika sürümü değişti',
      automation_paused: t.pause,
      automation_resumed: t.resume,
      denied: t.denied,
      cancelled: t.cancelled,
      end_requested: t.end,
      management_released: t.released,
      lease_ended_role_retained: t.retained,
      demo_scenario: lang === 'en' ? 'Demo scenario applied' : 'Demo senaryosu uygulandı',
      member_left: t.memberLeft,
    })[kind] ?? kind;
  if (!ready)
    return (
      <main className="boot">
        <img src="/mark.svg" alt="" />
        <span>AccessLease</span>
        <span className="pulse" />
      </main>
    );
  if (!session?.actor)
    return (
      <div className="login">
        <div className="login-nav">
          <Brand />
          {language}
        </div>
        <main>
          <span className="eyebrow">NEXORA / ACCESSLEASE</span>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginText}</p>
          {session?.mode === 'demo' ? (
            <Button
              size="3"
              onClick={() =>
                void act(async () =>
                  installSession(await call<Session>('/api/demo/login', { persona: 0 })),
                )
              }
            >
              {t.demo}
              <ArrowRight size={18} />
            </Button>
          ) : (
            <Button size="3" asChild>
              <a href="/auth/discord">
                {t.signIn}
                <ArrowRight size={18} />
              </a>
            </Button>
          )}
        </main>
        {notice && <p role="alert">{notice.message}</p>}
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {lang === 'en' ? 'Skip to content' : 'İçeriğe geç'}
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">WORKSPACE</div>
        {workspaces.length > 1 ? (
          <Select.Root
            value={guild}
            onValueChange={(v) => {
              setData(null);
              setGuild(v);
            }}
          >
            <Select.Trigger aria-label="Workspace" />
            <Select.Content>
              {workspaces.map((w) => (
                <Select.Item key={w.id} value={w.id}>
                  {w.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        ) : (
          <div className="workspace-name">
            <span className="workspace-monogram">N</span>
            <span>
              {data?.workspace.name ?? 'AccessLease'}
              <small>DISCORD WORKSPACE</small>
            </span>
          </div>
        )}
        <nav aria-label={lang === 'en' ? 'Main navigation' : 'Ana gezinme'}>
          {nav.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              color="gray"
              className={`nav-item ${page === item.id ? 'current' : ''}`}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              aria-label={item.name}
            >
              <item.icon size={18} />
              {item.name}
              {item.id === 'ledger' && counts.pending > 0 && (
                <span className="nav-count">{counts.pending}</span>
              )}
            </Button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="trust-note">
            <ShieldCheck size={20} />
            <strong>{t.scope}</strong>
            <p>{t.noPrivateData}</p>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="ghost" color="gray" className="account">
                <span className="avatar">
                  {session.actor.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')}
                </span>
                <span>
                  {session.actor.name}
                  <small>
                    {data?.owner
                      ? t.owner
                      : data?.policies.some((p) => p.canReview)
                        ? t.reviewer
                        : t.member}
                  </small>
                </span>
                <ChevronRight size={14} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                onSelect={() =>
                  void act(async () => {
                    await call('/api/logout', {});
                    installSession({ ...session, actor: null, csrf: null });
                  })
                }
              >
                <LogOut size={14} />
                {t.logout}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <div className="version">
            NEXORA STUDIO <span>α 0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            STUDIO <span>/</span> {nav.find((n) => n.id === page)?.name}
          </div>
          <div className="top-actions">
            {session.mode === 'demo' && (
              <>
                <Badge className="demo-badge">
                  <span className="status-dot" />
                  {t.demo}
                </Badge>
                <Select.Root
                  value={String(
                    (session.actors ?? []).findIndex((a) => a.id === session.actor?.id),
                  )}
                  onValueChange={(v) =>
                    void act(async () =>
                      installSession(
                        await call<Session>('/api/demo/login', { persona: Number(v) }),
                      ),
                    )
                  }
                >
                  <Select.Trigger aria-label={t.persona} className="persona-select" />
                  <Select.Content>
                    {(session.actors ?? []).map((a, i) => (
                      <Select.Item key={a.id} value={String(i)}>
                        {a.name} · {i === 0 ? t.owner : i === 1 ? t.reviewer : t.member}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </>
            )}
            {language}
          </div>
        </header>
        <main id="main" className="main-content">
          {!guild ? (
            <div className="empty-state">
              <LockKeyhole size={28} />
              <h2>{t.noWorkspaces}</h2>
            </div>
          ) : !data ? (
            <div className="loading" role="status">
              {t.saving}
            </div>
          ) : (
            <>
              {data.workspace.paused && (
                <div className="banner">
                  <Pause size={16} />
                  {t.paused}
                </div>
              )}
              {!online && (
                <div className="banner">
                  <WifiOff size={16} />
                  {t.demoOffline}
                </div>
              )}
              {page === 'ledger' && (
                <>
                  <section className="hero">
                    <div>
                      <div className="eyebrow">
                        <span className="tiny-line" />
                        {t.eyebrow}
                      </div>
                      <h1>{t.title}</h1>
                      <p>{t.subtitle}</p>
                      <div className="hero-actions">
                        <Button
                          size="3"
                          onClick={() => {
                            setRequestPolicy(data.policies.find((p) => p.canRequest) ?? null);
                            setRequestOpen(true);
                          }}
                          disabled={
                            !data.policies.some((p) => p.canRequest) || data.workspace.paused
                          }
                        >
                          <Plus size={17} />
                          {t.request}
                        </Button>
                        {session.mode === 'demo' && data.owner && (
                          <Button
                            size="3"
                            variant="ghost"
                            color="gray"
                            onClick={() => setScenarioOpen(true)}
                          >
                            {t.scenarios}
                            <ArrowUpRight size={16} />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="access-orbit" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="orbit-core">
                        <KeyRound size={39} strokeWidth={1} />
                      </div>
                      <span className="orbit-caption">GRANT → VERIFY → EXPIRE</span>
                      <span className="orbit-dot one" />
                      <span className="orbit-dot two" />
                    </div>
                  </section>
                  <section className="ledger-section" aria-labelledby="ledger-title">
                    <div className="section-header">
                      <div>
                        <span className="eyebrow">THE ACCESS LEDGER</span>
                        <h2 id="ledger-title">
                          {t.overview}
                          <span className="total">
                            {data.requests.length.toString().padStart(2, '0')}
                          </span>
                        </h2>
                      </div>
                      <div className="sync">
                        <Radio size={14} />
                        {t.autoRefresh}
                      </div>
                    </div>
                    <div className="ledger-layout">
                      <div className="ledger-primary">
                        <div className="ledger-toolbar">
                          <SegmentedControl.Root
                            value={filter}
                            onValueChange={setFilter}
                            aria-label={t.all}
                          >
                            <SegmentedControl.Item value="all">{t.all}</SegmentedControl.Item>
                            <SegmentedControl.Item value="pending">
                              {t.review}
                              <span className="tab-count">{counts.pending}</span>
                            </SegmentedControl.Item>
                            <SegmentedControl.Item value="active">{t.live}</SegmentedControl.Item>
                          </SegmentedControl.Root>
                          <TextField.Root
                            placeholder={t.search}
                            aria-label={t.search}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          >
                            <TextField.Slot>
                              <Search size={15} />
                            </TextField.Slot>
                          </TextField.Root>
                        </div>
                        <div className="table-wrap">
                          <table className="ledger-table">
                            <thead>
                              <tr>
                                <th>{t.person}</th>
                                <th>{t.package}</th>
                                <th>{t.window}</th>
                                <th>{t.state}</th>
                                <th>
                                  <span className="sr-only">{t.inspect}</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {visible.map((r) => (
                                <tr key={r.id}>
                                  <td>
                                    <Button
                                      variant="ghost"
                                      color="gray"
                                      className="person-button"
                                      onClick={() => void openDetail(r)}
                                    >
                                      <span className="avatar small">
                                        {r.user_name
                                          .split(' ')
                                          .map((n) => n[0])
                                          .join('')}
                                      </span>
                                      <span>
                                        <strong>{r.user_name}</strong>
                                        <small>{r.reason}</small>
                                      </span>
                                    </Button>
                                  </td>
                                  <td>
                                    <span className="package-tag">
                                      <KeyRound size={12} />
                                      {r.policy_name}
                                    </span>
                                  </td>
                                  <td className="time-cell">
                                    <span>
                                      {r.expires_at
                                        ? date(r.expires_at)
                                        : `${r.duration_minutes / 60} ${t.hours}`}
                                    </span>
                                    <small>{r.expires_at ? t.expires : t.requested}</small>
                                  </td>
                                  <td>{stamp(status(r))}</td>
                                  <td>
                                    <Tooltip content={t.inspect}>
                                      <IconButton
                                        variant="ghost"
                                        color="gray"
                                        aria-label={`${t.inspect}: ${r.user_name} · ${r.policy_name}`}
                                        onClick={() => void openDetail(r)}
                                      >
                                        <ArrowUpRight size={17} />
                                      </IconButton>
                                    </Tooltip>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!visible.length && (
                            <div className="empty-state">
                              <FileClock size={25} />
                              <h3>{t.none}</h3>
                              <p>{t.emptyHint}</p>
                            </div>
                          )}
                        </div>
                        <div className="ledger-foot">
                          <ShieldCheck size={13} />
                          {t.expiryNote}
                        </div>
                      </div>
                      <aside className="insight-rail">
                        <div className="rail-heading">
                          <CircleDot size={15} /> ACCESS LIFECYCLE
                        </div>
                        <div className="journey">
                          <div>
                            <span>01</span>
                            <strong>{t.request}</strong>
                            <p>
                              {t.purpose} · {t.duration}
                            </p>
                          </div>
                          <div>
                            <span>02</span>
                            <strong>{t.preview}</strong>
                            <p>
                              {t.before} → {t.after}
                            </p>
                          </div>
                          <div>
                            <span>03</span>
                            <strong>{t.result}</strong>
                            <p>{t.grantNote}</p>
                          </div>
                        </div>
                        <div className="rail-stat">
                          <span>{t.active}</span>
                          <strong>
                            {String(counts.active).padStart(2, '0')}
                            <span>/</span>
                            <small>{data.requests.length}</small>
                          </strong>
                        </div>
                        {counts.conflict > 0 && (
                          <div className="attention-note">
                            <ShieldCheck size={16} />
                            {counts.conflict} · {t.conflict}
                          </div>
                        )}
                        <p className="rail-disclaimer">
                          {session.mode === 'demo' ? t.demoHint : t.noPrivateData}
                        </p>
                      </aside>
                    </div>
                  </section>
                </>
              )}
              {page === 'catalog' && (
                <>
                  <PageHeading
                    eyebrow="EXPLICIT ACCESS"
                    title={t.catalog}
                    description={t.expiryNote}
                  />
                  <div className="catalog-list">
                    {data.policies
                      .filter((p) => p.published || data.owner)
                      .map((p, i) => (
                        <article className="catalog-item" key={p.id}>
                          <span className="catalog-number">0{i + 1}</span>
                          <div>
                            <div className="catalog-title">
                              <h2>{p.name}</h2>
                              <Badge variant="outline" color="gray">
                                v{p.version}
                              </Badge>
                            </div>
                            <p>{p.description}</p>
                            <span className="muted">
                              <Clock3 size={13} /> {p.max_minutes / 60} {t.hours} MAX
                            </span>
                          </div>
                          <Button
                            disabled={!p.canRequest || data.workspace.paused}
                            onClick={() => {
                              setRequestPolicy(p);
                              setRequestOpen(true);
                            }}
                          >
                            {t.request}
                            <ArrowRight size={16} />
                          </Button>
                        </article>
                      ))}
                    {!data.policies.length && <div className="empty-state">{t.policyEmpty}</div>}
                  </div>
                </>
              )}
              {page === 'activity' && (
                <>
                  <PageHeading
                    eyebrow="EVERY DECISION, A TRACE"
                    title={t.activity}
                    description={t.grantNote}
                  >
                    {data.owner && (
                      <Button variant="outline" asChild>
                        <a href={`${path}/export?format=json`} download>
                          <ArrowDownToLine size={15} />
                          {t.export}
                        </a>
                      </Button>
                    )}
                  </PageHeading>
                  <div className="event-list">
                    {data.events.map((e) => (
                      <div className="event-row" key={e.sequence}>
                        <span className="event-node">
                          <Check size={13} />
                        </span>
                        <div>
                          <strong>{eventName(e.kind)}</strong>
                          <p>
                            {String(
                              e.detail.policyName ??
                                e.detail.name ??
                                e.detail.code ??
                                'AccessLease',
                            )}{' '}
                            <span>#{e.sequence}</span>
                          </p>
                        </div>
                        <time>{date(e.created_at)}</time>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {page === 'policies' && data.owner && (
                <>
                  <PageHeading
                    eyebrow="BOUNDARIES BY DESIGN"
                    title={t.settings}
                    description={t.policyHint}
                  >
                    <Button onClick={() => setPolicyEditor('new')}>
                      <Plus size={16} />
                      {t.newPolicy}
                    </Button>
                  </PageHeading>
                  <div className="pause-setting">
                    <div>
                      <strong>{data.workspace.paused ? t.resume : t.pause}</strong>
                      <p>{t.grantNote}</p>
                    </div>
                    <Switch
                      checked={data.workspace.paused}
                      onCheckedChange={(v) => void act(() => call(`${path}/pause`, { paused: v }))}
                      aria-label={t.pause}
                    />
                  </div>
                  <div className="catalog-list">
                    {data.policies.map((p) => (
                      <article className="catalog-item" key={p.id}>
                        <KeyRound size={23} />
                        <div>
                          <h2>{p.name}</h2>
                          <p>{p.description}</p>
                          <span className="muted">
                            v{p.version} · {p.max_minutes / 60} {t.hours} ·{' '}
                            {p.published ? 'Published' : 'Unpublished'}
                          </span>
                        </div>
                        <Button variant="outline" onClick={() => setPolicyEditor(p)}>
                          {t.editPolicy}
                        </Button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            ACCESSLEASE <span className="footer-slash">/</span> NEXORA STUDIO
          </span>
          <span>{session.mode === 'demo' ? t.demoHint : 'SELF-HOSTED · OPEN SOURCE'}</span>
        </footer>
      </div>
      <Dialog.Root
        open={!!selectedFresh}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <Dialog.Content className="detail-dialog" maxWidth="660px">
          {selectedFresh && (
            <>
              <div className="dialog-topline">
                <span className="eyebrow">{t.accessDetail}</span>
                <Dialog.Close>
                  <IconButton variant="ghost" color="gray" aria-label={t.close}>
                    <X size={19} />
                  </IconButton>
                </Dialog.Close>
              </div>
              <Dialog.Title size="7">{selectedFresh.policy_name}</Dialog.Title>
              <Dialog.Description className="muted">
                {selectedFresh.user_name} · {date(selectedFresh.created_at)}
              </Dialog.Description>
              <div className="detail-meta">
                {stamp(status(selectedFresh))}
                <span>
                  <Clock3 size={14} />
                  {selectedFresh.expires_at
                    ? date(selectedFresh.expires_at)
                    : `${selectedFresh.duration_minutes / 60} ${t.hours}`}
                </span>
              </div>
              <div className="reason-block">
                <span className="eyebrow">{t.purpose}</span>
                <p>{selectedFresh.reason}</p>
              </div>
              {previewLoading && <p role="status">{t.saving}</p>}
              {previewError && (
                <p className="inline-alert" role="alert">
                  {previewError}
                </p>
              )}
              {preview && (
                <>
                  <div className="detail-section-title">
                    <ShieldCheck size={17} />
                    <h3>{t.preview}</h3>
                  </div>
                  {permissionRows(preview.channels)}
                  <h4>{t.removal}</h4>
                  {permissionRows(preview.removal, true)}
                  {preview.self && <p className="inline-alert">{t.own}</p>}
                  {preview.stalePolicy && <p className="inline-alert">{t.stale}</p>}
                  {preview.alreadyPresent && selectedFresh.status === 'pending' && (
                    <p className="inline-alert">{t.preexisting}</p>
                  )}
                </>
              )}
              {selectedFresh.result && (
                <div className="result-block">
                  <h3>{t.result}</h3>
                  {selectedFresh.result.channels ? (
                    permissionRows(selectedFresh.result.channels, true)
                  ) : (
                    <p>
                      {selectedFresh.result.code === 'another_active_lease'
                        ? t.retained
                        : selectedFresh.result.code === 'management_released'
                          ? t.released
                          : selectedFresh.result.code === 'member_left'
                            ? t.memberLeft
                            : t.conflict}
                    </p>
                  )}
                </div>
              )}
              <div className="mini-timeline">
                {data?.events
                  .filter((e) => e.request_id === selectedFresh.id)
                  .slice(0, 6)
                  .reverse()
                  .map((e) => (
                    <div key={e.sequence}>
                      <span className="status-dot" />
                      <span>{eventName(e.kind)}</span>
                      <time>{date(e.created_at)}</time>
                    </div>
                  ))}
              </div>
              <div className="dialog-actions">
                {selectedFresh.status === 'pending' && (
                  <>
                    {data?.policies.find((p) => p.id === selectedFresh.policy_id)?.canReview && (
                      <>
                        <Button
                          variant="outline"
                          color="gray"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                call(`${path}/requests/${selectedFresh.id}/decision`, {
                                  action: 'deny',
                                }),
                              () => setSelected(null),
                            )
                          }
                        >
                          {t.decline}
                        </Button>
                        <Button
                          disabled={
                            busy ||
                            !preview ||
                            preview.self ||
                            preview.stalePolicy ||
                            data.workspace.paused
                          }
                          onClick={() =>
                            void act(
                              () =>
                                call(`${path}/requests/${selectedFresh.id}/approve`, {
                                  previewHash: preview!.hash,
                                }),
                              () => setSelected(null),
                            )
                          }
                        >
                          <Check size={15} />
                          {t.approve}
                        </Button>
                      </>
                    )}
                    {selectedFresh.user_id === session.actor.id && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              call(`${path}/requests/${selectedFresh.id}/decision`, {
                                action: 'cancel',
                              }),
                            () => setSelected(null),
                          )
                        }
                      >
                        {t.cancel}
                      </Button>
                    )}
                  </>
                )}
                {['approved', 'active', 'revoke_pending'].includes(selectedFresh.status) && (
                  <Button
                    variant="outline"
                    color="orange"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        title: t.end,
                        text: t.expiryNote,
                        label: t.end,
                        run: () =>
                          call(`${path}/requests/${selectedFresh.id}/decision`, { action: 'end' }),
                      })
                    }
                  >
                    {t.end}
                  </Button>
                )}
                {data?.owner && selectedFresh.status === 'conflict' && (
                  <Button
                    color="orange"
                    onClick={() =>
                      setConfirmation({
                        title: t.detachTitle,
                        text: t.detachText,
                        label: t.confirmDetach,
                        run: () =>
                          call(`${path}/detach`, {
                            userId: selectedFresh.user_id,
                            roleId: selectedFresh.role_id,
                            confirmation: 'release-management',
                          }),
                      })
                    }
                  >
                    {t.detach}
                  </Button>
                )}
                {data?.owner &&
                  data.bindings.some(
                    (b) =>
                      b.user_id === selectedFresh.user_id &&
                      b.role_id === selectedFresh.role_id &&
                      b.phase === 'detached',
                  ) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setConfirmation({
                          title: t.resetTitle,
                          text: t.resetText,
                          label: t.resetManagement,
                          run: () =>
                            call(`${path}/reset-management`, {
                              userId: selectedFresh.user_id,
                              roleId: selectedFresh.role_id,
                              confirmation: 'verify-absence',
                            }),
                        })
                      }
                    >
                      {t.resetManagement}
                    </Button>
                  )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Root>
      <RequestDialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        policies={data?.policies.filter((p) => p.canRequest) ?? []}
        initial={requestPolicy}
        t={t}
        busy={busy}
        onSubmit={(b) =>
          void act(
            () => call(`${path}/requests`, b),
            () => setRequestOpen(false),
          )
        }
      />
      <PolicyDialog
        policy={policyEditor}
        onClose={() => setPolicyEditor(null)}
        data={data}
        t={t}
        busy={busy}
        onSubmit={(b) =>
          void act(
            () =>
              call(
                `${path}/policies${policyEditor && policyEditor !== 'new' ? '/' + policyEditor.id : ''}`,
                b,
                policyEditor === 'new' ? 'POST' : 'PUT',
              ),
            () => setPolicyEditor(null),
          )
        }
      />
      <Dialog.Root open={scenarioOpen} onOpenChange={setScenarioOpen}>
        <Dialog.Content maxWidth="540px">
          <Dialog.Title>{t.scenarios}</Dialog.Title>
          <Dialog.Description>{t.scenarioHint}</Dialog.Description>
          <div className="scenario-list">
            {[
              ['remaining-access', t.remainingSetup],
              ['advance', t.advance],
              [online ? 'offline' : 'online', online ? t.offline : t.online],
              ['external-remove', t.manual],
            ].map(([action, text]) => (
              <Button
                key={action}
                variant="outline"
                color="gray"
                disabled={busy}
                onClick={() => void act(() => call(`${path}/demo`, { action }))}
              >
                <Sparkles size={15} />
                {text}
                <ArrowRight size={15} />
              </Button>
            ))}
          </div>
          <p className="muted">{t.remainingHint}</p>
          <div className="dialog-actions">
            <Dialog.Close>
              <Button variant="soft">{t.close}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <AlertDialog.Root
        open={!!confirmation}
        onOpenChange={(v) => {
          if (!v) setConfirmation(null);
        }}
      >
        <AlertDialog.Content maxWidth="470px">
          <AlertDialog.Title>{confirmation?.title}</AlertDialog.Title>
          <AlertDialog.Description>{confirmation?.text}</AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel>
              <Button variant="outline" color="gray">
                {t.cancel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              color="orange"
              disabled={busy}
              onClick={() => {
                if (confirmation)
                  void act(confirmation.run, () => {
                    setConfirmation(null);
                    setSelected(null);
                  });
              }}
            >
              {confirmation?.label}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {notice && (
        <div
          className={`notification ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.error ? <ShieldCheck size={17} /> : <Check size={17} />}
          <span>{notice.message}</span>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label={t.close}
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img src="/mark.svg" alt="" />
      <span>
        accesslease<small>BY NEXORA STUDIO</small>
      </span>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
type T = (typeof copy)['en'] | (typeof copy)['tr'];
function RequestDialog({
  open,
  onClose,
  policies,
  initial,
  t,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  policies: Policy[];
  initial: Policy | null;
  t: T;
  busy: boolean;
  onSubmit: (b: { policyId: string; durationMinutes: number; reason: string }) => void;
}) {
  const [id, setId] = useState(''),
    [duration, setDuration] = useState('1440'),
    [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      const p = initial ?? policies[0];
      setId(p?.id ?? '');
      setDuration(String(Math.min(p?.max_minutes ?? 1440, 1440)));
      setReason('');
    }
  }, [open, initial]);
  const p = policies.find((p) => p.id === id);
  const durations = [5, 30, 60, 120, 1440, 2880, 4320, 10080].filter(
    (v) => v <= (p?.max_minutes ?? 0),
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Content maxWidth="500px">
        <Dialog.Title>{t.request}</Dialog.Title>
        <Dialog.Description>{t.expiryNote}</Dialog.Description>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onSubmit({ policyId: id, durationMinutes: Number(duration), reason });
          }}
        >
          <div className="form-fields">
            <label htmlFor="request-package">{t.package}</label>
            <Select.Root
              value={id}
              onValueChange={(id) => {
                setId(id);
                setDuration(
                  String(Math.min(policies.find((p) => p.id === id)?.max_minutes ?? 1440, 1440)),
                );
              }}
            >
              <Select.Trigger id="request-package" aria-label={t.package} />
              <Select.Content>
                {policies.map((p) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <label htmlFor="request-duration">{t.duration}</label>
            <Select.Root value={duration} onValueChange={setDuration}>
              <Select.Trigger id="request-duration" aria-label={t.duration} />
              <Select.Content>
                {[...new Set([...durations, Math.min(p?.max_minutes ?? 1440, 1440)])]
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <Select.Item key={v} value={String(v)}>
                      {v < 60 ? `${v} ${t.minute}` : `${v / 60} ${t.hours}`}
                    </Select.Item>
                  ))}
              </Select.Content>
            </Select.Root>
            <label htmlFor="request-reason">{t.reason}</label>
            <TextArea
              id="request-reason"
              minLength={10}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
          <div className="dialog-actions">
            <Dialog.Close>
              <Button type="button" variant="outline" color="gray">
                {t.cancel}
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={busy || !p || reason.trim().length < 10}>
              {busy ? t.saving : t.submit}
              <ArrowRight size={15} />
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
function PolicyDialog({
  policy,
  onClose,
  data,
  t,
  busy,
  onSubmit,
}: {
  policy: Policy | 'new' | null;
  onClose: () => void;
  data: Data | null;
  t: T;
  busy: boolean;
  onSubmit: (b: unknown) => void;
}) {
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [role, setRole] = useState(''),
    [channels, setChannels] = useState<string[]>([]),
    [eligible, setEligible] = useState<string[]>([]),
    [approvers, setApprovers] = useState<string[]>([]),
    [hours, setHours] = useState(24),
    [published, setPublished] = useState(true);
  useEffect(() => {
    if (policy) {
      const p = policy === 'new' ? null : policy;
      setName(p?.name ?? '');
      setDescription(p?.description ?? '');
      setRole(p?.role_id ?? '');
      setChannels(p?.channel_ids ?? []);
      setEligible(p?.eligible_role_ids ?? []);
      setApprovers(p?.approver_role_ids ?? []);
      setHours((p?.max_minutes ?? 1440) / 60);
      setPublished(p?.published ?? true);
    }
  }, [policy]);
  const checkList = (
    items: { id: string; name: string }[],
    values: string[],
    set: (v: string[]) => void,
    legend: string,
  ) => (
    <fieldset className="check-list">
      <legend>{legend}</legend>
      {items.map((i) => (
        <label key={i.id}>
          <Checkbox
            checked={values.includes(i.id)}
            onCheckedChange={(checked) =>
              set(checked ? [...values, i.id] : values.filter((v) => v !== i.id))
            }
          />
          {i.name}
        </label>
      ))}
    </fieldset>
  );
  return (
    <Dialog.Root
      open={!!policy}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>{policy === 'new' ? t.newPolicy : t.editPolicy}</Dialog.Title>
        <Dialog.Description>{t.policyHint}</Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name,
              description,
              roleId: role,
              channelIds: channels,
              eligibleRoleIds: eligible,
              approverRoleIds: approvers,
              maxMinutes: Math.round(hours * 60),
              published,
            });
          }}
        >
          <div className="form-fields">
            <label htmlFor="policy-name">{t.policyName}</label>
            <TextField.Root
              id="policy-name"
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor="policy-description">{t.description}</label>
            <TextArea
              id="policy-description"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label htmlFor="policy-role">{t.role}</label>
            <Select.Root value={role} onValueChange={setRole} disabled={policy !== 'new'}>
              <Select.Trigger id="policy-role" placeholder={t.select} />
              <Select.Content>
                {data?.configuration?.roles
                  .filter((r) => r.permissions === '0')
                  .map((r) => (
                    <Select.Item key={r.id} value={r.id}>
                      {r.name}
                    </Select.Item>
                  ))}
              </Select.Content>
            </Select.Root>
            <label htmlFor="policy-duration">{t.maxHours}</label>
            <TextField.Root
              id="policy-duration"
              type="number"
              min={1}
              max={168}
              required
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
            {checkList(data?.configuration?.channels ?? [], channels, setChannels, t.channels)}
            {checkList(data?.configuration?.roles ?? [], eligible, setEligible, t.eligibleRoles)}
            {checkList(data?.configuration?.roles ?? [], approvers, setApprovers, t.approverRoles)}
            <label className="inline-check">
              <Checkbox checked={published} onCheckedChange={(v) => setPublished(!!v)} />
              {t.published}
            </label>
          </div>
          <div className="dialog-actions">
            <Dialog.Close>
              <Button type="button" variant="outline" color="gray">
                {t.cancel}
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={busy || !role || !channels.length}>
              {t.savePolicy}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
