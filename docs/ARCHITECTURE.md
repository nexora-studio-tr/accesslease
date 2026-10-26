# Architecture and invariants

AccessLease is a modular TypeScript application: React/Radix web UI, Fastify API, an independent permission/lease domain, a Discord adapter, and PostgreSQL. A separate simulator implements the same adapter contract. Production and simulation are mutually exclusive process modes.

## Boundaries

One Discord guild is one workspace. Every stored policy, request, binding, job and event is workspace-scoped. Server-side authorization uses a freshly obtained member snapshot. Policy mutation, automation controls, management release and exports require the Discord server owner. Reviewers are explicitly delegated by each policy and must have a role above the target access role. Members can request eligible packages and end their own leases; they cannot approve themselves.

Private channel names are returned in owner configuration and delegated package previews, not in the member catalog. Evidence visible to a reviewer is limited to their delegated policies; ordinary members see their own request events.

## Permission analysis

`src/domain/permissions.ts` uses bigint permission fields, collective role overwrite precedence and final member overwrites. Owner/Administrator bypass, timeouts, implicit channel visibility and voice dependencies are handled. Standard text (0) and voice (2) channels are supported. Other channel types are explicitly unsupported.

Managed access roles must have zero guild-wide permissions and only safe, explicitly scoped channel overwrites. Unknown permission bits are rejected. This is intentionally narrower than Discord's entire permission surface.

The preview fingerprint excludes the target role's membership and cosmetic names, but includes the permission model, other member roles, timeout, bot roles and hierarchy. It is conservative: permission topology changes can require review even when a narrower analysis might prove them harmless. Approval carries the fingerprint and policy version; execution checks both again. Discord does not offer an atomic compare-and-set role API, so an administrator may still change state between the final check and the API call. Post-write verification and reconciliation reduce this window; they cannot eliminate it.

Reference: [Discord permission rules](https://docs.discord.com/developers/topics/permissions).

## Persistence and concurrency

Requests and jobs are committed together. A workspace advisory lock serializes competing mutations across database connections. Individual SQL transactions are short; the session-level workspace lock can span bounded Discord I/O without holding an open database transaction. The runtime holds a separate advisory leader lock, enforcing a single active application per database.

Jobs are claimed atomically with `FOR UPDATE SKIP LOCKED`. A generation number prevents a finishing job from deleting newer work enqueued during its execution. Claims have a recovery timeout. Repeated failures use bounded backoff; after eight failures the target requires manual review. Discord write results that cannot be established safely become conflicts rather than automatic ownership claims.

The policy is **at-least-once work with state verification**, not exactly-once delivery. A fixed lease deadline never moves because of a retry, restart or outage.

## Ownership lifecycle

- No binding + role already present: refuse adoption and leave the role unchanged.
- A successful approved grant: persist `adding` intent before the API call; verify the resulting membership and fingerprint, then persist `owned`.
- Crash recovery sees `adding` + role present: ownership is uncertain; require review and leave the role unchanged.
- Owned role + another valid lease: retain it. End each expired lease independently.
- Owned role + no remaining authorization: persist `removing`, remove, read the result, then close.
- Crash recovery sees `removing` + role absent: record observed absence and close. If the role is still present, stop for review rather than remove an administrator's possible replacement.
- External removal or permission drift: mark conflict; never silently restore the role.
- Member leaves: close the affected leases without granting anything on a later rejoin.
- Automation pause: leave Discord unchanged; resume makes queued work immediately eligible again.

Role membership does not carry reliable, exclusive grant ownership. An administrator or another bot can make a same-value change that this system cannot distinguish. Dedicated roles are therefore an operational requirement; do not share them with autorole or subscription bots.

An owner can explicitly **release management**. This cancels affected managed leases without changing the Discord role. A detached binding is never automatically re-adopted. After manually removing any remaining role in Discord, the owner can choose **Allow new requests**. A fresh read must observe the old role absent before the target returns to an unmanaged, absent state; any subsequent lease needs a new independent approval. Do not delete ownership records from the database to force adoption.

## Demo isolation

Each anonymous demo login creates a random workspace. Switching personas rotates the session but keeps that workspace. A different browser has a different workspace. Synthetic roles, members, simulated clock offsets and online state are stored in PostgreSQL. Demo routes are absent in live mode.

The simulator's offline scenario fails role writes, while its known synthetic state remains readable. It does not claim to reproduce all Discord network behavior. Synthetic clock changes exist only in demo mode.

## Operational scope

One active runtime, one role per package, five-minute minimum and seven-day maximum. UI request lists are limited to 250 rows, event views to 100, and exports to the newest 10,000 events per workspace. Large-scale pagination, distributed workers and a hosted control plane are outside this alpha.

The runtime periodically removes expired sessions/OAuth states and demo workspaces older than one day. Live workspace data has no automatic retention deletion; operators control backups and retention. Deleting demo data never triggers a real Discord call.
