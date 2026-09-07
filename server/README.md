# ترياق — خادم الذكاء والتراخيص

الهدف: مفتاح Anthropic يبقى عندك في الخادم، والصيدلية تستعمل **كود اشتراك** فقط.
بهذا تبيع اشتراكاً شهرياً/سنوياً وتتحكم بالتفعيل والإيقاف والحصة.

## 1) إنشاء الـWorker
1. ادخل dash.cloudflare.com → **Workers & Pages** → **Create Worker**.
2. سمِّه `tiryaq-ai` ثم **Deploy**، بعدها **Edit code** والصق محتوى `worker.js` واحفظ.

## 2) مساحة التخزين
**Storage & Databases → KV → Create namespace** باسم `tiryaq-lic`،
ثم في الـWorker: **Settings → Bindings → Add → KV namespace**
- Variable name: `LIC`
- KV namespace: `tiryaq-lic`

## 3) المتغيّرات السرّية
Settings → Variables and Secrets → Add (نوع Secret):
| الاسم | القيمة |
|---|---|
| `ANTHROPIC_KEY` | مفتاحك من console.anthropic.com |
| `ADMIN_TOKEN` | كلمة سر طويلة تخصك أنت |
| `MODEL` | (اختياري) `claude-sonnet-4-5` |

## 4) إصدار كود لصيدلية
```bash
curl -X POST https://tiryaq-ai.<اسمك>.workers.dev/admin/new \
  -H "x-admin: ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"shop":"صيدلية النور","phone":"0770…","months":12,"monthly":1500,"maxDevices":2}'
```
يعيد كوداً مثل `TRQ-K7QM-4TDX-9BRA`. تعطيه للزبون، يدخله في
**الإعدادات → الاشتراك والذكاء → كود الاشتراك → تفعيل**.

- `monthly` = عدد طلبات الذكاء شهرياً (تتجدد أول كل شهر).
- `maxDevices` = عدد أجهزة الصيدلية المسموح بها.

## 5) إدارة الأكواد
```bash
# استعراض
curl -X POST .../admin/get -H "x-admin: TOKEN" -d '{"code":"TRQ-…"}'
# تمديد سنة / إيقاف / زيادة الحصة
curl -X POST .../admin/get -H "x-admin: TOKEN" \
     -d '{"code":"TRQ-…","set":{"until":"2027-09-01","blocked":false,"monthly":3000}}'
# تصفير الأجهزة (عند تغيير جهاز الصيدلية)
curl -X POST .../admin/get -H "x-admin: TOKEN" -d '{"code":"TRQ-…","resetDevices":true}'
```

## 6) ربط التطبيق
في `app.js` أعلى الملف:
```js
const AI_URL_DEFAULT = "https://tiryaq-ai.<اسمك>.workers.dev";
```
اكتب الرابط مرة واحدة قبل توليد الـAPK، فلا يبقى على الزبون إلا كود الاشتراك.

## التكلفة والتسعير
كل طلب ذكاء ≈ 1500–3000 توكن. بحصة 1500 طلب شهرياً تبقى كلفة الصيدلية
الواحدة بضعة دولارات شهرياً، فاحسب سعر الاشتراك على هذا الأساس
واترك هامشاً. راقب الاستهلاك من `used` في كل كود.

## ملاحظة أمنية صريحة
التطبيق ملف HTML يعمل على جهاز الزبون، فلا يمكن منع نسخه تقنياً.
ما يمكن حمايته فعلاً هو **خدمة الذكاء** (تتوقف بلا كود صالح) و**التحديثات
والدعم**. اجعل هذه الثلاثة هي قيمة الاشتراك.
