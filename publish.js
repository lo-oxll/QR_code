/* نشر المتجر للعامة بدون خادم: يرفع الصور و store-data.json إلى مستودع GitHub،
   فيقرأها كل زائر عبر الرابط (GitHub Pages). يعمل من لوحة الإدارة (المالك فقط). */
const GH = { owner: "lo-oxll", repo: "QR_code", branch: "main" };
const GH_KEY = "qrcode:gh_token";
const PUB_FILE = "store-data.json";

/* النشر عبر GitHub مخصص للوضع المحلي فقط (localdb.js). مع Supabase الحقيقي تُقرأ البيانات مباشرة من القاعدة. */
const LOCAL_DB = !(window.supabase && window.supabase.SupabaseClient);

let publishedP = null;
function loadPublished(force){
  if (!LOCAL_DB) return Promise.resolve(null);
  if (force || !publishedP) {
    publishedP = fetch(PUB_FILE + "?t=" + Date.now(), { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  return publishedP;
}

const ghUrl = p => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${p}`;
const ghReq = (url, opt = {}) => fetch(url, { ...opt, headers: { Authorization: "Bearer " + localStorage.getItem(GH_KEY), Accept: "application/vnd.github+json", "Content-Type": "application/json" } });
async function ghPut(path, b64, message){
  let sha;
  const g = await ghReq(ghUrl(path) + "?ref=" + GH.branch);
  if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error((await g.json().catch(() => ({}))).message || "HTTP " + g.status);
  const r = await ghReq(ghUrl(path), { method: "PUT", body: JSON.stringify({ message, content: b64, branch: GH.branch, ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "HTTP " + r.status);
}
async function pushImage(dataUrl, tag){
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return dataUrl;
  const path = `img/${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  await ghPut(path, m[2], "رفع صورة");
  return path;
}

async function buildData(products, srow, coupons){
  return {
    updated: new Date().toISOString(),
    products,
    settings: { whatsapp: srow.whatsapp || "", eyebrow: srow.eyebrow || "", lede: srow.lede || "", logo: srow.logo || "", policies: srow.policies || "", about_us: srow.about_us || "" },
    coupons: await Promise.all(coupons.filter(c => c.active !== false).map(async c => ({ code_hash: await sha256Hex(String(c.code).toUpperCase()), type: c.type, value: c.value })))
  };
}

/* تنزيل ملف store-data.json (الصور داخله) لرفعه يدويًا إلى GitHub — بدون رمز */
async function exportStoreFile(){
  const db = supabaseClient;
  const products = (await db.from("products").select("*").order("created_at", { ascending: false })).data || [];
  const srow = (await db.from("settings").select("*").eq("id", 1).single()).data || {};
  const coupons = (await db.from("coupons").select("*")).data || [];
  const data = await buildData(products, srow, coupons);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = PUB_FILE;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return products.length;
}

let pubBusy = false;
async function publishStore(setStatus){
  if (!localStorage.getItem(GH_KEY)) throw new Error("أدخل رمز GitHub أولًا");
  pubBusy = true;
  try { return await publishStore0(setStatus); } finally { pubBusy = false; }
}
async function publishStore0(setStatus){
  setStatus("جارٍ تجهيز البيانات…");
  const db = supabaseClient;
  const products = (await db.from("products").select("*").order("created_at", { ascending: false })).data || [];
  const srow = (await db.from("settings").select("*").eq("id", 1).single()).data || {};
  const coupons = (await db.from("coupons").select("*")).data || [];
  let n = 0;
  for (const p of products) {
    const patch = {};
    if (p.image && p.image.startsWith("data:")) { setStatus(`رفع الصور (${++n})…`); patch.image = await pushImage(p.image, "p-" + String(p.id).slice(0, 8)); }
    if (Array.isArray(p.colors) && p.colors.some(c => (c.images || []).some(i => String(i).startsWith("data:")))) {
      const cols = JSON.parse(JSON.stringify(p.colors));
      for (const c of cols) for (let i = 0; i < (c.images || []).length; i++) {
        if (String(c.images[i]).startsWith("data:")) { setStatus(`رفع الصور (${++n})…`); c.images[i] = await pushImage(c.images[i], "c-" + String(p.id).slice(0, 8)); }
      }
      patch.colors = cols;
    }
    if (Object.keys(patch).length) { await db.from("products").update(patch).eq("id", p.id); Object.assign(p, patch); }
  }
  if (srow.logo && srow.logo.startsWith("data:")) {
    setStatus("رفع الشعار…");
    srow.logo = await pushImage(srow.logo, "logo");
    await db.from("settings").update({ logo: srow.logo }).eq("id", 1);
  }
  setStatus("جارٍ النشر…");
  const data = await buildData(products, srow, coupons);
  await ghPut(PUB_FILE, btoa(unescape(encodeURIComponent(JSON.stringify(data)))), "نشر المتجر");
  publishedP = null;
  return data.products.length;
}

/* أول دخول للمدير على جهاز جديد: نسخ المنشور حاليًا إلى النسخة المحلية ليتمكن من تعديله */
async function seedFromPublished(){
  if (!LOCAL_DB) return;
  if (localStorage.getItem("qrcode:seeded")) return;
  localStorage.setItem("qrcode:seeded", "1");
  const pub = await loadPublished();
  if (!pub) return;
  pubBusy = true;
  try { await seed0(pub); } finally { pubBusy = false; }
}
async function seed0(pub){
  const have = (await supabaseClient.from("products").select("*")).data || [];
  if (!have.length && pub.products && pub.products.length) await supabaseClient.from("products").insert(pub.products);
  const s = (await supabaseClient.from("settings").select("*").eq("id", 1).single()).data || {};
  if (pub.settings && !s.whatsapp && !s.lede && !s.policies) await supabaseClient.from("settings").update(pub.settings).eq("id", 1);
}

function renderPublishPanel(el){
  if (!el) return;
  if (!LOCAL_DB) { el.style.display = "none"; return; }
  const saved = !!localStorage.getItem(GH_KEY);
  el.innerHTML = `<h3>نشر المتجر للعامة</h3>
    <p class="hint">المنتجات تُحفظ على هذا الجهاز. لتظهر لكل من يملك الرابط:<br>1) اضغط الزر أدناه لتنزيل ملف <b dir="ltr">store-data.json</b><br>2) افتح المستودع على GitHub ← <b dir="ltr">Add file</b> ← <b dir="ltr">Upload files</b> ← اختر الملف (يستبدل القديم) ← <b dir="ltr">Commit changes</b><br>3) يظهر للجميع بعد دقيقة تقريبًا.</p>
    <button class="primary-btn" id="exportBtn">⬇️ تنزيل ملف النشر</button>
    <p class="hint" id="exportStatus" style="margin-top:8px;"></p>
    <details style="margin-top:12px;"><summary class="hint" style="cursor:pointer;">نشر تلقائي برمز GitHub (اختياري)</summary>
      <p class="hint" style="margin:8px 0;">بعد حفظ الرمز يُنشر كل تعديل تلقائيًا بدون رفع يدوي.</p>
      <input class="plain-input" id="ghToken" type="password" dir="ltr" autocomplete="off" placeholder="${saved ? "الرمز محفوظ على هذا الجهاز ••••••" : "رمز GitHub (Contents: Read and write)"}">
      <button class="ghost-btn" id="ghPublish">🚀 نشر الآن</button>
      <p class="hint" id="ghStatus" style="margin-top:8px;"></p>
      ${saved ? '<button class="cp-remove" id="ghForget">حذف الرمز من هذا الجهاز</button>' : ""}
    </details>`;
  document.getElementById("exportBtn").onclick = async function(){
    const st = document.getElementById("exportStatus");
    this.disabled = true;
    try { const n = await exportStoreFile(); st.style.color = "var(--ok)"; st.textContent = `تم تنزيل الملف (${n} منتج). ارفعه الآن إلى GitHub.`; }
    catch (e) { st.style.color = "var(--err)"; st.textContent = "تعذر التنزيل: " + (e.message || e); }
    this.disabled = false;
  };
  const st = document.getElementById("ghStatus");
  const setStatus = t => { st.style.color = ""; st.textContent = t; };
  document.getElementById("ghPublish").onclick = async function(){
    const v = document.getElementById("ghToken").value.trim();
    if (v) localStorage.setItem(GH_KEY, v);
    this.disabled = true;
    try {
      const n = await publishStore(setStatus);
      st.style.color = "var(--ok)";
      st.textContent = `تم النشر ✓ (${n} منتج). يظهر للجميع خلال دقيقة تقريبًا.`;
      logActivity("نشر المتجر", String(n));
    } catch (e) {
      st.style.color = "var(--err)";
      st.textContent = "تعذر النشر: " + (e.message || e);
    }
    this.disabled = false;
  };
  const f = document.getElementById("ghForget");
  if (f) f.onclick = () => { localStorage.removeItem(GH_KEY); renderPublishPanel(el); };
}

/* نشر تلقائي: أي تعديل على المنتجات أو الإعدادات أو الكوبونات يُنشر بعد 4 ثوانٍ */
let pubTimer = 0;
function schedulePublish(){
  if (pubBusy || !localStorage.getItem(GH_KEY) || !state.currentAdmin || state.currentAdmin.role !== "owner") return;
  clearTimeout(pubTimer);
  pubTimer = setTimeout(async () => {
    if (pubBusy) return schedulePublish();
    try {
      showToast("جارٍ نشر التغييرات…");
      const n = await publishStore(() => {});
      showToast(`تم النشر للجميع ✓ (${n} منتج)`);
    } catch (e) { showToast("تعذر النشر: " + (e.message || e), "err"); }
  }, 4000);
}
if (LOCAL_DB) (function(){
  const cc = window.supabase.createClient;
  window.supabase.createClient = (...a) => {
    const c = cc(...a), from = c.from;
    c.from = t => {
      const q = from(t);
      if (["products", "settings", "coupons"].includes(t)) {
        const run = q.run.bind(q);
        q.run = async () => { const r = await run(); if (!r.error && q.op !== "select") schedulePublish(); return r; };
      }
      return q;
    };
    return c;
  };
})();
