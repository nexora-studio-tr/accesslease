# Security policy

This alpha manages low-privilege, dedicated Discord access roles. It is not a moderation or incident-response replacement.

## Supported version

Security fixes target the latest `0.1.0-alpha` release. Run a separate bot application and a private test guild before connecting a real team.

## Reporting

Use the repository's **Security → Report a vulnerability** private channel when private reporting is enabled. If it is unavailable, open a minimal issue asking for a private contact without reproduction secrets or exploit details. Never post bot tokens, OAuth secrets, session cookies, database URLs or unredacted private-server evidence publicly.

## Controls

- Official Discord bot API and OAuth authorization-code flow with one-use state bound to a browser cookie.
- Opaque, rotated, hashed-at-rest server sessions, eight-hour expiry, HttpOnly/SameSite cookies and HTTPS Secure cookies.
- Exact configured Host and mutation Origin checks, CSRF tokens, input bounds, JSON-only mutations and rate limits.
- Per-workspace authorization and per-policy reviewer delegation; no self approval.
- Zero-base-permission access roles, bounded channel scope and live hierarchy checks.
- Parameterized SQL, a separate database, non-superuser application login in generated setups, no raw provider errors in public responses.
- Source archives exclude local runtime state, credentials, database files, backups and commercial projects.

## Limits to understand

Discord role writes are not conditional transactions. State may change after a preview or final check. No service can infer every unobservable manual role-grant intention from membership alone. Conflicts intentionally preserve external changes; access may remain until an owner resolves it.

During an outage, an expired role can remain assigned. The panel must not report successful revocation without observing it. After retry exhaustion, inspect the conflict in Discord and explicitly resolve the situation. An event export is an application record, not tamper-proof forensic evidence: database owners can alter their own database.

Do not give Administrator to the bot. Keep secrets in private environment configuration or your own secret manager. Backups may contain personal identifiers and request reasons; restrict and encrypt them. Public demos must use simulation mode only.

## Türkçe

Güvenlik açığını mümkünse GitHub **Security → Report a vulnerability** üzerinden özel bildir. Bu özellik yoksa açık paylaşımda yalnızca özel iletişim iste; anahtar veya istismar ayrıntısı yayımlama.

Bot yalnızca özel, düşük yetkili erişim rollerini yönetir. Kesintide süresi dolmuş rol hemen kaldırılamayabilir; panel doğrulanmayan kapanışı başarılı göstermez. Çakışmalar yönetici müdahalesini korumak için durur ve manuel inceleme gerektirir. Olay geçmişi değiştirilemez adli delil iddiası taşımaz. Administrator verme, canlı anahtarları demoda kullanma, yedekleri koru.
