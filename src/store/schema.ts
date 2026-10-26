export const schema = `
CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces (
 id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL, mode text NOT NULL CHECK(mode IN ('demo','live')),
 paused boolean NOT NULL DEFAULT false, clock_offset_ms bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS simulations (guild_id text PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE, state jsonb NOT NULL, online boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS policies (
 id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, name text NOT NULL, description text NOT NULL,
 role_id text NOT NULL, channel_ids jsonb NOT NULL, eligible_role_ids jsonb NOT NULL, approver_role_ids jsonb NOT NULL,
 max_minutes integer NOT NULL CHECK(max_minutes BETWEEN 5 AND 10080), version integer NOT NULL DEFAULT 1,
 published boolean NOT NULL DEFAULT true, UNIQUE(guild_id, role_id), UNIQUE(id,guild_id)
);
CREATE TABLE IF NOT EXISTS requests (
 id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 user_id text NOT NULL, user_name text NOT NULL, policy_id uuid NOT NULL, policy_version integer NOT NULL,
 policy_name text NOT NULL, role_id text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 10080),
 status text NOT NULL CHECK(status IN ('pending','approved','active','revoke_pending','closed','denied','cancelled','conflict')),
 approved_by text, approved_name text, expires_at timestamptz, approval_fingerprint text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(policy_id,guild_id) REFERENCES policies(id,guild_id)
);
CREATE INDEX IF NOT EXISTS requests_workspace_time ON requests(guild_id,created_at DESC);
CREATE INDEX IF NOT EXISTS requests_expiring ON requests(expires_at) WHERE status IN ('approved','active','revoke_pending');
CREATE UNIQUE INDEX IF NOT EXISTS requests_pending_user_policy ON requests(guild_id,user_id,policy_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS bindings (
 guild_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, user_id text NOT NULL, role_id text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('adding','owned','removing','conflict','detached','absent')),
 fingerprint text NOT NULL, channel_ids jsonb NOT NULL, detail text, PRIMARY KEY(guild_id,user_id,role_id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE, user_id text NOT NULL, role_id text NOT NULL,
 run_at timestamptz NOT NULL, locked_until timestamptz, attempts integer NOT NULL DEFAULT 0, generation integer NOT NULL DEFAULT 1, last_error text,
 UNIQUE(guild_id,user_id,role_id)
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(run_at);
CREATE TABLE IF NOT EXISTS events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, guild_id text NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 request_id uuid, actor_id text NOT NULL, kind text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_workspace_seq ON events(guild_id,sequence DESC);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, user_name text NOT NULL, demo_guild_id text REFERENCES workspaces ON DELETE CASCADE, csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
INSERT INTO schema_version(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
