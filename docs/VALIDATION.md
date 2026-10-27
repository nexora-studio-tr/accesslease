# Validation / Doğrulama

Release candidate: **0.1.0-alpha.2** · Date: **27 October 2026**.

## Verified locally for alpha.2

Environment: Windows, Node.js 24.22.1, native PostgreSQL 18.6. Only synthetic demo workspaces and isolated test schemas were used. No Discord or paid provider was contacted.

| Check                           | Result                 | Boundary                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build | Passed                 | Strict server and web typechecking, backend build, optimized and compressed frontend assets.                                                                                                                                                                          |
| ESLint and formatting           | Passed                 | Source and configuration.                                                                                                                                                                                                                                             |
| Automated tests                 | **77 passed**          | Real PostgreSQL integration, HTTP security, permission logic, generated event/order properties and simulated Discord transport. Eight renewal scenarios include tenant-bound migration, concurrent duplicates, overlap expiry, independent approval and stale expiry. |
| Browser tests                   | **5 passed**           | Existing request/review/expiry/privacy flows plus linked renewal submission, independent review and unchanged original deadline.                                                                                                                                      |
| Accessibility scan              | Passed in tested views | Axe WCAG A/AA and WCAG 2.1 AA rules, desktop and Turkish mobile renewal dialog, keyboard dismissal. This is not a complete accessibility certification.                                                                                                               |

The GitHub release includes a source manifest, clean-install record and exact-commit CI results. Use those records for the final packaged build. CI also exercises PostgreSQL, a Docker Compose smoke test and a Windows build; local tests alone do not prove those remote checks passed.

## Previous validation retained as history

Alpha.1 passed 68 automated tests, four browser scenarios, a clean source install, and a backup/restore into an isolated database on the same Windows host. These are historical results, not newly repeated alpha.2 backup or independent installation claims.

## Explicitly not verified

- **Real Discord OAuth, gateway, command registration and role changes:** postponed at the user's request. Follow the private-server checklist in [setup](SETUP.en.md) before real access is managed.
- Independent human installation, multiple real Discord users, large guilds, prolonged outages and distributed deployment remain unverified.
- A queued removal is not a completed revocation. Another role can keep channel access open after AccessLease removes its managed role.

This is an **alpha release**. Database migration preserves existing requests and deadlines; see [renewal semantics and upgrade notes](RENEWALS.md). No guaranteed instantaneous revocation or production-readiness claim is made.

## Türkçe

Alpha.2 için 77 otomatik test ve beş tarayıcı senaryosu geçti. Yenileme, ayrı başvuru ve başka bir kişinin onayını gerektirir; bekleme sırasında ilk bitiş zamanı değişmez. Süresi dolmuş veya yöneticinin rolünü kaldırdığı erişim yeniden açılmaz. Gerçek PostgreSQL, sunucu sınırları, eşzamanlı istekler, şema yükseltmesi ve çakışan sürelerin bitişi test edildi.

Yayın paketindeki doğrulama dosyaları son kaynak paketinin temiz kurulumunu ve aynı commit için GitHub CI sonuçlarını belirtir. Alpha.1'in yedekten dönüş sonucu geçmiş doğrulamadır. Gerçek Discord testi ve bağımsız çok kullanıcılı deneme henüz yapılmadı; canlı kullanımdan önce özel sunucuda test gerekir.
