# Kurulum ve kullanım

## Yerel demo

1. Node.js 24 ve PostgreSQL 18 kurulu olmalı; PostgreSQL yerine çalışan Docker Compose da kullanabilirsin.
2. Bu proje klasöründe `npm ci`, ardından `npm run setup` çalıştır.
3. Kurulum rastgele veritabanı parolaları üretip özel `.env` dosyasına yazar. Parolaları ekrana basmaz ve Discord’a bağlanmaz.
4. Windows’ta `C:/Program Files/PostgreSQL/18/bin` algılanır. Başka kurulum için `PG_BIN` tanımla. Yalnızca bu projeye ait veritabanı `artifacts/local-postgres/data` altında, `127.0.0.1:5448` adresinde çalışır. Mevcut veritabanları ve `.env` korunur.
5. Yerel PostgreSQL bulunmadıysa `docker compose up -d db` çalıştır.
6. `npm run build`, sonra `npm start` çalıştır. http://127.0.0.1:4348 adresini aç.

Bilgisayar yeniden başladıktan sonra oluşturulan yerel veritabanını açmak için PowerShell’de:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '.\artifacts\local-postgres\data' -l '.\artifacts\local-postgres\postgres.log' -o '-p 5448 -h 127.0.0.1' -w start
```

Kapatmak için aynı komutta `-m fast -w stop` kullan. Klasörü silmek yerine PostgreSQL’i düzgün kapat.

## Tam Docker kurulumu

Yerel veritabanı ve Docker seçeneklerinden birini kullan. PostgreSQL zaten yüklüyken Docker’ı tercih ediyorsan ilk kurulum komutunda `PG_BIN` değerini var olmayan bir klasöre ayarla; böylece kurulum yalnızca `.env` üretir.

```sh
docker compose up --build -d
docker compose logs -f app
```

Docker uygulaması ve veritabanı yalnızca bu bilgisayardan bağlantı kabul eder. Veriler kalıcı Docker biriminde saklanır; `docker compose down` bu birimi silmez. Docker servisi açık olmalı.

## Gerçek Discord botunu bağlama

1. [Discord Developer Portal](https://discord.com/developers/applications) üzerinden **AccessLease’e özel yeni uygulama** oluştur. Diğer projelerin anahtarlarını kullanma.
2. Bot bölümünden **Server Members Intent** seçeneğini aç. Message Content kapalı kalsın. Uygulama büyüdüğünde Discord’un intent onay koşulları uygulanabilir.
3. Botu özel test sunucuna `bot`, `applications.commands` kapsamları ve **Rolleri Yönet** yetkisiyle ekle. Administrator verme.
4. OAuth2 geri dönüş adresini tam olarak `http://127.0.0.1:4348/auth/callback` gir. `localhost` ile `127.0.0.1` aynı adres sayılmaz.
5. Yerel `.env` dosyasını açıp aşağıdaki alanları doldur. Anahtarları sohbete gönderme:

```dotenv
APP_MODE=live
DISCORD_APPLICATION_ID=UYGULAMA_ID
DISCORD_CLIENT_SECRET=GERCEK_OAUTH_SECRET
DISCORD_BOT_TOKEN=YENI_BOT_TOKEN
DISCORD_GUILD_IDS=TEST_SUNUCU_ID
```

Birden fazla izinli sunucu ID’sini virgülle ayırabilirsin. Client Secret, uygulamanın sayısal ID’si değildir.

6. Uygulamayı yeniden başlat. `/access panel`, `/access request` ve `/access mine` komutları yalnızca seçtiğin sunuculara eklenir.
7. Discord’da **Build Lab** gibi özel bir erişim rolü aç. Sunucu genelindeki tüm yetkileri kapalı olsun. Rol, bot ve onaylayıcı rollerinin altında dursun. Sadece hedef özel metin/ses kanallarında gerekli güvenli izinleri ver.
8. Sunucu sahibi olarak panele Discord ile giriş yap. **Politikalar → Yeni politika** üzerinden rolü, bu role kural yazılan tüm kanalları, başvurabilecek rolleri, onaylayıcıları ve azami süreyi seç. Başvurabilecek roller boşsa tüm üyeler başvurabilir. Onaylayıcı rolü boş olsa da sunucu sahibi başkasının başvurusunu onaylayabilir.
9. Bu role zaten sahip olmayan farklı bir üye başvuru yapsın. Başka bir yetkili önizlemeyi inceleyip onaylasın. En kısa test süresi beş dakikadır.
10. Discord’daki rolü ve kanal erişimini kontrol et. Süre sonunda ikisini yeniden doğrula. İkinci izinle çakışma ve rolü dışarıdan manuel kaldırma senaryolarını da dene.

İnceleme gerektiren bir rolün yönetimini bıraktığında rol otomatik kaldırılmaz. Kalan rolü Discord’dan kaldırıp ilgili başvuruda **Yeni başvuruları aç** seç. AccessLease önce rolün gerçekten olmadığını doğrular; ardından ayrı onay gerektiren yeni bir başvuru yapılabilir. Mevcut rolün yönetimi otomatik üstlenilmez.

## İnternete açma

HTTPS, `NODE_ENV=production` ve `PUBLIC_ORIGIN=https://alan-adin` kullan. Ters vekil bu Host başlığını korumalı. OAuth geri dönüş adresini de aynı HTTPS alan adına göre kaydet. Veritabanını internete açma. Panel ve API aynı adreste çalışır; HTTPS kurulumunda oturum çerezleri Secure olur.

Örnek demo yayımlayacaksan `APP_MODE=demo` kalsın; gerçek anahtar veya sunucu verisi ekleme. Demo alanları bir gün, oturumlar sekiz saat sonra temizlenir. Varsayılan Docker portu yereldir; genel erişimi aynı bilgisayardaki HTTPS ters vekil üzerinden kur.

## Yedekleme ve geri yükleme

Çalışan veri klasörünü kopyalamak yerine `pg_dump --format=custom` ile veritabanı yedeği al. Bağlantı bilgilerini özel PostgreSQL ortam değişkeni veya korumalı parola dosyasıyla ver; ortak terminale veya günlüğe yazma. Yedekleri şifreli sakla.

Geri yüklemede uygulamayı durdur, `pg_restore` ile **ayrı ve boş bir veritabanına** aktar, özel `DATABASE_URL` alanını güncelle ve tek uygulama örneğini aç. Kuyruğu ve çakışmaları incele. Aynı Discord sunucusunu eski ve geri yüklenen iki uygulamayla eşzamanlı yönetme. Önce demo verisiyle geri yükleme provası yap.

## Geliştirme

`npm run dev` TypeScript sunucusunu açar. Arayüz değişince tekrar derle. Vite kullanacaksan API’nin `PUBLIC_ORIGIN` adresini `http://127.0.0.1:4349` yap, OAuth geri dönüşünü buna göre ayarla ve `npm run web:dev` çalıştır. Testleri ayrı bir deneme veritabanında `npm run check` ve `npm run test:browser` ile yürüt.
