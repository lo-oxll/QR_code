/* ======================= تهيئة اتصال Supabase ======================= */
const SUPABASE_URL = "https://hhknbkyjalsbanoudoos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SaukFLYePA4O6j9hm33Xfw_uvyYm1u-";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const KEYS = { PRODUCTS: "qissa:products", ORDERS: "qissa:orders", SETTINGS: "qissa:settings" };
const DEFAULT_PW_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// شوارع رئيسية معروفة لكل منطقة، تُقترح تلقائيًا لتسريع وتوحيد إدخال الموقع.
// المطابقة تتم بالاحتواء (includes) وليس التطابق الحرفي، لأن اسم المنطقة القادم من الوسيط
// قد يكون بصيغة "مدينة الصدر - قطاع 17" وليس "مدينة الصدر" فقط.
const STREETS_BY_REGION = {
  "مدينة الصدر": ["شارع الداخل", "شارع الفلاح", "شارع الجوادر", "شارع الأرفلي", "شارع الكيارة", "العورة"],
};
function getStreetsForRegion(regionName){
  if (!regionName) return [];
  for (const key in STREETS_BY_REGION) {
    if (regionName.includes(key)) return STREETS_BY_REGION[key];
  }
  return [];
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// يميّز بين معرّف حقيقي من قاعدة البيانات (uuid) ومعرّف قديم محلي فقط (uid() قديم غير مرتبط بأي صف فعلي)
// أي طلب/منتج قديم بمعرّف غير uuid لا يمكن تحديثه أو حذفه من Supabase مباشرة لأن العمود من نوع uuid،
// لذلك يُعامَل هنا كسجل محلي فقط: يُحذف من الذاكرة والتخزين المحلي مباشرة دون استدعاء الخادم.
function isDbId(id){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
}

/* ======================= الوضع الليلي/النهاري ======================= */
// هذا التفضيل يُحفظ في localStorage الخاص بمتصفح هذا الجهاز فقط،
// لذلك تفعيله لا يغيّر أي شيء عند أي مستخدم آخر يفتح الموقع من جهازه الخاص
const THEME_KEY = "qissa:theme";
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
function initTheme(){
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const saved = loadLocal(THEME_KEY, null) || (prefersDark ? "dark" : "light");
  applyTheme(saved);
  document.getElementById("themeToggle").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    saveLocal(THEME_KEY, next);
    applyTheme(next);
  };
}

/* ======================= الربط مع شركة الوسيط للتوصيل ======================= */
// كل الاتصال بـ API الوسيط يمر عبر Edge Function باسم "alwaseet" على Supabase،
// لأن اسم المستخدم وكلمة مرور التاجر يجب أن يبقيا على الخادم فقط ولا يظهرا هنا.
const alwaseetCache = { cities: null, packageSizeId: null, regionsByCity: {} };

async function alwaseetCall(action, params = {}) {
  const { data, error } = await supabaseClient.functions.invoke('alwaseet', {
    body: { action, ...params }
  });
  if (error) throw error;
  if (!data || data.status !== true) throw new Error(data?.msg || "تعذر الاتصال بشركة التوصيل");
  return data.data;
}

async function getAlwaseetCities() {
  if (alwaseetCache.cities) return alwaseetCache.cities;
  alwaseetCache.cities = await alwaseetCall('cities');
  return alwaseetCache.cities;
}

async function getAlwaseetRegions(cityId) {
  if (alwaseetCache.regionsByCity[cityId]) return alwaseetCache.regionsByCity[cityId];
  const regions = await alwaseetCall('regions', { city_id: cityId });
  alwaseetCache.regionsByCity[cityId] = regions;
  return regions;
}

// يحدَّد حجم الطرد تلقائيًا (يُفضَّل "عادي") حتى لا نُثقل نموذج الحجز بحقل إضافي للزبونة
async function getDefaultPackageSizeId() {
  if (alwaseetCache.packageSizeId) return alwaseetCache.packageSizeId;
  const sizes = await alwaseetCall('package-sizes');
  const normal = sizes.find(s => s.size?.includes("عادي")) || sizes[0];
  alwaseetCache.packageSizeId = normal?.id;
  return alwaseetCache.packageSizeId;
}

// يرسل طلبًا واحدًا إلى الوسيط، ويعيد { qr_id, qr_link, assigned_username, assigned_whatsapp } عند النجاح أو يرمي خطأ عند الفشل
async function sendOrderToAlwaseet({ name, phone, phone2, cityId, regionId, location, productLabel, qty, total, notes }) {
  const packageSize = await getDefaultPackageSizeId();
  const result = await alwaseetCall('create-order', {
    client_name: name,
    client_mobile: phone,
    client_mobile2: phone2 || undefined,
    city_id: cityId,
    region_id: regionId,
    location,
    type_name: productLabel,
    items_number: qty,
    price: total,
    package_size: packageSize,
    merchant_notes: notes || ""
  });
  const row = Array.isArray(result) ? result[0] : result;
  return {
    qr_id: String(row.qr_id),
    qr_link: row.qr_link,
    assigned_username: row.assigned_staff_username || null,
    assigned_whatsapp: row.assigned_staff_whatsapp || null
  };
}

/* ======================= حالة عامة ======================= */
let state = {
  view: "store",
  adminTab: "products",
  products: [],
  orders: [],
  settings: { whatsapp: "" },
  selectedProduct: null,
  // بيانات المشرف الحالي (owner أو staff) - محفوظة في الذاكرة فقط لهذه الجلسة، لا تُخزَّن على القرص
  currentAdmin: null, // { username, role, passwordHash }
  staffList: [],
  orderFilter: "pending", // "pending" (قيد المراجعة، الرئيسي) | "confirmed" | "cancelled"
};

const app = document.getElementById("app");
const loadingEl = document.getElementById("loading");
const modalBg = document.getElementById("modalBg");

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function money(n){ return Number(n||0).toLocaleString("ar"); }

function showToast(text, kind="ok"){
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = "toast" + (kind==="err" ? " err" : "");
  el.textContent = text;
  host.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
}

// يعرض اسم المستخدم وكلمة المرور بنصها الصريح مرة واحدة فقط عند إنشاء مشرف جديد.
// بعد إغلاق هذه النافذة لا يمكن استرجاع كلمة المرور من أي مكان (لأن المخزَّن هو هاش فقط)،
// لذا يجب على المالك نسخها الآن أو إخبار المشرف بها فورًا.
function showOneTimeCredentials(username, password){
  modalBg.innerHTML = `
    <div class="modal">
      <div class="row">
        <h2>بيانات دخول المشرف</h2>
        <button class="close-x" id="closeCredModal">✕</button>
      </div>
      <p class="hint" style="color:var(--err);margin-top:-8px;">
        احفظ كلمة المرور الآن — لن تظهر مرة أخرى بعد إغلاق هذه النافذة، لأنها تُخزَّن مشفّرة ولا يمكن استرجاعها لاحقًا.
      </p>
      <div class="field"><div class="box">👤<input readonly value="${esc(username)}"></div></div>
      <div class="field"><div class="box">🔑<input readonly value="${esc(password)}" style="font-family:monospace;letter-spacing:.05em;"></div></div>
      <button class="primary-btn" id="copyCredBtn">نسخ البيانات</button>
      <button class="ghost-btn" id="doneCredBtn">تم، أغلق</button>
    </div>
  `;
  modalBg.classList.add("open");
  document.getElementById("closeCredModal").onclick = closeModal;
  document.getElementById("doneCredBtn").onclick = closeModal;
  document.getElementById("copyCredBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(`اسم المستخدم: ${username}\nكلمة المرور: ${password}`);
      showToast("تم النسخ");
    } catch {
      showToast("تعذر النسخ التلقائي، انسخ يدويًا", "err");
    }
  };
}

