# Contributing

Start with a focused issue: describe the user problem, expected result and a minimal redacted reproduction. English and Turkish are welcome. For a security issue, follow [SECURITY.md](SECURITY.md).

Use Node 24 and a private disposable PostgreSQL database. Follow the [setup](docs/SETUP.en.md), create a `codex/` or descriptive feature branch, and keep changes focused.

Before a pull request:

```sh
npm run format
npm run lint
npm run check
npm run test:browser
```

Test behavioral invariants rather than implementation details. Permission, ownership, timing and tenant changes need adversarial cases. Explain any validation that was not performed. UI strings require English and Turkish entries and keyboard-accessible primitives from Radix UI.

Do not commit `.env`, tokens, test guild identifiers, database files, recordings or private commercial source. Contributions are licensed under MIT; retain upstream notices.

## Türkçe

Kullanıcı problemini ve beklenen davranışı açıklayan küçük bir issue ile başla. Değişiklikleri ayrı dalda yap, yukarıdaki kontrolleri çalıştır, yapılmayan canlı testleri açıkça belirt. Arayüz metinlerini iki dile ekle. Gizli anahtar, özel sunucu verisi ve ticari kaynak kodu gönderme.
