/* ===== ترياق · نظام إدارة الصيدلية — نقطة بيع ومخزون بمساعدة الذكاء الاصطناعي ===== */
const BRAND = "ترياق";

const $ = id => document.getElementById(id);
/* تأخير بسيط لبحث القوائم الطويلة: يمنع تعليق الكتابة على الأجهزة الضعيفة */
const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 90); }; };
const money = n => (Number(n) || 0).toLocaleString("en-US");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DATE_RE = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})/;
/* صلاحيات الأدوية تُكتب غالباً شهر/سنة أو JUN 2027 — نحوّلها إلى يوم/شهر/سنة */
const MY_RE   = /(?:^|[^\d])(\d{1,2})\s*[\/\-.]\s*(20\d{2})(?!\d)/;
const MONY_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[\-\/ ]?\s*(20\d{2}|\d{2})\b/i;
const MONS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const pad2 = n => String(n).padStart(2, "0");
function normExp(v) {
  const t = String(v == null ? "" : v).trim();
  if (!t) return "";
  let m = t.match(DATE_RE);
  if (m) return pad2(m[1]) + "/" + pad2(m[2]) + "/" + m[3];
  m = t.match(MONY_RE);
  if (m) { const mo = MONS[m[1].toLowerCase().slice(0, 3)];
           const y = m[2].length === 2 ? "20" + m[2] : m[2];
           return "01/" + pad2(mo) + "/" + y; }
  m = t.match(MY_RE);
  if (m && +m[1] >= 1 && +m[1] <= 12) return "01/" + pad2(m[1]) + "/" + m[2];
  return "";
}
/* يلتقط تاريخ الصلاحية من سطر ويعيد باقي السطر بدونه */
function grabExp(t) {
  for (const re of [DATE_RE, MONY_RE, MY_RE]) {
    const m = t.match(re);
    if (m) { const e = normExp(m[0]); if (e) return { exp: e, rest: t.replace(m[0], " ") }; }
  }
  return { exp: "", rest: t };
}
const F = ["n","b","sc","ss","c","k","p","q","min","e","t","cat"];   /* sup/pk تُضاف بالتعديل */

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; }
              catch (e) { toast("الذاكرة ممتلئة — صدّر نسخة احتياطية"); return false; } }
};

let PATCH    = LS.get("ph.patch", {});
let EXTRA    = LS.get("ph.extra", []);
let INVOICES = LS.get("ph.inv", []);
let HELD     = LS.get("ph.held", []);
let PURCH    = LS.get("ph.purch", []);
let CUST     = LS.get("ph.cust", []);
let WH       = LS.get("ph.wh", ["المخزن الرئيسي"]);
let AWH      = LS.get("ph.awh", "المخزن الرئيسي");
let USERS    = LS.get("ph.users", []);              /* {n,pin,role} */
let ME       = null;
let PLANS    = LS.get("ph.plans", []);              /* أقساط */      /* {n, phone, bal, log:[{at,amt,note}]} */
let CFG      = LS.get("ph.cfg", { shop: "", cur: "د.ع", margin: 25, expdays: 90,
                                  key: "", model: "claude-sonnet-4-5", safet: 0, safeb: 0 });
let SEQ      = LS.get("ph.seq", 0);
let ITEMS = [], CART = [], DISC = 0, PAYM = "نقد", PICK = null;

/* كل صنف مضاف يأخذ رقماً ثابتاً (uid) لا يتغيّر بتغيّر ترتيب المصفوفة،
   لأن مفاتيح PATCH كانت تعتمد على الفهرس فتنزلق التعديلات عند الاستعادة. */
function migrateExtra() {
  let max = SEQ - 1, dirty = false;
  EXTRA.forEach((it, i) => {
    if (it && it.uid == null) { it.uid = i; dirty = true; }          /* يحفظ ارتباط PATCH["x"+i] القديم */
    if (it && it.uid > max) max = it.uid;
  });
  const seen = new Set();
  EXTRA.forEach(it => { if (!it) return; while (seen.has(it.uid)) { it.uid = ++max; dirty = true; } seen.add(it.uid); });
  if (max + 1 > SEQ) { SEQ = max + 1; LS.set("ph.seq", SEQ); }
  if (dirty) LS.set("ph.extra", EXTRA);
}
function newExtra(rec) { rec.uid = SEQ++; LS.set("ph.seq", SEQ); EXTRA.push(rec); return rec; }

function buildItems() {
  const fromSeed = SEED.rows.map((r, i) => {
    const o = { id: "s" + i };
    F.forEach((k, j) => { o[k] = r[j] === undefined ? "" : r[j]; });
    return Object.assign(o, PATCH["s" + i] || {});
  });
  migrateExtra();
  const fromExtra = EXTRA.map(it => Object.assign({ id: "x" + it.uid }, it, PATCH["x" + it.uid] || {}));
  ITEMS = fromSeed.concat(fromExtra);
  ITEMS.forEach(it => {
    it._n = String(it.n || "").toLowerCase();
    it._c = String(it.c || "").toLowerCase();
    it._s = String(it.sc || "").toLowerCase();
  });
}
function patchItem(it, ch) {
  PATCH[it.id] = Object.assign({}, PATCH[it.id], ch);
  Object.assign(it, ch);
  it._n = String(it.n || "").toLowerCase(); it._s = String(it.sc || "").toLowerCase();
  LS.set("ph.patch", PATCH);
}
/* أقرب تاريخ انتهاء بين تشغيلات الصنف */
function nearestExp(it) {
  const bs = (it.bt || []).filter(b => b.e && (b.q || 0) > 0);
  if (!bs.length) return it.e || "";
  return bs.slice().sort((a, b) => (expDays(a.e) ?? 9e9) - (expDays(b.e) ?? 9e9))[0].e;
}
/* خصم الكمية من أقرب تشغيلة انتهاءً (FEFO) */
function takeStock(it, qty) {
  let left = qty;
  const bt = (it.bt || []).slice().sort((a, b) => (expDays(a.e) ?? 9e9) - (expDays(b.e) ?? 9e9));
  bt.forEach(b => { const t = Math.min(b.q || 0, left); b.q = (b.q || 0) - t; left -= t; });
  const rest = bt.filter(b => (b.q || 0) > 0);
  patchItem(it, { q: Math.max(0, (it.q || 0) - qty), bt: rest.length ? rest : undefined });
}
function addBatch(it, qty, exp, lot) {
  const bt = (it.bt || []).slice();
  const same = bt.find(b => b.e === exp && (b.l || "") === (lot || ""));
  if (same) same.q = (same.q || 0) + qty; else bt.push({ l: lot || "", e: exp || "", q: qty });
  patchItem(it, { q: (it.q || 0) + qty, bt, e: exp || it.e });
}

const expDays = e => { const m = String(e || "").match(DATE_RE); return m ? Math.round((new Date(+m[3], +m[2]-1, +m[1]) - new Date()) / 86400000) : null; };
const sellOf = it => it.p || 0;

function go(tab) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("on", p.id === "pg-" + tab));
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  if (tab === "home")   renderHome();
  if (tab === "sale")   renderCart();
  if (tab === "stock")  { renderStock(); renderPurch(); renderCust(); renderWH(); renderPlans(); }
  if (tab === "alerts") renderAlerts();
  if (tab === "debt")   renderDebt();
  if (tab === "guide")  renderGuide();
  window.scrollTo(0, 0);
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 3200);
}

/* ---------- الرئيسية ---------- */
function renderHome() {
  const today = new Date().toDateString();
  const sales = INVOICES.filter(v => new Date(v.at).toDateString() === today);
  const sold  = sales.reduce((a, v) => a + v.total, 0);
  const low = ITEMS.filter(it => (it.q || 0) <= (it.min || 5)).length;
  const exp = ITEMS.filter(it => { const d = expDays(nearestExp(it)); return d !== null && d < (CFG.expdays || 90); }).length;
  $("k-sales").textContent = money(sold) + " " + CFG.cur;
  $("k-salesn").textContent = sales.length ? sales.length + " فاتورة اليوم" : "لا حركة بعد";
  $("k-items").textContent = money(ITEMS.length);
  $("k-avail").textContent = money(ITEMS.filter(it => (it.q || 0) > 0).length) + " متوفر";
  $("k-low").textContent = money(low);
  $("k-exp").textContent = money(exp);

  /* مخطط ٧ أيام */
  const days = [], names = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const tot = INVOICES.filter(v => new Date(v.at).toDateString() === d.toDateString())
                        .reduce((a, v) => a + v.total, 0);
    days.push({ l: names[d.getDay()].slice(0, 3), v: tot });
  }
  const mx = Math.max(1, ...days.map(d => d.v));
  $("chart").innerHTML = days.map(d =>
    '<div style="height:' + Math.max(4, Math.round(d.v / mx * 100)) + '%;background:' +
    (d.v ? "var(--brand2)" : "var(--soft)") + '">' +
    (d.v ? '<b>' + money(d.v) + '</b>' : "") + '<span>' + d.l + '</span></div>').join("");
  const week = days.reduce((a, d) => a + d.v, 0);
  $("chartsum").textContent = "مجموع الأسبوع: " + money(week) + " " + CFG.cur +
    " · متوسط يومي: " + money(Math.round(week / 7)) + " " + CFG.cur;

  /* الأكثر مبيعاً */
  const c = {};
  INVOICES.slice(-120).forEach(v => (v.lines || []).forEach(l => {
    c[l.n] = c[l.n] || { q: 0, v: 0 }; c[l.n].q += l.q; c[l.n].v += l.q * l.p;
  }));
  const top = Object.keys(c).sort((a, b) => c[b].v - c[a].v).slice(0, 6);
  $("topsell").innerHTML = top.length ? top.map(n =>
    '<div class="row"><span>' + esc(n) + '</span><b>' + c[n].q + " × · " + money(c[n].v) + '</b></div>').join("")
    : '<p class="muted">لا توجد مبيعات بعد.</p>';
}

/* ---------- البحث ---------- */
let HITS = [], CUR = -1, KIND = "all";
function search() {
  const v = $("q").value.trim().toLowerCase();
  $("card").classList.remove("on");
  if (!v) { HITS = []; drawSug(); $("nores").style.display = "none"; return; }
  const digits = /^\d{5,}$/.test(v);
  const a = [], b = [];
  for (const it of ITEMS) {
    if (KIND === "avail" ? !(it.q > 0) : (KIND !== "all" && (it.t || "مخزون") !== KIND)) continue;
    if (digits) { if (String(it.b || "").includes(v) || (it.b2 || "").includes(v)) a.push(it); continue; }
    if (it._n.startsWith(v)) a.push(it);
    else if (it._n.includes(v) || it._s.includes(v) || it._c.includes(v)) b.push(it);
    if (a.length > 40) break;
  }
  HITS = a.concat(b).slice(0, 12); CUR = -1; drawSug();
  $("nores").style.display = HITS.length ? "none" : "block";
}
function drawSug() {
  $("sug").innerHTML = HITS.map((it, i) =>
    '<div class="opt' + (i === CUR ? " on" : "") + '" data-i="' + i + '"><b>' + esc(it.n) + '</b><small>' +
    money(sellOf(it)) + " " + esc(CFG.cur) + (it.sc ? " · " + esc(it.sc) : "") +
    " · " + (it.q > 0 ? "متوفر " + money(it.q) : "غير متوفر") + '</small></div>').join("");
  $("sug").classList.toggle("on", HITS.length > 0);
}
const cell = (k, v) => '<div><i>' + k + '</i>' + esc(v) + '</div>';
function show(it) {
  PICK = it;
  const margin = (it.p && it.k) ? Math.round((it.p - it.k) / it.k * 100) : null;
  $("c-name").textContent = it.n;
  $("c-sci").textContent = it.sc || "الاسم العلمي غير معروف";
  $("c-sci").className = "sci" + (it.sc ? "" : " none");
  $("c-meta").textContent = (it.c || "بدون شركة") + (it.b ? " · " + it.b : "");
  $("c-price").textContent = money(it.p);
  $("c-kv").innerHTML =
    ((CFG.hidecost || !can("cost")) ? cell("سعر الكلفة", "مخفي") :
      cell("سعر الكلفة", (it.k ? money(it.k) : "غير مسجّلة") + (it.pk ? " (كان " + money(it.pk) + ")" : ""))) +
    cell("هامش الربح", margin === null ? "—" : margin + "%") +
    cell("الكمية", money(it.q)) +
    cell("حد إعادة الطلب", money(it.min || 5)) +
    cell("أقرب انتهاء", nearestExp(it) || "—") +
    cell("الفئة", it.cat || "غير مصنف") +
    cell("المذخر", it.sup || "—") +
    (it.u2 ? cell("الوحدة الثانية", it.u2 + " = " + (it.u2q || 1) + " × " + (it.u2p ? money(it.u2p) : "بلا سعر")) : "");
  const f = $("c-flag"); f.className = "flag";
  const d = expDays(nearestExp(it));
  if (d !== null && d < 0) { f.textContent = "منتهي الصلاحية منذ " + Math.abs(d) + " يوماً"; f.className = "flag warn on"; }
  else if (d !== null && d < (CFG.expdays || 90)) { f.textContent = "قريب الانتهاء — يتبقى " + d + " يوماً"; f.className = "flag warn on"; }
  else if (!it.q) { f.textContent = "غير متوفر في المخزون"; f.className = "flag warn on"; }
  else if (it.k && it.p && it.p < it.k) { f.textContent = "سعر البيع أقل من الكلفة"; f.className = "flag warn on"; }
  drawAlts(it);
  $("card").classList.add("on");
  $("sug").classList.remove("on");
}

/* ---------- المخزون ---------- */
let SFILTER = "all", SPAGE = 50;
function stockList() {
  const v = $("ssearch").value.trim().toLowerCase();
  return ITEMS.filter(it => {
    if (v && !(it._n.includes(v) || it._s.includes(v) || String(it.b || "").includes(v))) return false;
    if (SFILTER === "low")     return (it.q || 0) <= (it.min || 5) && (it.q || 0) > 0;
    if (SFILTER === "zero")    return !(it.q > 0);
    if (SFILTER === "nosci")   return !it.sc;
    if (SFILTER === "noprice") return !it.p;
    if (SFILTER === "nocost")  return !it.k;
    if (SFILTER === "noexp")   return !nearestExp(it);
    if (SFILTER === "pricechg") return !!it.pk && it.pk !== it.k;
    if (SFILTER === "drug")    return (it.cat || "") === "دواء" || !!it.sc;
    if (SFILTER === "nondrug") return ["عناية شخصية وتجميل","مستلزمات طبية","مكملات وفيتامينات","محاليل ومغذيات"].includes(it.cat || "");
    if (SFILTER === "fix")     return (it.cat || "") === "يحتاج تصحيح";
    return true;
  });
}
function renderStock() {
  const list = stockList();
  $("scount").textContent = money(list.length) + " صنفاً";
  $("stockbody").innerHTML = list.slice(0, SPAGE).map(it =>
    '<tr data-id="' + it.id + '"><td><b>' + esc(it.n) + '</b>' +
    (it.sc ? '<br><small class="muted">' + esc(it.sc) + '</small>' : "") + '</td>' +
    '<td' + ((it.q || 0) <= (it.min || 5) ? ' class="warn"' : "") + '>' + money(it.q) + '</td>' +
    '<td>' + money(it.p) + '</td><td>' + (it.k ? money(it.k) : "—") + '</td></tr>').join("");
  $("more").style.display = list.length > SPAGE ? "" : "none";
}
let EDITING = null, QUICKCART = false;
function quickAdd(code, toCart) {
  openEdit(null);
  $("e-b").value = code || "";
  $("e-hint").textContent = code ? ("مادة جديدة بالباركود " + code) : "مادة جديدة";
  QUICKCART = !!toCart;
  setTimeout(() => $("e-n").focus(), 80);
}
function openEdit(it) {
  EDITING = it || { id: null, n: "", b: "", sc: "", c: "", k: 0, p: 0, q: 0, min: 5, e: "", t: "مخزون" };
  $("edittitle").textContent = it ? "تعديل صنف" : "صنف جديد";
  ["n","b","sc","c","k","p","q","min","e","b2","u2","u2q","u2p"].forEach(k => {
    const f = $("e-" + k); if (f) f.value = EDITING[k] || "";
  });
  $("e-hint").textContent = it ? ("المصدر: " + (it.ss || "—")) : "";
  const bt = (it && it.bt || []).filter(b => (b.q || 0) > 0);
  $("e-batches").innerHTML = bt.length
    ? '<label>التشغيلات</label>' + bt.map(b =>
        '<div class="sum"><span>' + (b.l ? esc(b.l) + " · " : "") + (b.e || "بلا تاريخ") +
        '</span><b>' + money(b.q) + '</b></div>').join("")
    : '<p class="muted">لا توجد تشغيلات مسجّلة — تُضاف تلقائياً عند استيراد قائمة شراء PDF.</p>';
  $("editwin").classList.add("on");
}
function saveEdit() {
  const g = k => $("e-" + k).value.trim();
  const num = k => Math.max(0, Number(String(g(k)).replace(/[^\d.]/g, "")) || 0);
  const data = { n: g("n"), b: g("b"), sc: g("sc"), c: g("c"),
                 k: num("k"), p: num("p"), q: num("q"), min: num("min") || 5, e: g("e"),
                 b2: g("b2"), u2: g("u2"), u2q: num("u2q"), u2p: num("u2p") };
  if (!data.n) return toast("الاسم مطلوب");
  if (EDITING.id) patchItem(EDITING, data);
  else {
    newExtra(Object.assign({ t: "مخزون", ss: "إدخال يدوي", cat: "غير مصنف" }, data));
    LS.set("ph.extra", EXTRA); buildItems();
    const fresh = ITEMS[ITEMS.length - 1];
    if (QUICKCART && fresh) { QUICKCART = false; addToCart(fresh); toast("أُضيفت وأُدخلت الفاتورة"); }
  }
  $("editwin").classList.remove("on");
  renderStock(); renderHome(); toast("حُفظ");
}

