# Changelog

## 0.1.0-alpha.2

- Request extra time from an active lease using a linked, independently reviewed renewal. Pending review never changes the original deadline.
- Recheck the original lease, role ownership, current membership and policy at approval. A renewal cannot revive expired, revoked or manually removed access.
- Preserve the managed role across independently approved overlapping terms; verify removal after the final term ends.
- Add English/Turkish Radix renewal forms, audit links, a tenant-bound database migration, eight renewal integration tests, HTTP security coverage and a fifth browser scenario.

Live Discord testing remains postponed. See [renewal semantics](docs/RENEWALS.md) and [validation](docs/VALIDATION.md).

## 0.1.0-alpha.1

Initial implementation of policy-scoped temporary Discord access: permission previews, independent approvals, PostgreSQL-backed jobs, overlapping leases, ownership protection, conflict review, private simulated workspaces, bilingual web UI and setup documentation.

This alpha's validation status and live-test boundaries are documented in [docs/VALIDATION.md](docs/VALIDATION.md).
