export type Role = {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed: boolean;
};
export type Overwrite = { id: string; type: 'role' | 'member'; allow: string; deny: string };
export type Channel = { id: string; name: string; type: number; overwrites: Overwrite[] };
export type Member = { id: string; name: string; roleIds: string[]; timedOut: boolean };
export type Snapshot = {
  guildId: string;
  guildName: string;
  ownerId: string;
  botId: string;
  botRoleIds: string[];
  member: Member;
  roles: Role[];
  channels: Channel[];
};
export type Actor = { id: string; name: string };
export type Policy = {
  id: string;
  guild_id: string;
  name: string;
  description: string;
  role_id: string;
  channel_ids: string[];
  eligible_role_ids: string[];
  approver_role_ids: string[];
  max_minutes: number;
  version: number;
  published: boolean;
};
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'revoke_pending'
  | 'closed'
  | 'denied'
  | 'cancelled'
  | 'conflict';
export type LeaseRequest = {
  id: string;
  guild_id: string;
  user_id: string;
  user_name: string;
  policy_id: string;
  policy_version: number;
  policy_name: string;
  role_id: string;
  reason: string;
  duration_minutes: number;
  status: RequestStatus;
  approved_by: string | null;
  approved_name: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  result: unknown;
};
export type Binding = {
  guild_id: string;
  user_id: string;
  role_id: string;
  phase: 'adding' | 'owned' | 'removing' | 'conflict' | 'detached' | 'absent';
  fingerprint: string;
  channel_ids: string[];
  detail: string | null;
};
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: string,
  ) {
    super(code);
  }
}
export class DiscordUnavailable extends Error {
  constructor(
    message = 'Discord unavailable',
    public uncertain = false,
  ) {
    super(message);
  }
}
export interface DiscordAdapter {
  snapshot(guildId: string, memberId: string): Promise<Snapshot>;
  addRole(guildId: string, memberId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, memberId: string, roleId: string): Promise<void>;
}