/* ---------- طابعة بلوتوث حرارية (ESC/POS) ---------- */
let BTCHAR = null;
async function btConnect() {
  if (!navigator.bluetooth) { toast("متصفحك لا يدعم بلوتوث الويب — استعمل كروم"); return null; }
  try {
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0x18f0] }, { services: ["000018f0-0000-1000-8000-00805f9b34fb"] },
                { namePrefix: "Printer" }, { namePrefix: "BT" }, { namePrefix: "MTP" }, { namePrefix: "POS" }],
      optionalServices: [0x18f0, "0000ffe0-0000-1000-8000-00805f9b34fb",
                         "49535343-fe7d-4ae5-8fa9-9fafd205e455"]
    });
    const srv = await dev.gatt.connect();
    for (const uuid of [0x18f0, "0000ffe0-0000-1000-8000-00805f9b34fb",
                        "49535343-fe7d-4ae5-8fa9-9fafd205e455"]) {
      try {
        const s = await srv.getPrimaryService(uuid);
        const cs = await s.getCharacteristics();
        const c = cs.find(x => x.properties.write || x.properties.writeWithoutResponse);
        if (c) { BTCHAR = c; dev.addEventListener("gattserverdisconnected", () => { BTCHAR = null; }); 
                 toast("اتصلت الطابعة: " + (dev.name || "بلوتوث")); return c; }
      } catch (e) {}
    }
    toast("لم أجد قناة كتابة في الطابعة");
  } catch (e) { toast("تعذّر الاتصال: " + (e.message || e)); }
  return null;
}
/* الوصل يُرسم صورة ثم يُرسل رستر — لضمان ظهور العربية على أي طابعة */
async function btPrintNode(node) {
  const c = BTCHAR || await btConnect(); if (!c) return false;
  const W = 384;                                   /* 58mm = 384 نقطة */
  const cv = document.createElement("canvas");
  const lines = String(node.innerText || node.textContent || '').split(String.fromCharCode(10)).filter(x => x.trim() !== "");
  const lh = 26, pad = 8;
  cv.width = W; cv.height = pad * 2 + lines.length * lh;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#000"; g.textAlign = "right"; g.direction = "rtl";
  lines.forEach((t, i) => {
    g.font = (i === 0 ? "bold 20px" : "18px") + " Tahoma, Arial";
    g.fillText(t.trim(), W - pad, pad + (i + 1) * lh - 6, W - pad * 2);
  });
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const bytesPerRow = W / 8, out = new Uint8Array(bytesPerRow * cv.height);
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, lum = (img[i] * 0.299 + img[i+1] * 0.587 + img[i+2] * 0.114);
    if (lum < 160) out[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
  }
  const header = new Uint8Array([0x1B, 0x40, 0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 255, bytesPerRow >> 8, cv.height & 255, cv.height >> 8]);
  const feed = new Uint8Array([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00]);   /* تغذية وقص */
  const all = new Uint8Array(header.length + out.length + feed.length);
  all.set(header, 0); all.set(out, header.length); all.set(feed, header.length + out.length);
  const CH = 180;
  for (let i = 0; i < all.length; i += CH) {
    const part = all.slice(i, i + CH);
    if (c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part);
    else await c.writeValue(part);
    await new Promise(r => setTimeout(r, 18));
  }
  return true;
}
function markPrinted(no) {
  const v = INVOICES.find(x => x.no === no); if (!v) return;
  v.printed = true; v.printedAt = new Date().toISOString();
  LS.set("ph.inv", INVOICES);
}
async function printReceipt(no) {
  const ok = await btPrintNode($("rc"));
  if (!ok) { try { window.print(); } catch (e) { toast("الطباعة غير مدعومة هنا"); return; } }
  if (no) { markPrinted(no); toast("طُبعت الفاتورة وسُجّلت كمباعة"); }
}

