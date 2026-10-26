# Validation / Doğrulama

Release candidate: **0.1.0-alpha.1** · Date: **26 October 2026**.

## Verified locally

Environment: Windows, Node.js 24.15.0, npm 11.12.1, native PostgreSQL 18.6. The app uses a dedicated, generated local database. No real Discord credentials were used.

| Check                        | Result                 | Boundary                                                                                                                                                                                                 |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                   | Passed                 | Strict server and web typechecking.                                                                                                                                                                      |
| ESLint and formatting        | Passed                 | Source and configuration.                                                                                                                                                                                |
| Automated tests              | **68 passed**          | Permission logic, generated event/order properties, configuration, Discord transport contracts, real PostgreSQL jobs and HTTP security. Mocked transport checks do not constitute a live Discord test.   |
| Browser tests                | **4 passed**           | Request/review/expiry, member privacy and form submission, Turkish mobile layout, keyboard dismissal, desktop and dialog checks.                                                                         |
| Accessibility scan           | Passed in tested views | Axe WCAG A/AA and WCAG 2.1 AA rules on the ledger and permission dialog. This is not a full accessibility certification or AAA claim.                                                                    |
| Clean install                | Passed                 | New source directory, `npm ci`, typecheck, build, all 68 tests and a newly started runtime's health/login/dashboard. Same Windows host; npm's package cache may be reused. No old `node_modules` copied. |
| Backup and restore           | Passed                 | `pg_dump` custom archive restored into a newly created isolated database. Seven table counts and every request deadline/status matched. Test database was removed afterwards.                            |
| Dependency audit             | Passed                 | No known production vulnerabilities returned by npm audit at validation time; this is a point-in-time registry check.                                                                                    |
| Compose configuration        | Passed                 | `docker compose config --quiet`.                                                                                                                                                                         |
| Production asset compression | Implemented            | Generated Brotli/gzip assets served through the static adapter.                                                                                                                                          |

Tests include competing approvals, denied self approval, pre-existing roles, overlapping leases, stale previews, administrator removals, expiry during a write outage, restart recovery, uncertain ownership, workspace isolation, CSRF/Origin/Host checks, member evidence limits, session rotation, and safe ownership reset only after observed role absence.

## Explicitly not verified

- **Real Discord OAuth, gateway, command registration and role changes:** postponed at the user's request. No live success is claimed. Follow the private-server checklist in [setup](SETUP.en.md) before using this for real access.
- **Docker image/runtime on this computer:** Docker CLI is present, but Docker Desktop's engine installation cannot start. Compose configuration was checked; native PostgreSQL/application execution was tested instead. The Linux CI workflow includes an image build, whose remote result must be checked after publication.
- Independent human installation, multiple real Discord users, large guilds, prolonged outages and distributed deployment have not been validated.

This is a usable **local alpha and reviewable release candidate**, not a claim of production readiness or guaranteed instantaneous revocation.

## Türkçe

68 otomatik test ve 4 tarayıcı testi yerelde geçti. Gerçek PostgreSQL ile kuyruk, eşzamanlılık, güvenli oturumlar ve erişim sınırları sınandı. Yeni kaynak klasöründe temiz kurulum ve ayrı veritabanına yedekten dönüş doğrulandı. Otomatik erişilebilirlik taraması tam sertifikasyon anlamına gelmez.

Gerçek Discord testi kullanıcının isteğiyle ertelendi. Bu bilgisayarda Docker motoru bulunmadığı için konteyner uçtan uca denenmedi; Compose yapılandırması ve yerel PostgreSQL/Node çalışması kontrol edildi. GitHub CI sonucu yayımdan sonra ayrıca doğrulanmalı. Canlı ekip kullanımından önce özel test sunucusunda kurulum yönergesindeki denemeler yapılmalı.
