# Reviewed renewals / Onaylı yenilemeler

## English

**Extra time is a new decision.** In an active lease's details, its holder can select **Request more time**, choose a duration and give a reason. The policy and role are inherited from the original lease; a renewal cannot substitute another role or user.

The result is a separate pending request linked to the original. The original deadline remains unchanged, and the holder cannot approve their own renewal. A reviewer uses the existing permission preview and approval flow.

An approved renewal lasts for the requested duration **from approval time**, subject to the policy's maximum. It is not added to the original deadline. For example, a 24-hour renewal approved at Tuesday 12:00 ends Wednesday 12:00. It must end later than the original term; choosing a shorter term does not count as a renewal.

Both submission and approval require a still-active original lease, unchanged published policy, current eligibility, and an observed role owned by AccessLease. Expiry is checked against the current database clock even if the expiry worker has not updated the row yet. A removed role, revoked lease or expired original cannot be renewed. Submit a new normal request when access is needed again.

An approved renewal and its original are independent leases. Ending either one does not end another approved term. The managed role remains while at least one valid term needs it; the reconciler verifies removal after the last term. A pending renewal cannot keep an expired role alive.

Only one pending request for the same holder and policy is allowed. Requests are serialized per workspace, and the database links a renewal only to a request in that workspace. The `renewal_requested` audit event records the original request and its previous deadline; normal approval/grant/expiry events remain visible.

### Upgrade from alpha.1

Back up the database using the existing setup instructions, install alpha.2 dependencies and build, then restart the application. Startup migrations add a nullable `renewal_of` column and a workspace-bound foreign key. Existing requests and deadlines are preserved; no reset or fresh database is required. Do not downgrade a database containing renewal requests to alpha.1: that version cannot enforce renewal semantics.

### Try the simulated flow

1. As the owner, approve the member's Build Lab request.
2. Switch to the member, open that active lease and request a longer term.
3. Observe that the original deadline remains unchanged and the new request is pending.
4. Switch to a reviewer or owner and approve the linked request independently.
5. Advance the demo clock past the original deadline, then past the renewal's deadline. Inspect the role and verification events at both points.

## Türkçe

**Ek süre yeni bir onay kararıdır.** Aktif izninin ayrıntısını açıp **Yenileme iste** seçeneğine bas; süreyi ve gerekçeyi gir. Kullanıcı, rol ve politika mevcut izinden alınır.

Yeni başvuru onay beklerken eski bitiş zamanı değişmez. Kendi başvurunu onaylayamazsın. Başka bir yetkili izin önizlemesini inceleyip karar verir.

Onaylanan süre **onay anından başlar**; eski bitiş zamanına eklenmez. Örneğin salı 12:00'de onaylanan 24 saatlik yenileme çarşamba 12:00'de biter. Yeni bitişin eskisinden daha ileri olması ve politika sınırını aşmaması gerekir.

Başvuruda ve onayda mevcut izin hâlâ aktif olmalı; yayımlanmış politika değişmemiş olmalı; kullanıcı uygunluğu ve AccessLease'in yönettiği rol yeniden doğrulanır. Süresi dolmuş, geri alınmış veya rolü yönetici tarafından kaldırılmış bir izin yenilenemez. Süre sonu işçisi gecikse bile güncel veritabanı zamanı esas alınır.

Onaylanan yenileme ve ilk izin bağımsızdır. Birini sonlandırmak diğerini iptal etmez. Rol son geçerli izin bitene kadar tutulur; ardından kaldırıldığı doğrulanır. Bekleyen bir yenileme erişim süresini uzatmaz.

Aynı kullanıcı ve politika için tek bekleyen başvuru olabilir. Yenileme bağlantıları sunucu sınırını aşamaz. Olay geçmişindeki yenileme kaydı önceki izni ve bitiş zamanını gösterir.

Alpha.1'den yükseltmeden önce veritabanı yedeğini al; yeni bağımlılıkları kur, derle ve uygulamayı yeniden başlat. Açılıştaki şema yükseltmesi mevcut kayıtları ve süreleri korur. Yenileme verisi oluşmuş veritabanını alpha.1 ile çalıştırma. Gerçek Discord testi henüz tamamlanmadı; önce özel test sunucusunda doğrulama gerekir.