/* ---------- دليل الأسعار الرسمي ---------- */
let GUIDE = [];
function buildGuide() {
  if (typeof PRICES === "undefined") { GUIDE = []; return; }
  GUIDE = PRICES.rows.map((r, i) => ({
    i: i, n: r[0], f: r[1], m: r[2], buy: r[3], sell: r[4], _n: String(r[0]).toLowerCase()
  }));
}
function searchGuide(v) {
  const q = String(v || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const a = [], b = [];
  for (const g of GUIDE) {
    if (g._n.startsWith(q)) a.push(g);
    else if (g._n.includes(q)) b.push(g);
    if (a.length > 30) break;
  }
  return a.concat(b).slice(0, 25);
}
function renderGuide() {
  const list = searchGuide($("gsearch").value);
  $("gcount").textContent = GUIDE.length ? money(GUIDE.length) + " صنفاً في الدليل" : "";
  $("glist").innerHTML = list.length ? list.map(g =>
    '<div class="tk" data-i="' + g.i + '"><b>' + esc(g.n) + '</b>' +
    '<small>' + esc(g.f || "—") + (g.m ? " · " + esc(g.m) : "") + '</small>' +
    '<div class="lst" style="margin-top:6px">' +
      '<div class="row"><span>سعر المذخر للصيدلية</span><b>' + money(g.buy) + " " + CFG.cur + '</b></div>' +
      '<div class="row"><span>سعر البيع للمواطن</span><b>' + money(g.sell) + " " + CFG.cur + '</b></div>' +
      '<div class="row"><span>هامش الربح</span><b>' + (g.buy ? Math.round((g.sell - g.buy) / g.buy * 100) + "%" : "—") + '</b></div>' +
    '</div>' +
    '<div class="btns"><button class="main" data-act="add">إضافة للمخزون</button>' +
    '<button data-act="apply">تسعير الصنف المفتوح</button></div></div>').join("")
    : ($("gsearch").value.trim().length < 2
        ? '<p class="muted">اكتب حرفين على الأقل للبحث في دليل الأسعار الرسمي.</p>'
        : '<p class="muted">لا يوجد صنف مطابق في الدليل.</p>');
}

/* ---------- التصدير: Excel حقيقي وتقرير PDF ---------- */
async function ensureXLSX() {
  if (window.XLSX) return true;
  toast("جارٍ تحضير محرّك Excel…");
  try { await loadScript("vendor/xlsx.min.js"); }
  catch (e) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }
  return !!window.XLSX;
}
function sheetFrom(rows) { return XLSX.utils.aoa_to_sheet(rows); }
function saveWorkbook(wb, name) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (dlBlob(blob, name)) { toast("حُفظ " + name); shareBtn(blob, name); return; }
  shareBlob(blob, name).then(ok => { if (!ok) toast("تعذّر حفظ الملف — جرّب زر المشاركة أو متصفح كروم"); });
  shareBtn(blob, name);
}
async function exportDebtsXLSX() {
  if (!await ensureXLSX()) return;
  const rows = debtRows();
  const s1 = [["الزبون", "الهاتف", "الرصيد", "أيام منذ آخر حركة", "آخر حركة", "عدد الحركات"]];
  rows.forEach(c => s1.push([c.n, c.phone || "", c.bal || 0, custDays(c) === null ? "" : custDays(c),
    custLast(c) ? new Date(custLast(c)).toLocaleDateString("en-GB") : "", (c.log || []).length]));
  s1.push([]); s1.push(["الإجمالي", "", rows.reduce((a, c) => a + (c.bal || 0), 0)]);
  const s2 = [["الزبون", "التاريخ", "النوع", "المبلغ", "الملاحظة", "الرصيد بعدها"]];
  CUST.forEach(c => { let run = 0; (c.log || []).forEach(l => {
    run += l.amt;
    s2.push([c.n, new Date(l.at).toLocaleDateString("en-GB"), l.amt > 0 ? "دين" : "تسديد",
             Math.abs(l.amt), l.note || "", run]);
  }); });
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sheetFrom(s1), "الديون");
  XLSX.utils.book_append_sheet(wb, sheetFrom(s2), "كشف الحركات");
  saveWorkbook(wb, "debts-" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
async function exportAllXLSX() {
  if (!await ensureXLSX()) return;
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const inv = [["الاسم", "الباركود", "المادة الفعالة", "الشركة", "الفئة", "الكلفة", "البيع",
                "الكمية", "الحد", "أقرب انتهاء", "المذخر", "النوع"]];
  ITEMS.forEach(it => inv.push([it.n, it.b || "", it.sc || "", it.c || "", it.cat || "", it.k || 0, it.p || 0,
    it.q || 0, it.min || 5, nearestExp(it) || "", it.sup || "", it.t || "مخزون"]));
  XLSX.utils.book_append_sheet(wb, sheetFrom(inv), "المخزون");

  const sales = [["رقم", "التاريخ", "الزبون", "الدفع", "المجموع", "الخصم", "المطلوب", "النوع"]];
  INVOICES.forEach(v => sales.push([v.no, new Date(v.at).toLocaleString("en-GB"), v.who || "", v.pay || "",
    v.sub, v.disc || 0, v.total, v.kind || "بيع"]));
  XLSX.utils.book_append_sheet(wb, sheetFrom(sales), "المبيعات");

  const lines = [["رقم الفاتورة", "التاريخ", "الصنف", "الكمية", "السعر", "الإجمالي"]];
  INVOICES.forEach(v => (v.lines || []).forEach(l =>
    lines.push([v.no, new Date(v.at).toLocaleDateString("en-GB"), l.n, l.q, l.p, l.q * l.p - (l.d || 0)])));
  XLSX.utils.book_append_sheet(wb, sheetFrom(lines), "تفاصيل المبيعات");

  const deb = [["الزبون", "الهاتف", "الرصيد", "أيام منذ آخر حركة"]];
  CUST.forEach(c => deb.push([c.n, c.phone || "", c.bal || 0, custDays(c) === null ? "" : custDays(c)]));
  XLSX.utils.book_append_sheet(wb, sheetFrom(deb), "الديون");

  const pur = [["التاريخ", "المذخر", "الملف", "أصناف جديدة", "محدَّثة", "تغيّر سعر", "المبلغ"]];
  PURCH.forEach(p => pur.push([new Date(p.at).toLocaleDateString("en-GB"), p.sup, p.file,
    p.added, p.updated, p.changed || 0, p.total || 0]));
  XLSX.utils.book_append_sheet(wb, sheetFrom(pur), "المشتريات");

  const pl = [["الزبون", "تاريخ الاستحقاق", "قيمة القسط", "المسدَّد", "المتبقي"]];
  PLANS.forEach(p => p.items.forEach(q => pl.push([p.cust, q.due, q.amt, q.paid || 0, q.amt - (q.paid || 0)])));
  XLSX.utils.book_append_sheet(wb, sheetFrom(pl), "الأقساط");

  saveWorkbook(wb, "pharma-" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
function debtReportPDF() {
  const rows = debtRows();
  const total = rows.reduce((a, c) => a + (c.bal || 0), 0);
  const d = new Date();
  $("rep").innerHTML =
    '<h2 style="margin:0">' + esc(CFG.shop) + ' — تقرير الديون</h2>' +
    '<p class="muted">' + d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"}) +
      ' · ' + rows.length + ' زبوناً' + (ME ? " · " + esc(ME.n) : "") + '</p>' +
    '<table class="tbl"><thead><tr><th>الزبون</th><th>الهاتف</th><th>الرصيد</th><th>آخر حركة</th></tr></thead><tbody>' +
    rows.map(c => '<tr><td>' + esc(c.n) + '</td><td>' + esc(c.phone || "—") + '</td><td>' +
      money(c.bal) + '</td><td>' + (custDays(c) === null ? "—" : "قبل " + custDays(c) + " يوماً") + '</td></tr>').join("") +
    '</tbody></table>' +
    '<h3>الإجمالي: ' + money(total) + " " + esc(CFG.cur) + '</h3>' +
    '<p class="muted">' + tafqit(total, CFG.cur) + '</p>';
  $("reportwin").classList.add("on");
}

/* ---------- الديون: الشاشة الرئيسية ---------- */
let DFILTER = "owe";
function custLast(c) { return c.log && c.log.length ? c.log[c.log.length - 1].at : c.at || null; }
function custDays(c) {
  const l = custLast(c); if (!l) return null;
  return Math.floor((Date.now() - new Date(l).getTime()) / 86400000);
}
function debtRows() {
  const v = ($("dsearch").value || "").trim().toLowerCase();
  return CUST.filter(c => {
    if (v && !(c.n.toLowerCase().includes(v) || String(c.phone || "").includes(v))) return false;
    if (DFILTER === "owe")  return (c.bal || 0) > 0;
    if (DFILTER === "late") return (c.bal || 0) > 0 && (custDays(c) || 0) > 30;
    return true;
  }).sort((a, b) => (b.bal || 0) - (a.bal || 0));
}
function renderDebt() {
  const rows = debtRows();
  const owing = CUST.filter(c => (c.bal || 0) > 0);
  const total = owing.reduce((a, c) => a + c.bal, 0);
  const late = owing.filter(c => (custDays(c) || 0) > 30).reduce((a, c) => a + c.bal, 0);
  const today = new Date().toDateString();
  let paid = 0, paidN = 0;
  CUST.forEach(c => (c.log || []).forEach(l => {
    if (l.amt < 0 && new Date(l.at).toDateString() === today) { paid += -l.amt; paidN++; }
  }));
  const top = owing.slice().sort((a, b) => b.bal - a.bal)[0];
  $("d-total").textContent = money(total);
  $("d-count").textContent = owing.length + " مدين";
  $("d-late").textContent = money(late);
  $("d-today").textContent = money(paid);
  $("d-todayn").textContent = paidN ? paidN + " سند قبض" : "لا تحصيل بعد";
  $("d-top").textContent = top ? top.n.slice(0, 14) : "—";
  $("d-topv").textContent = top ? money(top.bal) + " " + CFG.cur : "";

  $("dlist").innerHTML = rows.length ? rows.map((c, i) => {
    const d = custDays(c), over = (c.bal || 0) > 0 && d !== null && d > 30;
    return '<div class="tk" data-n="' + esc(c.n) + '">' +
      '<b>' + esc(c.n) + ' · ' + ((c.bal || 0) > 0
        ? '<span class="' + (over ? "bad" : "warn") + '">عليه ' + money(c.bal) + " " + CFG.cur + '</span>'
        : ((c.bal || 0) < 0 ? 'له ' + money(-c.bal) : 'مسدَّد')) + '</b>' +
      '<small>' + (c.phone ? esc(c.phone) + " · " : "") +
        (d === null ? "بلا حركة" : ("آخر حركة قبل " + d + " يوماً")) +
        (over ? " · متأخر" : "") + '</small>' +
      '<div class="btns">' +
        '<button class="main" data-act="pay">تسديد</button>' +
        '<button data-act="hist">كشف</button>' +
        (c.phone ? '<button data-act="wa">واتساب</button><button data-act="call">اتصال</button>'
                 : '<button data-act="phone">إضافة هاتف</button>') +
      '</div></div>';
  }).join("") : '<p class="muted">لا يوجد مدينون في هذه القائمة.</p>';
}
function showVoucher(c, amt, before) {
  const d = new Date();
  $("vc").innerHTML =
    '<h3>سند قبض</h3>' +
    '<div class="rc-meta">' + esc(CFG.shop) + ' · ' + d.toLocaleDateString("en-GB") + " " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + '</div>' +
    '<table><tr><td>الزبون</td><td>' + esc(c.n) + '</td></tr>' +
    '<tr><td>الدين قبل التسديد</td><td>' + money(before) + '</td></tr>' +
    '<tr><td>المبلغ المستلم</td><td><b>' + money(amt) + " " + esc(CFG.cur) + '</b></td></tr>' +
    '<tr><td>الرصيد المتبقي</td><td>' + money(c.bal) + " " + esc(CFG.cur) + '</td></tr></table>' +
    '<div class="rc-tot"><small>' + tafqit(amt, CFG.cur) + '</small>' +
    (ME ? '<br><small>المستلم: ' + esc(ME.n) + '</small>' : "") + '</div>';
  $("voucher").dataset.msg = "سند قبض من " + CFG.shop + ": استلمنا " + money(amt) + " " + CFG.cur +
    " من " + c.n + ". الرصيد المتبقي " + money(c.bal) + " " + CFG.cur + ".";
  $("voucher").dataset.phone = c.phone || "";
  $("voucher").classList.add("on");
}

/* ---------- المخازن والنقل المخزني ---------- */
function whQty(it, w) {
  if (!it.wq) return (w === WH[0]) ? (it.q || 0) : 0;
  return Number(it.wq[w] || 0);
}
function whSet(it, w, v) {
  const wq = Object.assign({}, it.wq || {});
  if (!it.wq) wq[WH[0]] = it.q || 0;
  wq[w] = Math.max(0, Math.round(v));
  const total = Object.values(wq).reduce((a, n) => a + Number(n || 0), 0);
  patchItem(it, { wq: wq, q: total });
}
function transfer(it, from, to, qty) {
  if (from === to || qty <= 0) return false;
  const have = whQty(it, from);
  if (qty > have) { toast("الكمية في " + from + " هي " + have + " فقط"); return false; }
  whSet(it, from, have - qty);
  whSet(it, to, whQty(it, to) + qty);
  return true;
}
function renderWH() {
  const box = $("whlist"); if (!box) return;
  $("whsel").innerHTML = WH.map(w => '<option' + (w === AWH ? " selected" : "") + '>' + esc(w) + '</option>').join("");
  const val = {};
  WH.forEach(w => { val[w] = ITEMS.reduce((a, it) => a + whQty(it, w) * (it.k || 0), 0); });
  box.innerHTML = WH.map(w =>
    '<div class="row"><span>' + esc(w) + (w === AWH ? " · <b>الحالي</b>" : "") + '</span><b>' +
    money(Math.round(val[w])) + " " + CFG.cur + '</b></div>').join("");
}

/* ---------- الموظفون والصلاحيات ---------- */
const ROLES = {
  "مدير":    { cost: 1, price: 1, refund: 1, settings: 1, stock: 1 },
  "صيدلاني": { cost: 1, price: 1, refund: 1, settings: 0, stock: 1 },
  "كاشير":   { cost: 0, price: 0, refund: 0, settings: 0, stock: 0 }
};
function can(p) { return !ME ? true : !!(ROLES[ME.role] || ROLES["مدير"])[p]; }
function applyPerms() {
  document.querySelectorAll(".nav button[data-t=cfg]").forEach(b => b.style.display = can("settings") ? "" : "none");
  document.querySelectorAll(".nav button[data-t=stock]").forEach(b => b.style.display = can("stock") ? "" : "none");
  const who = $("whoami"); if (who) who.textContent = ME ? (ME.n + " · " + ME.role) : "";
}
function renderUsers() {
  const box = $("userlist"); if (!box) return;
  box.innerHTML = USERS.length ? USERS.map((u, i) =>
    '<div class="row"><span>' + esc(u.n) + ' · ' + esc(u.role) + '</span>' +
    '<b><button data-act="del" data-i="' + i + '">حذف</button></b></div>').join("")
    : '<p class="muted">لا يوجد موظفون — يدخل الجميع كمدير.</p>';
}

/* ---------- الأقساط والمتأخرين ---------- */
function planAdd(cust, total, count, every) {
  const per = Math.round(total / count), out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(); d.setDate(d.getDate() + every * (i + 1));
    out.push({ due: d.toISOString().slice(0, 10), amt: per, paid: 0 });
  }
  PLANS.push({ cust: cust, at: new Date().toISOString(), total: total, items: out });
  LS.set("ph.plans", PLANS);
}
function renderPlans() {
  const box = $("planlist"); if (!box) return;
  const today = new Date().toISOString().slice(0, 10);
  let late = 0, due = 0;
  const rows = [];
  PLANS.forEach((p, pi) => p.items.forEach((q, qi) => {
    if (q.paid >= q.amt) return;
    const overdue = q.due < today;
    if (overdue) late += q.amt - q.paid; else due += q.amt - q.paid;
    rows.push('<div class="tk"><b>' + esc(p.cust) + ' · ' + money(q.amt - q.paid) + " " + CFG.cur +
      (overdue ? ' <span class="warn">متأخر</span>' : "") + '</b>' +
      '<small>الاستحقاق ' + q.due + ' · قسط ' + (qi + 1) + ' من ' + p.items.length + '</small>' +
      '<div class="btns"><button data-act="paid" data-p="' + pi + '" data-q="' + qi + '">تسديد القسط</button></div></div>');
  }));
  $("planlate").textContent = money(late) + " " + CFG.cur;
  $("plandue").textContent = money(due) + " " + CFG.cur;
  box.innerHTML = rows.join("") || '<p class="muted">لا توجد أقساط مستحقة.</p>';
}

/* ---------- طباعة ملصقات الباركود (EAN-13) ---------- */
const EAN_A = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_B = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_C = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_P = ["AAAAAA","AABABB","AABBAB","AABBBA","ABAABB","ABBAAB","ABBBAA","ABABAB","ABABBA","ABBABA"];
function ean13Bits(code) {
  if (!/^\d{13}$/.test(code)) return null;
  const d = code.split("").map(Number), par = EAN_P[d[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === "A" ? EAN_A : EAN_B)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_C[d[i]];
  return bits + "101";
}
function labelHTML(it, copies) {
  const code = String(it.b || "").replace(/\D/g, "");
  const bits = ean13Bits(code);
  const bars = bits ? bits.split("").map((b, i) =>
      '<span style="display:inline-block;width:2px;height:38px;background:' + (b === "1" ? "#000" : "#fff") + '"></span>').join("")
    : '<span style="font:12px monospace">' + esc(code || "بلا باركود") + '</span>';
  let out = "";
  for (let i = 0; i < copies; i++)
    out += '<div class="label"><div class="ln">' + esc(it.n).slice(0, 34) + '</div>' +
           '<div class="bars">' + bars + '</div>' +
           '<div class="cd">' + esc(code) + '</div>' +
           '<div class="pr">' + money(it.p) + " " + esc(CFG.cur) + '</div></div>';
  return out;
}

/* ---------- المزامنة بين الأجهزة ---------- */
function syncPayload() {
  return { v: 2, at: Date.now(), patch: PATCH, extra: EXTRA, inv: INVOICES,
           held: HELD, purch: PURCH, cust: CUST, plans: PLANS, wh: WH, users: USERS };
}
function syncMerge(remote) {
  if (!remote || !remote.patch) return false;
  PATCH = Object.assign({}, remote.patch, PATCH);
  const seen = new Set(EXTRA.map(x => (x.n || "") + "|" + (x.b || "")));
  (remote.extra || []).forEach(x => { const k = (x.n || "") + "|" + (x.b || ""); if (!seen.has(k)) { newExtra(Object.assign({}, x, { uid: null })); seen.add(k); } });
  const inv = new Set(INVOICES.map(v => v.at + "|" + v.total));
  (remote.inv || []).forEach(v => { if (!inv.has(v.at + "|" + v.total)) INVOICES.push(v); });
  (remote.cust || []).forEach(rc => { if (!findCust(rc.n)) CUST.push(rc); });
  (remote.purch || []).forEach(p => { if (!PURCH.some(o => o.at === p.at)) PURCH.push(p); });
  (remote.plans || []).forEach(p => { if (!PLANS.some(o => o.at === p.at)) PLANS.push(p); });
  (remote.wh || []).forEach(w => { if (!WH.includes(w)) WH.push(w); });
  ["patch","extra","inv","held","purch","cust","plans","wh","users"].forEach((k, i) =>
    LS.set("ph." + k, [PATCH, EXTRA, INVOICES, HELD, PURCH, CUST, PLANS, WH, USERS][i]));
  buildItems(); renderHome(); renderStock(); renderCust(); renderPlans(); renderWH();
  return true;
}
async function syncNow() {
  const url = (CFG.syncurl || "").trim();
  if (!url) { toast("أدخل رابط المزامنة في الإعدادات"); return; }
  $("syncmsg").textContent = "جارٍ المزامنة…";
  try {
    const headers = { "content-type": "application/json" };
    if (CFG.synckey) headers["X-Master-Key"] = CFG.synckey;
    const g = await fetch(url, { headers: headers });
    if (g.ok) { const j = await g.json(); syncMerge(j.record || j); }
    const put = await fetch(url, { method: "PUT", headers: headers, body: JSON.stringify(syncPayload()) });
    $("syncmsg").textContent = put.ok ? "تمت المزامنة " + new Date().toLocaleTimeString("en-GB")
                                      : "تعذّر الرفع (" + put.status + ")";
  } catch (e) { $("syncmsg").textContent = "تعذّرت المزامنة: " + e.message; }
}

/* ---------- العملاء والديون ---------- */
function findCust(name) {
  const k = String(name || "").trim().toLowerCase();
  return CUST.find(c => c.n.toLowerCase() === k);
}
function custAdd(name, amt, note) {
  const nm = String(name || "").trim(); if (!nm) return null;
  let c = findCust(nm);
  if (!c) { c = { n: nm, phone: "", bal: 0, log: [] }; CUST.push(c); }
  c.bal = Math.round((c.bal || 0) + amt);
  c.log.push({ at: new Date().toISOString(), amt: amt, note: note || "" });
  LS.set("ph.cust", CUST);
  return c;
}
/* التقريب للأعلى: 2650 → 2750 (خطوة 250) أو 3000 (خطوة 500/1000) */
function roundUp(v, step) {
  const st = Number(step || CFG.upstep || 250);
  if (!v || st < 2) return Math.round(v || 0);
  return Math.ceil(v / st) * st;
}
function applyRoundUpAll() {
  const st = Number(CFG.upstep || 250);
  const list = ITEMS.filter(it => it.p > 0 && it.p % st !== 0);
  if (!list.length) return toast("كل الأسعار مقرّبة أصلاً");
  if (!confirm("تقريب سعر بيع " + money(list.length) + " صنفاً للأعلى لأقرب " + st + "؟")) return;
  let n = 0;
  list.forEach(it => { const nv = roundUp(it.p, st); if (nv !== it.p) { patchItem(it, { p: nv }); n++; } });
  renderStock(); renderHome(); toast("قُرّب سعر " + money(n) + " صنفاً");
}
function roundTo(v) {
  const r = Number(CFG.round) || 0;
  return r > 1 ? Math.round(v / r) * r : Math.round(v);
}
function renderCust() {
  const box = $("custlist"); if (!box) return;
  const owing = CUST.filter(c => (c.bal || 0) > 0).sort((a, b) => b.bal - a.bal);
  const total = owing.reduce((a, c) => a + c.bal, 0);
  $("custtotal").textContent = money(total) + " " + CFG.cur;
  box.innerHTML = CUST.length ? CUST.slice().sort((a, b) => (b.bal || 0) - (a.bal || 0)).map((c, i) =>
    '<div class="tk"><b>' + esc(c.n) + ' · ' +
    ((c.bal || 0) > 0 ? '<span class="warn">عليه ' + money(c.bal) + '</span>'
                      : ((c.bal || 0) < 0 ? 'له ' + money(-c.bal) : 'مسدَّد')) + '</b>' +
    '<small>' + (c.phone ? esc(c.phone) + " · " : "") + (c.log.length) + ' حركة · آخرها ' +
      (c.log.length ? new Date(c.log[c.log.length - 1].at).toLocaleDateString("en-GB") : "—") + '</small>' +
    '<div class="btns"><button data-act="pay" data-i="' + i + '">تسديد</button>' +
    '<button data-act="phone" data-i="' + i + '">هاتف</button>' +
    '<button data-act="hist" data-i="' + i + '">كشف</button></div></div>').join("")
    : '<p class="muted">لا يوجد عملاء بعد — تُضاف أسماؤهم تلقائياً عند البيع بالدين.</p>';
}

/* ---------- سجل المشتريات والمذاخر ---------- */
function renderPurch() {
  const box = $("purch"); if (!box) return;
  if (!PURCH.length) { box.innerHTML = '<p class="muted">لم تُستورد قوائم شراء بعد.</p>'; return; }
  const bySup = {};
  PURCH.forEach(p => { bySup[p.sup] = (bySup[p.sup] || 0) + (p.total || 0); });
  box.innerHTML =
    '<div class="lst">' + Object.keys(bySup).sort((a, b) => bySup[b] - bySup[a]).map(sup =>
      '<div class="row"><span>' + esc(sup) + '</span><b>' + money(bySup[sup]) + " " + CFG.cur + '</b></div>').join("") + '</div>' +
    '<h4 style="margin-top:12px">آخر القوائم</h4>' +
    PURCH.slice(-10).reverse().map(p =>
      '<div class="tk"><b>' + esc(p.sup) + ' · ' + money(p.total) + " " + CFG.cur + '</b>' +
      '<small>' + new Date(p.at).toLocaleDateString("en-GB") + " · " + esc(p.file) +
      " · جديد " + p.added + " · محدَّث " + p.updated +
      (p.changed ? " · تغيّر سعر " + p.changed : "") + '</small></div>').join("");
}

/* ---------- التنبيهات ---------- */
function renderAlerts() {
  const expd = [], soon = [], low = [], zero = [], nop = [], loss = [];
  ITEMS.forEach(it => {
    const d = expDays(nearestExp(it));
    if (d !== null && d < 0) expd.push(it);
    else if (d !== null && d < (CFG.expdays || 90)) soon.push(it);
    if (!(it.q > 0)) zero.push(it);
    else if ((it.q || 0) <= (it.min || 5)) low.push(it);
    if (!it.p) nop.push(it);
    else if (it.k && it.p < it.k) loss.push(it);
  });
  const rows = (arr, extra) => arr.slice(0, 60).map(it =>
    '<div class="row" data-id="' + it.id + '" style="cursor:pointer"><span>' + esc(it.n) + '</span><b>' + extra(it) + '</b></div>').join("")
    || '<p class="muted">لا يوجد</p>';
  const sec = (t, body) => '<div class="panel"><h4>' + t + '</h4><div class="lst">' + body + '</div></div>';
  $("alerts").innerHTML =
    sec("منتهية الصلاحية (" + expd.length + ")", rows(expd, it => nearestExp(it))) +
    sec("قريبة الانتهاء (" + soon.length + ")", rows(soon, it => nearestExp(it) + " · " + expDays(nearestExp(it)) + " يوماً")) +
    sec("تحتاج إعادة طلب (" + low.length + ")", rows(low, it => "المتوفر " + it.q + " / الحد " + (it.min || 5))) +
    sec("نفدت (" + zero.length + ")", rows(zero, it => "0")) +
    sec("بلا سعر بيع (" + nop.length + ")", rows(nop, it => it.k ? "الكلفة " + money(it.k) : "—")) +
    sec("البيع أقل من الكلفة (" + loss.length + ")", rows(loss, it => money(it.p) + " < " + money(it.k)));
}

/* ---------- الذكاء الاصطناعي: عبر خادم الاشتراك أو بمفتاح خاص ---------- */
/* ضع هنا رابط الـWorker قبل توليد الـAPK فلا يحتاج الزبون غير كود الاشتراك */
const AI_URL_DEFAULT = "";
const AI_SYS = "أنت مساعد صيدلاني في العراق. أجب بالعربية باختصار ودقة، ونبّه إلى ما يستدعي مراجعة الطبيب.";
let AIQ = LS.get("ph.aiq", null);          /* آخر حالة اشتراك معروفة */

function deviceId() {
  let d = LS.get("ph.dev", "");
  if (!d) { d = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); LS.set("ph.dev", d); }
  return d;
}
const aiURL  = () => String(CFG.aiurl || AI_URL_DEFAULT || "").replace(/\/+$/, "");
const aiMode = () => (aiURL() && CFG.lic) ? "lic" : (CFG.key ? "key" : "none");

async function aiPost(path, body) {
  const res = await fetch(aiURL() + path, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let d = {}; try { d = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(d.error || ("تعذّر الاتصال بخادم الاشتراك (" + res.status + ")"));
  return d;
}
function setQuota(d) {
  if (d && d.left != null) { AIQ = { until: d.until || (AIQ && AIQ.until), left: d.left,
                                     quota: d.quota || (AIQ && AIQ.quota), at: Date.now() };
                             LS.set("ph.aiq", AIQ); drawQuota(); }
}
function drawQuota() {
  const el = $("licmsg"); if (!el) return;
  if (aiMode() === "key") { el.textContent = "يعمل بمفتاح خاص (وضع المطوّر)"; return; }
  if (!AIQ) { el.textContent = CFG.lic ? "لم يُفعَّل بعد — اضغط تفعيل" : "غير مفعّل"; return; }
  el.textContent = "مفعّل ✓" + (AIQ.until ? " حتى " + AIQ.until : "") +
                   (AIQ.left != null ? " · المتبقي هذا الشهر: " + AIQ.left + " طلب" : "");
}
async function activateLic() {
  const code = ($("cfg-lic").value || "").trim().toUpperCase();
  const url  = ($("cfg-aiurl").value || "").trim() || AI_URL_DEFAULT;
  if (!code) return toast("أدخل كود الاشتراك");
  if (!url)  return toast("أدخل رابط خادم الاشتراك");
  CFG.lic = code; CFG.aiurl = url; LS.set("ph.cfg", CFG);
  $("licmsg").textContent = "جارٍ التفعيل…";
  try {
    const d = await aiPost("/activate", { code, device: deviceId(), shop: CFG.shop });
    setQuota(d); drawQuota(); toast("تم تفعيل الاشتراك");
  } catch (e) { $("licmsg").textContent = e.message; }
}
async function ai(prompt, sys, maxTok) {
  const mode = aiMode();
  if (mode === "none") { go("cfg"); throw new Error("فعّل الاشتراك من الإعدادات لتشغيل المساعد الذكي"); }
  if (mode === "lic") {
    const d = await aiPost("/ai", { code: CFG.lic, device: deviceId(), prompt: prompt,
                                    system: sys || AI_SYS, max_tokens: maxTok || 800 });
    setQuota(d);
    return d.text || "";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": CFG.key,
               "anthropic-version": "2023-06-01",
               "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: CFG.model || "claude-sonnet-4-5", max_tokens: maxTok || 800,
      system: sys || AI_SYS, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error("خطأ " + res.status + " — تحقق من المفتاح أو الاتصال");
  const d = await res.json();
  return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
}
function aiOut(t) { $("aiout").textContent = t; $("aiout").classList.add("on"); }
async function askAI() {
  const q = $("aiq").value.trim(); if (!q) return;
  aiOut("…");
  const ctx = PICK ? "الصنف المعروض: " + PICK.n + (PICK.sc ? " (المادة: " + PICK.sc + ")" : "") + ". " : "";
  try { aiOut(await ai(ctx + q)); } catch (e) { aiOut(e.message); }
}
async function aiSci() {
  if (!PICK) return toast("اختر صنفاً أولاً");
  aiOut("…");
  try {
    const t = await ai("ما المادة الفعالة لهذا المستحضر؟ اكتب الاسم العلمي بالإنجليزية فقط، وإن لم تكن متأكداً اكتب: غير معروف\n" + PICK.n,
                       "أنت مرجع دوائي دقيق. لا تخمّن.", 120);
    const v = t.trim().split("\n")[0];
    aiOut(v);
    if (v && !/غير معروف/.test(v) && confirm("حفظ «" + v + "» كاسم علمي؟")) {
      patchItem(PICK, { sc: v, ss: "المساعد الدوائي" }); show(PICK); toast("حُفظ");
    }
  } catch (e) { aiOut(e.message); }
}
async function aiBatch() {
  const todo = ITEMS.filter(it => !it.sc && (it.q || 0) > 0).slice(0, 25);
  if (!todo.length) return toast("لا توجد أصناف بحاجة إلى مادة فعالة");
  aiOut("جارٍ تحديد المادة الفعالة لـ " + todo.length + " صنفاً…");
  try {
    const t = await ai("لكل سطر أدناه اكتب: الرقم|المادة الفعالة بالإنجليزية. إن لم تكن متأكداً اكتب: الرقم|غير معروف. بلا أي شرح.\n"
      + todo.map((it, i) => (i + 1) + ") " + it.n).join("\n"), "أنت مرجع دوائي دقيق. لا تخمّن.", 1200);
    let n = 0;
    t.split("\n").forEach(line => {
      const m = line.match(/^\s*(\d+)\s*[|:\-]\s*(.+)$/); if (!m) return;
      const it = todo[+m[1] - 1], v = m[2].trim();
      if (it && v && !/غير معروف/.test(v)) { patchItem(it, { sc: v, ss: "المساعد الدوائي" }); n++; }
    });
    buildItems(); aiOut("أُضيفت المادة الفعالة لـ " + n + " صنفاً من " + todo.length + ". كرّر الضغط لدفعة أخرى.");
    renderStock();
  } catch (e) { aiOut(e.message); }
}
/* ---------- نافذة عرض عامة ---------- */
function info(title, html) {
  $("infotitle").textContent = title;
  $("infobody").innerHTML = html;
  $("infowin").classList.add("on");
}
const aiWait = '<p class="muted">جارٍ التحليل بالذكاء الاصطناعي…</p>';

/* ---------- بدائل بنفس المادة الفعالة (فوري، بلا إنترنت) ---------- */
function altsFor(it) {
  const sc = String(it.sc || "").trim().toLowerCase();
  if (!sc) return [];
  return ITEMS.filter(x => x.id !== it.id && (x.q || 0) > 0 &&
                           String(x.sc || "").trim().toLowerCase() === sc)
              .sort((a, b) => (a.p || 0) - (b.p || 0)).slice(0, 6);
}
function drawAlts(it) {
  const box = $("c-alt"); if (!box) return;
  const a = altsFor(it);
  if (!a.length) { box.innerHTML = ""; box.classList.remove("on"); return; }
  box.innerHTML = '<i>بدائل متوفرة بنفس المادة الفعالة</i>' +
    a.map(x => '<div class="row" data-id="' + x.id + '"><span>' + esc(x.n) + '</span>' +
      '<b>' + money(x.p) + " " + esc(CFG.cur) + ' · ' + money(x.q) + '</b></div>').join("");
  box.classList.add("on");
}

/* ---------- الطلبية الذكية ---------- */
let ORDER = [];
function soldMap(days) {
  const from = Date.now() - days * 86400000, m = {};
  INVOICES.forEach(v => {
    if (v.kind === "مرتجع" || new Date(v.at).getTime() < from) return;
    (v.lines || []).forEach(l => { const k = l.id || l.n; m[k] = (m[k] || 0) + (l.q || 0); });
  });
  return m;
}
function orderRows(cover) {
  cover = cover || Number(CFG.cover) || 30;
  const sold = soldMap(30), out = [];
  ITEMS.forEach(it => {
    const s = sold[it.id] || sold[it.n] || 0;
    if (!s && !(it.q > 0)) return;                       /* أصناف لا تتعامل بها الصيدلية */
    const rate = s / 30;
    const need = Math.ceil(rate * cover) - (it.q || 0);
    const low  = (it.q || 0) <= (it.min || 5);
    const qty  = Math.max(need > 0 ? need : 0, low ? Math.max(0, (it.min || 5) - (it.q || 0)) : 0);
    if (qty <= 0) return;
    out.push({ it: it, sold: s, qty: qty, cost: (it.k || 0) * qty,
               days: rate > 0 ? Math.floor((it.q || 0) / rate) : null });
  });
  return out.sort((a, b) => (b.sold - a.sold) || (b.cost - a.cost));
}
function renderOrder() {
  ORDER = orderRows();
  if (!ORDER.length) return info("الطلبية المقترحة",
    '<p class="muted">لا يوجد ما يستدعي الطلب الآن — لا أصناف تحت الحد ولا نفاد متوقع خلال ' +
    (Number(CFG.cover) || 30) + ' يوماً.</p>');
  const by = {};
  ORDER.forEach(r => { const k = r.it.sup || "غير محدد"; (by[k] = by[k] || []).push(r); });
  const total = ORDER.reduce((a, r) => a + r.cost, 0);
  const html =
    '<p class="muted">مبنية على مبيعات آخر ٣٠ يوماً وتغطية ' + (Number(CFG.cover) || 30) +
    ' يوماً والحد الأدنى لكل صنف.</p>' +
    Object.keys(by).map(sup =>
      '<h4 style="margin:12px 0 6px">' + esc(sup) + ' <small class="muted">(' + by[sup].length + ' صنف)</small></h4>' +
      '<table class="tbl"><thead><tr><th>الصنف</th><th>المتوفر</th><th>بيع ٣٠ يوم</th><th>يكفي</th><th>الطلب</th><th>الكلفة</th></tr></thead><tbody>' +
      by[sup].map(r => '<tr><td>' + esc(r.it.n) + '</td><td>' + money(r.it.q || 0) + '</td><td>' + money(r.sold) +
        '</td><td>' + (r.days === null ? "—" : r.days + " يوم") + '</td><td><b>' + money(r.qty) +
        '</b></td><td>' + (r.cost ? money(r.cost) : "—") + '</td></tr>').join("") +
      '</tbody></table>').join("") +
    '<h3 style="margin-top:12px">الكلفة التقديرية: ' + money(total) + " " + esc(CFG.cur) + '</h3>' +
    '<div class="btns"><button class="main" id="ord-xls">تصدير Excel</button>' +
    '<button id="ord-copy">نسخ النص</button>' +
    '<button id="ord-ai" class="dark">ترتيب بالأولوية (AI)</button></div>' +
    '<div id="ord-ai-out"></div>';
  info("الطلبية المقترحة", html);
  $("ord-xls").onclick  = orderXLSX;
  $("ord-copy").onclick = () => {
    const t = orderText();
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast("نُسخت الطلبية")).catch(() => toast("تعذّر النسخ"));
  };
  $("ord-ai").onclick = orderAI;
}
function orderText() {
  const by = {};
  ORDER.forEach(r => { const k = r.it.sup || "غير محدد"; (by[k] = by[k] || []).push(r); });
  return "طلبية " + CFG.shop + " — " + new Date().toLocaleDateString("en-GB") + "\n" +
    Object.keys(by).map(sup => sup + ":\n" +
      by[sup].map(r => "• " + r.it.n + " × " + r.qty).join("\n")).join("\n\n");
}
async function orderXLSX() {
  if (!await ensureXLSX()) return;
  const rows = [["الصنف", "الباركود", "المذخر", "المتوفر", "بيع ٣٠ يوم", "الكمية المطلوبة", "الكلفة التقديرية"]];
  ORDER.forEach(r => rows.push([r.it.n, r.it.b || "", r.it.sup || "", r.it.q || 0, r.sold, r.qty, r.cost]));
  rows.push([]); rows.push(["الإجمالي", "", "", "", "", "", ORDER.reduce((a, r) => a + r.cost, 0)]);
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows), "الطلبية");
  saveWorkbook(wb, "order-" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
async function orderAI() {
  const out = $("ord-ai-out"); out.innerHTML = aiWait;
  const list = ORDER.slice(0, 40).map(r =>
    r.it.n + " | متوفر " + (r.it.q || 0) + " | بيع30 " + r.sold + " | مقترح " + r.qty +
    " | كلفة " + r.cost).join("\n");
  try {
    const t = await ai("هذه طلبية شراء مقترحة لصيدلية. رتّبها بثلاث مجموعات: (عاجل الآن) و(هذا الأسبوع) و(يمكن تأجيله)، " +
      "واذكر سطراً واحداً لكل مجموعة يبرّر السبب، ثم اقترح كيف يقلّل الصيدلي الكلفة دون نفاد. بلا مقدمات.\n" + list,
      "أنت مستشار إدارة مخزون صيدليات. أجب بالعربية بنقاط قصيرة.", 900);
    out.innerHTML = '<div class="out on">' + esc(t) + '</div>';
  } catch (e) { out.innerHTML = '<p class="bad">' + esc(e.message) + '</p>'; }
}

/* ---------- فحص الفاتورة قبل البيع ---------- */
function cartDupes() {
  const by = {};
  CART.forEach(l => {
    const it = ITEMS.find(x => x.id === l.id);
    const sc = String((it && it.sc) || "").trim().toLowerCase();
    if (!sc) return; (by[sc] = by[sc] || []).push(l.n);
  });
  return Object.keys(by).filter(k => by[k].length > 1).map(k => ({ sc: k, names: by[k] }));
}
async function cartCheck() {
  if (!CART.length) return toast("الفاتورة فارغة");
  const dup = cartDupes();
  const head = dup.length
    ? '<div class="flag warn on">ازدواج بالمادة الفعالة: ' +
      dup.map(d => esc(d.sc) + " (" + d.names.map(esc).join(" + ") + ")").join(" · ") + '</div>'
    : '<p class="muted">لا يوجد ازدواج في المادة الفعالة.</p>';
  info("فحص الفاتورة", head + aiWait);
  const list = CART.map(l => {
    const it = ITEMS.find(x => x.id === l.id);
    return "- " + l.n + (it && it.sc ? " (" + it.sc + ")" : "");
  }).join("\n");
  try {
    const t = await ai("أدوية تُصرف معاً لمريض واحد. اذكر باختصار: التداخلات المهمة سريرياً، الازدواج العلاجي، " +
      "وما يستوجب مراجعة الطبيب. إن لم يوجد شيء مهم فاكتب: لا توجد تداخلات مهمة.\n" + list,
      "أنت صيدلاني سريري دقيق. أجب بالعربية بنقاط قصيرة ولا تخمّن.", 700);
    info("فحص الفاتورة", head + '<div class="out on">' + esc(t) + '</div>' +
         '<p class="muted">إرشادي ولا يغني عن المصادر الدوائية المعتمدة ورأي الطبيب.</p>');
  } catch (e) { info("فحص الفاتورة", head + '<p class="bad">' + esc(e.message) + '</p>'); }
}

/* ---------- تحليل أداء الصيدلية ---------- */
async function aiInsights() {
  info("تحليل الأداء", aiWait);
  const sold = soldMap(30);
  const top = Object.keys(sold).sort((a, b) => sold[b] - sold[a]).slice(0, 15);
  const inv30 = INVOICES.filter(v => new Date(v.at).getTime() > Date.now() - 30 * 86400000);
  const rev = inv30.reduce((a, v) => a + (v.total || 0), 0);
  const dead = ITEMS.filter(it => (it.q || 0) > 0 && !sold[it.id] && !sold[it.n]);
  const deadVal = dead.reduce((a, it) => a + (it.k || 0) * (it.q || 0), 0);
  const soon = ITEMS.filter(it => { const d = expDays(nearestExp(it)); return d !== null && d >= 0 && d < 120 && (it.q || 0) > 0; });
  const q = "أرقام صيدلية خلال ٣٠ يوماً:\n" +
    "- عدد الفواتير: " + inv30.length + "\n- المبيعات: " + rev + " " + CFG.cur +
    "\n- متوسط الفاتورة: " + (inv30.length ? Math.round(rev / inv30.length) : 0) +
    "\n- أصناف راكدة (متوفرة ولم تُبع): " + dead.length + " بكلفة " + deadVal +
    "\n- أصناف تنتهي خلال ١٢٠ يوماً: " + soon.length +
    "\n- الأكثر مبيعاً: " + top.map(k => { const it = ITEMS.find(x => x.id === k); return (it ? it.n : k) + "×" + sold[k]; }).join("، ") +
    "\nأعطني ٥ ملاحظات عملية قابلة للتنفيذ هذا الأسبوع لزيادة الربح وتقليل الخسارة، بلا مقدمات.";
  try {
    const t = await ai(q, "أنت مستشار إدارة صيدليات في العراق. أجب بالعربية بخمس نقاط قصيرة ومحددة.", 900);
    info("تحليل الأداء",
      '<div class="kv"><div><i>فواتير ٣٠ يوم</i>' + money(inv30.length) + '</div>' +
      '<div><i>المبيعات</i>' + money(rev) + " " + esc(CFG.cur) + '</div>' +
      '<div><i>أصناف راكدة</i>' + money(dead.length) + '</div>' +
      '<div><i>كلفة الراكد</i>' + money(deadVal) + '</div></div>' +
      '<div class="out on">' + esc(t) + '</div>');
  } catch (e) { info("تحليل الأداء", '<p class="bad">' + esc(e.message) + '</p>'); }
}

function suggestPrice() {
  const k = Number($("e-k").value) || 0;
  if (!k) return toast("أدخل الكلفة أولاً");
  const m = Number(CFG.margin) || 25;
  $("e-p").value = roundUp(k * (1 + m / 100));
  $("e-hint").textContent = "اقتراح بهامش " + m + "% مقرَّب للأعلى لأقرب " + (CFG.upstep || 250);
}

/* ---------- إدارة النوافذ: زر إغلاق، زر رجوع الهاتف، اللمس خارجها ---------- */
const HIST = (() => {            /* بعض المتصفحات تمنع history على ملفات file:// */
  try { history.replaceState({ modal: null }, ""); return true; } catch (e) { return false; }
})();
function modalsInit() {
  document.querySelectorAll(".modal").forEach(m => {
    if (m.id === "lockwin") return;                     /* شاشة القفل لا تُغلق */
    const sheet = m.querySelector(".sheet");
    if (sheet && !sheet.querySelector(".xclose")) {
      const x = document.createElement("button");
      x.className = "xclose"; x.type = "button"; x.textContent = "✕";
      x.setAttribute("aria-label", "إغلاق");
      x.onclick = () => closeModal(m);
      sheet.insertBefore(x, sheet.firstChild);
    }
    m.addEventListener("click", e => { if (e.target === m) closeModal(m); });
    if (HIST) new MutationObserver(() => {
      try {
        if (m.classList.contains("on") && (!history.state || history.state.modal !== m.id))
          history.pushState({ modal: m.id }, "");
      } catch (e) {}
    }).observe(m, { attributes: true, attributeFilter: ["class"] });
  });
  window.addEventListener("popstate", () => {
    const open = [...document.querySelectorAll(".modal.on")].filter(m => m.id !== "lockwin");
    if (open.length) {
      open.forEach(m => m.classList.remove("on"));
      try { history.pushState({ modal: null }, ""); } catch (e) {}
    }
  });
}
function closeModal(m) {
  m.classList.remove("on");
  try { if (HIST && history.state && history.state.modal === m.id) history.back(); } catch (e) {}
}

/* ---------- القفل برمز PIN ---------- */
let LOCKED = false, IDLE_T = null;
function lock() {
  if (!CFG.pin) return;
  LOCKED = true; $("lockpin").value = ""; $("lockwin").classList.add("on");
  setTimeout(() => $("lockpin").focus(), 60);
}
function unlock() {
  const v = $("lockpin").value.trim();
  const u = USERS.find(x => String(x.pin) === v);
  if (u) { ME = u; applyPerms(); }
  else if (v !== String(CFG.pin)) { $("lockmsg").textContent = "رمز غير صحيح"; return; }
  else { ME = null; applyPerms(); }
  LOCKED = false; $("lockmsg").textContent = ""; $("lockwin").classList.remove("on"); resetIdle();
}
function resetIdle() {
  clearTimeout(IDLE_T);
  const mins = Number(CFG.lockmin) || 0;
  if (CFG.pin && mins) IDLE_T = setTimeout(lock, mins * 60000);
}

/* ---------- قارئ باركود خارجي (USB OTG أو بلوتوث HID) ----------
   هذه القارئات تعمل كلوحة مفاتيح: تكتب الرقم بسرعة ثم Enter.
   نلتقط الضربات السريعة في أي مكان بالتطبيق ونعاملها كمسح. */
let SCAN_BUF = "", SCAN_T = 0, LAST_HW = "";
function hwScanInit() {
  let pending = null;
  const flush = (code) => {
    if (!code || code.length < 4) return;
    if (typeof checkDigitOK === "function" && !checkDigitOK(code)) {
      /* رمز ناقص أو مشوّه — لا يُقبل */
      toast("قراءة باركود غير مكتملة (" + code + ") — أعد المسح");
      return;
    }
    if (typeof acceptCode === "function" && !acceptCode(code)) return;   /* منع التكرار */
    LAST_HW = code;
    const el = document.activeElement;
    if (el && el.tagName === "INPUT") el.value = "";
    SCANMODE = document.body.classList.contains("cashier") ||
               document.getElementById("pg-sale").classList.contains("on") ? "sale" : "search";
    onCode(code);
  };
  document.addEventListener("keydown", e => {
    if (CFG.hw === false) return;
    const now = Date.now(), gap = now - SCAN_T;
    SCAN_T = now;
    if (e.key === "Enter" || e.key === "Tab") {
      const code = SCAN_BUF;
      if (code.length >= 4) {
        e.preventDefault();
        clearTimeout(pending);
        if (typeof checkDigitOK === "function" && !checkDigitOK(code) && code.length < 13) {
          /* قد تكون بقية الرمز في الطريق — انتظر لحظة ثم قرّر */
          pending = setTimeout(() => { flush(SCAN_BUF || code); SCAN_BUF = ""; }, 260);
        } else { SCAN_BUF = ""; flush(code); }
      } else SCAN_BUF = "";
      return;
    }
    if (e.key.length !== 1) return;
    if (gap > 250) SCAN_BUF = "";        /* نافذة أوسع: القارئات البطيئة لا تُقطع */
    SCAN_BUF += e.key;
    if (SCAN_BUF.length > 32) SCAN_BUF = SCAN_BUF.slice(-32);
    clearTimeout(pending);
    pending = setTimeout(() => {          /* بعض القارئات لا ترسل Enter */
      const code = SCAN_BUF;
      if (code.length >= 8) { SCAN_BUF = ""; flush(code); }
    }, 320);
  });
}


/* ---------- وضع الكاشير وتقفيل الوردية ---------- */
function setCashier(on) {
  document.body.classList.toggle("cashier", on);
  if (on) { go("sale"); setTimeout(() => $("psearch").focus(), 60); }
  LS.set("ph.cashier", on);
}
function todayInvoices() {
  const t = new Date().toDateString();
  return INVOICES.filter(v => new Date(v.at).toDateString() === t);
}
function renderShift() {
  const inv = todayInvoices();
  const sales = inv.filter(v => v.kind !== "مرتجع");
  const refs  = inv.filter(v => v.kind === "مرتجع");
  const by = {};
  sales.forEach(v => { const m = v.pay || "نقد"; by[m] = (by[m] || 0) + v.total; });
  const gross = sales.reduce((a, v) => a + v.sub, 0);
  const disc  = sales.reduce((a, v) => a + (v.disc || 0), 0);
  const net   = sales.reduce((a, v) => a + v.total, 0);
  const back  = refs.reduce((a, v) => a + Math.abs(v.total), 0);
  const qty   = sales.reduce((a, v) => a + v.lines.reduce((x, l) => x + l.q, 0), 0);
  const line = (k, v, b) => '<div class="sum"><span>' + k + '</span>' + (b ? '<b>' : '<span>') + v + (b ? '</b>' : '</span>') + '</div>';
  $("shiftbody").innerHTML =
    '<p class="muted">' + new Date().toLocaleDateString("en-GB") + " · " + CFG.shop + '</p>' +
    line("عدد الفواتير", sales.length) +
    line("عدد القطع المباعة", money(qty)) +
    line("إجمالي المبيعات", money(gross) + " " + CFG.cur) +
    line("الخصومات", money(disc) + " " + CFG.cur) +
    line("المرتجعات", money(back) + " (" + refs.length + ")") +
    Object.keys(by).map(m => line("تحصيل " + m, money(by[m]) + " " + CFG.cur)).join("") +
    line("الصافي", money(net - back) + " " + CFG.cur, true) +
    '<p class="muted" style="margin-top:8px">' + tafqit(Math.max(0, net - back), CFG.cur) + '</p>';
  $("shiftwin").classList.add("on");
}

/* ---------- نسخ احتياطية ---------- */
/* التنزيل داخل تطبيقات WebView قد يكون معطّلاً، فنوفّر بدائل */
function dlBlob(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) { return false; }
}
/* داخل تطبيق APK قد يكون التنزيل معطّلاً — نعرض المشاركة كبديل */
async function shareBlob(blob, name) {
  try {
    if (navigator.share && navigator.canShare && typeof File === "function") {
      const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
    }
  } catch (e) {}
  return false;
}
function shareBtn(blob, name) {
  if (!(navigator.share && navigator.canShare)) return;
  const el = $("sharebar"); if (!el) return;
  el.innerHTML = '<button class="main" id="sharebtn" type="button">إرسال ' + esc(name) + '</button>' +
                 '<button class="x" id="sharex" type="button">✕</button>';
  el.classList.add("on");
  $("sharebtn").onclick = async () => {
    if (!await shareBlob(blob, name)) toast("تعذّرت المشاركة على هذا الجهاز");
  };
  $("sharex").onclick = () => el.classList.remove("on");
  clearTimeout(shareBtn._t); shareBtn._t = setTimeout(() => el.classList.remove("on"), 60000);
}
function saveFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  if (dlBlob(blob, name)) { toast("حُفظ الملف: " + name); shareBtn(blob, name); return true; }
  shareBlob(blob, name).then(ok => {
    if (ok) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => toast("تعذّر التنزيل — نُسخ المحتوى، الصقه في ملف نصي"))
        .catch(() => toast("تعذّر حفظ الملف على هذا الجهاز"));
    } else toast("تعذّر حفظ الملف على هذا الجهاز");
  });
  return false;
}
/* النسخة الاحتياطية = كل شيء: المخزون والفواتير والديون والأقساط والمخازن والموظفون */
function backupData() {
  return Object.assign(syncPayload(), { app: "TIRYAQ", v: 3, cfg: CFG, awh: AWH, seq: SEQ });
}
function backup() {
  saveFile("tiryaq-backup-" + new Date().toISOString().slice(0, 10) + ".json",
           JSON.stringify(backupData()), "application/json");
}
function askShop() {
  const v = (prompt("مرحباً بك في " + BRAND + "\nاسم صيدليتك كما تريده أن يظهر على الوصولات والتقارير:", "") || "").trim();
  CFG.shop = v || "صيدليتي";
  LS.set("ph.cfg", CFG);
  $("shopname").textContent = CFG.shop;
  const f = $("cfg-shop"); if (f) f.value = CFG.shop;
}
function refreshAll() {
  buildItems(); renderHome(); renderStock(); renderPurch(); renderCust();
  renderWH(); renderPlans(); renderUsers(); renderDebt(); renderTickets(); renderCart();
}
async function restore(f) {
  let d;
  try { d = JSON.parse(await f.text()); }
  catch (e) { return toast("الملف ليس نسخة احتياطية سليمة (JSON غير صالح)"); }
  if (!d || typeof d !== "object" || (!d.patch && !d.extra && !d.inv && !d.cust))
    return toast("الملف لا يحتوي بيانات الصيدلية");
  const info = "الأصناف المضافة: " + ((d.extra || []).length) +
               " · الفواتير: " + ((d.inv || []).length) +
               " · الزبائن: " + ((d.cust || []).length) +
               (d.at ? "\nتاريخ النسخة: " + new Date(d.at).toLocaleString("en-GB") : "");
  if (!confirm("ستُستبدل بيانات هذا الجهاز بمحتوى النسخة.\n" + info + "\n\nمتابعة؟")) return;
  try {
    const keep = (v, cur) => (v === undefined || v === null ? cur : v);
    PATCH    = keep(d.patch, PATCH);
    EXTRA    = keep(d.extra, EXTRA);
    INVOICES = keep(d.inv,   INVOICES);
    HELD     = keep(d.held,  HELD);
    PURCH    = keep(d.purch, PURCH);
    CUST     = keep(d.cust,  CUST);
    PLANS    = keep(d.plans, PLANS);
    WH       = keep(d.wh,    WH);
    USERS    = keep(d.users, USERS);
    AWH      = keep(d.awh,   AWH);
    CFG      = Object.assign(CFG, d.cfg || {});
    if (typeof d.seq === "number" && d.seq > SEQ) SEQ = d.seq;
    const map = { patch: PATCH, extra: EXTRA, inv: INVOICES, held: HELD, purch: PURCH,
                  cust: CUST, plans: PLANS, wh: WH, users: USERS, awh: AWH, cfg: CFG, seq: SEQ };
    Object.keys(map).forEach(k => LS.set("ph." + k, map[k]));
    refreshAll();
    toast("استُعيدت النسخة" + (d.plans === undefined ? " — نسخة قديمة: الأقساط والموظفون بقيا كما هما" : ""));
  } catch (e) { toast("تعذّرت الاستعادة: " + (e.message || e)); }
}
function exportCSV() {
  const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const view = stockList();
  let rows = ITEMS, tag = "all";
  if (view.length !== ITEMS.length) {
    if (confirm("تصدير النتائج المعروضة فقط (" + view.length + " صنفاً)؟\n\nإلغاء = تصدير المخزون كاملاً (" + ITEMS.length + " صنفاً)"))
      { rows = view; tag = "view"; }
  }
  const head = ["الاسم","الباركود","الاسم العلمي","الشركة","الكلفة","البيع","الكمية","الحد","أقرب انتهاء","المذخر","النوع"];
  const body = rows.map(it => [it.n, it.b, it.sc, it.c, it.k, it.p, it.q, it.min, nearestExp(it), it.sup || "", it.t].map(q).join(","));
  saveFile("stock-" + tag + "-" + new Date().toISOString().slice(0, 10) + ".csv",
           "\uFEFF" + [head.map(q).join(",")].concat(body).join("\r\n"), "text/csv;charset=utf-8");
}

