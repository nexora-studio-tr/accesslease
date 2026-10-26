# Nexora AccessLease

**Ürün ve mimari kararı · 26 Ekim 2026**

**Durum:** Bu kapsam temel alınarak alpha.1 uygulandı. Güncel doğrulama ve bilinçli sınırlar `docs/VALIDATION.md` belgesinde tutulur. Gerçek Discord testi kullanıcının isteğiyle ertelendi.

> Doğru kişiye, doğru gerekçeyle, doğru süre boyunca erişim.

## 1. Ürün

AccessLease, Discord üzerinde çalışan bir **geçici erişim yönetim sistemi** olacak: bot, kişisel başvuru ekranı ve ekip yönetim paneli birlikte çalışacak.

İlk hedefimiz; Discord üzerinden proje yürüten yazılım ekipleri ve dışarıdan geliştirici, destek uzmanı veya beta testçisi alan topluluklar. Temel problem, geçici görevler bittiğinde unutulan yetkiler ve yöneticinin verdiği rolün gerçekte hangi kanalları açtığını anlayamaması.

**Örnek:** Bir geliştirici özel test kanalına 48 saatliğine erişim ister. Yetkili, erişimin etkisini görüp onaylar. AccessLease rolü verir; süre sonunda kendi verdiği rolü kaldırır ve kanal erişiminin devam edip etmediğini ayrıca gösterir.