/* ======================= الإعدادات (متزامنة عبر Supabase) ======================= */
async function loadSettings(){
  try {
    const { data, error } = await supabaseClient
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (!error && data) {
      state.settings = { whatsapp: data.whatsapp || "" };
      return;
    }
  } catch (e) { console.error("settings load error", e); }
  // fallback محلي إن تعذر الاتصال بالسحابة
  state.settings = loadLocal(KEYS.SETTINGS, { whatsapp: "" });
}

async function saveWhatsapp(newNumber){
  const { error } = await supabaseClient
    .from('settings')
    .update({ whatsapp: newNumber })
    .eq('id', 1);
  if (error) {
    console.error("settings save error", error);
    saveLocal(KEYS.SETTINGS, { whatsapp: newNumber }); // احتياط محلي فقط
    return false;
  }
  state.settings.whatsapp = newNumber;
  return true;
}

/* ======================= توجيه واتساب ======================= */
function formatWhatsapp(raw){
  let d = (raw||"").replace(/\D/g,"");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "964" + d.slice(1);
  return d;
}
function isValidWhatsapp(raw){
  const d = formatWhatsapp(raw);
  return d.length >= 10 && d.length <= 15;
}

/* ======================= ضغط الصور إلى base64 ======================= */
function resizeImage(file, maxW=720, quality=0.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW/img.width);
        const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
        const canvas = document.createElement("canvas");
        canvas.width=w; canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ======================= الرندر الرئيسي ======================= */
function render(){
  if (state.view === "store") return renderStore();
  if (state.view === "adminLogin") return renderAdminLogin();
  if (state.view === "admin") return renderAdmin();
}