/* ---------- التشغيل ---------- */
function tick() {
  const d = new Date();
  $("clock").textContent = d.toLocaleDateString("en-GB") + " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function applySafe() {
  const r = document.documentElement.style;
  r.setProperty("--safet", (Number(CFG.safet) || 0) + "px");
  r.setProperty("--safeb", (Number(CFG.safeb) || 0) + "px");
}
function init() {
  console.time && console.time("boot");
  buildItems();
  if (!ITEMS.length) {
    const wrn = $("loadwarn"); if (wrn) wrn.style.display = "block";
  }
  if (typeof PRICES === "undefined") {
    const gb = document.querySelector('.nav button[data-t=guide]'); if (gb) gb.style.display = "none";
  }
  applySafe();
  $("shopname").textContent = CFG.shop || BRAND;
  if (!CFG.shop) setTimeout(askShop, 900);          /* أول تشغيل: اسم الصيدلية يُطبع على كل وصل */
  $("cfg-shop").value = CFG.shop; $("cfg-cur").value = CFG.cur;
  $("cfg-margin").value = CFG.margin; $("cfg-expdays").value = CFG.expdays;
  $("cfg-key").value = CFG.key; $("cfg-model").value = CFG.model;
  $("cfg-lic").value = CFG.lic || ""; $("cfg-aiurl").value = CFG.aiurl || AI_URL_DEFAULT;
  $("cfg-cover").value = CFG.cover || 30;
  drawQuota();
  $("cfg-safet").value = CFG.safet || 0; $("cfg-safeb").value = CFG.safeb || 0;
  $("cfg-scan").value = CFG.scan || "balanced";
  $("cfg-upstep").value = CFG.upstep || 250;
  $("cfg-round").value = CFG.round || 0; $("cfg-hidecost").checked = !!CFG.hidecost;
  $("cfg-syncurl").value = CFG.syncurl || ""; $("cfg-synckey").value = CFG.synckey || "";
  renderUsers(); applyPerms();
  $("seedinfo").textContent = money(SEED.rows.length) + " صنفاً مضمّناً · نسخة البيانات " + SEED.v;
  tick(); setInterval(tick, 30000);
  const hint = $("camhint");
  if (hint) {
    const live = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
    hint.textContent = live
      ? "المسح المباشر بالكاميرا جاهز. وللسرعة على الكاونتر استعمل قارئ باركود خارجي."
      : "الكاميرا داخل التطبيق تحتاج فتحه من رابط https — الآن سيفتح كاميرا الهاتف لتصوير الباركود، أو استعمل قارئاً خارجياً.";
  }

  document.querySelectorAll(".nav button").forEach(b => b.onclick = () => go(b.dataset.t));

  /* بحث */
  $("q").addEventListener("input", search);
  $("q").addEventListener("keydown", e => {
    if (!HITS.length) return;
    if (e.key === "ArrowDown") { CUR = (CUR + 1) % HITS.length; drawSug(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { CUR = (CUR - 1 + HITS.length) % HITS.length; drawSug(); e.preventDefault(); }
    else if (e.key === "Enter") { show(HITS[CUR < 0 ? 0 : CUR]); e.preventDefault(); }
  });
  $("sug").addEventListener("click", e => {
    const o = e.target.closest(".opt"); if (o) { const it = HITS[+o.dataset.i]; $("q").value = it.n; show(it); }
  });
  document.addEventListener("click", e => { if (!e.target.closest(".searchbox")) $("sug").classList.remove("on"); });
  document.querySelectorAll("#pg-home .chip").forEach(c => c.onclick = () => {
    document.querySelectorAll("#pg-home .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); KIND = c.dataset.k; search();
  });

  /* كاميرا */
  $("scan").onclick = () => openCam("search");
  $("scansale").onclick = () => openCam("sale");
  $("shot").onclick = () => photoMode("search");
  $("ocrbtn").onclick = () => openCam("ocr");
  $("camx").onclick = closeCam;
  $("diag").onclick = () => {
    alert([
      "قارئ الباركود الخارجي: " + (CFG.hw === false ? "معطّل" : "مفعّل"),
      "وضع دقة المسح: " + (typeof scanProfile === "function" ? scanProfile().name : "متوازن"),
      "آخر رمز من القارئ: " + (LAST_HW || "لا شيء بعد"),
      "البروتوكول: " + location.protocol +
        (location.protocol === "https:" ? " (مناسب للكاميرا)" : " (يمنع الكاميرا المباشرة)"),
      "سياق آمن: " + (window.isSecureContext ? "نعم" : "لا"),
      "كاميرا الجهاز: " + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? "متاحة" : "غير متاحة"),
      "BarcodeDetector: " + (("BarcodeDetector" in window) ? "متاح" : "غير متاح"),
      "مكتبة ZXing: " + (window.ZXing ? "محمّلة" : "غير محمّلة")
    ].join(String.fromCharCode(10)));
  };
  $("cfg-hw").checked = CFG.hw !== false;
  $("photo").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const img = new Image(); img.src = URL.createObjectURL(f);
    try {
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("تعذّر فتح الصورة")); });
      if (PHOTOMODE === "ocr") useOcr(await ocr(img));
      else {
        toast("جارٍ قراءة الباركود…");
        const code = await readBarcode(img, img.naturalWidth, img.naturalHeight);
        if (code) { SCANMODE = PHOTOMODE; onCode(code); }
        else toast("لم يُقرأ الباركود — قرّب الكاميرا ووفّر إضاءة");
      }
    } catch (err) { toast("تعذّرت القراءة: " + (err.message || err)); }
    finally { URL.revokeObjectURL(img.src); }
  });

  /* البيع */
  $("addcart").onclick = () => PICK && addToCart(PICK);
  $("cart").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const row = b.closest(".prow"); if (!row) return;
    const i = +row.dataset.i, act = b.dataset.act;
    if (act === "del") CART.splice(i, 1);
    else if (act === "plus") CART[i].q++;
    else if (act === "minus") { CART[i].q--; if (CART[i].q < 1) CART.splice(i, 1); }
    else if (act === "unit") {
      const it = ITEMS.find(x => x.id === CART[i].id);
      if (it && it.u2) {
        CART[i].u2 = !CART[i].u2;
        CART[i].price = CART[i].u2 ? (it.u2p || Math.round((it.p || 0) / (it.u2q || 1))) : (it.p || 0);
        CART[i].n = CART[i].u2 ? (it.n + " (" + it.u2 + ")") : it.n;
      }
    }
    else if (act === "ldisc") {
      const v = prompt("خصم هذا السطر (مبلغ أو نسبة مثل 10%)", CART[i].d || "");
      if (v === null) return;
      const base = CART[i].price * CART[i].q;
      CART[i].d = /%$/.test(String(v).trim()) ? Math.round(base * (parseFloat(v) || 0) / 100) : (Number(v) || 0);
    }
    else return;
    renderCart();
  });
  $("cart").addEventListener("change", e => {
    const inp = e.target.closest("input"); if (!inp) return;
    const i = +inp.closest(".prow").dataset.i, v = Math.max(0, Number(inp.value) || 0);
    if (inp.dataset.act === "price") CART[i].price = v;
    else { if (!v) CART.splice(i, 1); else CART[i].q = v; }
    renderCart();
  });
  $("favs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const it = ITEMS.find(x => x.n === b.dataset.n); if (it) addToCart(it);
  });
  let PH = [];
  $("psearch").addEventListener("input", () => {
    const v = $("psearch").value.trim().toLowerCase();
    if (!v) { PH = []; $("psug").classList.remove("on"); return; }
    const digits = /^\d{5,}$/.test(v);
    PH = ITEMS.filter(it => digits ? String(it.b || "").includes(v)
                                   : (it._n.includes(v) || it._s.includes(v))).slice(0, 8);
    $("psug").innerHTML = PH.map((it, i) =>
      '<div class="opt" data-i="' + i + '"><b>' + esc(it.n) + '</b><small>' + money(sellOf(it)) + " " +
      esc(CFG.cur) + (it.sc ? " · " + esc(it.sc) : "") + " · المتوفر " + money(it.q) +
      (nearestExp(it) ? " · ينتهي " + nearestExp(it) : "") + '</small></div>').join("");
    $("psug").classList.toggle("on", PH.length > 0);
  });
  $("psug").addEventListener("click", e => {
    const o = e.target.closest(".opt"); if (!o) return;
    addToCart(PH[+o.dataset.i]); $("psearch").value = ""; $("psug").classList.remove("on"); $("psearch").focus();
  });
  $("psearch").addEventListener("keydown", e => {
    if (e.key === "Enter" && PH.length) { addToCart(PH[0]); $("psearch").value = ""; $("psug").classList.remove("on"); $("psearch").focus(); e.preventDefault(); }
  });
  $("setdisc").onclick = () => {
    const v = prompt("قيمة الخصم (أو نسبة مثل 10%)", DISC || "");
    if (v === null) return;
    const sub = CART.reduce((a, l) => a + l.price * l.q, 0);
    DISC = /%$/.test(String(v).trim()) ? Math.round(sub * (parseFloat(v) || 0) / 100) : (Number(v) || 0);
    renderCart();
  };
  $("pay").onclick = openPay;
  $("paycancel").onclick = () => $("paywin").classList.remove("on");
  $("dopay").onclick = doPay;
  $("tendered").addEventListener("input", calcChange);
  $("quickcash").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    $("tendered").value = c.dataset.v; calcChange();
  });
  $("methods").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    $("methods").querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); PAYM = c.dataset.m;
  });
  $("keypad").innerHTML = ["1","2","3","4","5","6","7","8","9","00","0","⌫"]
    .map(k => '<button data-k="' + k + '">' + k + '</button>').join("");
  $("keypad").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const t = $("tendered");
    t.value = b.dataset.k === "⌫" ? String(t.value).slice(0, -1) : String(t.value) + b.dataset.k;
    calcChange();
  });
  $("hold").onclick = holdSale;
  $("clearcart").onclick = () => { if (CART.length && confirm("إلغاء الفاتورة الحالية؟")) { CART = []; DISC = 0; renderCart(); } };
  $("tickets").onclick = () => { renderTickets(); $("ticketwin").classList.add("on"); };
  $("ticketx").onclick = () => $("ticketwin").classList.remove("on");
  $("tabs2").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    $("tabs2").querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); TKVIEW = c.dataset.v; renderTickets();
  });
  $("ticketlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const act = b.dataset.act;
    if (act === "resume") { const t = HELD.splice(+b.dataset.i, 1)[0]; LS.set("ph.held", HELD);
      CART = t.lines; DISC = t.disc || 0; $("cust").value = t.who || ""; $("ticketwin").classList.remove("on"); renderCart(); }
    else if (act === "drop") { HELD.splice(+b.dataset.i, 1); LS.set("ph.held", HELD); renderTickets(); renderCart(); }
    else if (act === "print") { const v = INVOICES.find(x => x.no === +b.dataset.no); if (v) { $("ticketwin").classList.remove("on"); showReceipt(v); } }
    else if (act === "refund") refund(+b.dataset.no);
  });
  $("cashier").onclick = () => setCashier(true);
  $("exitcash").onclick = () => setCashier(false);
  $("shiftbtn").onclick = renderShift;
  $("shiftx").onclick = () => $("shiftwin").classList.remove("on");
  $("shiftprint").onclick = () => { try { window.print(); } catch (e) { toast("الطباعة غير مدعومة هنا"); } };
  if (LS.get("ph.cashier", false)) setCashier(true);
  $("rcx").onclick = () => $("receipt").classList.remove("on");
  $("rcprint").onclick = () => printReceipt(Number($("receipt").dataset.no || 0));
  $("btconnect").onclick = btConnect;
  $("newitem2").onclick = () => quickAdd("", true);
  

  /* المخزون */
  $("ssearch").addEventListener("input", debounce(() => { SPAGE = 50; renderStock(); }, 110));
  document.querySelectorAll("#pg-stock .chip").forEach(c => c.onclick = () => {
    document.querySelectorAll("#pg-stock .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); SFILTER = c.dataset.s; SPAGE = 50; renderStock();
  });
  $("more").onclick = () => { SPAGE += 100; renderStock(); };
  $("stockbody").addEventListener("click", e => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const it = ITEMS.find(x => x.id === tr.dataset.id); if (it) openEdit(it);
  });
  $("newitem").onclick = () => openEdit(null);
  $("editItem").onclick = () => PICK && openEdit(PICK);
  $("esave").onclick = saveEdit;
  $("ecancel").onclick = () => $("editwin").classList.remove("on");
  $("esuggest").onclick = suggestPrice;
  $("eguide").onclick = () => {
    const n = $("e-n").value.trim(); if (!n) return toast("اكتب اسم الصنف أولاً");
    const hit = searchGuide(n)[0];
    if (!hit) return toast("لا يوجد مطابق في دليل الأسعار");
    $("e-k").value = hit.buy || $("e-k").value;
    $("e-p").value = hit.sell || $("e-p").value;
    $("e-hint").textContent = "من الدليل: " + hit.n + (hit.m ? " · " + hit.m : "");
  };
  $("eround").onclick = () => {
    const v = Number($("e-p").value) || 0;
    if (!v) return toast("أدخل سعر البيع أولاً");
    $("e-p").value = roundUp(v);
    $("e-hint").textContent = "قُرّب للأعلى لأقرب " + (CFG.upstep || 250);
  };
  $("roundall").onclick = applyRoundUpAll;
  $("zeroqty").onclick = () => {
    if (!confirm("تصفير كميات كل الأصناف؟ تدخلها أنت بعدها.")) return;
    let n = 0; ITEMS.forEach(it => { if (it.q) { patchItem(it, { q: 0, wq: undefined }); n++; } });
    renderStock(); renderHome(); toast("صُفّرت كميات " + money(n) + " صنفاً");
  };
  $("exportcsv").onclick = exportAllXLSX;
  $("pick").onclick = () => $("file").click();
  const impGo = (accept, note) => {
    const f = $("file");
    f.accept = accept;
    $("imp-note").textContent = note;
    f.click();
  };
  $("imp-pdf").onclick = () => impGo(".pdf", "اختر ملف PDF لقائمة المذخر");
  $("imp-xls").onclick = () => impGo(".xlsx,.xls,.csv", "اختر ملف Excel أو CSV");
  $("imp-doc").onclick = () => impGo(".docx,.doc", "اختر ملف Word");
  $("imp-img").onclick = () => impGo("image/*", "اختر صورة القائمة — تُقرأ داخل الجهاز");
  $("file").addEventListener("change", e => {
    if (e.target.files && e.target.files.length) go("stock");
    handleFiles(e.target.files);
    e.target.value = "";
    e.target.accept = ".pdf,.xlsx,.xls,.csv,.docx,.doc,image/*";
  });
  $("doimport").onclick = doImport;

  /* دليل الأسعار */
  buildGuide();
  $("gsearch").addEventListener("input", debounce(renderGuide, 130));
  $("glist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const g = GUIDE[+b.closest(".tk").dataset.i]; if (!g) return;
    if (b.dataset.act === "add") {
      const exists = ITEMS.find(x => x._n === g._n);
      if (exists && !confirm("الصنف موجود في المخزون. إضافته مرة أخرى؟")) return;
      quickAdd("", false);
      $("e-n").value = g.n; $("e-c").value = g.m || "";
      $("e-k").value = g.buy || ""; $("e-p").value = g.sell || "";
      $("e-hint").textContent = "من دليل الأسعار الرسمي — أدخل الكمية والباركود";
    } else {
      if (!PICK) return toast("افتح صنفاً من البحث أولاً");
      patchItem(PICK, { k: g.buy || PICK.k, p: g.sell || PICK.p });
      show(PICK); renderStock(); toast("سُعِّر " + PICK.n + " من الدليل");
    }
  });

  /* الديون */
  $("dsearch").addEventListener("input", debounce(renderDebt, 90));
  document.querySelectorAll("#pg-debt .chip").forEach(c => c.onclick = () => {
    document.querySelectorAll("#pg-debt .chip").forEach(x => x.classList.remove("on"));
    c.classList.add("on"); DFILTER = c.dataset.d; renderDebt();
  });
  $("dadd").onclick = () => {
    const n = prompt("اسم الزبون:"); if (!n) return;
    const v = Number(prompt("مبلغ الدين:")) || 0; if (!v) return;
    const note = prompt("ملاحظة (اختياري):", "") || "";
    custAdd(n.trim(), v, note); renderDebt(); renderCust(); toast("سُجّل الدين");
  };
  $("dexport").onclick = exportDebtsXLSX;
  $("dpdf").onclick = debtReportPDF;
  $("repprint").onclick = () => { try { window.print(); } catch (e) { toast("الطباعة غير مدعومة هنا"); } };
  $("exportall").onclick = exportAllXLSX;
  $("dlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const c = findCust(b.closest(".tk").dataset.n); if (!c) return;
    const act = b.dataset.act;
    if (act === "pay") {
      const v = Number(prompt("المبلغ المستلم من " + c.n + " (المطلوب " + money(c.bal) + ")", c.bal || "")) || 0;
      if (!v) return;
      const before = c.bal || 0;
      custAdd(c.n, -v, "سند قبض");
      renderDebt(); renderCust(); showVoucher(c, v, before);
    } else if (act === "hist") {
      alert("كشف حساب " + c.n + String.fromCharCode(10) +
        (c.log || []).slice(-20).map(l => new Date(l.at).toLocaleDateString("en-GB") + " · " +
          (l.amt > 0 ? "دين " : "تسديد ") + money(Math.abs(l.amt)) + (l.note ? " · " + l.note : "")).join(String.fromCharCode(10)) +
        String.fromCharCode(10) + "الرصيد: " + money(c.bal) + " " + CFG.cur);
    } else if (act === "phone") {
      const v = prompt("رقم هاتف " + c.n, ""); if (v === null) return;
      c.phone = v.trim(); LS.set("ph.cust", CUST); renderDebt();
    } else if (act === "wa") {
      const msg = "السلام عليكم " + c.n + "، تذكير من " + CFG.shop + ": الرصيد المستحق " +
                  money(c.bal) + " " + CFG.cur + ". شكراً لتعاملكم معنا.";
      window.open("https://wa.me/" + String(c.phone).replace(/\D/g, "") + "?text=" + encodeURIComponent(msg), "_blank");
    } else if (act === "call") {
      window.open("tel:" + String(c.phone).replace(/\s/g, ""), "_self");
    }
  });
  $("vcprint").onclick = () => { try { window.print(); } catch (e) { toast("الطباعة غير مدعومة هنا"); } };
  $("vcshare").onclick = () => {
    const w = $("voucher"), ph = String(w.dataset.phone || "").replace(/\D/g, "");
    window.open("https://wa.me/" + ph + "?text=" + encodeURIComponent(w.dataset.msg || ""), "_blank");
  };

  /* المخازن */
  $("whsel").onchange = () => { AWH = $("whsel").value; LS.set("ph.awh", AWH); renderWH(); renderStock(); };
  $("whadd").onclick = () => {
    const v = prompt("اسم المخزن الجديد:"); if (!v) return;
    if (!WH.includes(v.trim())) { WH.push(v.trim()); LS.set("ph.wh", WH); renderWH(); }
  };
  $("whmove").onclick = () => {
    if (!PICK) return toast("افتح صنفاً من البحث أولاً");
    if (WH.length < 2) return toast("أضف مخزناً ثانياً أولاً");
    const from = prompt("النقل من مخزن:", AWH); if (!from) return;
    const to = prompt("إلى مخزن:", WH.find(w => w !== from)); if (!to) return;
    const qty = Number(prompt("الكمية المنقولة من " + PICK.n + ":", "1")) || 0;
    if (transfer(PICK, from.trim(), to.trim(), qty)) { renderWH(); renderStock(); toast("نُقلت " + qty); }
  };

  /* الموظفون */
  $("useradd").onclick = () => {
    const n = prompt("اسم الموظف:"); if (!n) return;
    const pin = prompt("رمز دخوله (أرقام):"); if (!pin) return;
    const role = prompt("الصلاحية: مدير أو صيدلاني أو كاشير", "كاشير") || "كاشير";
    USERS.push({ n: n.trim(), pin: pin.trim(), role: ROLES[role.trim()] ? role.trim() : "كاشير" });
    LS.set("ph.users", USERS); renderUsers();
  };
  $("userlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (confirm("حذف الموظف؟")) { USERS.splice(+b.dataset.i, 1); LS.set("ph.users", USERS); renderUsers(); }
  });

  /* الأقساط */
  $("planadd").onclick = () => {
    const c = prompt("اسم الزبون:"); if (!c) return;
    const t = Number(prompt("المبلغ الكلي:")) || 0; if (!t) return;
    const n = Number(prompt("عدد الأقساط:", "4")) || 4;
    const ev = Number(prompt("كل كم يوم؟", "30")) || 30;
    planAdd(c.trim(), t, n, ev); custAdd(c.trim(), t, "أقساط"); renderPlans(); renderCust();
  };
  $("planlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const p = PLANS[+b.dataset.p], q = p && p.items[+b.dataset.q]; if (!q) return;
    const v = Number(prompt("مبلغ التسديد:", q.amt - q.paid)) || 0;
    q.paid += v; LS.set("ph.plans", PLANS); custAdd(p.cust, -v, "قسط"); renderPlans(); renderCust();
  });

  /* ملصقات الباركود */
  $("labelbtn").onclick = () => {
    if (!PICK) return toast("افتح صنفاً أولاً");
    const n = Number(prompt("عدد الملصقات:", "12")) || 12;
    $("labels").innerHTML = labelHTML(PICK, n);
    $("labelwin").classList.add("on");
  };
  $("labelprint").onclick = () => { try { window.print(); } catch (e) { toast("الطباعة غير مدعومة هنا"); } };

  /* المزامنة */
  $("syncbtn").onclick = syncNow;

  /* العملاء والديون */
  $("custlist").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const c = CUST.slice().sort((x, y) => (y.bal || 0) - (x.bal || 0))[+b.dataset.i];
    if (!c) return;
    if (b.dataset.act === "pay") {
      const v = prompt("مبلغ التسديد من " + c.n + " (المطلوب " + money(c.bal) + ")", c.bal || "");
      if (v === null) return;
      custAdd(c.n, -(Number(v) || 0), "تسديد"); renderCust(); toast("سُجّل التسديد");
    } else if (b.dataset.act === "phone") {
      const v = prompt("رقم هاتف " + c.n, c.phone || "");
      if (v === null) return;
      c.phone = v.trim(); LS.set("ph.cust", CUST); renderCust();
    } else {
      alert("كشف حساب " + c.n + String.fromCharCode(10) +
        c.log.slice(-15).map(l => new Date(l.at).toLocaleDateString("en-GB") + " · " +
          (l.amt > 0 ? "دين " : "تسديد ") + money(Math.abs(l.amt)) + (l.note ? " · " + l.note : "")).join(String.fromCharCode(10)) +
        String.fromCharCode(10) + "الرصيد: " + money(c.bal));
    }
  });

  /* التنبيهات */
  $("alerts").addEventListener("click", e => {
    const r = e.target.closest(".row"); if (!r) return;
    const it = ITEMS.find(x => x.id === r.dataset.id); if (it) { go("home"); $("q").value = it.n; show(it); }
  });

  /* الذكاء والإعدادات */
  $("aiask").onclick = askAI;
  $("aisci").onclick = aiSci;
  $("aibatch").onclick = aiBatch;
  $("orderbtn").onclick   = renderOrder;
  $("insightbtn").onclick = aiInsights;
  $("cartcheck").onclick  = cartCheck;
  $("licsave").onclick    = activateLic;
  $("c-alt").addEventListener("click", e => {
    const r = e.target.closest(".row"); if (!r) return;
    const it = ITEMS.find(x => x.id === r.dataset.id); if (it) { $("q").value = it.n; show(it); }
  });
  drawQuota();
  $("savecfg").onclick = () => {
    CFG = { shop: $("cfg-shop").value.trim() || "صيدليتي", cur: $("cfg-cur").value.trim() || "د.ع",
            margin: Number($("cfg-margin").value) || 25, expdays: Number($("cfg-expdays").value) || 90,
            key: $("cfg-key").value.trim(), model: $("cfg-model").value.trim() || "claude-sonnet-4-5",
            hw: $("cfg-hw").checked, pin: $("cfg-pin").value.trim(),
            lockmin: Number($("cfg-lockmin").value) || 0,
            safet: Number($("cfg-safet").value) || 0, safeb: Number($("cfg-safeb").value) || 0,
            scan: $("cfg-scan").value, upstep: Number($("cfg-upstep").value) || 250,
            round: Number($("cfg-round").value) || 0, hidecost: $("cfg-hidecost").checked,
            syncurl: $("cfg-syncurl").value.trim(), synckey: $("cfg-synckey").value.trim(),
            lic: ($("cfg-lic").value || "").trim().toUpperCase(),
            aiurl: ($("cfg-aiurl").value || "").trim(),
            cover: Number($("cfg-cover").value) || 30 };
    LS.set("ph.cfg", CFG); applySafe(); $("shopname").textContent = CFG.shop || BRAND; renderHome(); toast("حُفظت الإعدادات");
  };
  $("backup").onclick = backup;
  try {
    const used = Math.round((JSON.stringify(PATCH).length + JSON.stringify(EXTRA).length +
                             JSON.stringify(INVOICES).length + JSON.stringify(CUST).length +
                             JSON.stringify(PLANS).length + JSON.stringify(PURCH).length) / 1024);
    if (used > 3500) toast("بيانات الجهاز " + used + " ك.ب — صدّر نسخة احتياطية");
  } catch (e) {}
  $("restorebtn").onclick = () => $("restore").click();
  $("restore").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) restore(f); });
  $("wipe").onclick = () => {
    if (!confirm("حذف التعديلات والأصناف المضافة والفواتير؟")) return;
    PATCH = {}; EXTRA = []; INVOICES = []; HELD = []; PURCH = [];
    ["patch","extra","inv","held","purch"].forEach((k, i) => LS.set("ph." + k, [PATCH, EXTRA, INVOICES, HELD, PURCH][i]));
    buildItems(); renderHome(); renderStock(); toast("أُعيد الضبط");
  };

  /* اختصارات لوحة المفاتيح كبرامج نقاط البيع */
  document.addEventListener("keydown", e => {
    if (LOCKED) return;
    if (e.key === "F2") { e.preventDefault(); go("sale"); const f = $("psearch"); if (f) f.focus(); }
    else if (e.key === "F3") { e.preventDefault(); if (CART.length && confirm("إلغاء الفاتورة؟")) { CART = []; DISC = 0; renderCart(); } }
    else if (e.key === "F5") { e.preventDefault(); go("home"); const f = $("q"); if (f) f.focus(); }
    else if (e.key === "F6") { e.preventDefault(); holdSale(); }
    else if (e.key === "F8") { e.preventDefault(); if (CART.length) openPay(); }
    else if (e.key === "F9") { e.preventDefault(); renderShift(); }
    else if (e.key === "Escape") {
      document.querySelectorAll(".modal.on").forEach(m => { if (m.id !== "lockwin") m.classList.remove("on"); });
    }
  });
  try { hwScanInit(); } catch (e) {}
  try { modalsInit(); } catch (e) {}
  $("dounlock").onclick = unlock;
  $("lockpin").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
  $("cfg-pin").value = CFG.pin || "";
  $("cfg-lockmin").value = CFG.lockmin || 0;
  $("lockbtn").onclick = () => CFG.pin ? lock() : toast("عيّن رمزاً في الإعدادات أولاً");
  ["click","keydown","touchstart"].forEach(ev => document.addEventListener(ev, resetIdle, true));
  if (CFG.pin) lock(); else resetIdle();
  go("home");
  console.timeEnd && console.timeEnd("boot");
}
document.addEventListener("DOMContentLoaded", init);