Süreli roller, kalıcı zamanlayıcılar ve önceden var olan rolleri koruma mevcut ürünlerde de bulunuyor. Bu yüzden farklılaşma iddiamız bu özelliklerden oluşmayacak. Değer önerimiz; **açıklanabilir izin analizi + onay süreci + gözlemlenebilir, güvenilir erişim yaşam döngüsü** birleşimi. Bunun kullanıcılar için değerini beta testleriyle doğrulayacağız. [Karşılaştırılan mevcut ürün](https://builddiscordbots.com/modules/temproles.html).

## 2. İlk kullanılabilir sürüm

| Özellik | Kesin kapsam |
| --- | --- |
| Erişim kataloğu | Yönetici, önceden hazırlanmış özel bir Discord rolünü erişim paketine bağlar; kimlerin başvurabileceğini, onaylayıcıları ve azami süreyi belirler. İlk sürümde paket başına bir rol. |
| Başvuru ve onay | Discord komutu veya web panelinden gerekçeli başvuru; başvuran kişiden farklı bir yetkilinin onayı. Süre uzatma da yeniden onay ister. |
| İzin etkisi önizlemesi | Desteklenen metin/ses kanallarında görünürlük, yazma, bağlanma ve konuşma izinlerinin önce/sonra karşılaştırması; sonucu etkileyen roller ve kanal kuralları. |
| Süre sonu denetimi | Rol kaldırıldıktan sonra başka bir rol nedeniyle erişim sürüyorsa bunu açıkça belirtir. “Rol kaldırıldı” ile “kanal erişimi kapandı” ayrı sonuçlardır. |
| Dayanıklı erişim motoru | Yeniden başlatma, gecikme, tekrar gelen olaylar, çakışan başvurular ve Discord bağlantı sorunlarına karşı kalıcı iş kuyruğu ve uzlaştırma. |
| Olay geçmişi | Başvuru, politika sürümü, onay, Discord işlemi ve gözlenen sonuç; yetkili kullanıcılar için JSON/CSV dışa aktarımı. Gizli anahtarlar kaydedilmez. |
| Denenebilir demo | Örnek verilerle erişim isteme, onaylama, zamanı ilerletme, kesinti ve yönetici müdahalesi senaryoları. Simülasyon olduğu görünür biçimde belirtilir. |

Varsayılan süre 24 saat, ilk sürümün üst sınırı 7 gün olacak. Onay anında kesinleşen bitiş zamanı, gecikme veya yeniden deneme nedeniyle ileri taşınmayacak. Süresi geçmiş bir iş yeni erişim vermeyecek.

## 3. Erişim motorunun değişmez kuralları

1. **Mevcut erişimin sahipliğini üstlenme:** Üye rolü önceden taşıyorsa bunu geçici erişime dönüştürme ve otomatik kaldırma. Yöneticiye durum gösterilir.
2. **Çakışan izinleri birlikte değerlendir:** Aynı üye/rol için birden fazla geçerli AccessLease onayı varsa sonuncusu bitmeden rol kaldırılmaz.
3. **Yönetici değişikliklerini ezme:** Dışarıdan rol kaldırılması veya ilgili izinlerin değişmesi gözlendiğinde otomatik geri yükleme yerine çakışma incelemesi gerekir.
4. **Gözlenen sonucu bildir:** Discord erişilemiyorsa “süre doldu, kaldırma bekleniyor” gösterilir. Başarılı sonuç gözlenmeden erişimin kapandığı söylenmez.
5. **Eski önizlemeyle işlem yapma:** İlgili rol/kanal/üye durumu ve politika sürümü onaydan sonra değişirse işlem yeniden değerlendirilir; etki değişmişse yeni onay gerekir.
6. **Yetki yükseltmeyi engelle:** Yalnızca açıkça izin verilmiş, AccessLease için ayrılmış erişim rolleri kullanılabilir. Yönetim ve moderasyon yetkisi veren roller kapsam dışıdır; izin değişikliği bu kontrolü yeniden tetikler.

Discord izinleri rol ve kanal kurallarının birleşiminden oluşur; botun rol atayabilmesi de rol hiyerarşisine bağlıdır. Önizleme motoru bu kurallara göre çalışacak. İlk sürüm standart metin/ses kanallarını kapsayacak; thread, forum ve stage sonuçları desteklenmiyorsa “hesaplanamadı” gösterilecek. [Discord izin modeli](https://docs.discord.com/developers/topics/permissions).

Sınır: Discord rol üyeliği tek başına kimin hangi niyetle atama yaptığını kanıtlamaz. Gözlemlenemeyen, üyeliği değiştirmeyen manuel müdahaleleri eksiksiz tespit etme iddiasında bulunmayacağız. Ayrılmış erişim rolleri bu nedenle kurulum şartıdır; sahipliği devralma ve otomasyonu durdurma işlemleri panelden yapılır.

## 4. Mimari

**Karar: modüler tek uygulama + PostgreSQL.** İlk sürümde mikroservis, Redis ve ayrı kuyruk altyapısı gerekmeyecek. Docker Compose ile uygulama ve veritabanı birlikte kurulacak.

| Katman | Seçim ve sorumluluk |
| --- | --- |
| Web | React, Vite, TypeScript; Radix UI erişilebilir bileşenleri ve özgün CSS tasarımı. |
| API | Fastify; sunucu tarafında oturum, ekip sınırları, başvuru ve onay denetimleri. |
| Discord adaptörü | discord.js; resmi bot API, komutlar ve olaylar. Kullanıcı hesabı otomasyonu yok. |
| Alan motoru | Discord bağlantısından bağımsız TypeScript modülü: politikalar, izin açıklaması, sahiplik ve süre kuralları. |
| Kalıcı işler | PostgreSQL üzerinde işlemle birlikte yazılan iş kayıtları; tekilleştirme, sınırlı yeniden deneme ve düzenli durum karşılaştırması. |
| Çalıştırma | İlk sürüm tek etkin bot/işçi örneği; yatay ölçekleme desteği vaat edilmeyecek. |

Akış: **başvuru → izin önizlemesi → onay → kalıcı iş → Discord işlemi → sonucu doğrulama → süre sonu kaldırma → yeniden doğrulama.**

Veritabanı işlemi ile Discord çağrısı tek bir atomik işlem değildir. Motor, aynı işin tekrar çalışmasına dayanacak; belirsiz API sonuçlarında önce mevcut durumu okuyacak. Hız sınırları sabit sayılarla varsayılmayacak; Discord yanıtları ve bekleme bilgilerine uyulacak. [Discord hız sınırları](https://docs.discord.com/developers/topics/rate-limits).

Bir Discord sunucusu bir çalışma alanı olacak. Yönetici, onaylayıcı ve üye rolleri API tarafında uygulanacak. Sunucular arası veri erişimi ve kendi başvurusunu onaylama engellenecek. İşlem anında üyelik ve yetki yeniden doğrulanacak.

Discord OAuth girişi, sunucuda saklanan oturumlar, üretimde güvenli çerezler, CSRF kontrolleri ve giriş/işlem hız sınırlaması kullanılacak. Bot anahtarı ve OAuth sırrı kurulum sahibinde kalacak; kaynak koduna veya tarayıcıya gönderilmeyecek. Bot için Administrator ve mesaj içeriği erişimi istenmeyecek. Gerekli üye olayları ve Discord intent koşulları kurulumda açıkça belgelenip kontrol edilecek.

Katalog yalnızca yöneticinin yayımladığı paketleri gösterecek. Özel kanal adları ve ayrıntılı izin dökümü, bunları görmeye yetkisi olmayan başvuru sahibine sızdırılmayacak.

## 5. Arayüz kararı

Ana ekranın odağı, **kim / hangi erişim / hangi gerekçe / ne zamana kadar / şu anki gerçek durum** sorularını yanıtlayan erişim listesi ve zaman çizgisi olacak.

- Kömür grisi zemin, kırık beyaz metin ve tek turkuaz vurgu; okunabilir tipografi ve geniş boşluklar.
- Sağ ayrıntı panelinde izin farkı ve sonucu açıklayan sade cümleler: “Bu rol kaldırılınca test kanalını görmeye devam edecek; başka bir rol izin veriyor.”
- “Onay bekliyor”, “Etkin”, “Kaldırma bekliyor”, “Kapandı” ve “İnceleme gerekli” durumları renk yanında metin ve simgeyle gösterilecek.
- Klavye ile tam kullanım, görünür odak, hareket azaltma desteği ve mobilde kullanılabilir başvuru/onay ekranı.
- Arayüz, kurulum ve dokümantasyon Türkçe/İngilizce hazırlanacak.

## 6. Doğrulama ve tamamlanma ölçütü

İlk sürüm aşağıdaki kanıtlar olmadan tamamlanmış sayılmayacak:

- İzin birleşimleri, üst üste binen süreler ve olay sıraları için anlamlı alan testleri; üretilmiş olay dizileriyle değişmez kuralların sınanması.
- Gerçek PostgreSQL ile eşzamanlı onay, yeniden başlatma, tekrar teslim, işlem geri alma ve bitiş zamanı testleri.
- Discord adaptöründe gecikme, hız sınırı, yetki kaybı ve sonucu belirsiz çağrı senaryoları.
- Çalışma alanı yalıtımı, kendi kendine onay, eski yetkiyle işlem ve özel kanal bilgisi sızıntısı testleri.
- Tarayıcıdan başvuru → onay → etkin erişim → kapanış akışı ve klavye kullanımı kontrolü.
- Ayrı test sunucusunda gerçek rol verme/kaldırma ve manuel müdahale denemeleri. Yapılmayan canlı testler yayında açıkça belirtilir.
- Temiz kurulum, yedekleme/geri yükleme tarifi, örnek demo, TR/EN belgeler, lisans ve bağımlılık bildirimleri.

## 7. Geliştirme sırası ve sınırlar

1. **Temel motor:** politika ve izin modeli, sahiplik kuralları, kalıcı işler ve kritik testler.
2. **Çalışan ürün akışı:** Discord botu, güvenli ekip girişi, başvuru ve onay, gerçek rol verme/kaldırma.
3. **Hata ve müdahale senaryoları:** çakışma inceleme, kesinti kurtarma, eşzamanlılık ve güvenlik doğrulaması.
4. **Sunum ve yayın:** özgün arayüz, etkileşimli örnek demo, kolay kurulum, TR/EN belgeler ve GitHub beta sürümü.

Ödeme alma, abonelik, yapay zekâ çağrıları, genel moderasyon, otomatik kanal oluşturma ve başka platformlara bağlanma ilk sürüme dahil değil. Ticari güvenlik botunun kaynakları kullanılmayacak. Yeni proje bağımsız geliştirilecek; MIT lisansı hedeflenecek ve üçüncü taraf bildirimleri yayın öncesinde doğrulanacak.

Teknik zorluk **yüksek**, bakım yükü **orta-yüksek**: asıl emek Discord izin modelinin doğruluğu, olayların tutarsız sırada gelmesi ve yönetici müdahaleleriyle birlikte güvenilir çalışmak. İlk hedefimiz para veya yıldız tahmini değil; bir ekibin gerçek geçici erişim sürecini güvenle tamamlayabildiğini göstermek.