function renderStore(){
  const items = state.products.map(p => {
    const imgTag = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="object-position:${esc(p.image_position || '50% 50%')};">` : '🖨️';
    return `
      <div class="card">
        <div class="img">${imgTag}</div>
        <div class="body">
          <div class="seal">${money(p.price)}<br>د.ع</div>
          <div class="info">
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          </div>
        </div>
        <button class="book-btn" data-book="${p.id}">احجز الآن</button>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="wrap">
      <header class="hero">
        <div class="brand-row">
          <h1 class="brand display">QR CODE</h1>
          <img src="logo.png" alt="شعار QR CODE" class="logo-img">
        </div>
        <span class="eyebrow">طباعة · تطريز · ليزر</span>
        <p class="lede">نطبع ونطرّز ونقصّ بالليزر كل ما تحتاجه من تشيرتات وملابس مخصصة، أوشحة التخرج، الباجات التعريفية، الأقلام المطبوعة، وسجاد Tufting بتصميمك الخاص. اختر منتجك واحجزه، وسنتواصل معك لإتمام الطلب.</p>
        <div class="contact-row">
          <a href="https://wa.me/9647714623377" target="_blank" rel="noopener" class="social-btn" title="واتساب">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.09-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.6 0-3.09-.44-4.36-1.2l-.31-.19-3.02.79.81-2.95-.2-.31A7.94 7.94 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8zm4.36-5.86c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.44-1.34-1.68-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28z"/></svg>
          </a>
          <a href="https://www.instagram.com/qr__iq" target="_blank" rel="noopener" class="social-btn" title="انستغرام">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>
          </a>
          <a href="https://www.tiktok.com/@qr__iq" target="_blank" rel="noopener" class="social-btn" title="تيك توك">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5 2h-3v13.5a3 3 0 1 1-2.5-2.96V9.4A6.5 6.5 0 1 0 16.5 15.8V8.2a7.4 7.4 0 0 0 4.5 1.5V6.6a4.3 4.3 0 0 1-4.5-4.6z"/></svg>
          </a>
        </div>
      </header>
      ${state.products.length === 0 ? `<div class="empty">لم تتم إضافة أي منتجات بعد.</div>` : `<div class="grid">${items}</div>`}
    </div>
    <button class="fab" id="adminFab" title="دخول الإدارة">🔒</button>
  `;

  app.querySelectorAll("[data-book]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedProduct = state.products.find(p => p.id === btn.dataset.book);
      openBookingModal();
    });
  });
  document.getElementById("adminFab").addEventListener("click", () => {
    state.view = "adminLogin";
    render();
  });
}

/* ---------- نافذة الحجز ---------- */
function openBookingModal(){
  const p = state.selectedProduct;
  let qty = 1;
  let cities = [];
  let regions = [];
  let citiesFailed = false;
  // القيم تُحفظ هنا وتُعاد تعبئتها في كل إعادة رسم، لأن paint() يعيد بناء الـ HTML من الصفر
  // في كل مرة (عند تغيير الكمية أو المدينة)، وبدون هذا كانت قيم الحقول تُمسح بالكامل.
  const vals = { name: "", loc: "", phone: "", instagram: "", cityId: "", cityName: "", regionId: "", regionName: "" };

  function paint(){
    const total = qty * Number(p.price);
    const modalImg = p.image ? '<img src="' + esc(p.image) + '" style="object-position:' + esc(p.image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
    const cityOptions = cities.map(c => `<option value="${esc(c.id)}" ${String(c.id)===String(vals.cityId) ? "selected" : ""}>${esc(c.city_name)}</option>`).join("");
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>تأكيد الحجز</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <div class="product-preview">
          ${modalImg}
          <div>
            <div style="font-weight:600">${esc(p.name)}</div>
            <div style="font-size:13px;color:var(--muted)">${money(p.price)} د.ع للقطعة</div>
          </div>
        </div>
        <div class="qty-row">
          <span style="font-size:14px;font-weight:600;">الكمية</span>
          <div class="qty-ctl">
            <button id="qtyMinus">−</button>
            <span id="qtyVal" style="min-width:20px;text-align:center;font-weight:700;">${qty}</span>
            <button id="qtyPlus">+</button>
          </div>
        </div>
        <div class="field"><div class="box">👤<input id="fName" placeholder="الاسم الكامل" value="${esc(vals.name)}"></div><div class="err" id="errName"></div></div>
        ${citiesFailed ? "" : `
        <div class="field"><div class="box">🏙️<select id="fCity" style="width:100%;background:transparent;border:0;outline:0;font-family:'Cairo',sans-serif;font-size:14px;">
          <option value="">${cities.length ? "اختر المدينة" : "جارِ التحميل..."}</option>${cityOptions}
        </select></div><div class="err" id="errCity"></div></div>
        <div style="position:relative;">
          <div class="field"><div class="box">🗺️<input id="fRegionSearch" autocomplete="off" value="${esc(vals.regionName)}"
            placeholder="${!vals.cityId ? "اختر المدينة أولًا" : (regions.length ? "ابحث عن المنطقة" : "جارِ التحميل...")}"
            ${vals.cityId ? "" : "disabled"}></div><div class="err" id="errRegion"></div></div>
          <div id="regionSuggest" class="suggest-list" style="display:none;"></div>
        </div>
        `}
        <div class="field"><div class="box">📍<input id="fLoc" placeholder="${citiesFailed ? "الموقع / العنوان" : "أقرب نقطة دالة (تفاصيل إضافية)"}" value="${esc(vals.loc)}"></div><div class="err" id="errLoc"></div></div>
        ${citiesFailed ? "" : `<div id="streetChips" class="street-chips"></div>`}
        <div class="field"><div class="box">📞<input id="fPhone" placeholder="رقم الهاتف" type="tel" value="${esc(vals.phone)}"></div><div class="err" id="errPhone"></div></div>
        <div class="field"><div class="box">📷<input id="fInsta" placeholder="يوزر انستغرام" value="${esc(vals.instagram)}" dir="ltr"></div><div class="err" id="errInsta"></div></div>
        <div class="total-row"><span style="font-weight:400;color:var(--muted)">الإجمالي</span><span>${money(total)} د.ع</span></div>
        <button class="primary-btn" id="submitOrder">تأكيد الحجز</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("qtyMinus").onclick = () => { qty = Math.max(1, qty-1); paint(); };
    document.getElementById("qtyPlus").onclick = () => { qty = Math.min(10, qty+1); paint(); };
    document.getElementById("submitOrder").onclick = submit;
    // حفظ القيم فور كتابتها حتى تبقى محفوظة عبر أي إعادة رسم لاحقة (تغيير الكمية مثلًا)
    document.getElementById("fName").oninput = (e) => vals.name = e.target.value;
    document.getElementById("fLoc").oninput = (e) => vals.loc = e.target.value;
    document.getElementById("fPhone").oninput = (e) => vals.phone = e.target.value;
    document.getElementById("fInsta").oninput = (e) => vals.instagram = e.target.value;
    renderStreetChips();

    if (!citiesFailed) {
      document.getElementById("fCity").onchange = async (e) => {
        vals.cityId = e.target.value;
        vals.cityName = cities.find(c => String(c.id) === String(vals.cityId))?.city_name || "";
        vals.regionId = ""; vals.regionName = "";
        regions = [];
        paint();
        if (!vals.cityId) return;
        try {
          regions = await getAlwaseetRegions(vals.cityId);
        } catch (err) {
          console.error("regions load error", err);
        }
        paint();
      };

      const regionInput = document.getElementById("fRegionSearch");
      const suggestEl = document.getElementById("regionSuggest");
      function showRegionSuggestions(query){
        const q = (query || "").trim();
        const matches = q ? regions.filter(r => r.region_name.includes(q)) : regions;
        if (!matches.length) { suggestEl.style.display = "none"; suggestEl.innerHTML = ""; return; }
        suggestEl.innerHTML = matches.slice(0, 40).map(r =>
          `<button type="button" data-rid="${esc(r.id)}" data-rname="${esc(r.region_name)}">${esc(r.region_name)}</button>`
        ).join("");
        suggestEl.style.display = "block";
        suggestEl.querySelectorAll("[data-rid]").forEach(btn => {
          // mousedown بدل click حتى يُنفَّذ قبل blur الذي يخفي القائمة
          btn.onmousedown = (ev) => {
            ev.preventDefault();
            vals.regionId = btn.dataset.rid;
            vals.regionName = btn.dataset.rname;
            regionInput.value = vals.regionName;
            suggestEl.style.display = "none";
            renderStreetChips();
          };
        });
      }
      regionInput.oninput = (e) => {
        vals.regionId = ""; // إلغاء أي منطقة مؤكدة سابقًا حتى تُختار منطقة جديدة فعليًا من الاقتراحات
        vals.regionName = e.target.value;
        showRegionSuggestions(e.target.value);
      };
      regionInput.onfocus = () => showRegionSuggestions(regionInput.value);
      regionInput.addEventListener("blur", () => setTimeout(() => { suggestEl.style.display = "none"; }, 150));
    }
  }

  // يعرض أزرار سريعة لأشهر شوارع المنطقة المختارة (إن وُجدت) أسفل حقل الموقع،
  // النقر على أي زر يضيف اسم الشارع لحقل الموقع مباشرة بدل كتابته يدويًا
  function renderStreetChips(){
    const el = document.getElementById("streetChips");
    if (!el) return;
    const streets = getStreetsForRegion(vals.regionName);
    if (!streets.length) { el.innerHTML = ""; return; }
    el.innerHTML = streets.map(s => `<button type="button" class="street-chip" data-street="${esc(s)}">${esc(s)}</button>`).join("");
    el.querySelectorAll("[data-street]").forEach(btn => {
      btn.onclick = () => {
        const s = btn.dataset.street;
        vals.loc = (vals.loc && !vals.loc.includes(s)) ? `${vals.loc} - ${s}` : (vals.loc || s);
        const locInput = document.getElementById("fLoc");
        if (locInput) locInput.value = vals.loc;
      };
    });
  }

  // تحميل قائمة المدن أول مرة فقط، وإن فشل الاتصال (مثلًا الدالة غير منشورة بعد)
  // يتحول النموذج تلقائيًا لحقل عنوان نصي حر بدل تعطيل الحجز بالكامل
  (async () => {
    try {
      cities = await Promise.race([
        getAlwaseetCities(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("انتهت مهلة الاتصال")), 9000))
      ]);
      paint();
    } catch (err) {
      console.error("alwaseet cities load error", err);
      citiesFailed = true;
      paint();
    }
  })();

  async function submit(){
    const name = vals.name.trim();
    const loc = vals.loc.trim();
    const phone = vals.phone.trim();
    const instagram = vals.instagram.trim().replace(/^@/, "");
    const cityId = citiesFailed ? "" : vals.cityId;
    const regionId = citiesFailed ? "" : vals.regionId;
    let ok = true;
    document.getElementById("errName").textContent = "";
    document.getElementById("errLoc").textContent = "";
    document.getElementById("errPhone").textContent = "";
    document.getElementById("errInsta").textContent = "";
    if (!citiesFailed) {
      document.getElementById("errCity").textContent = "";
      document.getElementById("errRegion").textContent = "";
    }
    if (!name){ document.getElementById("errName").textContent = "أدخل الاسم"; ok = false; }
    if (!loc){ document.getElementById("errLoc").textContent = "أدخل الموقع"; ok = false; }
    if (!phone || phone.replace(/\D/g,"").length < 8){ document.getElementById("errPhone").textContent = "أدخل رقم هاتف صحيح"; ok = false; }
    if (!instagram){ document.getElementById("errInsta").textContent = "أدخل يوزر الانستغرام"; ok = false; }
    if (!citiesFailed && !cityId){ document.getElementById("errCity").textContent = "اختر المدينة"; ok = false; }
    if (!citiesFailed && !regionId){ document.getElementById("errRegion").textContent = "اختر المنطقة"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("submitOrder");
    btn.disabled = true; btn.textContent = "جارِ الإرسال...";

    // نفتح نافذة واتساب فارغة الآن (أثناء نقرة الزر مباشرة)، ونملأ رابطها لاحقًا بعد جهوزية
    // بيانات الطلب — لأن أغلب المتصفحات تمنع فتح نافذة جديدة تلقائيًا بعد أي عملية غير متزامنة (await)
    const waWindow = window.open("", "_blank");

    const total = qty * Number(p.price);
    const cityName = vals.cityName;
    const regionName = vals.regionName;

    // 1) إرسال الطلب إلى جدول orders في Supabase أولًا (هذا هو السجل الأساسي دائمًا،
    //    بغض النظر عن نجاح أو فشل الاتصال بالوسيط لاحقًا)
    const { data: inserted, error } = await supabaseClient
      .from('orders')
      .insert([
        {
          customer_name: name,
          phone_number: phone,
          address: loc,
          product_name: `${p.name} (عدد: ${qty})`,
          city_id: cityId || null,
          region_id: regionId || null,
          city_name: cityName || null,
          region_name: regionName || null,
          instagram_username: instagram || null,
          qty,
          total,
          alwaseet_status: 'pending'
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      if (waWindow) waWindow.close();
      showToast("تعذر حفظ الحجز: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "تأكيد الحجز";
      return;
    }

    // تحديث فوري للواجهة محليًا (الصورة تُعرض هنا فقط، لأن جدول orders الأصلي لا يخزنها)
    const localOrder = { ...inserted, product_image: p.image || "", product_image_position: p.image_position || "50% 50%" };
    state.orders.unshift(localOrder);

    // 2) إرسال الطلب مباشرة إلى الوسيط للتوصيل — فقط إذا اختار الزبون مدينة/منطقة فعليًا
    let assignedWhatsapp = null;
    if (cityId && regionId) {
      try {
        const { qr_id, qr_link, assigned_username, assigned_whatsapp } = await sendOrderToAlwaseet({
          name, phone, cityId, regionId, location: loc,
          productLabel: p.name, qty, total,
          notes: instagram ? `انستغرام: @${instagram}` : undefined
        });
        localOrder.alwaseet_qr_id = qr_id;
        localOrder.alwaseet_qr_link = qr_link;
        localOrder.alwaseet_status = 'sent';
        localOrder.assigned_staff_username = assigned_username;
        localOrder.assigned_staff_whatsapp = assigned_whatsapp;
        assignedWhatsapp = assigned_whatsapp;
        await supabaseClient.from('orders').update({
          alwaseet_qr_id: qr_id, alwaseet_qr_link: qr_link, alwaseet_status: 'sent',
          assigned_staff_username: assigned_username, assigned_staff_whatsapp: assigned_whatsapp
        }).eq('id', inserted.id);
      } catch (err) {
        // الحجز يبقى ناجحًا للزبون دائمًا حتى لو فشل الإرسال للوسيط —
        // يمكن للمشرف إعادة المحاولة يدويًا من لوحة الإدارة
        console.error("alwaseet create-order error", err);
        localOrder.alwaseet_status = 'failed';
        localOrder.alwaseet_error = err.message || "خطأ غير معروف";
        await supabaseClient.from('orders').update({
          alwaseet_status: 'failed', alwaseet_error: localOrder.alwaseet_error
        }).eq('id', inserted.id);
      }
    }

    // إن كان هناك مشرف مسؤول عن هذا الطلب برقم واتساب شخصي، تُفتح المحادثة معه مباشرة؛
    // وإلا يُستخدم الرقم العام المشترك من الإعدادات كخطة بديلة
    const num = formatWhatsapp(assignedWhatsapp || state.settings.whatsapp);
    if (num){
      const msg = `حجز جديد من QR CODE\nالمنتج: ${p.name}\nالكمية: ${qty}\nالسعر الإجمالي: ${total} د.ع\nاسم العميل: ${name}\nالموقع: ${loc}${cityName ? ` (${cityName}${regionName ? " - " + regionName : ""})` : ""}\nرقم الهاتف: ${phone}${instagram ? `\nانستغرام: https://instagram.com/${instagram}` : ""}`;
      const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
      if (waWindow) { waWindow.location.href = waUrl; }
      else { window.open(waUrl, "_blank"); } // احتياط لو حظر المتصفح النافذة المفتوحة مسبقًا لأي سبب

      // شاشة انتظار داخل المودال نفسه بدل إغلاقه فورًا، لتوضيح أن الحجز أُرسل
      // ويجب على الزبون إرسال رسالة الواتساب المفتوحة وانتظار رد المتجر لتأكيد الطلب
      modalBg.querySelector(".modal").innerHTML = `
        <div class="center" style="padding:6px 0;">
          <div class="seal" style="margin:0 auto 16px;">✓</div>
          <h2 style="margin-bottom:8px;">تم إرسال حجزك</h2>
          <p class="hint" style="margin-bottom:22px;">فتحنا لك محادثة واتساب برسالة تحتوي كل تفاصيل طلبك — أرسلها الآن، وانتظر رد المتجر لتأكيد الحجز.</p>
          <button class="primary-btn" id="closeWaitBtn">تم</button>
        </div>
      `;
      document.getElementById("closeWaitBtn").onclick = () => { closeModal(); render(); };
      return;
    }
    if (waWindow) waWindow.close(); // لا يوجد رقم واتساب مُعرَّف أصلًا في الإعدادات، أغلق النافذة الفارغة
    showToast("تم إرسال الحجز بنجاح، سيتم التواصل معك قريبًا");
    closeModal();
    render();
  }

  paint();
  modalBg.classList.add("open");
}

function closeModal(){
  modalBg.classList.remove("open");
  modalBg.innerHTML = "";
}

/* ---------- تسجيل دخول الأدمن (يوزر + رمز، عبر Supabase) ---------- */
function renderAdminLogin(){
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="center" style="margin-bottom:14px;">
          <div class="seal" style="margin:0 auto;">دخول</div>
        </div>
        <h2 class="center" style="margin:0 0 4px;">لوحة الإدارة</h2>
        <p class="hint center">أدخل اسم المستخدم وكلمة المرور للدخول</p>
        <div class="field"><div class="box">👤<input id="usr" placeholder="اسم المستخدم" autocomplete="username"></div></div>
        <div class="field"><div class="box">🔑<input id="pw" placeholder="كلمة المرور" type="password" autocomplete="current-password"></div></div>
        <div class="err" id="loginErr" style="margin-bottom:10px;color:var(--err);font-size:12px;"></div>
        <button class="primary-btn" id="loginBtn">دخول</button>
        <button class="ghost-btn" id="backBtn">→ العودة للمتجر</button>
      </div>
    </div>
  `;
  document.getElementById("backBtn").onclick = () => { state.view = "store"; render(); };

  const usrInput = document.getElementById("usr");
  const pwInput = document.getElementById("pw");
  pwInput.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("loginBtn").onclick = doLogin;

  async function doLogin(){
    const username = usrInput.value.trim();
    const pw = pwInput.value;
    const btn = document.getElementById("loginBtn");
    if (!username || !pw) return;
    btn.disabled = true; btn.textContent = "جارِ الدخول...";

    const hash = await sha256Hex(pw);

    try {
      const { data, error } = await supabaseClient.rpc('verify_admin_login', {
        p_username: username,
        p_password_hash: hash
      });

      if (error) throw error;

      if (data && data.length > 0) {
        state.currentAdmin = { username: data[0].username, role: data[0].role, passwordHash: hash };
        document.getElementById("loginErr").textContent = "";
        state.view = "admin";
        state.adminTab = data[0].role === "owner" ? "products" : "orders";
        render();
      } else {
        document.getElementById("loginErr").textContent = "اسم المستخدم أو كلمة المرور غير صحيحة";
        btn.disabled = false; btn.textContent = "دخول";
      }
    } catch (e) {
      console.error("login error", e);
      document.getElementById("loginErr").textContent = "تعذر الاتصال بالخادم، حاول مجددًا";
      btn.disabled = false; btn.textContent = "دخول";
    }
  }
}

/* ---------- لوحة الإدارة ---------- */
function renderAdmin(){
  const isOwner = state.currentAdmin?.role === "owner";
  const roleLabel = isOwner ? "مدير المتجر" : "مشرف";

  const tabsHtml = isOwner
    ? `
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})</button>
      <button class="tab ${state.adminTab==='settings'?'active':''}" data-tab="settings">الإعدادات</button>
      <button class="tab ${state.adminTab==='admins'?'active':''}" data-tab="admins">المشرفون</button>
      <button class="tab ${state.adminTab==='myAlwaseet'?'active':''}" data-tab="myAlwaseet">حسابي بالوسيط</button>
    `
    : `
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})</button>
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
      <button class="tab ${state.adminTab==='myAlwaseet'?'active':''}" data-tab="myAlwaseet">حسابي بالوسيط</button>
    `;

  app.innerHTML = `
    <div class="wrap">
      <div class="admin-header">
        <h1 class="display" style="font-size:28px;margin:0;">لوحة QR CODE <span class="role-badge">${roleLabel}</span></h1>
        <button class="ghost-btn" id="logoutBtn" style="width:auto;">خروج ⏏</button>
      </div>
      <div class="tabs">${tabsHtml}</div>
      <div id="adminBody"></div>
    </div>
  `;
  document.getElementById("logoutBtn").onclick = () => {
    state.currentAdmin = null;
    state.view = "store";
    render();
  };
  app.querySelectorAll("[data-tab]").forEach(btn=>{
    btn.onclick = () => { state.adminTab = btn.dataset.tab; render(); };
  });

  // حماية إضافية: منع الوصول لأي تبويب غير مصرح به حتى لو تم التلاعب بالحالة محليًا
  // المشرف (staff) يُسمح له فقط بـ orders و products (عرض فقط) و myAlwaseet
  if (!isOwner && !["orders", "products", "myAlwaseet"].includes(state.adminTab)) state.adminTab = "orders";

  const body = document.getElementById("adminBody");
  if (state.adminTab === "products") {
    if (isOwner) renderProductsTab(body);
    else renderProductsReadOnly(body);
  }
  else if (state.adminTab === "orders") renderOrdersTab(body);
  else if (state.adminTab === "settings" && isOwner) renderSettingsTab(body);
  else if (state.adminTab === "admins" && isOwner) renderAdminsTab(body);
  else if (state.adminTab === "myAlwaseet") renderMyAlwaseetTab(body);
  else renderOrdersTab(body);
}

/* ---------- عرض المنتجات للمشرف (قراءة فقط، بدون إضافة أو حذف) ---------- */
function renderProductsReadOnly(body){
  if (state.products.length === 0){
    body.innerHTML = `<p class="hint center" style="padding:30px 0;">لا توجد منتجات مضافة بعد.</p>`;
    return;
  }
  body.innerHTML = `<div id="prodListRO"></div>`;
  document.getElementById("prodListRO").innerHTML = state.products.map(p => {
    const prodImg = p.image ? '<img src="' + esc(p.image) + '" style="object-position:' + esc(p.image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
    return `
      <div class="prod-row">
        ${prodImg}
        <div class="info"><h4>${esc(p.name)}</h4><p>${money(p.price)} د.ع${p.description ? " · " + esc(p.description) : ""}</p></div>
      </div>
    `;
  }).join("");
}

function renderProductsTab(body){
  let pendingImage = null;
  let pendingPos = { x: 50, y: 50 }; // نسبة موضع الصورة داخل الإطار (لضبط أي جزء منها يظهر)
  body.innerHTML = `
    <div class="panel">
      <h3>إضافة منتج جديد</h3>
      <input type="file" id="fileInput" accept="image/*" style="display:none">
      <div class="upload-box" id="uploadBox">📷 إضافة صورة المنتج</div>
      <p class="hint" id="dragHint" style="display:none;margin-top:-8px;">اسحب الصورة داخل الإطار لضبط الجزء الظاهر منها</p>
      <input class="plain-input" id="pName" placeholder="اسم المنتج">
      <div class="err" id="errPName" style="margin:-6px 0 10px;"></div>
      <input class="plain-input" id="pPrice" placeholder="السعر (د.ع)" inputmode="numeric">
      <div class="err" id="errPPrice" style="margin:-6px 0 10px;"></div>
      <textarea class="plain-textarea" id="pDesc" placeholder="وصف مختصر (اختياري)" rows="2"></textarea>
      <button class="primary-btn" id="addBtn">+ إضافة المنتج</button>
    </div>
    <div id="prodList"></div>
  `;

  const uploadBox = document.getElementById("uploadBox");
  const dragHint = document.getElementById("dragHint");

  function paintUploadBox(){
    uploadBox.innerHTML = `<img id="posImg" src="${pendingImage}" style="object-position:${pendingPos.x}% ${pendingPos.y}%;cursor:grab;">`;
    dragHint.style.display = "block";
    wireDrag();
  }

  // سحب الصورة داخل الإطار (فأرة أو لمس) لضبط أي جزء منها يظهر ضمن مساحة البطاقة المربعة
  function wireDrag(){
    const imgEl = document.getElementById("posImg");
    let dragging = false;
    let startX = 0, startY = 0, startPos = { ...pendingPos };

    function pointerPos(e){
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }
    function onDown(e){
      dragging = true;
      const p = pointerPos(e);
      startX = p.x; startY = p.y; startPos = { ...pendingPos };
      imgEl.style.cursor = "grabbing";
      e.preventDefault();
    }
    function onMove(e){
      if (!dragging) return;
      const p = pointerPos(e);
      const rect = uploadBox.getBoundingClientRect();
      const dx = ((p.x - startX) / rect.width) * 100;
      const dy = ((p.y - startY) / rect.height) * 100;
      // السحب لليمين يُظهر الجزء الأيسر من الصورة، لذا نعكس اتجاه الإزاحة عن object-position
      pendingPos.x = Math.min(100, Math.max(0, startPos.x - dx));
      pendingPos.y = Math.min(100, Math.max(0, startPos.y - dy));
      imgEl.style.objectPosition = `${pendingPos.x}% ${pendingPos.y}%`;
    }
    function onUp(){ dragging = false; if (imgEl) imgEl.style.cursor = "grab"; }

    imgEl.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    imgEl.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
  }

  uploadBox.onclick = (e) => {
    if (e.target.id === "posImg") return; // النقر على الصورة نفسها لسحبها فقط، لا يفتح منتقي الملفات
    document.getElementById("fileInput").click();
  };
  document.getElementById("fileInput").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file);
    pendingImage = dataUrl;
    pendingPos = { x: 50, y: 50 };
    paintUploadBox();
  };
  document.getElementById("pPrice").oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, "");
  };
  document.getElementById("addBtn").onclick = async () => {
    const name = document.getElementById("pName").value.trim();
    const price = document.getElementById("pPrice").value.trim();
    const desc = document.getElementById("pDesc").value.trim();
    document.getElementById("errPName").textContent = "";
    document.getElementById("errPPrice").textContent = "";
    let ok = true;
    if (!name) { document.getElementById("errPName").textContent = "أدخل اسم المنتج"; ok = false; }
    if (!price || Number(price) <= 0) { document.getElementById("errPPrice").textContent = "أدخل سعرًا صحيحًا أكبر من صفر"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("addBtn");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";

    const row = { name, price: Number(price), description: desc, image: pendingImage };
    if (pendingImage) row.image_position = `${pendingPos.x}% ${pendingPos.y}%`;

    const { error } = await supabaseClient.from('products').insert([row]);

    if (error) {
      console.error("Error inserting product:", error);
      showToast("تعذر إضافة المنتج: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "+ إضافة المنتج";
      return;
    }

    showToast("تمت إضافة المنتج بنجاح");
    await loadAll();
    renderAdmin();
  };

  const list = document.getElementById("prodList");
  if (state.products.length === 0){
    list.innerHTML = `<p class="hint center">لا توجد منتجات مضافة بعد.</p>`;
  } else {
    list.innerHTML = state.products.map(p => {
      const prodImg = p.image ? '<img src="' + esc(p.image) + '" style="object-position:' + esc(p.image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
      return `
        <div class="prod-row">
          ${prodImg}
          <div class="info"><h4>${esc(p.name)}</h4><p>${money(p.price)} د.ع</p></div>
          <button class="del-btn" data-del="${p.id}">🗑</button>
        </div>
      `;
    }).join("");
    list.querySelectorAll("[data-del]").forEach(b => {
      b.onclick = async () => {
        const confirmDelete = confirm("هل أنت متأكد من حذف هذا المنتج؟");
        if (!confirmDelete) return;
        const pid = b.dataset.del;

        // منتج قديم محفوظ محليًا فقط (معرّفه ليس uuid حقيقي) — لا يوجد صف مطابق له في Supabase أصلًا
        if (!isDbId(pid)) {
          state.products = state.products.filter(p => String(p.id) !== String(pid));
          saveLocal(KEYS.PRODUCTS, state.products);
          showToast("تم حذف المنتج (كان مخزَّنًا محليًا فقط)");
          renderAdmin();
          return;
        }

        const { error } = await supabaseClient
          .from('products')
          .delete()
          .eq('id', pid);

        if (error) {
          console.error("Error deleting product:", error);
          showToast("تعذر حذف المنتج: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }

        showToast("تم حذف المنتج");
        await loadAll();
        renderAdmin();
      };
    });
  }
}

// نص حالة الإرسال للوسيط فقط (بدون زر) — أزرار الإجراءات أصبحت موحّدة أسفل كل بطاقة
function alwaseetStatusText(o){
  if (o.alwaseet_status === 'sent' && o.alwaseet_qr_link) {
    return `<a href="${esc(o.alwaseet_qr_link)}" target="_blank" style="font-size:11px;color:var(--moss);font-weight:700;">✓ أُرسل للوسيط · وصل #${esc(o.alwaseet_qr_id)}</a>`;
  }
  if (o.alwaseet_status === 'failed') {
    return `<span style="font-size:11px;color:var(--err);">⚠ فشل الإرسال للوسيط (${esc(o.alwaseet_error || "خطأ")})</span>`;
  }
  if (o.city_id && o.region_id) {
    return `<span style="font-size:11px;color:var(--muted);">⏳ لم تُرسل للوسيط بعد</span>`;
  }
  return `<span style="font-size:11px;color:var(--muted);">— بدون مدينة/منطقة —</span>`;
}

// حالة المراجعة الافتراضية "pending" لأي طلب قديم لم يُحدَّث بعد إضافة هذا العمود
function reviewStatus(o){ return o.review_status || "pending"; }

/* ---------- تبويب الحجوزات: مقسّم إلى قيد المراجعة (الرئيسي) / مؤكدة / ملغية ---------- */
function renderOrdersTab(body){
  const isOwner = state.currentAdmin?.role === "owner";

  const counts = {
    pending: state.orders.filter(o => reviewStatus(o) === "pending").length,
    confirmed: state.orders.filter(o => reviewStatus(o) === "confirmed").length,
    cancelled: state.orders.filter(o => reviewStatus(o) === "cancelled").length,
  };

  const filterTabsHtml = `
    <div class="tabs" style="margin-bottom:16px;">
      <button class="tab ${state.orderFilter==='pending'?'active':''}" data-orderfilter="pending">قيد المراجعة (${counts.pending})</button>
      <button class="tab ${state.orderFilter==='confirmed'?'active':''}" data-orderfilter="confirmed">مؤكدة (${counts.confirmed})</button>
      <button class="tab ${state.orderFilter==='cancelled'?'active':''}" data-orderfilter="cancelled">ملغية (${counts.cancelled})</button>
    </div>
  `;

  const filtered = state.orders.filter(o => reviewStatus(o) === state.orderFilter);

  const listHtml = filtered.length === 0
    ? `<p class="hint center" style="padding:30px 0;">لا توجد حجوزات في هذا القسم.</p>`
    : filtered.map(o => {
      const orderImg = o.product_image ? '<img src="' + esc(o.product_image) + '" style="object-position:' + esc(o.product_image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
      const cannotSendToAlwaseet = !o.city_id || !o.region_id || o.alwaseet_status === 'sent';
      return `
        <div class="order-card">
          <div class="order-top">
            ${orderImg}
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;">${esc(o.product_name)} <span style="color:var(--muted);font-weight:400;">${o.qty ? `× ${o.qty}` : ''}</span></div>
              <div style="font-size:11px;color:var(--muted);">${new Date(o.created_at).toLocaleString("ar")}</div>
            </div>
            <div style="font-weight:700;font-size:14px;">${o.total ? money(o.total) + ' د.ع' : ''}</div>
          </div>
          <div class="order-details">
            <div>👤 ${esc(o.customer_name)}</div>
            <div>📍 ${esc(o.address || o.location)}${o.city_name ? ` — ${esc(o.city_name)}${o.region_name ? " / " + esc(o.region_name) : ""}` : ""}</div>
            <div>📞 <a href="https://wa.me/${formatWhatsapp(o.phone_number || o.phone)}" target="_blank" style="color:var(--ink);text-decoration:underline;">${esc(o.phone_number || o.phone)}</a></div>
            ${o.instagram_username ? `<div>📷 <a href="https://instagram.com/${esc(o.instagram_username)}" target="_blank" style="color:var(--moss);text-decoration:underline;">@${esc(o.instagram_username)}</a></div>` : ""}
            <div style="margin-top:6px;">${alwaseetStatusText(o)}</div>
          </div>
          <div class="order-actions">
            <button class="btn-cancel" data-cancel="${o.id}" ${reviewStatus(o)==='cancelled' ? 'disabled' : ''}>✕ إلغاء</button>
            <button class="btn-confirm" data-confirm="${o.id}" ${reviewStatus(o)==='confirmed' ? 'disabled' : ''}>✓ تم التأكيد</button>
            <button class="btn-whatsapp" data-wa="${o.id}">💬 واتساب</button>
            <button class="btn-whatsapp" data-wacustomer="${o.id}">📱 واتساب العميل</button>
            <button class="btn-instagram" data-instagram="${o.id}" ${o.instagram_username ? '' : 'disabled'}>📷 انستغرام العميل</button>
            <button class="btn-alwaseet" data-sendalwaseet="${o.id}" ${cannotSendToAlwaseet ? 'disabled' : ''}>${o.alwaseet_status === 'sent' ? '✓ أُرسل للوسيط' : '🚚 إرسال إلى الوسيط'}</button>
            ${isOwner ? `<button class="btn-delete" data-delorder="${o.id}">🗑 حذف</button>` : ''}
          </div>
        </div>
      `;
    }).join("");

  body.innerHTML = filterTabsHtml + listHtml;

  body.querySelectorAll("[data-orderfilter]").forEach(b => {
    b.onclick = () => { state.orderFilter = b.dataset.orderfilter; renderOrdersTab(body); };
  });

  // بعد تأكيد أو إلغاء الطلب، تُرسَل نسخة منه تلقائيًا إلى الرقم الرئيسي المسجَّل في الإعدادات،
  // مع اسم المشرف الذي اتخذ الإجراء، حتى يبقى صاحب المتجر مطّلعًا على كل حركة
  function notifyMainNumber(order, actionLabel){
    const mainNum = formatWhatsapp(state.settings.whatsapp);
    if (!mainNum) return;
    const actingUser = state.currentAdmin?.username || "غير معروف";
    const msg = `${actionLabel} — QR CODE\nبواسطة: ${actingUser}\nالمنتج: ${order.product_name}\nالعميل: ${order.customer_name}\nالهاتف: ${order.phone_number || order.phone || ""}\nالإجمالي: ${money(order.total)} د.ع`;
    window.open(`https://wa.me/${mainNum}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  async function updateReviewStatus(orderId, status){
    const order = state.orders.find(o => String(o.id) === String(orderId));
    if (!order) return;

    if (isDbId(orderId)) {
      const { error } = await supabaseClient.from('orders').update({ review_status: status }).eq('id', orderId);
      if (error) {
        console.error("update review_status error", error);
        showToast("تعذر تحديث حالة الطلب: " + (error.message || "خطأ غير معروف"), "err");
        return;
      }
    } else {
      // طلب قديم محفوظ محليًا فقط، لا صف حقيقي له في قاعدة البيانات لتحديثه
      saveLocal(KEYS.ORDERS, state.orders);
    }

    order.review_status = status;
    showToast(status === 'confirmed' ? "تم تأكيد الطلب" : "تم إلغاء الطلب");
    notifyMainNumber(order, status === 'confirmed' ? "تم تأكيد الطلب" : "تم إلغاء الطلب");
    renderOrdersTab(body);
  }

  body.querySelectorAll("[data-cancel]").forEach(b => {
    b.onclick = () => updateReviewStatus(b.dataset.cancel, "cancelled");
  });
  body.querySelectorAll("[data-confirm]").forEach(b => {
    b.onclick = () => updateReviewStatus(b.dataset.confirm, "confirmed");
  });

  body.querySelectorAll("[data-wa]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.wa));
      if (!o) return;
      const num = formatWhatsapp(o.assigned_staff_whatsapp || state.settings.whatsapp);
      if (!num) { showToast("لا يوجد رقم واتساب متاح لإرسال هذا الطلب", "err"); return; }
      const msg = `تفاصيل الحجز - QR CODE\nالمنتج: ${o.product_name}\nالعميل: ${o.customer_name}\nالهاتف: ${o.phone_number || o.phone || ""}\nالموقع: ${o.address || o.location || ""}${o.city_name ? ` (${o.city_name}${o.region_name ? " - " + o.region_name : ""})` : ""}\nالإجمالي: ${money(o.total)} د.ع`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
    };
  });

  // تواصل مباشر مع العميل نفسه على رقمه (بدون رسالة معبّأة مسبقًا، فتح محادثة فقط)
  body.querySelectorAll("[data-wacustomer]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.wacustomer));
      if (!o) return;
      const num = formatWhatsapp(o.phone_number || o.phone);
      if (!num) { showToast("رقم هاتف العميل غير صالح", "err"); return; }
      window.open(`https://wa.me/${num}`, "_blank");
    };
  });

  // فتح صفحة انستغرام الشخصية للعميل كما كتبها بنفسه عند الحجز
  body.querySelectorAll("[data-instagram]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.instagram));
      if (!o || !o.instagram_username) return;
      window.open(`https://instagram.com/${o.instagram_username}`, "_blank");
    };
  });

  body.querySelectorAll("[data-sendalwaseet]").forEach(b => {
    b.onclick = async () => {
      const order = state.orders.find(o => String(o.id) === String(b.dataset.sendalwaseet));
      if (!order) return;
      b.textContent = "جارِ الإرسال...";
      b.disabled = true;
      try {
        const { qr_id, qr_link } = await sendOrderToAlwaseet({
          name: order.customer_name,
          phone: order.phone_number || order.phone,
          cityId: order.city_id,
          regionId: order.region_id,
          location: order.address || order.location,
          productLabel: (order.product_name || "").replace(/\s*\(عدد:.*\)$/, ""),
          qty: order.qty || 1,
          total: order.total || 0
        });
        order.alwaseet_qr_id = qr_id; order.alwaseet_qr_link = qr_link; order.alwaseet_status = 'sent';
        if (isDbId(order.id)) {
          await supabaseClient.from('orders').update({
            alwaseet_qr_id: qr_id, alwaseet_qr_link: qr_link, alwaseet_status: 'sent', alwaseet_error: null
          }).eq('id', order.id);
        } else {
          saveLocal(KEYS.ORDERS, state.orders);
        }
        showToast("تم إرسال الطلب إلى الوسيط بنجاح");
        renderOrdersTab(body);
      } catch (err) {
        console.error("send alwaseet error", err);
        order.alwaseet_error = err.message || "خطأ غير معروف";
        order.alwaseet_status = 'failed';
        if (isDbId(order.id)) {
          await supabaseClient.from('orders').update({ alwaseet_status: 'failed', alwaseet_error: order.alwaseet_error }).eq('id', order.id);
        } else {
          saveLocal(KEYS.ORDERS, state.orders);
        }
        showToast("فشل الإرسال للوسيط: " + order.alwaseet_error, "err");
        renderOrdersTab(body);
      }
    };
  });

  if (isOwner) {
    body.querySelectorAll("[data-delorder]").forEach(b => {
      b.onclick = async () => {
        if (!confirm("هل أنت متأكد من حذف هذا الطلب نهائيًا؟")) return;
        const oid = b.dataset.delorder;

        if (!isDbId(oid)) {
          state.orders = state.orders.filter(o => String(o.id) !== String(oid));
          saveLocal(KEYS.ORDERS, state.orders);
          showToast("تم حذف الطلب (كان مخزَّنًا محليًا فقط)");
          renderOrdersTab(body);
          return;
        }

        const { error } = await supabaseClient.from('orders').delete().eq('id', oid);
        if (error) {
          console.error("delete order error", error);
          showToast("تعذر حذف الطلب: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }
        state.orders = state.orders.filter(o => String(o.id) !== String(oid));
        showToast("تم حذف الطلب");
        renderOrdersTab(body);
      };
    });
  }
}

function renderSettingsTab(body){
  body.innerHTML = `
    <div class="panel">
      <h3>رقم واتساب استلام الحجوزات</h3>
      <p class="hint">تُرسل كل تفاصيل الحجز تلقائيًا إلى هذا الرقم عبر واتساب. أدخل الرقم مع مفتاح الدولة (مثال: 9647701234567). هذا الرقم مشترك ويظهر فورًا على كل الأجهزة.</p>
      <input class="plain-input" id="waNum" value="${esc(state.settings.whatsapp)}" placeholder="9647xxxxxxxx" dir="ltr">
      <div class="err" id="waErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveWa">حفظ</button>
    </div>
    <div class="panel">
      <h3>تغيير كلمة مرور مدير المتجر</h3>
      <input class="plain-input" id="oldPw" type="password" placeholder="كلمة المرور الحالية">
      <input class="plain-input" id="newPw" type="password" placeholder="كلمة المرور الجديدة">
      <div class="err" id="pwMsg" style="margin:-6px 0 10px;font-size:12px;"></div>
      <button class="dark-btn" id="savePw">حفظ كلمة المرور</button>
    </div>
  `;

  document.getElementById("saveWa").onclick = async () => {
    const val = document.getElementById("waNum").value.trim();
    if (val && !isValidWhatsapp(val)) {
      document.getElementById("waErr").textContent = "الرقم غير صالح، أدخله مع مفتاح الدولة بدون علامة + (مثال: 9647701234567)";
      return;
    }
    document.getElementById("waErr").textContent = "";
    const ok = await saveWhatsapp(formatWhatsapp(val));
    if (ok) showToast("تم حفظ الإعدادات");
    else showToast("تعذر الحفظ في السحابة، تم الحفظ محليًا فقط", "err");
  };

  document.getElementById("savePw").onclick = async () => {
    const oldPw = document.getElementById("oldPw").value;
    const newPw = document.getElementById("newPw").value.trim();
    const msgEl = document.getElementById("pwMsg");

    if (!newPw || newPw.length < 4) {
      msgEl.style.color = "var(--err)";
      msgEl.textContent = "كلمة المرور الجديدة يجب أن تكون 4 أحرف/أرقام على الأقل";
      return;
    }

    const oldHash = await sha256Hex(oldPw);
    const newHash = await sha256Hex(newPw);

    try {
      const { error } = await supabaseClient.rpc('change_owner_password', {
        p_owner_username: state.currentAdmin.username,
        p_old_password_hash: oldHash,
        p_new_password_hash: newHash
      });
      if (error) throw error;

      state.currentAdmin.passwordHash = newHash;
      document.getElementById("oldPw").value = "";
      document.getElementById("newPw").value = "";
      msgEl.style.color = "var(--moss)";
      msgEl.textContent = "تم تغيير كلمة المرور بنجاح ✓";
      showToast("تم تغيير كلمة المرور");
    } catch (e) {
      console.error("change password error", e);
      msgEl.style.color = "var(--err)";
      msgEl.textContent = "كلمة المرور الحالية غير صحيحة أو تعذر الاتصال";
    }
  };
}

/* ---------- تبويب حساب الوسيط الشخصي (owner و staff) ---------- */
async function renderMyAlwaseetTab(body){
  body.innerHTML = `<p class="hint center" style="padding:20px 0;">جارِ التحميل...</p>`;

  let current = { has_account: false, alwaseet_username: "", whatsapp_number: "" };
  try {
    const { data, error } = await supabaseClient.rpc('get_my_alwaseet_account', {
      p_username: state.currentAdmin.username,
      p_password_hash: state.currentAdmin.passwordHash
    });
    if (error) throw error;
    if (data && data.length > 0) current = data[0];
  } catch (e) {
    console.error("get_my_alwaseet_account error", e);
    body.innerHTML = `<p class="hint center" style="padding:20px 0;">تعذر تحميل بيانات حسابك.<br>${esc(e.message || "")}</p>`;
    return;
  }

  body.innerHTML = `
    <div class="panel">
      <h3>حساب الوسيط للتوصيل الخاص بي</h3>
      <p class="hint">
        اربط حسابك الخاص في "الوسيط للتوصيل" هنا حتى تصلك الحجوزات مباشرة على اسمك بالتناوب مع باقي المشرفين.
        كلمة مرورك تُخزَّن مشفّرة ولا تُعرض لأي أحد بعد الحفظ، حتى لك.
        ${current.has_account ? `<br><span style="color:var(--moss);font-weight:700;">✓ حسابك مضبوط حاليًا (${esc(current.alwaseet_username || "")})</span>` : `<br><span style="color:var(--err);font-weight:700;">لم تضبط حسابك بعد — لن تصلك أي حجوزات عبر الوسيط حتى تضبطه</span>`}
      </p>
      <input class="plain-input" id="awUsr" placeholder="اسم المستخدم في الوسيط" value="${esc(current.alwaseet_username || "")}" dir="ltr">
      <input class="plain-input" id="awPw" type="password" placeholder="${current.has_account ? "كلمة مرور جديدة (اتركه فارغًا للإبقاء على القديمة)" : "كلمة المرور في الوسيط"}" dir="ltr">
      <input class="plain-input" id="awWa" placeholder="رقم واتساب شخصي للتواصل مع الزبون (مثال: 9647701234567)" value="${esc(current.whatsapp_number || "")}" dir="ltr">
      <div class="err" id="awErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveAw">حفظ</button>
    </div>
  `;

  document.getElementById("saveAw").onclick = async () => {
    const awUsr = document.getElementById("awUsr").value.trim();
    const awPw = document.getElementById("awPw").value;
    const awWa = document.getElementById("awWa").value.trim();
    const errEl = document.getElementById("awErr");
    errEl.textContent = "";

    if (awWa && !isValidWhatsapp(awWa)) {
      errEl.textContent = "رقم واتساب غير صالح، أدخله مع مفتاح الدولة بدون علامة + (مثال: 9647701234567)";
      return;
    }
    if (awUsr && !awPw && !current.has_account) {
      errEl.textContent = "أدخل كلمة مرور حساب الوسيط";
      return;
    }

    const btn = document.getElementById("saveAw");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";
    try {
      const { error } = await supabaseClient.rpc('update_my_alwaseet_account', {
        p_username: state.currentAdmin.username,
        p_password_hash: state.currentAdmin.passwordHash,
        p_alwaseet_username: awUsr || null,
        // null يعني "أبقِ كلمة المرور الحالية كما هي دون تغيير" — هذا ما تفعله دالة SQL الآن،
        // فلا خطر من فقدان كلمة مرور محفوظة سابقًا لمجرد ترك الحقل فارغًا
        p_alwaseet_password: awPw || null,
        p_whatsapp: awWa || null
      });
      if (error) throw error;
      showToast("تم حفظ بيانات حسابك بنجاح");
      renderMyAlwaseetTab(body);
    } catch (e) {
      console.error("update_my_alwaseet_account error", e);
      errEl.textContent = e.message || "تعذر الحفظ";
    } finally {
      btn.disabled = false; btn.textContent = "حفظ";
    }
  };
}

/* ---------- تبويب إدارة المشرفين (owner فقط) ---------- */
async function renderAdminsTab(body){
  body.innerHTML = `
    <div class="panel">
      <h3>إضافة مشرف جديد</h3>
      <p class="hint">يمكن للمشرف الجديد مراجعة الحجوزات فقط، ولا يستطيع تغيير كلمة المرور أو رقم واتساب أو حذف/إضافة المنتجات.<br>ستظهر لك كلمة المرور مرة واحدة فقط بعد الإضافة — احفظها فورًا، فلا يمكن استرجاعها بعد ذلك من أي مكان.</p>
      <input class="plain-input" id="newUsr" placeholder="اسم مستخدم جديد">
      <input class="plain-input" id="newPw" type="password" placeholder="كلمة المرور">
      <div class="err" id="addAdminErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="addAdminBtn">+ إضافة مشرف</button>
    </div>
    <div class="panel">
      <h3>المشرفين الحاليين</h3>
      <div id="staffList"><p class="hint center">جارِ التحميل...</p></div>
    </div>
  `;

  document.getElementById("addAdminBtn").onclick = async () => {
    const newUsr = document.getElementById("newUsr").value.trim();
    const newPw = document.getElementById("newPw").value;
    const errEl = document.getElementById("addAdminErr");
    errEl.textContent = "";
    if (!newUsr || newPw.length < 4) {
      errEl.textContent = "الرجاء إدخال اسم مستخدم وكلمة مرور لا تقل عن 4 أحرف";
      return;
    }
    const btn = document.getElementById("addAdminBtn");
    btn.disabled = true; btn.textContent = "جارِ الإضافة...";

    const newHash = await sha256Hex(newPw);
    try {
      const { error } = await supabaseClient.rpc('add_staff_admin', {
        p_owner_username: state.currentAdmin.username,
        p_owner_password_hash: state.currentAdmin.passwordHash,
        p_new_username: newUsr,
        p_new_password_hash: newHash
      });
      if (error) throw error;
      document.getElementById("newUsr").value = "";
      document.getElementById("newPw").value = "";
      // كلمة المرور بنصها الصريح موجودة هنا فقط لحظيًا قبل أن تُهاش وتُرسل.
      // بعد هذه اللحظة لا يمكن استرجاعها من أي مكان، لذا نعرضها مرة واحدة فقط للمشرف.
      showOneTimeCredentials(newUsr, newPw);
      await renderAdminsTab(body);
    } catch (e) {
      console.error("add admin error", e);
      errEl.textContent = e.message || "تعذر إضافة المشرف";
    } finally {
      btn.disabled = false; btn.textContent = "+ إضافة مشرف";
    }
  };

  try {
    const { data, error } = await supabaseClient.rpc('list_staff_admins', {
      p_owner_username: state.currentAdmin.username,
      p_owner_password_hash: state.currentAdmin.passwordHash
    });
    if (error) throw error;
    const listEl = document.getElementById("staffList");
    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="hint center">لا يوجد مشرفون مضافون بعد.</p>`;
      return;
    }
    listEl.innerHTML = data.map(s => {
      let dateLabel = "";
      try { dateLabel = s.created_at ? new Date(s.created_at).toLocaleDateString("ar") : ""; } catch { dateLabel = ""; }
      return `
      <div class="staff-row">
        <div class="info">
          <h4>${esc(s.username)}</h4>
          <p>مراجعة الحجوزات فقط${dateLabel ? " · أُضيف " + dateLabel : ""}</p>
        </div>
        <button class="del-btn" data-removeusr="${esc(s.username)}">🗑</button>
      </div>
    `;
    }).join("");
    listEl.querySelectorAll("[data-removeusr]").forEach(b => {
      b.onclick = async () => {
        if (!confirm(`هل تريد إزالة صلاحية ${b.dataset.removeusr}؟`)) return;
        try {
          const { error } = await supabaseClient.rpc('remove_staff_admin', {
            p_owner_username: state.currentAdmin.username,
            p_owner_password_hash: state.currentAdmin.passwordHash,
            p_target_username: b.dataset.removeusr
          });
          if (error) throw error;
          showToast("تمت الإزالة");
          await renderAdminsTab(body);
        } catch (e) {
          console.error("remove admin error", e);
          showToast("تعذر الإزالة", "err");
        }
      };
    });
  } catch (e) {
    console.error("list admins error", e);
    document.getElementById("staffList").innerHTML =
      `<p class="hint center">تعذر تحميل قائمة المشرفين.<br>${esc(e.message || "")}</p>`;
  }
}

/* ======================= جلب البيانات من Supabase ======================= */
async function loadAll(){
  try {
    const { data: dbProducts, error: prodErr } = await supabaseClient
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (!prodErr && dbProducts) {
      state.products = dbProducts;
    } else {
      state.products = loadLocal(KEYS.PRODUCTS, []);
    }

    const { data: dbOrders, error: ordErr } = await supabaseClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!ordErr && dbOrders) {
      state.orders = dbOrders;
    } else {
      state.orders = loadLocal(KEYS.ORDERS, []);
    }
  } catch (e) {
    console.error("Supabase load error, falling back to local:", e);
    state.products = loadLocal(KEYS.PRODUCTS, []);
    state.orders = loadLocal(KEYS.ORDERS, []);
  }
}

/* ======================= بدء التشغيل ======================= */
async function init(){
  initTheme();
  await loadAll();
  await loadSettings();

  loadingEl.style.display = "none";
  app.style.display = "block";
  render();
}

init();