/* ---------- الباركود ---------- */
let stream = null, loop = null, LASTERR = "", TORCH = false;
/* خانة المراجعة في EAN-13/EAN-8/UPC — ترفض القراءات الناقصة */
function checkDigitOK(code) {
  if (!/^\d+$/.test(code)) return true;
  if (![8, 12, 13, 14].includes(code.length)) return code.length >= 6;
  const d = code.split("").map(Number), cd = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === cd;
}

function decodeCanvas(cv) {
  const w = cv.width, h = cv.height;
  const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  const src = new ZXing.RGBLuminanceSource(lum, w, h);
  const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
  const rd = new ZXing.MultiFormatReader();
  rd.setHints(new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]));
  return rd.decode(bmp).getText();
}
function frameTo(src, sx, sy, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh));
  const cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round(sw * k)); cv.height = Math.max(2, Math.round(sh * k));
  cv.getContext("2d", { willReadFrequently: true }).drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}
async function readBarcode(src, w, h) {
  if ("BarcodeDetector" in window) {
    try {
      const det = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf","codabar"] });
      const r = await det.detect(src); if (r && r.length) return r[0].rawValue;
    } catch (e) {}
  }
  const tries = [[0,0,w,h,1400], [w*0.12|0, h*0.2|0, w*0.76|0, h*0.6|0, 1400], [0,0,w,h,900]];
  for (const t of tries) {
    try {
      const c = decodeCanvas(frameTo(src, t[0], t[1], t[2], t[3], t[4]));
      if (c && checkDigitOK(c)) return c;
    } catch (e) {}
  }
  return "";
}
async function openCam(mode) {
  closeCam(); SCANMODE = mode;
  const gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    ? c => navigator.mediaDevices.getUserMedia(c)
    : (navigator.getUserMedia || navigator.webkitGetUserMedia)
      ? c => new Promise((ok, no) => (navigator.getUserMedia || navigator.webkitGetUserMedia).call(navigator, c, ok, no))
      : null;
  const insecure = !window.isSecureContext && location.protocol !== "http:";
  if (!gum || insecure) {
    LASTERR = insecure ? "الملف مفتوح بلا https" : "mediaDevices غير متاح";
    /* نشرح السبب أولاً بدل فتح كاميرا النظام فجأة */
    const why = insecure
      ? "المسح المباشر داخل التطبيق يحتاج فتحه من رابط https (أو من التطبيق المنصَّب)." +
        String.fromCharCode(10) + "الملف مفتوح الآن بصيغة " + location.protocol + " فالمتصفح يمنع الكاميرا."
      : "هذا الجهاز أو العارض لا يتيح الكاميرا المباشرة للتطبيق.";
    if (confirm(why + String.fromCharCode(10) + String.fromCharCode(10) +
                "أفتح كاميرا الهاتف لتصوير الباركود وأقرأه من الصورة؟")) {
      return photoMode(mode, "صوّر الباركود قريباً وواضحاً وسأقرأه");
    }
    toast("ألغيت المسح — استعمل قارئ الباركود الخارجي أو افتح التطبيق من الرابط");
    return;
  }
  $("cam").classList.add("on"); $("camtxt").textContent = "جارٍ فتح الكاميرا…";
  try {
    try { stream = await gum({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } }); }
    catch (e) { stream = await gum({ audio: false, video: true }); }
    const v = $("vid"); v.srcObject = stream; v.muted = true; v.setAttribute("playsinline", "");
    await v.play();
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $("torch").style.display = caps.torch ? "" : "none";
      $("torch").onclick = () => {
        TORCH = !TORCH;
        track.applyConstraints({ advanced: [{ torch: TORCH }] }).catch(() => {});
        $("torch").textContent = TORCH ? "إطفاء الضوء" : "تشغيل الضوء";
      };
    } catch (e) { $("torch").style.display = "none"; }
    if (mode === "ocr") startOCR(); else startScan();
  } catch (err) {
    LASTERR = (err && (err.name || err.message)) || "خطأ";
    closeCam(); photoMode(mode, "تعذّر فتح الكاميرا (" + LASTERR + ")");
  }
}
function closeCam() {
  $("cam").classList.remove("on");
  if (loop) { clearInterval(loop); loop = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  TORCH = false; const tb = $("torch"); if (tb) { tb.style.display = "none"; tb.textContent = "تشغيل الضوء"; }
  const v = $("vid"); if (v) { v.onclick = null; try { v.pause(); } catch (e) {} v.srcObject = null; }
}
function scanProfile() {
  const m = (CFG && CFG.scan) || "balanced";
  if (m === "fast")   return { need: 1, ms: 180, name: "سريع" };
  if (m === "strict") return { need: 3, ms: 320, name: "دقيق" };
  return { need: 2, ms: 260, name: "متوازن" };
}
let LASTCODE = "", LASTAT = 0;
function acceptCode(code) {            /* يمنع القراءة المكرّرة خلال ثانية */
  const now = Date.now();
  if (code === LASTCODE && now - LASTAT < 1000) return false;
  LASTCODE = code; LASTAT = now; return true;
}
function startScan() {
  const P = scanProfile();
  $("camtxt").textContent = "وجّه الباركود داخل الإطار — الوضع " + P.name +
                            " (يتأكّد من القراءة " + P.need + " مرات)";
  let busy = false, last = "", hits = 0;
  loop = setInterval(async () => {
    const v = $("vid"); if (busy || !v.videoWidth) return; busy = true;
    try {
      const code = await readBarcode(v, v.videoWidth, v.videoHeight);
      if (code) {
        if (!checkDigitOK(code)) { last = ""; hits = 0; $("camtxt").textContent = "قراءة غير مكتملة — ثبّت الهاتف"; }
        else if (code === last) {
          hits++;
          $("camtxt").textContent = "تأكيد " + hits + " من " + P.need + " · " + code;
          if (hits >= P.need && acceptCode(code)) { closeCam(); onCode(code); }
        } else { last = code; hits = 1; $("camtxt").textContent = "جارٍ التأكيد… " + code; }
      }
    } catch (e) {}
    busy = false;
  }, P.ms);
}

let SCANMODE = "search";
function onCode(code) {
  code = String(code).trim();
  const strip = v => String(v || "").replace(/^0+/, "");
  const cs = strip(code);
  const hit = ITEMS.find(x => String(x.b || "") === code) ||
              (cs ? ITEMS.find(x => x.b && strip(x.b) === cs) : null);
  if (!hit) {
    if (typeof quickAdd === "function" && can("stock") &&
        confirm("الباركود " + code + " غير مسجّل. إضافته كمادة جديدة؟")) {
      quickAdd(code, SCANMODE === "sale"); return;
    }
    go("home"); $("q").value = code; search(); toast("الباركود " + code + " غير مسجّل"); return;
  }
  if (SCANMODE === "sale") { addToCart(hit); toast("أُضيف: " + hit.n); }
  else { go("home"); $("q").value = hit.n; show(hit); toast(hit.n); }
}
let PHOTOMODE = "search";
function photoMode(mode, why) {
  PHOTOMODE = mode; if (why) toast(why);
  $("photo").click();
}
async function startOCR() {
  $("camtxt").textContent = "قرّب الكاميرا من اسم العلاج ثم اضغط على الصورة";
  const v = $("vid");
  v.onclick = async () => {
    v.onclick = null; $("camtxt").textContent = "جارٍ قراءة الاسم…";
    const cv = frameTo(v, 0, 0, v.videoWidth, v.videoHeight, 1400);
    try { const t = await ocr(cv); closeCam(); useOcr(t); }
    catch (e) { $("camtxt").textContent = "تعذّرت القراءة: " + (e.message || e); }
  };
}
async function ocr(source) {
  if (!window.Tesseract) {
    try { await loadScript("vendor/tesseract.min.js"); }
    catch (e) {
      try { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js"); }
      catch (e2) { throw new Error("التعرّف الضوئي يحتاج إنترنت في أول تشغيل"); }
    }
  }
  const w = await Tesseract.createWorker(["eng"]);
  const { data } = await w.recognize(source); await w.terminate();
  return data.text;
}
function useOcr(text) {
  const words = (text.match(/[A-Za-z][A-Za-z\-]{3,}/g) || []).sort((a, b) => b.length - a.length).slice(0, 5);
  go("home");
  for (const t of words) {
    $("q").value = t; search();
    if (HITS.length) { show(HITS[0]); toast("قُرئ: " + t); return; }
  }
  toast("لم يُعثر على صنف مطابق" + (words[0] ? " (" + words[0] + ")" : ""));
}
function loadScript(src) {
  return new Promise((ok, no) => {
    const el = document.createElement("script");
    el.src = src; el.onload = ok; el.onerror = () => no(new Error("تعذّر تحميل المكتبة — تحقق من الإنترنت"));
    document.head.appendChild(el);
  });
}
function diag() {
  alert([
    "البروتوكول: " + location.protocol,
    "سياق آمن: " + (window.isSecureContext ? "نعم" : "لا"),
    "mediaDevices: " + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? "متاح" : "غير متاح"),
    "BarcodeDetector: " + (("BarcodeDetector" in window) ? "متاح" : "غير متاح"),
    "ZXing: " + (window.ZXing ? "محمّلة" : "غير محمّلة"),
    "SheetJS: " + (window.XLSX ? "محمّلة" : "غير محمّلة"),
    "pdf.js: " + (window.pdfjsLib ? "محمّلة" : "غير محمّلة"),
    LASTERR ? "آخر خطأ كاميرا: " + LASTERR : ""
  ].filter(Boolean).join(String.fromCharCode(10)));
}



/* ---------- تفقيط المبلغ بالعربية ---------- */
const ONES = ["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة",
  "أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
const TENS = ["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
const HUND = ["","مائة","مائتان","ثلاثمائة","أربعمائة","خمسمائة","ستمائة","سبعمائة","ثمانمائة","تسعمائة"];
function under1000(n) {
  const out = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(HUND[h]);
  if (r < 20) { if (r) out.push(ONES[r]); }
  else {
    const t = Math.floor(r / 10), o = r % 10;
    if (o) out.push(ONES[o]);
    out.push(TENS[t]);
  }
  return out.join(" و");
}
function group(n, one, two, plural, single) {
  if (!n) return "";
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return under1000(n) + " " + plural;
  return under1000(n) + " " + (n % 100 === 0 ? one : single);
}
function tafqit(num, cur) {
  num = Math.round(Math.abs(Number(num) || 0));
  if (!num) return "صفر " + cur;
  const parts = [];
  const bn = Math.floor(num / 1e9); num %= 1e9;
  const mn = Math.floor(num / 1e6); num %= 1e6;
  const th = Math.floor(num / 1e3); num %= 1e3;
  if (bn) parts.push(group(bn, "مليار", "ملياران", "مليارات", "ملياراً"));
  if (mn) parts.push(group(mn, "مليون", "مليونان", "ملايين", "مليوناً"));
  if (th) parts.push(group(th, "ألف", "ألفان", "آلاف", "ألفاً"));
  if (num) parts.push(under1000(num));
  return "فقط " + parts.filter(Boolean).join(" و") + " " + cur + " لا غير.";
}


/* ---------- البيع ---------- */
function addToCart(it, qty) {
  const line = CART.find(l => l.id === it.id);
  if (line) line.q += (qty || 1);
  else CART.push({ id: it.id, n: it.n, b: it.b || "", price: it.p || it.s || it.k || 0, q: qty || 1, stock: it.q || 0 });
  go("sale"); renderCart();
}
function renderCart() {
  const box = $("cart");
  box.innerHTML = CART.length ? CART.map((l, i) =>
      '<div class="prow" data-i="' + i + '">' +
        '<div class="top"><span>' + (i + 1) + ') ' + esc(l.b || "") + '</span>' +
          '<button class="del" data-act="del">حذف</button></div>' +
        '<div class="nm">' + esc(l.n) +
          (l.sc ? ' <small style="font-weight:400;color:var(--muted)">· ' + esc(l.sc) + '</small>' : "") + '</div>' +
        '<div class="cells">' +
          '<span class="grow">' + (l.q > l.stock ? '<span class="warn">أكثر من المتوفر (' + l.stock + ')</span>' : "المتوفر " + money(l.stock)) +
            (l.d ? ' · <b class="warn">خصم ' + money(l.d) + '</b>' : "") + '</span>' +
          '<input class="pin" data-act="price" inputmode="numeric" value="' + l.price + '">' +
          '<span class="step"><button data-act="minus">−</button>' +
          '<input class="qin" data-act="qty" inputmode="numeric" value="' + l.q + '">' +
          '<button data-act="plus">+</button></span>' +
          '<span class="tot">' + money(lineTotal(l)) + '</span>' +
          '<button data-act="ldisc" class="ld" title="خصم السطر">%</button>' +
          (l.u2 || l.hasU2 ? '<button data-act="unit" class="ld" title="تبديل الوحدة">⇄</button>' : "") +
        '</div></div>').join("")
    : '<p class="muted" style="padding:16px 12px">لا توجد مواد — امسح باركوداً أو ابحث في الأعلى.</p>';
  const sub = CART.reduce((a, l) => a + lineTotal(l), 0);
  const total = Math.max(0, sub - DISC);
  $("subtotal").textContent = money(sub);
  $("discv").textContent = money(DISC);
  $("total").textContent = money(total) + " " + CFG.cur;
  $("count").textContent = CART.reduce((a, l) => a + l.q, 0);
  $("words").textContent = CART.length ? tafqit(total, CFG.cur) : "";
  $("heldn").textContent = HELD.length;
  renderFavs();
}

/* الأكثر مبيعاً كأزرار سريعة */
function renderFavs() {
  const c = {};
  INVOICES.slice(-60).forEach(v => (v.lines || []).forEach(l => { c[l.n] = (c[l.n] || 0) + l.q; }));
  const top = Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 10);
  $("favs").innerHTML = top.length
    ? top.map(n => '<button data-n="' + esc(n) + '">' + esc(n) + '</button>').join("")
    : '<span class="muted" style="font-size:.75rem">الأصناف الأكثر مبيعاً ستظهر هنا للإضافة بضغطة</span>';
}

function lineTotal(l) { return Math.max(0, l.price * l.q - (l.d || 0)); }
function cartTotal() {
  return roundTo(Math.max(0, CART.reduce((a, l) => a + lineTotal(l), 0) - DISC));
}

/* ---------- الدفع ---------- */
function openPay() {
  if (!CART.length) return toast("لا توجد مواد");
  const due = cartTotal();
  $("paydue").textContent = money(due) + " " + CFG.cur;
  $("tendered").value = ""; $("change").textContent = "0";
  const steps = [due, Math.ceil(due / 1000) * 1000, Math.ceil(due / 5000) * 5000,
                 Math.ceil(due / 10000) * 10000, Math.ceil(due / 25000) * 25000];
  $("quickcash").innerHTML = [...new Set(steps)].filter(v => v > 0).slice(0, 5)
    .map(v => '<span class="chip" data-v="' + v + '">' + money(v) + '</span>').join("");
  $("paywin").classList.add("on");
}
function calcChange() {
  const t = Number(String($("tendered").value).replace(/[^\d]/g, "")) || 0;
  const ch = t - cartTotal();
  $("change").textContent = (ch >= 0 ? money(ch) : "ناقص " + money(-ch)) + " " + CFG.cur;
}
function doPay() {
  const due = cartTotal();
  /* تنبيه البيع بأقل من الكلفة */
  const under = CART.filter(l => { const it = ITEMS.find(x => x.id === l.id); return it && it.k && l.price < it.k; });
  if (under.length && !confirm("هناك " + under.length + " صنفاً سعره أقل من الكلفة (" +
      under.map(l => l.n).slice(0, 3).join("، ") + "). إتمام البيع؟")) return;
  const tendered = Number(String($("tendered").value).replace(/[^\d]/g, "")) || (PAYM === "دين" ? 0 : due);
  if (PAYM !== "دين" && tendered < due) return toast("المبلغ المدفوع أقل من المطلوب");
  const sub = CART.reduce((a, l) => a + l.price * l.q, 0);
  const inv = {
    no: INVOICES.length + 1, at: new Date().toISOString(), who: $("cust").value.trim(),
    lines: CART.map(l => ({ id: l.id, n: l.n, q: l.q, p: l.price, d: l.d || 0 })),
    sub, disc: DISC, total: due, pay: PAYM, tendered, change: Math.max(0, tendered - due), kind: "بيع"
  };
  CART.forEach(l => { const it = ITEMS.find(x => x.id === l.id); if (it) takeStock(it, l.q); });
  if (PAYM === "دين") {
    const nm = ($("cust").value || "").trim();
    if (!nm) return toast("اكتب اسم الزبون لتسجيل الدين");
    custAdd(nm, due - tendered, "فاتورة " + inv.no);
    renderCust();
  } else if (($("cust").value || "").trim() && tendered < due) {
    custAdd($("cust").value.trim(), due - tendered, "فاتورة " + inv.no);
    renderCust();
  }
  INVOICES.push(inv); LS.set("ph.inv", INVOICES);
  $("paywin").classList.remove("on");
  showReceipt(inv);
  CART = []; DISC = 0; $("cust").value = ""; renderCart(); renderHome();
}

/* ---------- تعليق الفواتير والسجل ---------- */
function holdSale() {
  if (!CART.length) return toast("لا توجد مواد");
  HELD.push({ at: new Date().toISOString(), who: $("cust").value.trim(), lines: CART, disc: DISC });
  LS.set("ph.held", HELD); CART = []; DISC = 0; renderCart(); toast("عُلّقت الفاتورة");
}
let TKVIEW = "held";
function renderTickets() {
  const box = $("ticketlist");
  if (TKVIEW === "held") {
    box.innerHTML = HELD.length ? HELD.map((t, i) =>
      '<div class="tk"><b>' + (t.who || "بلا اسم") + " · " + t.lines.length + ' مادة</b>' +
      '<small>' + new Date(t.at).toLocaleString("en-GB") + " · " +
      money(t.lines.reduce((a, l) => a + l.price * l.q, 0) - (t.disc || 0)) + " " + CFG.cur + '</small>' +
      '<div class="btns"><button class="main" data-act="resume" data-i="' + i + '">استئناف</button>' +
      '<button data-act="drop" data-i="' + i + '">حذف</button></div></div>').join("")
      : '<p class="muted">لا توجد فواتير معلّقة</p>';
  } else {
    box.innerHTML = INVOICES.slice(-30).reverse().map(v =>
      '<div class="tk"><b>فاتورة ' + v.no + " · " + money(v.total) + " " + CFG.cur +
      (v.kind === "مرتجع" ? " (مرتجع)" : "") + '</b>' +
      '<small>' + new Date(v.at).toLocaleString("en-GB") + " · " + (v.pay || "نقد") +
      (v.printed ? " · طُبعت" : "") +
      (v.who ? " · " + esc(v.who) : "") + " · " + v.lines.length + ' مادة</small>' +
      '<div class="btns"><button data-act="print" data-no="' + v.no + '">عرض وطباعة</button>' +
      (v.kind === "مرتجع" ? "" : '<button data-act="refund" data-no="' + v.no + '">مرتجع</button>') +
      '</div></div>').join("") || '<p class="muted">لا توجد فواتير</p>';
  }
}
function refund(no) {
  const v = INVOICES.find(x => x.no === no); if (!v) return;
  if (!confirm("إرجاع فاتورة " + no + " وإعادة موادها إلى المخزون؟")) return;
  v.lines.forEach(l => { const it = ITEMS.find(x => x.id === l.id); if (it) patchItem(it, { q: (it.q || 0) + l.q }); });  /* المرتجع يعود للرصيد العام */
  INVOICES.push({ no: INVOICES.length + 1, at: new Date().toISOString(), who: v.who, lines: v.lines,
                  sub: -v.sub, disc: 0, total: -v.total, pay: v.pay, kind: "مرتجع", ref: v.no });
  LS.set("ph.inv", INVOICES); renderTickets(); renderHome(); toast("سُجّل المرتجع");
}
function showReceipt(inv) {
  const d = new Date(inv.at);
  $("rc").innerHTML =
    '<h3>' + esc(CFG.shop) + '</h3>' +
    '<div class="rc-meta">' + (inv.kind === "مرتجع" ? "مرتجع" : "فاتورة") + ' رقم ' + inv.no + ' · ' +
    d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) +
    (inv.who ? ' · ' + esc(inv.who) : "") + '</div>' +
    '<table>' + inv.lines.map(l => '<tr><td>' + esc(l.n) + '</td><td>' + l.q + ' × ' + money(l.p) +
      '</td><td>' + money(l.p * l.q) + '</td></tr>').join("") + '</table>' +
    '<div class="rc-tot">المجموع: ' + money(inv.sub) + (inv.disc ? " · خصم: " + money(inv.disc) : "") +
    '<br><b>المطلوب: ' + money(inv.total) + " " + esc(CFG.cur) + '</b>' +
    (inv.tendered ? '<br>المدفوع: ' + money(inv.tendered) + " · الباقي: " + money(inv.change) : "") +
    '<br>طريقة الدفع: ' + esc(inv.pay || "نقد") +
    '<br><small>' + tafqit(Math.abs(inv.total), CFG.cur) + '</small></div>';
  $("receipt").dataset.no = inv.no || "";
  $("receipt").classList.add("on");
}


/* ---------- الاستيراد ---------- */
let PREVIEW = null;
async function handleFiles(files) {
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    try {
      if (ext === "pdf") await importPDF(f);
      else if (ext === "docx" || ext === "doc") await importDocx(f);
      else if (["jpg","jpeg","png","webp","bmp","heic"].includes(ext) || (f.type||"").startsWith("image/")) await importImage(f);
      else await importSheet(f);
    } catch (e) { imsg("تعذّر قراءة " + f.name + ": " + (e.message || e)); }
  }
}
function imsg(t, html) {
  const el = $("imsg");
  if (html) el.innerHTML = t; else el.textContent = t;
  el.classList.add("on");
}

