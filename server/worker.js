/* ============================================================
   ترياق — خادم الذكاء والتراخيص (Cloudflare Worker)
   يحمي مفتاح Anthropic: يبقى في الخادم ولا يُوزَّع مع التطبيق.
   يتحقق من كود الاشتراك، يحدّ الأجهزة والاستهلاك الشهري،
   ثم يمرّر الطلب إلى Anthropic ويعيد النص فقط.

   المتغيّرات المطلوبة (Settings → Variables):
     ANTHROPIC_KEY  : سرّي — مفتاحك من console.anthropic.com
     ADMIN_TOKEN    : سرّي — كلمة سر لإصدار الأكواد
     MODEL          : اختياري — claude-sonnet-4-5 افتراضاً
   ومساحة KV باسم LIC (Bindings → KV Namespace).
   ============================================================ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, GET, OPTIONS"
};
const json = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS)
});
const month = () => new Date().toISOString().slice(0, 7);          /* 2026-09 */
const today = () => new Date().toISOString().slice(0, 10);

/* كود بصيغة TRQ-XXXX-XXXX-XXXX (بلا حروف ملتبسة) */
function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const g = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  return "TRQ-" + g() + "-" + g() + "-" + g();
}

async function getLic(env, code) {
  if (!code) return null;
  const raw = await env.LIC.get("lic:" + String(code).trim().toUpperCase());
  return raw ? JSON.parse(raw) : null;
}
const putLic = (env, lic) => env.LIC.put("lic:" + lic.code, JSON.stringify(lic));

/* يعيد رسالة الخطأ أو null إن كان الترخيص صالحاً */
function checkLic(lic, device) {
  if (!lic) return { s: 401, e: "كود الاشتراك غير صحيح" };
  if (lic.blocked) return { s: 403, e: "الاشتراك موقوف — راجع المزوّد" };
  if (lic.until && today() > lic.until) return { s: 402, e: "انتهى الاشتراك بتاريخ " + lic.until };
  if (device && !(lic.devices || []).includes(device)) {
    if ((lic.devices || []).length >= (lic.maxDevices || 2))
      return { s: 409, e: "بلغت الحد المسموح من الأجهزة (" + (lic.maxDevices || 2) + ")" };
    return { s: 0, add: true };
  }
  return { s: 0 };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    /* ---------- إصدار كود جديد (لك أنت فقط) ----------
       curl -X POST https://…/admin/new -H "x-admin: TOKEN" \
            -d '{"shop":"صيدلية النور","months":12,"monthly":1500,"maxDevices":2}' */
    if (path === "/admin/new" && req.method === "POST") {
      if (req.headers.get("x-admin") !== env.ADMIN_TOKEN) return json({ error: "غير مصرّح" }, 401);
      const b = await req.json().catch(() => ({}));
      const d = new Date(); d.setMonth(d.getMonth() + (Number(b.months) || 12));
      const lic = {
        code: b.code ? String(b.code).toUpperCase() : makeCode(),
        shop: b.shop || "", phone: b.phone || "",
        until: d.toISOString().slice(0, 10),
        monthly: Number(b.monthly) || 1500,      /* عدد طلبات الذكاء شهرياً */
        maxDevices: Number(b.maxDevices) || 2,
        devices: [], used: {}, at: new Date().toISOString()
      };
      await putLic(env, lic);
      return json({ ok: true, license: lic });
    }

    /* ---------- استعراض/تعديل كود ---------- */
    if (path === "/admin/get" && req.method === "POST") {
      if (req.headers.get("x-admin") !== env.ADMIN_TOKEN) return json({ error: "غير مصرّح" }, 401);
      const b = await req.json().catch(() => ({}));
      const lic = await getLic(env, b.code);
      if (!lic) return json({ error: "غير موجود" }, 404);
      if (b.set && typeof b.set === "object") { Object.assign(lic, b.set); await putLic(env, lic); }
      if (b.resetDevices) { lic.devices = []; await putLic(env, lic); }
      return json({ ok: true, license: lic });
    }

    /* ---------- تفعيل الجهاز ---------- */
    if (path === "/activate" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const lic = await getLic(env, b.code);
      const c = checkLic(lic, b.device);
      if (c.s) return json({ error: c.e }, c.s);
      if (c.add) { lic.devices = (lic.devices || []).concat(b.device); }
      if (b.shop && !lic.shop) lic.shop = b.shop;
      lic.lastSeen = new Date().toISOString();
      await putLic(env, lic);
      const used = (lic.used || {})[month()] || 0;
      return json({ ok: true, shop: lic.shop, until: lic.until,
                    quota: lic.monthly, used, left: Math.max(0, lic.monthly - used),
                    devices: lic.devices.length, maxDevices: lic.maxDevices });
    }

    /* ---------- حالة الاشتراك ---------- */
    if (path === "/status" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const lic = await getLic(env, b.code);
      const c = checkLic(lic, b.device);
      if (c.s) return json({ error: c.e }, c.s);
      const used = (lic.used || {})[month()] || 0;
      return json({ ok: true, shop: lic.shop, until: lic.until, quota: lic.monthly,
                    used, left: Math.max(0, lic.monthly - used) });
    }

    /* ---------- طلب الذكاء ---------- */
    if (path === "/ai" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const lic = await getLic(env, b.code);
      const c = checkLic(lic, b.device);
      if (c.s) return json({ error: c.e }, c.s);
      if (c.add) lic.devices = (lic.devices || []).concat(b.device);

      const m = month();
      lic.used = lic.used || {};
      const used = lic.used[m] || 0;
      if (used >= (lic.monthly || 1500))
        return json({ error: "انتهت حصة هذا الشهر (" + lic.monthly + " طلب) — تتجدد أول الشهر" }, 429);

      const prompt = String(b.prompt || "").slice(0, 12000);
      if (!prompt) return json({ error: "لا يوجد سؤال" }, 400);

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_KEY,
                   "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: env.MODEL || "claude-sonnet-4-5",
          max_tokens: Math.min(Number(b.max_tokens) || 800, 2000),
          system: String(b.system || "أنت مساعد صيدلاني في العراق. أجب بالعربية باختصار ودقة."),
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: "تعذّر الاتصال بخدمة الذكاء", detail: t.slice(0, 300) }, 502);
      }
      const d = await r.json();
      const text = (d.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");

      lic.used[m] = used + 1;
      lic.lastSeen = new Date().toISOString();
      await putLic(env, lic);
      return json({ ok: true, text, used: lic.used[m], left: Math.max(0, lic.monthly - lic.used[m]) });
    }

    return json({ ok: true, service: "TIRYAQ AI", time: new Date().toISOString() });
  }
};
