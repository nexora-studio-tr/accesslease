// Exercise a fresh synthetic workspace only. This command refuses live mode.
const origin = new URL(process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:4348');
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
  throw new Error('Smoke checks accept a loopback-only simulation.');
}
let cookie = '',
  csrf = '';
async function call(path, body) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : { Origin: origin.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (path === '/api/demo/login') {
    cookie =
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith('al_session='))
        ?.split(';')[0] ?? '';
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error ?? response.status}`);
  return data;
}
if ((await call('/health')).mode !== 'demo')
  throw new Error('Smoke checks refuse live Discord mode.');
const login = await call('/api/demo/login', { persona: 0 });
csrf = login.csrf;
if (!cookie || !csrf) throw new Error('Demo authentication failed.');
const workspaces = await call('/api/workspaces'),
  guild = workspaces[0]?.id;
if (!guild) throw new Error('Missing isolated demo workspace.');
const base = `/api/w/${guild}`;
const dashboard = await call(base + '/');
const request = dashboard.requests.find((value) => value.status === 'pending');
if (!request || dashboard.policies.length !== 3) throw new Error('Demo seed mismatch.');
const preview = await call(`${base}/requests/${request.id}/preview`);
await call(`${base}/requests/${request.id}/approve`, { previewHash: preview.hash });
let active = false;
for (let i = 0; i < 30; i++) {
  if (
    (await call(base + '/')).requests.find((value) => value.id === request.id)?.status === 'active'
  ) {
    active = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!active) throw new Error('Worker did not confirm the grant.');
await call(base + '/demo', { action: 'advance' });
const ended = (await call(base + '/')).requests.find((value) => value.id === request.id);
if (
  ended?.status !== 'closed' ||
  ended.result?.roleRemoved !== true ||
  !ended.result.channels.every((value) => !value.after.view)
) {
  throw new Error('Expiry was not confirmed.');
}
await call('/api/logout', {});
console.log(
  'Simulation smoke passed: private login, catalog, preview, approval, worker grant, verified expiry and logout.',
);