async function importSheet(f) {
  imsg("جارٍ قراءة " + f.name + "…");
  if (!window.XLSX) {
    imsg("جارٍ تحميل قارئ الجداول…");
    try { await loadScript("vendor/xlsx.min.js"); }
    catch (e) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }
  }
  const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
  /* نفحص كل الأوراق ونختار الورقة التي فيها جدول أصناف حقيقي */
  let best = null;
  wb.SheetNames.forEach(nm => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, blankrows: false, raw: true });
    if (!rows.length) return;
    const head = findHeader(rows);
    const score = (Object.keys(head.map).length >= 2 ? 1e6 : 0) + Object.keys(head.map).length * 1000 + rows.length;
    if (!best || score > best.score) best = { nm, rows, head, score };
  });
  if (!best) return imsg("الملف فارغ");
  PREVIEW = { rows: best.rows.slice(best.head.at + 1), map: best.head.map,
              name: f.name + (wb.SheetNames.length > 1 ? " · ورقة: " + best.nm : ""),
              cols: best.rows[best.head.at], kind: "مخزون" };
  drawPreview();
}
const H = {
  n:  ["اسم الدواء","أسم الدواء","اسم الماده","اسم المادة","الصنف","المادة","product _name","product_name","product name","name","item","description"],
  b:  ["باركود","الباركود","barcode","product_id","product id","code","رمز"],
  c:  ["الشركة","شركة المنتج","الشركة المنتجة","company","manufacturer","المنتج"],
  e:  ["تاريخ الانتهاء","الانتهاء","الصلاحية","expiry","exp"],
  q:  ["الكمية","كارتون","العدد","qty","quantity","quamri","الرصيد"],
  k:  ["سعر المفرد","سعر الشراء","الكلفة","khh","cost","السعر","price"],
  s:  ["سعر الجمهور","سعر البيع","بيع الجمهور","price 1","price1","selling","retail"],
  bo: ["بونص","bonus","هدية"]
};
/* الأدق أولاً: نطابق العمود بأطول كلمة مفتاحية توافقه */
function findHeader(rows) {
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const cells = (rows[i] || []).map(c => String(c == null ? "" : c).trim().toLowerCase().replace(/\s+/g, " "));
    const best = {};   // key -> {col, rank}  الأولوية لترتيب الكلمة في القائمة
    cells.forEach((c, j) => {
      if (!c) return;
      for (const key in H) H[key].forEach((w, rank) => {
        if (c.includes(w.toLowerCase()) && (!best[key] || rank < best[key].rank)) best[key] = { col: j, rank };
      });
    });
    const map = {}, owner = {};
    Object.keys(best).sort((a, b) => best[a].rank - best[b].rank).forEach(key => {
      const c = best[key].col;
      if (owner[c] === undefined) { owner[c] = key; map[key] = c; }
    });
    if ("n" in map && Object.keys(map).length >= 2) return { at: i, map };
  }
  return { at: 0, map: { n: 0, k: 1 } };
}

function drawPreview() {
  const m = PREVIEW.map;
  const sample = PREVIEW.rows.filter(r => r && r[m.n]).slice(0, 5);
  $("prev").innerHTML =
    '<p><b>' + esc(PREVIEW.name) + '</b> — ' + PREVIEW.rows.filter(r => r && r[m.n]).length + ' سطراً</p>' +
    '<p class="muted">سيُصنَّف كـ <b>' + PREVIEW.kind + '</b> — الأعمدة المكتشفة: ' + Object.keys(m).map(k => ({n:"الاسم",b:"باركود",c:"الشركة",e:"الانتهاء",q:"الكمية",k:"الكلفة",s:"البيع",bo:"بونص"}[k])).join(" · ") + '</p>' +
    '<table class="tbl"><tr><th>الاسم</th><th>الكلفة</th><th>الكمية</th><th>الانتهاء</th></tr>' +
    sample.map(r => '<tr><td>' + esc(r[m.n]) + '</td><td>' + esc(r[m.k] || "") + '</td><td>' + esc(r[m.q] || "") + '</td><td>' + esc(fmtDate(r[m.e])) + '</td></tr>').join("") +
    '</table>';
  $("prev").classList.add("on"); $("doimport").classList.add("on");
}
function fmtDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && window.XLSX && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return String(d.d).padStart(2,"0") + "/" + String(d.m).padStart(2,"0") + "/" + d.y;
  }
  const nz = normExp(v);
  return nz || String(v).trim();
}
const toNum = v => {
  let x = String(v == null ? "" : v)
            .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))   /* أرقام عربية */
            .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
            .replace(/[^\d.,]/g, "");
  if (!x) return 0;
  x = x.replace(/,/g, "");                                   /* الفاصلة = فاصل آلاف */
  if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");   /* 12.500 = 12500 وليس 12.5 */
  const n = parseFloat(x);
  return isFinite(n) ? Math.round(n) : 0;
};
/* الباركودات (8 خانات فأكثر) ليست أسعاراً — تُستبعد من حساب السعر والكمية */
const isCode = c => /\d{8,}/.test(String(c).replace(/\D/g, ""));
/* أرقام الجرعة (500mg، 5ml، 2%) ليست سعراً ولا كمية، وتبقى جزءاً من الاسم */
const UNIT_RE = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|gm|g|ml|cc|iu|%)\b/gi;
const isUnit  = c => /^\d+(?:[.,]\d+)?\s*(?:mg|mcg|gm|g|ml|cc|iu|%)$/i.test(String(c).trim());

let LAST_IMPORT = null;
function undoImport() {
  if (!LAST_IMPORT) return toast("لا يوجد استيراد يمكن التراجع عنه");
  if (!confirm("التراجع عن آخر استيراد وإرجاع المخزون كما كان؟")) return;
  PATCH = LAST_IMPORT.patch; EXTRA = LAST_IMPORT.extra; PURCH = LAST_IMPORT.purch; SEQ = LAST_IMPORT.seq;
  LS.set("ph.patch", PATCH); LS.set("ph.extra", EXTRA); LS.set("ph.purch", PURCH); LS.set("ph.seq", SEQ);
  LAST_IMPORT = null;
  buildItems(); renderHome(); renderStock(); renderPurch();
  imsg("تم التراجع — المخزون رجع كما كان قبل الاستيراد");
}
function doImport() {
  if (!PREVIEW) return;
  const m = PREVIEW.map;
  let added = 0, updated = 0, changed = 0, spent = 0;
  /* لقطة قبل الكتابة حتى يمكن التراجع عن استيراد خاطئ */
  const snap = { patch: JSON.parse(JSON.stringify(PATCH)), extra: JSON.parse(JSON.stringify(EXTRA)),
                 purch: JSON.parse(JSON.stringify(PURCH)), seq: SEQ };
  const SUP = (PREVIEW.kind === "جديد")
    ? (prompt("اسم المذخر أو الشركة الموردة لهذه القائمة:", PREVIEW.sup || "") || "").trim()
    : "";
  PREVIEW.rows.forEach(r => {
    if (!r || !r[m.n]) return;
    const name = String(r[m.n]).trim();
    if (!name || name.length < 2) return;
    const rec = {
      n: name,
      b: m.b != null ? String(r[m.b] || "").trim() : "",
      c: m.c != null ? String(r[m.c] || "").trim() : "",
      e: m.e != null ? fmtDate(r[m.e]) : "",
      q: m.q != null ? toNum(r[m.q]) : 0,
      k: m.k != null ? toNum(r[m.k]) : 0,
      p: m.s != null ? toNum(r[m.s]) : 0,   /* سعر البيع يُخزَّن في p — هو الحقل الذي يستعمله باقي التطبيق */
      t: PREVIEW.kind,
      src: PREVIEW.name
    };
    const found = rec.b ? ITEMS.find(x => x.b && x.b === rec.b)
                        : ITEMS.find(x => x._n === name.toLowerCase());
    if (rec.q) spent += rec.q * (rec.k || 0);   /* يشمل الأصناف الجديدة أيضاً */
    if (found) {
      const ch = {};
      if (rec.k) {
        if (found.k && found.k !== rec.k) { ch.pk = found.k; changed++; }   /* السعر القديم */
        ch.k = rec.k;
      }
      if (SUP) ch.sup = SUP;
      if (rec.p) { ch.p = rec.p; ch.s = rec.p; }   /* s حقل قديم — نبقيه متطابقاً */
      if (PREVIEW.kind === "جديد") {
        if (rec.q) { addBatch(found, rec.q, rec.e, rec.lot); ch.q = found.q; }  /* شراء: تشغيلة جديدة */
      } else if (rec.q || rec.q === 0) ch.q = rec.q;                            /* جرد: تثبيت الكمية */
      if (rec.e) ch.e = rec.e;
      patchItem(found, ch); updated++;
    } else {
      if (PREVIEW.kind === "جديد" && rec.q) rec.bt = [{ l: "", e: rec.e || "", q: rec.q }];
      if (SUP) rec.sup = SUP;
      newExtra(rec); added++;
    }
  });
  LS.set("ph.extra", EXTRA); buildItems(); renderHome(); renderStock();
  if (PREVIEW.kind === "جديد") {
    PURCH.push({ at: new Date().toISOString(), sup: SUP || "غير محدد", file: PREVIEW.name,
                 added: added, updated: updated, changed: changed, total: spent });
    LS.set("ph.purch", PURCH);
    renderPurch();
  }
  const msg = "تم: أُضيف " + added + " صنفاً · حُدِّث " + updated + " صنفاً" +
              (changed ? " · تغيّر سعر " + changed + " صنفاً" : "") +
              (SUP ? " · المذخر: " + SUP : "");
  PREVIEW = null; $("prev").style.display = "none"; $("doimport").style.display = "none";
  LAST_IMPORT = snap;
  imsg(esc(msg) + ' <button type="button" id="undoimp">تراجع عن هذا الاستيراد</button>', true);
  const u = $("undoimp"); if (u) u.onclick = undoImport;
}

/* استيراد صورة قائمة: تعرّف ضوئي ثم تحليل الأسطر */
async function importImage(f) {
  imsg("جارٍ قراءة صورة القائمة… قد تستغرق نحو دقيقة");
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("تعذّر فتح الصورة")); });
  const big = frameTo(img, 0, 0, img.naturalWidth, img.naturalHeight, 2200);
  const text = await ocr(big);
  URL.revokeObjectURL(img.src);
  const rows = [];
  text.split(String.fromCharCode(10)).forEach(l => { const r = lineToRow(l); if (r) rows.push(r); });
  if (!rows.length) return imsg("لم تُقرأ أسطر من الصورة — صوّر القائمة أوضح وأقرب، أو استعمل PDF.");
  PREVIEW = { rows, map: { n: 0, c: 1, e: 2, q: 3, k: 4 }, name: f.name, cols: [], kind: "جديد" };
  drawPreview();
}

/* استيراد ملف Word: docx حزمة مضغوطة، نقرأ نص المستند منها */
async function importDocx(f) {
  imsg("جارٍ قراءة ملف Word…");
  const buf = new Uint8Array(await f.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b))          /* ليست حزمة ZIP = ملف .doc قديم */
    return imsg("هذا ملف Word قديم (.doc) — افتحه واحفظه بصيغة .docx ثم أعد المحاولة");
  const files = fflate.unzipSync(buf);
  const xml = files["word/document.xml"];
  if (!xml) return imsg("ملف Word غير مقروء — احفظه بصيغة .docx حديثة");
  let txt = new TextDecoder("utf-8").decode(xml);
  txt = txt.replace(/<\/w:p>/g, String.fromCharCode(10))
           .replace(/<w:tab[^>]*\/>/g, " ")
           .replace(/<\/w:tc>/g, " | ")
           .replace(/<[^>]+>/g, "");
  txt = txt.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " ");
  const rows = [];
  txt.split(String.fromCharCode(10)).forEach(l => { const r = lineToRow(l); if (r) rows.push(r); });
  if (!rows.length) return imsg("لم تُقرأ أسطر من ملف Word — تأكد أن القائمة جدول أو أسطر فيها الاسم والسعر.");
  PREVIEW = { rows, map: { n: 0, c: 1, e: 2, q: 3, k: 4 }, name: f.name, cols: [], kind: "جديد" };
  drawPreview();
}

async function importPDF(f) {
  imsg("جارٍ قراءة " + f.name + "…");
  if (!window.pdfjsLib) {
    imsg("جارٍ تحميل قارئ PDF…");
    try { await loadScript("vendor/pdf.min.js"); window.__localpdf = true; }
    catch (e) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"); }
  }
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      (window.__localpdf ? "vendor/pdf.worker.min.js"
                         : "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js");
  }
  const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
  const first = await (await pdf.getPage(1)).getTextContent();
  const rows = first.items.length ? await pdfRows(pdf) : await pdfOCR(pdf);
  if (!rows.length) return imsg("لم يُعثر على أسطر في هذا الملف.");
  PREVIEW = { rows, map: { n: 0, c: 1, e: 2, q: 3, k: 4 }, name: f.name, cols: [], kind: "جديد" };
  drawPreview();
}
async function pdfRows(pdf) {
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    imsg("قراءة الصفحة " + p + " من " + pdf.numPages + "…");
    const tc = await (await pdf.getPage(p)).getTextContent();
    const lines = [];
    tc.items.forEach(i => {
      const t = i.str.trim(); if (!t) return;
      const y = i.transform[5], x = i.transform[4];
      let l = lines.find(z => Math.abs(z.y - y) < 6);
      if (!l) { l = { y, c: [] }; lines.push(l); }
      l.c.push({ x, t });
    });
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(l => { const r = lineToRow(l.c.sort((a, b) => b.x - a.x).map(c => c.t).join(" ")); if (r) out.push(r); });
  }
  return out;
}
async function pdfOCR(pdf) {
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    imsg("تعرّف ضوئي على الصفحة " + p + " من " + pdf.numPages + " (قد تستغرق دقيقة)…");
    const page = await pdf.getPage(p), vp = page.getViewport({ scale: 2 });
    const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    const text = await ocr(cv);
    text.split(String.fromCharCode(10)).forEach(l => { const r = lineToRow(l); if (r) out.push(r); });
  }
  return out;
}
function lineToRow(line) {
  const t = String(line).replace(/\s+/g, " ").trim();
  if (t.length < 8) return null;

  /* جدول بأعمدة مفصولة: الاسم كما هو بتركيزه */
  if ((t.match(/\|/g) || []).length >= 2) {
    const cells = t.split("|").map(c => c.trim()).filter(Boolean);
    const name = cells.find(c => /[A-Za-z\u0600-\u06FF]{3,}/.test(c) && !DATE_RE.test(c)) || "";
    if (!name) return null;
    const rest = cells.filter(c => c !== name);
    const date = grabExp(t).exp;
    const comp = rest.find(c => /[A-Za-z\u0600-\u06FF]{3,}/.test(c) && !DATE_RE.test(c) && !/\d{3,}/.test(c)) || "";
    const nums = rest.filter(c => !DATE_RE.test(c) && !MY_RE.test(c) && !isCode(c) && !isUnit(c)).map(toNum).filter(n => n > 0);
    if (!nums.length) return null;
    const total = Math.max.apply(null, nums);
    let price = 0, qty = 0;
    for (const a of nums) for (const b of nums) if (a * b === total && b > 1 && b <= 10000 && a >= price) { price = a; qty = b; }
    if (!price) { const r = nums.filter(n => n !== total).sort((x, y) => y - x); price = r[0] || total; qty = price ? Math.round(total / price) : 0; }
    return [name, comp, date, qty, price];
  }

  const g = grabExp(t);
  const date = g.exp, rest = g.rest;
  const nums = (rest.replace(UNIT_RE, " ").match(/[\d,]+(?:\.\d+)?/g) || [])
                 .filter(c => !isCode(c)).map(toNum).filter(n => n > 0);
  const kept = [];
  let ki = 0;
  let name = rest.replace(UNIT_RE, m => { kept.push(m.replace(/\s+/g, "")); return " \u0001 "; })
                 .replace(/[\d,]+(?:\.\d+)?/g, " ").replace(/[%|]/g, " ")
                 .replace(/\u0001/g, () => kept[ki++] || "")
                 .replace(/\s+/g, " ").trim();
  if (!name || nums.length < 2) return null;
  const total = Math.max.apply(null, nums);
  let price = 0, qty = 0;
  for (const a of nums) for (const b of nums) if (a * b === total && b > 1 && b <= 10000 && a >= price) { price = a; qty = b; }
  if (!price) { const r = nums.filter(n => n !== total).sort((x, y) => y - x); price = r[0] || total; qty = price ? Math.round(total / price) : 0; }
  return [name, "", date, qty, price];
}


