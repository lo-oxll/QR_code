/* ======================= تهيئة اتصال Supabase ======================= */
const SUPABASE_URL = "https://hhknbkyjalsbanoudoos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SaukFLYePA4O6j9hm33Xfw_uvyYm1u-";

let supabaseClient;
try {
  if (typeof window.supabase === "undefined") throw new Error("Supabase SDK لم يُحمَّل");
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error("Supabase client init error:", e);
  if (typeof showStoreLoadError === "function") showStoreLoadError();
}

const KEYS = { PRODUCTS: "qissa:products", ORDERS: "qissa:orders", SETTINGS: "qissa:settings", CART: "qissa:cart" };
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
  // موضع الكرة داخل المفتاح يتغيّر تلقائيًا عبر CSS ([data-theme="dark"] .switch-thumb)،
  // هنا فقط نبدّل الأيقونة الظاهرة داخل الكرة
  const thumb = document.getElementById("themeThumb");
  if (thumb) thumb.textContent = theme === "dark" ? "☀️" : "🌙";
  // إن كان المتجر يستخدم الشعار الافتراضي (لا يوجد شعار مخصص محفوظ بالإعدادات)، نبدّل الصورة فورًا مع تبديل الوضع
  const logoEl = document.querySelector(".logo-img");
  if (logoEl && !state.settings.logo) logoEl.src = defaultLogoSrc();
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

/* ======================= زر السلة العلوي (ثابت خارج دورة الرندر) ======================= */
// نربطه مرة واحدة هنا بدل إعادة ربطه بكل render() لتفادي تكرار المستمعين
function initTopCart(){
  const btn = document.getElementById("cartFab");
  if (btn) btn.addEventListener("click", () => openCartModal());
}

/* ======================= إظهار تسجيل دخول الإدارة بالنقر على عنوان المتجر 3 مرات ======================= */
// لا يوجد أي زر ظاهر لدخول الإدارة في الواجهة إطلاقًا.
// النقر على عنوان "QR CODE STORE" 3 مرات متتالية خلال ثانية ونصف يفتح مباشرة نموذج تسجيل الدخول.
// تعمل بالفأرة وباللمس معًا (لأنها click عادي، وليست إيماءة لمس خاصة).
// تنبيه: هذه تعمية (obscurity) وليست حماية حقيقية — الحماية الفعلية بكلمة المرور بالخادم.
let titleClickTimes = [];
function handleTitleClickForAdmin(){
  const REQUIRED_CLICKS = 3;
  const MAX_GAP_MS = 1500; // أقصى فارق زمني بين أول نقرة وآخر نقرة بالسلسلة
  const now = Date.now();
  titleClickTimes = titleClickTimes.filter(t => now - t <= MAX_GAP_MS);
  titleClickTimes.push(now);
  if (titleClickTimes.length >= REQUIRED_CLICKS) {
    titleClickTimes = [];
    if (state.view !== "admin" && state.view !== "adminLogin") {
      state.view = "adminLogin";
      render();
    }
  }
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

/* ======================= محتوى افتراضي للواجهة الرئيسية ======================= */
// تُستخدم كقيم احتياطية إذا لم يضبط المالك محتوى مخصصًا من الإعدادات، أو إذا تعذّر الاتصال بالسحابة
const DEFAULT_EYEBROW = "طباعة · تطريز · ليزر";
const DEFAULT_LEDE = "نطبع ونطرّز ونقصّ بالليزر كل ما تحتاجه من تشيرتات وملابس مخصصة، أوشحة التخرج، الباجات التعريفية، الأقلام المطبوعة، وسجاد Tufting بتصميمك الخاص. اختر منتجك واحجزه، وسنتواصل معك لإتمام الطلب.";
const DEFAULT_CONTACT_LABEL = "تواصل معنا مباشرة عبر:";
const DEFAULT_POLICIES = "";
const DEFAULT_ABOUT = "";

// الشعار الافتراضي (عند عدم رفع شعار مخصص من الإعدادات): خلفية شفافة بالوضع النهاري،
// وصورة كاملة بدون تفريغ بالوضع الليلي، لأن الوحدات السوداء تختفي فوق خلفية غامقة بدون خلفية بيضاء خلفها
function defaultLogoSrc(){
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return isDark ? "logo-dark.png" : "logo.png";
}

/* ======================= حالة عامة ======================= */
let state = {
  view: "store",
  adminTab: "products",
  products: [],
  orders: [],
  reviews: [],
  settings: { whatsapp: "", eyebrow: DEFAULT_EYEBROW, lede: DEFAULT_LEDE, logo: "", policies: DEFAULT_POLICIES, aboutUs: DEFAULT_ABOUT },
  cart: [], // { productId, name, price, colorName, size, qty, image, imagePosition }
  // بيانات المشرف الحالي (owner أو staff) - محفوظة في الذاكرة فقط لهذه الجلسة، لا تُخزَّن على القرص
  currentAdmin: null, // { username, role, passwordHash }
  newOrdersCount: 0,
  staffList: [],
  orderFilter: "pending", // "pending" (قيد المراجعة، الرئيسي) | "confirmed" | "cancelled"
  storeSearch: "",       // نص البحث الحالي بواجهة المتجر
  storeCategory: "all",  // فلترة حسب نوع المنتج (category) — "all" يعرض الكل
  ordersDateFrom: "",    // فلترة الطلبات حسب التاريخ (تبويب الحجوزات) — من
  ordersDateTo: "",      // فلترة الطلبات حسب التاريخ (تبويب الحجوزات) — إلى
};

const app = document.getElementById("app");
const loadingEl = document.getElementById("loading");
const modalBg = document.getElementById("modalBg");

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function money(n){ return Number(n||0).toLocaleString("ar"); }
function orderRef(o){ return "#" + String(o.id).slice(-6).toUpperCase(); }

/* ======================= إدارة السلة (محلية بالمتصفح، لا تُرسل لقاعدة البيانات إلا عند إتمام الطلب) ======================= */
function saveCart(){ saveLocal(KEYS.CART, state.cart); }

function addToCart(product, variant){
  const colorName = variant?.colorName || null;
  const size = variant?.size || null;
  const existing = state.cart.find(i => i.productId === product.id && i.colorName === colorName && i.size === size);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      colorName, size, qty: 1,
      image: product.image || "",
      imagePosition: product.image_position || "50% 50%"
    });
  }
  saveCart();
}

function cartCount(){ return state.cart.reduce((sum, i) => sum + i.qty, 0); }
function cartSubtotal(){ return state.cart.reduce((sum, i) => sum + i.price * i.qty, 0); }
function updateCartBadge(){
  const btn = document.getElementById("cartFab");
  if (!btn) return;
  const count = cartCount();
  btn.innerHTML = `🛒${count > 0 ? `<span class="notif-badge" id="cartBadge" style="top:-4px;left:-4px;">${count}</span>` : ""}`;
}

// يحوّل حقل sizes النصي (مثل "S,M,L") إلى مصفوفة قياسات نظيفة، ويتجاهله بأمان إن كان غير معرّف أصلًا
function parseSizes(p){
  return String(p?.sizes || "").split(",").map(s => s.trim()).filter(Boolean);
}
// يعيد مصفوفة الألوان المتوفرة للمنتج (فارغة إن لم تُضَف أي ألوان)، بأمان حتى لو كان العمود غير موجود بعد بقاعدة البيانات
function parseColors(p){
  return Array.isArray(p?.colors) ? p.colors : [];
}
// حالة اللون/القياس/الإطار الحالي المختار لكل منتج على واجهة المتجر (تفاعل فوري بدون إعادة رسم كاملة)
const productVariantState = {};
function getVariantState(pid){
  if (!productVariantState[pid]) productVariantState[pid] = { colorIdx: 0, size: null, frame: 0 };
  return productVariantState[pid];
}

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
      state.settings = {
        whatsapp: data.whatsapp || "",
        eyebrow: data.eyebrow || DEFAULT_EYEBROW,
        lede: data.lede || DEFAULT_LEDE,
        logo: data.logo || "",
        policies: data.policies || DEFAULT_POLICIES,
        aboutUs: data.about_us || DEFAULT_ABOUT
      };
      return;
    }
  } catch (e) { console.error("settings load error", e); }
  // fallback محلي إن تعذر الاتصال بالسحابة
  state.settings = loadLocal(KEYS.SETTINGS, { whatsapp: "", eyebrow: DEFAULT_EYEBROW, lede: DEFAULT_LEDE, logo: "", policies: DEFAULT_POLICIES, aboutUs: DEFAULT_ABOUT });
}

async function saveWhatsapp(newNumber){
  const { error } = await supabaseClient
    .from('settings')
    .update({ whatsapp: newNumber })
    .eq('id', 1);
  if (error) {
    console.error("settings save error", error);
    saveLocal(KEYS.SETTINGS, { ...state.settings, whatsapp: newNumber }); // احتياط محلي فقط
    return false;
  }
  state.settings.whatsapp = newNumber;
  return true;
}

// يحفظ محتوى الواجهة الرئيسية (العنوان الفرعي، النص التعريفي، الشعار) في نفس صف الإعدادات المشترك،
// بحيث تنعكس أي تعديلات فورًا لكل زوار المتجر على كل الأجهزة
async function saveSiteContent({ eyebrow, lede, logo, policies, aboutUs }){
  const patch = {};
  if (eyebrow !== undefined) patch.eyebrow = eyebrow;
  if (lede !== undefined) patch.lede = lede;
  if (logo !== undefined) patch.logo = logo;
  if (policies !== undefined) patch.policies = policies;
  if (aboutUs !== undefined) patch.about_us = aboutUs;

  const { error } = await supabaseClient
    .from('settings')
    .update(patch)
    .eq('id', 1);

  if (error) {
    console.error("site content save error", error);
    const localPatch = { eyebrow, lede, logo, policies, aboutUs };
    Object.keys(localPatch).forEach(k => localPatch[k] === undefined && delete localPatch[k]);
    saveLocal(KEYS.SETTINGS, { ...state.settings, ...localPatch }); // احتياط محلي فقط
    return false;
  }
  const localPatch = { eyebrow, lede, logo, policies, aboutUs };
  Object.keys(localPatch).forEach(k => localPatch[k] === undefined && delete localPatch[k]);
  state.settings = { ...state.settings, ...localPatch };
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

// نفس تصغير الصورة، لكن يرجع Blob (بدل نص base64) تمهيدًا لرفعه إلى Supabase Storage
function resizeImageToBlob(file, maxW=720, quality=0.72){
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
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// يرفع صورة (Blob) إلى Supabase Storage (bucket: products) ويرجع الرابط العام المباشر
async function uploadImageToStorage(blob, folder="misc"){
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error } = await supabaseClient.storage
    .from("products")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from("products").getPublicUrl(path);
  return data.publicUrl;
}

/* ======================= الرندر الرئيسي ======================= */
function render(){
  if (state.view === "store") return renderStore();
  if (state.view === "adminLogin") return renderAdminLogin();
  if (state.view === "admin") return renderAdmin();
}

function renderStore(){
  // --- بحث + فلترة حسب النوع (category) ---
  // يعتمد على عمود "category" إن وُجد بجدول products؛ المنتجات بدون هذا الحقل تبقى ضمن "الكل" فقط
  const q = (state.storeSearch || "").trim().toLowerCase();
  const availableCategories = Array.from(new Set(state.products.map(p => p.category).filter(Boolean)));
  const visibleProducts = state.products.filter(p => {
    const matchesSearch = !q
      || (p.name || "").toLowerCase().includes(q)
      || (p.description || "").toLowerCase().includes(q);
    const matchesCategory = state.storeCategory === "all" || p.category === state.storeCategory;
    return matchesSearch && matchesCategory;
  });

  const searchBarHtml = state.products.length > 0 ? `
    <div class="store-search-bar" style="margin:18px 0 14px;">
      <input type="search" id="storeSearchInput" class="plain-input" style="margin-bottom:10px;" placeholder="🔍 ابحث عن منتج..." value="${esc(state.storeSearch)}">
      ${availableCategories.length ? `
        <div class="size-row" style="justify-content:center;flex-wrap:wrap;">
          <button type="button" class="size-chip ${state.storeCategory==='all'?'active':''}" data-cat="all">الكل</button>
          ${availableCategories.map(c => `<button type="button" class="size-chip ${state.storeCategory===c?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
        </div>
      ` : ""}
    </div>
  ` : "";

  const items = visibleProducts.map(p => {
    const colors = parseColors(p);
    const sizes = parseSizes(p);
    const vs = getVariantState(p.id);
    if (vs.colorIdx >= colors.length) vs.colorIdx = 0;

    // الصورة المعروضة: صورة اللون المختار حاليًا (وإطارها الحالي إن كانت 3D) إن وُجدت ألوان، وإلا صورة المنتج الأساسية
    const activeColor = colors[vs.colorIdx] || null;
    const activeImages = activeColor?.images?.length ? activeColor.images : (p.image ? [p.image] : []);
    if (vs.frame >= activeImages.length) vs.frame = 0;
    const shownImage = activeImages[vs.frame] || "";
    const is3d = activeColor?.type === "3d" && activeImages.length > 1;

    const imgTag = shownImage
      ? `<img id="img-${esc(p.id)}" src="${esc(shownImage)}" alt="${esc(p.name)}" style="object-position:${esc(p.image_position || '50% 50%')};" draggable="false" loading="lazy" decoding="async">`
      : '🖨️';

    const colorRow = colors.length ? `
      <div class="color-row" data-colors="${esc(p.id)}">
        ${colors.map((c,i) => `<button type="button" class="color-dot ${i===vs.colorIdx?'active':''}" data-cidx="${i}" style="background:${esc(c.hex||'#ccc')}" title="${esc(c.name||'')}"></button>`).join("")}
      </div>` : "";

    const sizeRow = sizes.length ? `
      <div class="size-row" data-sizes="${esc(p.id)}">
        ${sizes.map(s => `<button type="button" class="size-chip ${vs.size===s?'active':''}" data-size="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>` : "";

    const outOfStock = (p.stock !== undefined && p.stock !== null) && Number(p.stock) <= 0;

    return `
      <div class="card" data-pid="${esc(p.id)}">
        <div class="img" id="imgwrap-${esc(p.id)}">
          ${imgTag}
          ${is3d ? `<span class="rotate-badge" title="اسحب يمينًا أو يسارًا للتدوير">🔄 اسحب للتدوير</span>` : ""}
          ${outOfStock ? `<span class="model3d-badge" style="background:#e5484d;">نفذت الكمية</span>` : ""}
        </div>
        ${colorRow}
        ${sizeRow}
        <div class="body">
          <div class="seal">${money(p.price)} د.ع</div>
          <div class="info">
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          </div>
        </div>
        ${outOfStock
          ? `<button class="book-btn" disabled style="opacity:.5;cursor:not-allowed;">نفذت الكمية</button>`
          : `<button class="book-btn" data-book="${esc(p.id)}">🛒 أضف للسلة</button>`}
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="wrap">
      <header class="hero">
        <div class="brand-row">
          <h1 class="brand display" id="storeTitle">QR CODE STORE</h1>
          <img src="${esc(state.settings.logo || defaultLogoSrc())}" alt="شعار QR CODE" class="logo-img">
        </div>
        <span class="eyebrow">${esc(state.settings.eyebrow || DEFAULT_EYEBROW)}</span>
        <p class="lede">${esc(state.settings.lede || DEFAULT_LEDE)}</p>
        <span class="contact-label">${esc(DEFAULT_CONTACT_LABEL)}</span>
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
        <button class="ghost-btn" id="customOrderBtn" style="margin:16px auto 0;max-width:280px;">🎨 اطلب تصميمك الخاص</button>
      </header>
      ${searchBarHtml}
      ${state.products.length === 0
        ? `<div class="empty">لم تتم إضافة أي منتجات بعد.</div>`
        : (visibleProducts.length === 0
          ? `<div class="empty">لا توجد نتائج مطابقة لبحثك.</div>`
          : `<div class="grid">${items}</div>`)}
      ${state.reviews.length > 0 ? `
        <div style="margin-top:36px;">
          <h2 class="display" style="font-size:20px;text-align:center;margin-bottom:16px;">آراء عملائنا</h2>
          <div class="grid">
            ${state.reviews.map(r => `
              <div style="background:var(--card);border-radius:16px;padding:16px;">
                <div style="font-size:16px;color:#f5a623;">${"⭐".repeat(r.customer_rating)}${"☆".repeat(5 - r.customer_rating)}</div>
                ${r.customer_review ? `<p style="font-size:13px;margin:8px 0 0;">${esc(r.customer_review)}</p>` : ""}
                <div class="hint" style="margin-top:8px;">${esc(r.product_name || "")}</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      <div class="center" style="padding:24px 0 8px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        <button id="trackOrderLink" style="background:none;border:0;color:var(--muted);text-decoration:underline;font-family:'Cairo',sans-serif;font-size:13px;cursor:pointer;">تتبع طلبك</button>
        ${state.settings.aboutUs ? `<button id="aboutLink" style="background:none;border:0;color:var(--muted);text-decoration:underline;font-family:'Cairo',sans-serif;font-size:13px;cursor:pointer;">من نحن</button>` : ""}
        ${state.settings.policies ? `<button id="policiesLink" style="background:none;border:0;color:var(--muted);text-decoration:underline;font-family:'Cairo',sans-serif;font-size:13px;cursor:pointer;">السياسات والشروط</button>` : ""}
      </div>
    </div>
  `;
  // السلة ثابتة بالشريط العلوي خارج #app — نظهرها فقط في واجهة المتجر ونحدّث شارتها
  const topCartBtn = document.getElementById("cartFab");
  if (topCartBtn) topCartBtn.style.display = "flex";
  updateCartBadge();

  // النقر 3 مرات على عنوان المتجر يفتح تسجيل دخول الإدارة (بدون أي زر ظاهر)
  const titleEl = document.getElementById("storeTitle");
  if (titleEl) titleEl.addEventListener("click", handleTitleClickForAdmin);

  // --- البحث الفوري: نعيد الرسم الكامل، لكن نعيد التركيز على حقل البحث وموضع المؤشر حتى لا ينقطع الكتابة ---
  const searchInput = document.getElementById("storeSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.storeSearch = e.target.value;
      const caret = e.target.selectionStart;
      renderStore();
      const newInput = document.getElementById("storeSearchInput");
      if (newInput) { newInput.focus(); newInput.setSelectionRange(caret, caret); }
    });
  }
  app.querySelectorAll("[data-cat]").forEach(chip => {
    chip.addEventListener("click", () => {
      state.storeCategory = chip.dataset.cat;
      renderStore();
    });
  });

  // --- تفاعل الألوان: النقر على أي لون يبدّل صورة البطاقة فورًا دون إعادة رسم الصفحة كاملة ---
  app.querySelectorAll("[data-colors]").forEach(row => {
    const pid = row.dataset.colors;
    const p = state.products.find(x => String(x.id) === String(pid));
    if (!p) return;
    const colors = parseColors(p);
    row.querySelectorAll("[data-cidx]").forEach(dot => {
      dot.addEventListener("click", () => {
        const vs = getVariantState(pid);
        vs.colorIdx = Number(dot.dataset.cidx);
        vs.frame = 0;
        row.querySelectorAll("[data-cidx]").forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
        const color = colors[vs.colorIdx];
        const images = color?.images?.length ? color.images : (p.image ? [p.image] : []);
        const imgEl = document.getElementById(`img-${pid}`);
        if (imgEl && images.length) imgEl.src = images[0];
        const wrap = document.getElementById(`imgwrap-${pid}`);
        const existingBadge = wrap.querySelector(".rotate-badge");
        const is3d = color?.type === "3d" && images.length > 1;
        if (is3d && !existingBadge) {
          wrap.insertAdjacentHTML("beforeend", `<span class="rotate-badge" title="اسحب يمينًا أو يسارًا للتدوير">🔄 اسحب للتدوير</span>`);
        } else if (!is3d && existingBadge) {
          existingBadge.remove();
        }
      });
    });
  });

  // --- تفاعل القياسات: اختيار قياس واحد فقط لكل منتج ---
  app.querySelectorAll("[data-sizes]").forEach(row => {
    const pid = row.dataset.sizes;
    row.querySelectorAll("[data-size]").forEach(chip => {
      chip.addEventListener("click", () => {
        const vs = getVariantState(pid);
        vs.size = vs.size === chip.dataset.size ? null : chip.dataset.size;
        row.querySelectorAll("[data-size]").forEach(c => c.classList.remove("active"));
        if (vs.size) chip.classList.add("active");
      });
    });
  });

  // --- تدوير 3D: سحب أفقي فوق صورة أي لون معلَّم كـ 3D يبدّل بين إطاراتها (يحاكي تقليب المنتج) ---
  app.querySelectorAll(".card").forEach(card => {
    const pid = card.dataset.pid;
    const p = state.products.find(x => String(x.id) === String(pid));
    if (!p) return;
    const wrap = card.querySelector(".img");
    if (!wrap) return;
    let dragging = false, startX = 0, startFrame = 0;
    function currentImages(){
      const vs = getVariantState(pid);
      const color = parseColors(p)[vs.colorIdx];
      return (color?.type === "3d" && color.images?.length > 1) ? color.images : null;
    }
    function pointerX(e){ return (e.touches ? e.touches[0] : e).clientX; }
    function onDown(e){
      const images = currentImages();
      if (!images) return;
      dragging = true;
      startX = pointerX(e);
      startFrame = getVariantState(pid).frame;
      e.preventDefault();
    }
    function onMove(e){
      if (!dragging) return;
      const images = currentImages();
      if (!images) return;
      const dx = pointerX(e) - startX;
      const step = 18; // كل 18px سحب = إطار واحد
      const delta = Math.round(dx / step);
      const vs = getVariantState(pid);
      let next = (startFrame - delta) % images.length;
      if (next < 0) next += images.length;
      if (next !== vs.frame) {
        vs.frame = next;
        const imgEl = document.getElementById(`img-${pid}`);
        if (imgEl) imgEl.src = images[next];
      }
    }
    function onUp(){ dragging = false; }
    wrap.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    wrap.addEventListener("touchstart", onDown, { passive:false });
    window.addEventListener("touchmove", onMove, { passive:true });
    window.addEventListener("touchend", onUp);
  });

  app.querySelectorAll("[data-book]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.book;
      const p = state.products.find(x => String(x.id) === pid);
      const sizes = parseSizes(p);
      const vs = getVariantState(pid);
      if (sizes.length && !vs.size) {
        showToast("الرجاء اختيار القياس أولًا", "err");
        return;
      }
      const colors = parseColors(p);
      const activeColor = colors[vs.colorIdx] || null;
      addToCart(p, { colorName: activeColor?.name || null, size: vs.size || null });
      showToast("أُضيف للسلة 🛒");
      updateCartBadge();
    });
  });
  document.getElementById("customOrderBtn").addEventListener("click", () => {
    openCustomOrderModal();
  });
  document.getElementById("trackOrderLink").addEventListener("click", () => openTrackOrderModal());
  const aboutLink = document.getElementById("aboutLink");
  if (aboutLink) aboutLink.addEventListener("click", () => openAboutModal());
  const policiesLink = document.getElementById("policiesLink");
  if (policiesLink) policiesLink.addEventListener("click", () => openPoliciesModal());
}

function openAboutModal(){
  modalBg.innerHTML = `
    <div class="modal">
      <div class="row">
        <h2>من نحن</h2>
        <button class="close-x" id="closeModal">✕</button>
      </div>
      <p style="white-space:pre-wrap;line-height:1.9;font-size:14px;">${esc(state.settings.aboutUs || "")}</p>
    </div>
  `;
  document.getElementById("closeModal").onclick = closeModal;
  modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
  modalBg.classList.add("open");
}

function openTrackOrderModal(){
  modalBg.innerHTML = `
    <div class="modal">
      <div class="row">
        <h2>تتبع طلبك</h2>
        <button class="close-x" id="closeModal">✕</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px;">أدخل رقم طلبك (مثال: A3F2B1) ورقم الهاتف المستخدم عند الحجز.</p>
      <div class="field"><div class="box">#<input id="trackRef" placeholder="رقم الطلب" dir="ltr" style="text-transform:uppercase;"></div></div>
      <div class="field"><div class="box">📞<input id="trackPhone" placeholder="رقم الهاتف" type="tel"></div></div>
      <div class="err" id="trackErr" style="margin:-6px 0 10px;"></div>
      <button class="primary-btn" id="trackSubmit">بحث</button>
      <div id="trackResult" style="margin-top:16px;"></div>
    </div>
  `;
  document.getElementById("closeModal").onclick = closeModal;
  modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
  modalBg.classList.add("open");

  document.getElementById("trackSubmit").onclick = async () => {
    const ref = document.getElementById("trackRef").value.trim().replace(/^#/, "");
    const phone = document.getElementById("trackPhone").value.trim();
    const errEl = document.getElementById("trackErr");
    const resultEl = document.getElementById("trackResult");
    errEl.textContent = ""; resultEl.innerHTML = "";
    if (!ref || !phone) { errEl.textContent = "أدخل رقم الطلب ورقم الهاتف"; return; }

    const btn = document.getElementById("trackSubmit");
    btn.disabled = true; btn.textContent = "جارِ البحث...";
    try {
      const { data, error } = await supabaseClient.rpc('track_order', { p_ref: ref, p_phone: phone });
      if (error) throw error;
      if (!data || data.length === 0) {
        resultEl.innerHTML = `<p class="hint center">لم يتم العثور على طلب مطابق. تأكد من رقم الطلب ورقم الهاتف.</p>`;
      } else {
        const o = data[0];
        const statusLabel = { pending: "قيد المراجعة", confirmed: "تم التأكيد ✓", cancelled: "ملغي ✕" }[o.review_status || "pending"] || "قيد المراجعة";
        let reviewHtml = "";
        if (o.review_status === "confirmed") {
          if (o.customer_rating) {
            reviewHtml = `
              <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px;">
                <div class="hint" style="margin-bottom:4px;">تقييمك:</div>
                <div style="font-size:18px;">${"⭐".repeat(o.customer_rating)}${"☆".repeat(5 - o.customer_rating)}</div>
                ${o.customer_review ? `<p style="font-size:13px;margin-top:6px;">${esc(o.customer_review)}</p>` : ""}
              </div>
            `;
          } else {
            reviewHtml = `
              <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px;">
                <div class="hint" style="margin-bottom:8px;">قيّم تجربتك معنا:</div>
                <div id="starPicker" style="font-size:26px;letter-spacing:4px;margin-bottom:10px;cursor:pointer;">☆☆☆☆☆</div>
                <textarea class="plain-textarea" id="reviewText" rows="2" placeholder="تعليقك (اختياري)"></textarea>
                <div class="err" id="reviewErr" style="margin:-4px 0 8px;"></div>
                <button class="primary-btn" id="submitReview">إرسال التقييم</button>
              </div>
            `;
          }
        }
        resultEl.innerHTML = `
          <div style="background:var(--card);border-radius:14px;padding:16px;">
            <div style="font-weight:700;margin-bottom:6px;">${esc(o.product_name)}</div>
            <div class="hint">تاريخ الطلب: ${new Date(o.created_at).toLocaleDateString("ar")}</div>
            <div style="margin-top:10px;font-weight:700;">الحالة: ${statusLabel}</div>
            ${reviewHtml}
          </div>
        `;

        const starPicker = document.getElementById("starPicker");
        if (starPicker) {
          let selectedRating = 0;
          starPicker.onclick = (e) => {
            const rect = starPicker.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            selectedRating = Math.max(1, Math.min(5, Math.ceil((relX / rect.width) * 5)));
            starPicker.textContent = "⭐".repeat(selectedRating) + "☆".repeat(5 - selectedRating);
          };
          document.getElementById("submitReview").onclick = async () => {
            const reviewErr = document.getElementById("reviewErr");
            reviewErr.textContent = "";
            if (!selectedRating) { reviewErr.textContent = "اختر تقييمًا بالنجوم أولًا"; return; }
            const reviewBtn = document.getElementById("submitReview");
            reviewBtn.disabled = true; reviewBtn.textContent = "جارِ الإرسال...";
            try {
              const { error: revError } = await supabaseClient.rpc('submit_order_review', {
                p_order_id: o.id,
                p_phone: phone,
                p_rating: selectedRating,
                p_review: document.getElementById("reviewText").value.trim() || null
              });
              if (revError) throw revError;
              showToast("شكرًا لتقييمك!");
              document.getElementById("trackSubmit").click();
            } catch (e2) {
              console.error("submit review error", e2);
              reviewErr.textContent = "تعذر إرسال التقييم";
              reviewBtn.disabled = false; reviewBtn.textContent = "إرسال التقييم";
            }
          };
        }
      }
    } catch (e) {
      console.error("track order error", e);
      errEl.textContent = "تعذر البحث، حاول مجددًا";
    }
    btn.disabled = false; btn.textContent = "بحث";
  };
}

function openCartModal(){
  function paint(){
    if (state.cart.length === 0) {
      modalBg.innerHTML = `
        <div class="modal">
          <div class="row">
            <h2>سلتك</h2>
            <button class="close-x" id="closeModal">✕</button>
          </div>
          <p class="hint center" style="padding:20px 0;">سلتك فارغة. أضف منتجات من المتجر أولًا.</p>
        </div>
      `;
      document.getElementById("closeModal").onclick = closeModal;
      modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
      return;
    }

    const itemsHtml = state.cart.map((i, idx) => {
      const variantParts = [];
      if (i.colorName) variantParts.push(i.colorName);
      if (i.size) variantParts.push(i.size);
      const img = i.image ? `<img src="${esc(i.image)}" style="width:48px;height:48px;border-radius:10px;object-fit:cover;object-position:${esc(i.imagePosition || '50% 50%')};">` : `<div class="ph" style="width:48px;height:48px;border-radius:10px;"></div>`;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);">
          ${img}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(i.name)}</div>
            ${variantParts.length ? `<div style="font-size:11px;color:var(--muted);">${esc(variantParts.join(" · "))}</div>` : ""}
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">${money(i.price)} د.ع</div>
          </div>
          <div class="qty-ctl">
            <button data-cartminus="${idx}">−</button>
            <span style="min-width:18px;text-align:center;font-weight:700;">${i.qty}</span>
            <button data-cartplus="${idx}">+</button>
          </div>
          <button data-cartremove="${idx}" style="background:none;border:0;color:var(--err);font-size:16px;cursor:pointer;">🗑</button>
        </div>
      `;
    }).join("");

    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>سلتك</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <div>${itemsHtml}</div>
        <div class="total-row"><span style="font-weight:400;color:var(--muted)">المجموع</span><span>${money(cartSubtotal())} د.ع</span></div>
        <button class="primary-btn" id="goCheckout">متابعة الطلب</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("goCheckout").onclick = () => { openCartCheckoutModal(); };

    modalBg.querySelectorAll("[data-cartplus]").forEach(b => {
      b.onclick = () => { state.cart[Number(b.dataset.cartplus)].qty += 1; saveCart(); updateCartBadge(); paint(); };
    });
    modalBg.querySelectorAll("[data-cartminus]").forEach(b => {
      b.onclick = () => {
        const idx = Number(b.dataset.cartminus);
        state.cart[idx].qty -= 1;
        if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
        saveCart(); updateCartBadge(); paint();
      };
    });
    modalBg.querySelectorAll("[data-cartremove]").forEach(b => {
      b.onclick = () => { state.cart.splice(Number(b.dataset.cartremove), 1); saveCart(); updateCartBadge(); paint(); };
    });
  }
  paint();
  modalBg.classList.add("open");
}

function openPoliciesModal(){
  modalBg.innerHTML = `
    <div class="modal">
      <div class="row">
        <h2>السياسات والشروط</h2>
        <button class="close-x" id="closeModal">✕</button>
      </div>
      <p style="white-space:pre-wrap;line-height:1.9;font-size:14px;">${esc(state.settings.policies || "")}</p>
    </div>
  `;
  document.getElementById("closeModal").onclick = closeModal;
  modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
  modalBg.classList.add("open");
}

/* ---------- نافذة إتمام الطلب (سلة متعددة المنتجات) ---------- */
function openCartCheckoutModal(){
  let cities = [];
  let regions = [];
  let citiesFailed = false;
  // القيم تُحفظ هنا وتُعاد تعبئتها في كل إعادة رسم، لأن paint() يعيد بناء الـ HTML من الصفر
  // في كل مرة (عند تغيير المدينة مثلًا)، وبدون هذا كانت قيم الحقول تُمسح بالكامل.
  const vals = { name: "", loc: "", phone: "", instagram: "", cityId: "", cityName: "", regionId: "", regionName: "" };
  let appliedCoupon = null; // { code, discount_type, discount_value }

  function paint(){
    const total = cartSubtotal();
    const discount = appliedCoupon
      ? Math.min(total, appliedCoupon.discount_type === 'percent' ? Math.round(total * appliedCoupon.discount_value / 100) : appliedCoupon.discount_value)
      : 0;
    const finalTotal = total - discount;
    const itemsHtml = state.cart.map(i => {
      const variantParts = [];
      if (i.colorName) variantParts.push(i.colorName);
      if (i.size) variantParts.push(i.size);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;">${esc(i.name)}${variantParts.length ? ` <span style="color:var(--muted);font-weight:400;">(${esc(variantParts.join(" · "))})</span>` : ""}</div>
            <div style="font-size:12px;color:var(--muted);">${i.qty} × ${money(i.price)} د.ع</div>
          </div>
          <div style="font-weight:700;font-size:13px;">${money(i.price * i.qty)} د.ع</div>
        </div>
      `;
    }).join("");
    const cityOptions = cities.map(c => `<option value="${esc(c.id)}" ${String(c.id)===String(vals.cityId) ? "selected" : ""}>${esc(c.city_name)}</option>`).join("");
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>إتمام الطلب</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <div style="margin-bottom:14px;">${itemsHtml}</div>
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

        ${discount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:2px;"><span>السعر قبل الخصم</span><span>${money(total)} د.ع</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--moss);margin-bottom:6px;"><span>الخصم</span><span>-${money(discount)} د.ع</span></div>` : ""}
        <div class="total-row"><span style="font-weight:400;color:var(--muted)">الإجمالي</span><span>${money(finalTotal)} د.ع</span></div>
        <button class="primary-btn" id="submitOrder">تأكيد الطلب</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("submitOrder").onclick = submit;
    // حفظ القيم فور كتابتها حتى تبقى محفوظة عبر أي إعادة رسم لاحقة
    document.getElementById("fName").oninput = (e) => vals.name = e.target.value;
    document.getElementById("fLoc").oninput = (e) => vals.loc = e.target.value;
    document.getElementById("fPhone").oninput = (e) => vals.phone = e.target.value;
    document.getElementById("fInsta").oninput = (e) => vals.instagram = e.target.value;
    renderStreetChips();

    // ملاحظة: تم إزالة واجهة كود الخصم بالكامل من صفحة الدفع بناءً على طلب صاحب المتجر.
    // appliedCoupon يبقى null دائمًا الآن، لذا الخصم = 0 والإجمالي = السعر الكامل دومًا.

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
    if (state.cart.length === 0) { showToast("السلة فارغة", "err"); return; }
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

    const cartItems = state.cart.map(i => ({
      product_id: i.productId, name: i.name, price: i.price, qty: i.qty,
      colorName: i.colorName, size: i.size
    }));
    const total = cartSubtotal();
    const discount = appliedCoupon
      ? Math.min(total, appliedCoupon.discount_type === 'percent' ? Math.round(total * appliedCoupon.discount_value / 100) : appliedCoupon.discount_value)
      : 0;
    const finalTotal = total - discount;
    const totalQty = state.cart.reduce((s, i) => s + i.qty, 0);
    const productSummary = state.cart.map(i => {
      const parts = [];
      if (i.colorName) parts.push(i.colorName);
      if (i.size) parts.push(i.size);
      return `${i.name}${parts.length ? ` (${parts.join(" · ")})` : ""} × ${i.qty}`;
    }).join(", ");
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
          product_name: productSummary,
          cart_items: cartItems,
          city_id: cityId || null,
          region_id: regionId || null,
          city_name: cityName || null,
          region_name: regionName || null,
          instagram_username: instagram || null,
          qty: totalQty,
          total: finalTotal,
          coupon_code: appliedCoupon ? appliedCoupon.code : null,
          alwaseet_status: 'pending'
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      if (waWindow) waWindow.close();
      showToast("تعذر حفظ الطلب: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "تأكيد الطلب";
      return;
    }

    // خصم الكمية من مخزون كل منتج بالسلة (فقط للمنتجات اللي حدّد لها صاحب المتجر كمية محدودة)
    for (const item of state.cart) {
      const localP = state.products.find(x => String(x.id) === String(item.productId));
      if (localP && localP.stock !== undefined && localP.stock !== null) {
        const newStock = Math.max(0, Number(localP.stock) - item.qty);
        try {
          await supabaseClient.from('products').update({ stock: newStock }).eq('id', localP.id);
          localP.stock = newStock;
        } catch (e) {
          console.error("stock update error", e);
        }
      }
    }

    // تحديث فوري للواجهة محليًا (صورة أول منتج بالسلة تُستخدم للمعاينة فقط، لأن جدول orders لا يخزنها)
    const firstItem = state.cart[0];
    const localOrder = { ...inserted, product_image: firstItem.image || "", product_image_position: firstItem.imagePosition || "50% 50%" };
    state.orders.unshift(localOrder);

    // تفريغ السلة فور نجاح إرسال الطلب
    state.cart = [];
    saveCart();

    // 2) إرسال الطلب مباشرة إلى الوسيط للتوصيل — فقط إذا اختار الزبون مدينة/منطقة فعليًا
    let assignedWhatsapp = null;
    if (cityId && regionId) {
      try {
        const { qr_id, qr_link, assigned_username, assigned_whatsapp } = await sendOrderToAlwaseet({
          name, phone, cityId, regionId, location: loc,
          productLabel: productSummary, qty: totalQty, total: finalTotal,
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
      const msg = `حجز جديد من QR CODE\nرقم الطلب: ${orderRef(inserted)}\nالمنتجات:\n${productSummary}\nالسعر الإجمالي: ${finalTotal} د.ع${discount > 0 ? ` (بعد خصم ${discount} د.ع بكود ${appliedCoupon.code})` : ""}\nاسم العميل: ${name}\nالموقع: ${loc}${cityName ? ` (${cityName}${regionName ? " - " + regionName : ""})` : ""}\nرقم الهاتف: ${phone}${instagram ? `\nانستغرام: https://instagram.com/${instagram}` : ""}`;
      const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
      if (waWindow) { waWindow.location.href = waUrl; }
      else { window.open(waUrl, "_blank"); } // احتياط لو حظر المتصفح النافذة المفتوحة مسبقًا لأي سبب

      // شاشة انتظار داخل المودال نفسه بدل إغلاقه فورًا، لتوضيح أن الحجز أُرسل
      // ويجب على الزبون إرسال رسالة الواتساب المفتوحة وانتظار رد المتجر لتأكيد الطلب
      modalBg.querySelector(".modal").innerHTML = `
        <div class="center" style="padding:6px 0;">
          <div class="seal" style="margin:0 auto 16px;">✓</div>
          <h2 style="margin-bottom:4px;">تم إرسال طلبك</h2>
          <p style="font-weight:800;font-size:15px;margin-bottom:10px;">رقم طلبك: ${orderRef(inserted)}</p>
          <p class="hint" style="margin-bottom:22px;">فتحنا لك محادثة واتساب برسالة تحتوي كل تفاصيل طلبك — أرسلها الآن، وانتظر رد المتجر لتأكيد الحجز. احتفظ برقم الطلب لمتابعة حالته لاحقًا.</p>
          <button class="primary-btn" id="closeWaitBtn">تم</button>
        </div>
      `;
      document.getElementById("closeWaitBtn").onclick = () => { closeModal(); render(); };
      return;
    }
    if (waWindow) waWindow.close(); // لا يوجد رقم واتساب مُعرَّف أصلًا في الإعدادات، أغلق النافذة الفارغة
    showToast(`تم إرسال الطلب بنجاح — رقم طلبك: ${orderRef(inserted)}`);
    closeModal();
    render();
  }

  paint();
  modalBg.classList.add("open");
}

/* ======================= نافذة الطلب المخصص (بدون منتج محدد من الكتالوج) ======================= */
function openCustomOrderModal(){
  let cities = [];
  let regions = [];
  let citiesFailed = false;
  const vals = { name: "", loc: "", phone: "", instagram: "", cityId: "", cityName: "", regionId: "", regionName: "", designImage: null, serviceType: "طباعة", desc: "" };
  const SERVICE_TYPES = ["طباعة", "تطريز", "سجاد Tufting", "باجات / أقلام", "أخرى"];

  function paint(){
    const cityOptions = cities.map(c => `<option value="${esc(c.id)}" ${String(c.id)===String(vals.cityId) ? "selected" : ""}>${esc(c.city_name)}</option>`).join("");
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>اطلب تصميمك الخاص</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <p class="hint" style="margin:-6px 0 14px;">اشرح لنا فكرتك، أرفق تصميمك أو صورة مرجعية إن وُجدت، وسنتواصل معك لتحديد السعر وتفاصيل التنفيذ.</p>

        <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">نوع الخدمة</p>
        <div class="size-row" id="serviceTypeRow" style="margin-bottom:14px;">
          ${SERVICE_TYPES.map(t => `<button type="button" class="size-chip ${vals.serviceType===t?'active':''}" data-svc="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>

        <textarea class="plain-textarea" id="fCustomDesc" placeholder="اشرح طلبك (المقاس، الكمية، الألوان، أي تفاصيل مهمة...)" rows="3">${esc(vals.desc)}</textarea>
        <div class="err" id="errDesc" style="margin:-6px 0 10px;"></div>

        <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">تصميمك أو صورة مرجعية (اختياري)</p>
        <input type="file" id="fDesign" accept="image/*" style="display:none">
        ${vals.designImage ? `
          <div style="position:relative;width:84px;margin-bottom:10px;">
            <img src="${esc(vals.designImage)}" style="width:84px;height:84px;object-fit:cover;border-radius:12px;border:1px solid var(--line);display:block;">
            <button type="button" id="removeDesign" style="position:absolute;top:-6px;left:-6px;width:22px;height:22px;border-radius:50%;background:var(--onyx);color:#fff;border:0;cursor:pointer;font-size:12px;line-height:1;">✕</button>
          </div>
        ` : `<label class="ghost-btn" id="designLabel" style="display:block;text-align:center;cursor:pointer;margin-bottom:14px;">🎨 إرفاق صورة</label>`}

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
        <div class="field"><div class="box">📞<input id="fPhone" placeholder="رقم الهاتف" type="tel" value="${esc(vals.phone)}"></div><div class="err" id="errPhone"></div></div>
        <div class="field"><div class="box">📷<input id="fInsta" placeholder="يوزر انستغرام (اختياري)" value="${esc(vals.instagram)}" dir="ltr"></div></div>

        <button class="primary-btn" id="submitOrder">إرسال الطلب</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("submitOrder").onclick = submit;

    document.querySelectorAll("#serviceTypeRow [data-svc]").forEach(chip => {
      chip.onclick = () => { vals.serviceType = chip.dataset.svc; paint(); };
    });
    document.getElementById("fCustomDesc").oninput = (e) => vals.desc = e.target.value;
    document.getElementById("fName").oninput = (e) => vals.name = e.target.value;
    document.getElementById("fLoc").oninput = (e) => vals.loc = e.target.value;
    document.getElementById("fPhone").oninput = (e) => vals.phone = e.target.value;
    document.getElementById("fInsta").oninput = (e) => vals.instagram = e.target.value;

    const designLabel = document.getElementById("designLabel");
    if (designLabel) designLabel.onclick = () => document.getElementById("fDesign").click();
    document.getElementById("fDesign").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      // معاينة فورية أثناء الرفع
      vals.designImage = URL.createObjectURL(f);
      paint();
      try {
        const blob = await resizeImageToBlob(f, 900, 0.8);
        vals.designImage = await uploadImageToStorage(blob, "designs");
      } catch (err) {
        console.error("design image upload error", err);
        showToast("تعذر رفع الصورة", "err");
        vals.designImage = null;
      }
      paint();
    };
    const removeDesignBtn = document.getElementById("removeDesign");
    if (removeDesignBtn) removeDesignBtn.onclick = () => { vals.designImage = null; paint(); };

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
          btn.onmousedown = (ev) => {
            ev.preventDefault();
            vals.regionId = btn.dataset.rid;
            vals.regionName = btn.dataset.rname;
            regionInput.value = vals.regionName;
            suggestEl.style.display = "none";
          };
        });
      }
      regionInput.oninput = (e) => {
        vals.regionId = "";
        vals.regionName = e.target.value;
        showRegionSuggestions(e.target.value);
      };
      regionInput.onfocus = () => showRegionSuggestions(regionInput.value);
      regionInput.addEventListener("blur", () => setTimeout(() => { suggestEl.style.display = "none"; }, 150));
    }
  }

  (async function loadCities(){
    try {
      cities = await getAlwaseetCities();
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
    const desc = vals.desc.trim();
    const cityId = citiesFailed ? "" : vals.cityId;
    const regionId = citiesFailed ? "" : vals.regionId;
    let ok = true;
    document.getElementById("errName").textContent = "";
    document.getElementById("errLoc").textContent = "";
    document.getElementById("errPhone").textContent = "";
    document.getElementById("errDesc").textContent = "";
    if (!citiesFailed) {
      document.getElementById("errCity").textContent = "";
      document.getElementById("errRegion").textContent = "";
    }
    if (!desc){ document.getElementById("errDesc").textContent = "اشرح لنا طلبك بإيجاز"; ok = false; }
    if (!name){ document.getElementById("errName").textContent = "أدخل الاسم"; ok = false; }
    if (!loc){ document.getElementById("errLoc").textContent = "أدخل الموقع"; ok = false; }
    if (!phone || phone.replace(/\D/g,"").length < 8){ document.getElementById("errPhone").textContent = "أدخل رقم هاتف صحيح"; ok = false; }
    if (!citiesFailed && !cityId){ document.getElementById("errCity").textContent = "اختر المدينة"; ok = false; }
    if (!citiesFailed && !regionId){ document.getElementById("errRegion").textContent = "اختر المنطقة"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("submitOrder");
    btn.disabled = true; btn.textContent = "جارِ الإرسال...";

    const waWindow = window.open("", "_blank");
    const cityName = vals.cityName;
    const regionName = vals.regionName;

    const { data: inserted, error } = await supabaseClient
      .from('orders')
      .insert([
        {
          customer_name: name,
          phone_number: phone,
          address: loc,
          product_name: `طلب مخصص - ${vals.serviceType}`,
          city_id: cityId || null,
          region_id: regionId || null,
          city_name: cityName || null,
          region_name: regionName || null,
          instagram_username: instagram || null,
          qty: 1,
          total: null,
          alwaseet_status: 'pending',
          design_image: vals.designImage || null,
          custom_request: desc
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      if (waWindow) waWindow.close();
      showToast("تعذر إرسال الطلب: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "إرسال الطلب";
      return;
    }

    const localOrder = { ...inserted };
    state.orders.unshift(localOrder);

    // الطلبات المخصصة لا تُرسل تلقائيًا لشركة الوسيط لأن السعر غير محدد بعد —
    // يحدَّد السعر أولًا عبر التواصل، وبعدها يرسلها المشرف يدويًا من لوحة الإدارة
    const num = formatWhatsapp(state.settings.whatsapp);
    if (num){
      const msg = `طلب مخصص جديد من QR CODE\nرقم الطلب: ${orderRef(inserted)}\nنوع الخدمة: ${vals.serviceType}\nالتفاصيل: ${desc}\nاسم العميل: ${name}\nالموقع: ${loc}${cityName ? ` (${cityName}${regionName ? " - " + regionName : ""})` : ""}\nرقم الهاتف: ${phone}${instagram ? `\nانستغرام: https://instagram.com/${instagram}` : ""}${vals.designImage ? `\n🎨 صورة التصميم/المرجع: ${vals.designImage}` : ""}`;
      const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
      if (waWindow) { waWindow.location.href = waUrl; }
      else { window.open(waUrl, "_blank"); }

      modalBg.querySelector(".modal").innerHTML = `
        <div class="center" style="padding:6px 0;">
          <div class="seal" style="margin:0 auto 16px;">✓</div>
          <h2 style="margin-bottom:4px;">تم إرسال طلبك</h2>
          <p style="font-weight:800;font-size:15px;margin-bottom:10px;">رقم طلبك: ${orderRef(inserted)}</p>
          <p class="hint" style="margin-bottom:22px;">فتحنا لك محادثة واتساب بتفاصيل طلبك — أرسلها الآن، وسنتواصل معك لتحديد السعر وتأكيد التنفيذ. احتفظ برقم الطلب لمتابعة حالته لاحقًا.</p>
          <button class="primary-btn" id="closeWaitBtn">تم</button>
        </div>
      `;
      document.getElementById("closeWaitBtn").onclick = () => { closeModal(); render(); };
      return;
    }
    if (waWindow) waWindow.close();
    showToast(`تم إرسال طلبك بنجاح — رقم طلبك: ${orderRef(inserted)}`);
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
  const topCartBtn = document.getElementById("cartFab");
  if (topCartBtn) topCartBtn.style.display = "none";
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
        await loadOrders();
        startOrderPolling();
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
  const topCartBtn = document.getElementById("cartFab");
  if (topCartBtn) topCartBtn.style.display = "none";
  const isOwner = state.currentAdmin?.role === "owner";
  const roleLabel = isOwner ? "مدير المتجر" : "مشرف";

  const ordersBadge = state.newOrdersCount > 0 ? `<span class="notif-badge">${state.newOrdersCount}</span>` : "";
  const tabsHtml = isOwner
    ? `
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})${ordersBadge}</button>
      <button class="tab ${state.adminTab==='stats'?'active':''}" data-tab="stats">الإحصائيات</button>
      <button class="tab ${state.adminTab==='coupons'?'active':''}" data-tab="coupons">الكوبونات</button>
      <button class="tab ${state.adminTab==='activity'?'active':''}" data-tab="activity">سجل النشاط</button>
      <button class="tab ${state.adminTab==='settings'?'active':''}" data-tab="settings">الإعدادات</button>
      <button class="tab ${state.adminTab==='admins'?'active':''}" data-tab="admins">المشرفون</button>
      <button class="tab ${state.adminTab==='myAlwaseet'?'active':''}" data-tab="myAlwaseet">حسابي بالوسيط</button>
    `
    : `
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})${ordersBadge}</button>
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
    stopOrderPolling();
    state.newOrdersCount = 0;
    document.title = "QR CODE | طباعة · تطريز · ليزر";
    state.currentAdmin = null;
    state.view = "store";
    render();
  };
  app.querySelectorAll("[data-tab]").forEach(btn=>{
    btn.onclick = async () => {
      state.adminTab = btn.dataset.tab;
      render();
      if (state.adminTab === "orders") {
        state.newOrdersCount = 0;
        document.title = "QR CODE | طباعة · تطريز · ليزر";
        await loadOrders();
        render();
      }
    };
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
  else if (state.adminTab === "stats" && isOwner) renderStatsTab(body);
  else if (state.adminTab === "coupons" && isOwner) renderCouponsTab(body);
  else if (state.adminTab === "activity" && isOwner) renderActivityTab(body);
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
    const prodImg = p.image ? '<img src="' + esc(p.image) + '" loading="lazy" decoding="async" style="object-position:' + esc(p.image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
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
  const AVAILABLE_SIZES = ["S","M","L","XL","XXL"];
  let pendingSizes = new Set();
  let pendingColors = []; // { name, hex, type: 'normal'|'3d', images: [dataURL,...] }
  let colorDraftImages = []; // صور اللون الجاري إضافته حاليًا قبل الضغط على "أضف اللون"

  body.innerHTML = `
    <div class="panel">
      <h3>إضافة منتج جديد</h3>
      <input type="file" id="fileInput" accept="image/*" style="display:none">
      <div class="upload-box" id="uploadBox">📷 إضافة صورة المنتج</div>
      <p class="hint" id="dragHint" style="display:none;margin-top:-8px;">اسحب الصورة داخل الإطار لضبط الجزء الظاهر منها</p>
      <input class="plain-input" id="pName" placeholder="اسم المنتج">
      <div class="err" id="errPName" style="margin:-6px 0 10px;"></div>
      <input class="plain-input" id="pCategory" placeholder="النوع/التصنيف (مثال: تشيرتات، أوشحة، باجات) — اختياري">
      <input class="plain-input" id="pPrice" placeholder="السعر (د.ع)" inputmode="numeric">
      <div class="err" id="errPPrice" style="margin:-6px 0 10px;"></div>
      <textarea class="plain-textarea" id="pDesc" placeholder="وصف مختصر (اختياري)" rows="2"></textarea>

      <input class="plain-input" id="pStock" placeholder="الكمية المتوفرة (اختياري — اتركه فارغًا لكمية غير محدودة)" inputmode="numeric">
      <p class="hint" style="margin:-6px 0 16px;">إذا حددت رقمًا، يظهر "نفذت الكمية" تلقائيًا للزبون عند نفادها ويُمنع الحجز.</p>

      <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">القياسات المتوفرة (اختياري)</p>
      <div class="size-row" id="sizeBuilder" style="margin-bottom:16px;">
        ${AVAILABLE_SIZES.map(s => `<button type="button" class="size-chip" data-sz="${s}">${s}</button>`).join("")}
      </div>

      <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">الألوان المتوفرة (اختياري)</p>
      <div class="color-builder">
        <input class="plain-input" id="cName" placeholder="اسم اللون (مثال: أبيض)">
        <div class="color-builder-row">
          <input type="color" id="cHex" value="#000000">
          <label class="ghost-btn" style="flex:1;text-align:center;cursor:pointer;" id="cFilesLabel">📷 إضافة صورة/صور اللون</label>
          <input type="file" id="cFiles" accept="image/*" multiple style="display:none">
        </div>
        <p class="hint" style="margin:2px 0 10px;">صورة واحدة = عرض عادي. عدة صور متتابعة (بزوايا مختلفة) = تفعيل تلقائي لوضع 3D التفاعلي (سحب لتقليب المنتج).</p>
        <div id="colorDraftThumbs" class="color-thumbs"></div>
        <button type="button" class="dark-btn" id="addColorBtn" style="margin-bottom:14px;">+ أضف هذا اللون</button>
      </div>
      <div id="pendingColorsList" class="color-thumbs" style="margin-bottom:16px;"></div>

      <button class="primary-btn" id="addBtn">+ إضافة المنتج</button>
    </div>
    <div id="prodList"></div>
  `;

  const uploadBox = document.getElementById("uploadBox");
  const dragHint = document.getElementById("dragHint");

  // --- القياسات: تبديل تحديد كل قياس عند الضغط ---
  document.querySelectorAll("#sizeBuilder [data-sz]").forEach(chip => {
    chip.onclick = () => {
      const sz = chip.dataset.sz;
      if (pendingSizes.has(sz)) { pendingSizes.delete(sz); chip.classList.remove("active"); }
      else { pendingSizes.add(sz); chip.classList.add("active"); }
    };
  });

  // --- بناء الألوان: اختيار صورة/صور اللون الجاري إضافته ---
  const cFilesLabel = document.getElementById("cFilesLabel");
  const cFiles = document.getElementById("cFiles");
  cFilesLabel.onclick = () => cFiles.click();
  cFiles.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const f of files) {
      try {
        const blob = await resizeImageToBlob(f, 560, 0.7);
        const url = await uploadImageToStorage(blob, "colors");
        colorDraftImages.push(url);
      } catch (err) {
        console.error("color image upload error", err);
        showToast("تعذر رفع إحدى صور اللون", "err");
      }
    }
    paintColorDraftThumbs();
    cFiles.value = "";
  };

  function paintColorDraftThumbs(){
    const el = document.getElementById("colorDraftThumbs");
    el.innerHTML = colorDraftImages.map((src,i) => `
      <div class="color-thumb">
        <img src="${src}">
        <button type="button" data-rmdraft="${i}">✕</button>
      </div>
    `).join("");
    el.querySelectorAll("[data-rmdraft]").forEach(b => {
      b.onclick = () => { colorDraftImages.splice(Number(b.dataset.rmdraft), 1); paintColorDraftThumbs(); };
    });
  }

  function paintPendingColorsList(){
    const el = document.getElementById("pendingColorsList");
    if (!pendingColors.length) { el.innerHTML = ""; return; }
    el.innerHTML = pendingColors.map((c,i) => `
      <div class="color-thumb">
        <img src="${c.images[0]}">
        <span class="color-thumb-dot" style="background:${esc(c.hex)}"></span>
        <span class="color-thumb-name">${esc(c.name)}${c.type==="3d" ? " · 3D" : ""}</span>
        <button type="button" data-rmcolor="${i}">✕</button>
      </div>
    `).join("");
    el.querySelectorAll("[data-rmcolor]").forEach(b => {
      b.onclick = () => { pendingColors.splice(Number(b.dataset.rmcolor), 1); paintPendingColorsList(); };
    });
  }

  document.getElementById("addColorBtn").onclick = () => {
    const name = document.getElementById("cName").value.trim();
    const hex = document.getElementById("cHex").value;
    if (!name) { showToast("أدخل اسم اللون", "err"); return; }
    if (!colorDraftImages.length) { showToast("أضف صورة واحدة على الأقل لهذا اللون", "err"); return; }
    pendingColors.push({
      name, hex,
      type: colorDraftImages.length > 1 ? "3d" : "normal",
      images: [...colorDraftImages]
    });
    colorDraftImages = [];
    document.getElementById("cName").value = "";
    paintColorDraftThumbs();
    paintPendingColorsList();
  };

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
    // معاينة فورية أثناء الرفع (رابط مؤقت محليًا بالمتصفح، يُستبدل بالرابط النهائي بعد الرفع)
    pendingImage = URL.createObjectURL(file);
    pendingPos = { x: 50, y: 50 };
    paintUploadBox();
    try {
      const blob = await resizeImageToBlob(file);
      pendingImage = await uploadImageToStorage(blob, "products");
    } catch (err) {
      console.error("product image upload error", err);
      showToast("تعذر رفع الصورة، تحقق من إعداد Storage bucket \"products\"", "err");
      pendingImage = null;
    }
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

    const category = document.getElementById("pCategory").value.trim();
    const row = { name, price: Number(price), description: desc, image: pendingImage };
    if (category) row.category = category;
    if (pendingImage) row.image_position = `${pendingPos.x}% ${pendingPos.y}%`;
    if (pendingSizes.size) row.sizes = [...pendingSizes].join(",");
    if (pendingColors.length) row.colors = pendingColors;
    const stockVal = document.getElementById("pStock").value.trim();
    if (stockVal !== "" && !isNaN(Number(stockVal))) row.stock = Math.max(0, Math.floor(Number(stockVal)));

    const { error } = await supabaseClient.from('products').insert([row]);

    if (error) {
      console.error("Error inserting product:", error);
      showToast("تعذر إضافة المنتج: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "+ إضافة المنتج";
      return;
    }

    showToast("تمت إضافة المنتج بنجاح");
    await loadProducts();
    renderAdmin();
  };

  const list = document.getElementById("prodList");
  if (state.products.length === 0){
    list.innerHTML = `<p class="hint center">لا توجد منتجات مضافة بعد.</p>`;
  } else {
    list.innerHTML = state.products.map(p => {
      const prodImg = p.image ? '<img src="' + esc(p.image) + '" loading="lazy" decoding="async" style="object-position:' + esc(p.image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
      const colors = parseColors(p);
      const sizes = parseSizes(p);
      const variantBits = [];
      if (colors.length) variantBits.push(`${colors.length} ألوان`);
      if (sizes.length) variantBits.push(sizes.join("/"));
      if (p.stock !== undefined && p.stock !== null) variantBits.push(`المخزون: ${p.stock}`);
      return `
        <div class="prod-row">
          ${prodImg}
          <div class="info"><h4>${esc(p.name)}</h4><p>${money(p.price)} د.ع${variantBits.length ? " · " + esc(variantBits.join(" · ")) : ""}</p></div>
          <input type="number" min="0" class="stock-input" data-stockinput="${p.id}" placeholder="الكمية" value="${p.stock !== undefined && p.stock !== null ? p.stock : ''}" style="width:64px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:12px;text-align:center;">
          <button class="del-btn" data-stocksave="${p.id}" title="تحديث المخزون" style="font-size:13px;">💾</button>
          <button class="del-btn" data-del="${p.id}">🗑</button>
        </div>
      `;
    }).join("");
    list.querySelectorAll("[data-stocksave]").forEach(b => {
      b.onclick = async () => {
        const pid = b.dataset.stocksave;
        const input = list.querySelector(`[data-stockinput="${pid}"]`);
        const raw = input.value.trim();
        const newStock = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
        if (raw !== "" && isNaN(newStock)) { showToast("أدخل رقمًا صحيحًا", "err"); return; }

        if (!isDbId(pid)) {
          const localP = state.products.find(x => String(x.id) === String(pid));
          if (localP) localP.stock = newStock;
          saveLocal(KEYS.PRODUCTS, state.products);
          showToast("تم تحديث المخزون (محليًا فقط)");
          renderAdmin();
          return;
        }

        const { error } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', pid);
        if (error) {
          console.error("stock update error", error);
          showToast("تعذر تحديث المخزون: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }
        const p2 = state.products.find(x => String(x.id) === String(pid));
        if (p2) p2.stock = newStock;
        showToast("تم تحديث المخزون بنجاح");
        renderAdmin();
      };
    });
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
        await loadProducts();
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
/* ======================= طباعة فاتورة العميل وإيصال الإنتاج الداخلي ======================= */
function openPrintWindow(title, bodyHtml){
  const win = window.open("", "_blank");
  if (!win) { showToast("يرجى السماح بالنوافذ المنبثقة لهذا الموقع لتتمكن من الطباعة", "err"); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        body{font-family:'Cairo',Tahoma,sans-serif;padding:28px;color:#111;max-width:520px;margin:0 auto;}
        h1{font-size:20px;margin:0 0 4px;}
        h2{font-size:15px;margin:0 0 18px;color:#555;font-weight:600;}
        table{width:100%;border-collapse:collapse;margin-top:14px;}
        td{padding:8px 0;border-bottom:1px solid #eee;font-size:14px;vertical-align:top;}
        td.label{color:#777;width:38%;}
        .total{font-size:17px;font-weight:800;margin-top:16px;text-align:left;}
        .foot{margin-top:30px;font-size:12px;color:#999;text-align:center;}
        img.design{max-width:140px;border-radius:8px;margin-top:6px;}
        @media print{ .no-print{display:none;} }
      </style>
    </head>
    <body>
      ${bodyHtml}
      <button class="no-print" onclick="window.print()" style="margin-top:22px;padding:10px 20px;border-radius:10px;border:2px solid #111;background:none;font-family:inherit;font-size:14px;cursor:pointer;">🖨️ طباعة / حفظ PDF</button>
    </body>
    </html>
  `);
  win.document.close();
}

function printInvoice(o){
  const invoiceNo = "INV-" + String(o.id).slice(-6).toUpperCase();
  const dateStr = new Date(o.created_at).toLocaleDateString("ar");
  const itemsRows = Array.isArray(o.cart_items) && o.cart_items.length
    ? o.cart_items.map(i => {
        const parts = [];
        if (i.colorName) parts.push(i.colorName);
        if (i.size) parts.push(i.size);
        return `<tr><td>${esc(i.name)}${parts.length ? ` (${esc(parts.join(" · "))})` : ""}</td><td>${esc(i.qty)}</td><td>${money(i.price * i.qty)} د.ع</td></tr>`;
      }).join("")
    : `<tr><td>${esc(o.product_name)}</td><td>${esc(o.qty || 1)}</td><td>${o.total ? money(o.total) + " د.ع" : ""}</td></tr>`;
  openPrintWindow("فاتورة " + invoiceNo, `
    <h1>QR CODE</h1>
    <h2>فاتورة رقم ${esc(invoiceNo)} — ${dateStr}</h2>
    <table>
      <tr><td class="label">الزبون</td><td>${esc(o.customer_name)}</td></tr>
      <tr><td class="label">الهاتف</td><td dir="ltr">${esc(o.phone_number || o.phone || "")}</td></tr>
      <tr><td class="label">العنوان</td><td>${esc(o.address || o.location || "")}${o.city_name ? " — " + esc(o.city_name) : ""}</td></tr>
    </table>
    <table style="margin-top:16px;">
      <tr style="font-weight:700;"><td>المنتج</td><td>الكمية</td><td>السعر</td></tr>
      ${itemsRows}
    </table>
    ${o.coupon_code ? `<div style="font-size:13px;color:#777;margin-top:8px;">كود الخصم المستخدم: ${esc(o.coupon_code)}</div>` : ""}
    <div class="total">الإجمالي: ${o.total ? money(o.total) + " د.ع" : "يُحدَّد لاحقًا"}</div>
    <div class="foot">شكرًا لثقتكم بـ QR CODE</div>
  `);
}

function printProductionSlip(o){
  const itemsRows = Array.isArray(o.cart_items) && o.cart_items.length
    ? o.cart_items.map(i => {
        const parts = [];
        if (i.colorName) parts.push(i.colorName);
        if (i.size) parts.push(i.size);
        return `<tr><td>${esc(i.name)}${parts.length ? ` (${esc(parts.join(" · "))})` : ""}</td><td>${esc(i.qty)}</td></tr>`;
      }).join("")
    : `<tr><td>${esc(o.product_name)}</td><td>${esc(o.qty || 1)}</td></tr>`;
  openPrintWindow("إيصال إنتاج", `
    <h1>إيصال إنتاج داخلي</h1>
    <h2>رقم الطلب: ${esc(String(o.id).slice(-6).toUpperCase())} — ${new Date(o.created_at).toLocaleDateString("ar")}</h2>
    <table>
      <tr style="font-weight:700;"><td>المنتج</td><td>الكمية</td></tr>
      ${itemsRows}
    </table>
    ${o.custom_request ? `<div style="margin-top:10px;"><strong style="font-size:13px;">تفاصيل الطلب:</strong><br>${esc(o.custom_request)}</div>` : ""}
    <div style="margin-top:10px;"><strong style="font-size:13px;">اسم الزبون:</strong> ${esc(o.customer_name)}</div>
    ${o.design_image ? `<div style="margin-top:10px;"><strong style="font-size:13px;">التصميم المرفق:</strong><br><img class="design" src="${esc(o.design_image)}"></div>` : ""}
    <div class="foot">للاستخدام الداخلي فقط — ${esc(state.currentAdmin?.username || "")}</div>
  `);
}

/* ======================= تبويب الإحصائيات ======================= */
/* ======================= تبويب الكوبونات ======================= */
async function renderCouponsTab(body){
  body.innerHTML = `<p class="hint center" style="padding:20px 0;">جارِ التحميل...</p>`;
  let coupons = [];
  try {
    const { data, error } = await supabaseClient.from('coupons').select('*').order('created_at', { ascending: false });
    if (!error && data) coupons = data;
  } catch (e) { console.error("coupons load error", e); }

  body.innerHTML = `
    <div class="panel">
      <h3>إضافة كوبون جديد</h3>
      <input class="plain-input" id="cCode" placeholder="الكود (مثال: EID20)" dir="ltr" style="text-transform:uppercase;">
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <select id="cType" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-family:inherit;">
          <option value="percent">نسبة مئوية %</option>
          <option value="fixed">مبلغ ثابت (د.ع)</option>
        </select>
        <input class="plain-input" id="cValue" placeholder="القيمة" inputmode="numeric" style="flex:1;margin-bottom:0;">
      </div>
      <div class="err" id="cErr" style="margin:-6px 0 10px;"></div>
      <button class="primary-btn" id="addCoupon">+ إضافة الكوبون</button>
    </div>
    <div class="panel">
      <h3>الكوبونات الحالية</h3>
      ${coupons.length === 0 ? `<p class="hint">لا توجد كوبونات مضافة بعد.</p>` : coupons.map(c => `
        <div class="prod-row">
          <div class="info">
            <h4 dir="ltr" style="text-align:right;">${esc(c.code)}</h4>
            <p>${c.discount_type === 'percent' ? `خصم ${esc(c.discount_value)}%` : `خصم ${money(c.discount_value)} د.ع`} — ${c.active ? '<span style="color:var(--moss);">فعّال</span>' : '<span style="color:var(--muted);">معطّل</span>'}</p>
          </div>
          <button class="del-btn" data-toggle-coupon="${c.id}" data-active="${c.active}" title="${c.active ? 'تعطيل' : 'تفعيل'}">${c.active ? '⏸' : '▶️'}</button>
          <button class="del-btn" data-del-coupon="${c.id}">🗑</button>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("addCoupon").onclick = async () => {
    const code = document.getElementById("cCode").value.trim().toUpperCase();
    const type = document.getElementById("cType").value;
    const value = Number(document.getElementById("cValue").value);
    const errEl = document.getElementById("cErr");
    errEl.textContent = "";
    if (!code) { errEl.textContent = "أدخل كود الكوبون"; return; }
    if (!value || value <= 0) { errEl.textContent = "أدخل قيمة صحيحة أكبر من صفر"; return; }
    if (type === "percent" && value > 100) { errEl.textContent = "النسبة المئوية لا يمكن أن تتجاوز 100"; return; }

    const btn = document.getElementById("addCoupon");
    btn.disabled = true; btn.textContent = "جارِ الإضافة...";
    const { error } = await supabaseClient.from('coupons').insert([{ code, discount_type: type, discount_value: value, active: true }]);
    if (error) {
      console.error("add coupon error", error);
      errEl.textContent = error.message?.includes("duplicate") ? "هذا الكود مستخدم مسبقًا" : "تعذر إضافة الكوبون";
      btn.disabled = false; btn.textContent = "+ إضافة الكوبون";
      return;
    }
    showToast("تمت إضافة الكوبون بنجاح");
    renderCouponsTab(body);
  };

  body.querySelectorAll("[data-toggle-coupon]").forEach(b => {
    b.onclick = async () => {
      const newActive = b.dataset.active !== "true";
      const { error } = await supabaseClient.from('coupons').update({ active: newActive }).eq('id', b.dataset.toggleCoupon);
      if (error) { showToast("تعذر التحديث", "err"); return; }
      renderCouponsTab(body);
    };
  });
  body.querySelectorAll("[data-del-coupon]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("حذف هذا الكوبون؟")) return;
      const { error } = await supabaseClient.from('coupons').delete().eq('id', b.dataset.delCoupon);
      if (error) { showToast("تعذر الحذف", "err"); return; }
      showToast("تم حذف الكوبون");
      renderCouponsTab(body);
    };
  });
}

/* ======================= تبويب سجل النشاط ======================= */
async function renderActivityTab(body){
  body.innerHTML = `<p class="hint center" style="padding:20px 0;">جارِ التحميل...</p>`;
  let logs = [];
  try {
    const { data, error } = await supabaseClient
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error && data) logs = data;
  } catch (e) { console.error("activity log load error", e); }

  body.innerHTML = `
    <div class="panel">
      <h3>آخر 100 عملية</h3>
      ${logs.length === 0 ? `<p class="hint">لا يوجد نشاط مسجَّل بعد.</p>` : logs.map(l => `
        <div style="padding:10px 0;border-bottom:1px solid var(--line);font-size:13px;">
          <div><strong>${esc(l.admin_username)}</strong> — ${esc(l.action)}</div>
          ${l.order_ref ? `<div class="hint">الطلب: ${esc(l.order_ref)}</div>` : ""}
          <div class="hint" style="font-size:11px;margin-top:2px;">${new Date(l.created_at).toLocaleString("ar")}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStatsTab(body){
  const confirmed = state.orders.filter(o => reviewStatus(o) === "confirmed");
  const totalRevenue = confirmed.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const avgOrder = confirmed.length ? Math.round(totalRevenue / confirmed.length) : 0;

  const counts = {
    pending: state.orders.filter(o => reviewStatus(o) === "pending").length,
    confirmed: confirmed.length,
    cancelled: state.orders.filter(o => reviewStatus(o) === "cancelled").length,
  };

  // أكثر المنتجات طلبًا (على الطلبات المؤكدة)
  const productCounts = {};
  confirmed.forEach(o => {
    const name = o.product_name || "غير معروف";
    productCounts[name] = (productCounts[name] || 0) + (Number(o.qty) || 1);
  });
  const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = topProducts.length ? topProducts[0][1] : 1;

  const cancellationChartHtml = renderCancellationRateChart(state.orders);

  body.innerHTML = `
    <div class="panel">
      <h3>نظرة عامة (الطلبات المؤكدة)</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
        <div style="background:var(--card);border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;">${money(totalRevenue)}</div>
          <div class="hint" style="margin-top:2px;">إجمالي المبيعات (د.ع)</div>
        </div>
        <div style="background:var(--card);border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;">${counts.confirmed}</div>
          <div class="hint" style="margin-top:2px;">عدد الطلبات المؤكدة</div>
        </div>
        <div style="background:var(--card);border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;">${money(avgOrder)}</div>
          <div class="hint" style="margin-top:2px;">متوسط قيمة الطلب (د.ع)</div>
        </div>
        <div style="background:var(--card);border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;">${counts.pending}</div>
          <div class="hint" style="margin-top:2px;">بانتظار المراجعة</div>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3>الأكثر طلبًا</h3>
      ${topProducts.length === 0 ? `<p class="hint">لا توجد بيانات كافية بعد.</p>` : topProducts.map(([name, count]) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
            <span>${esc(name)}</span><span style="color:var(--muted);">${count}</span>
          </div>
          <div style="background:var(--line);border-radius:999px;height:8px;overflow:hidden;">
            <div style="background:var(--moss);height:100%;width:${Math.max(6, Math.round((count / maxCount) * 100))}%;"></div>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="panel">
      <h3>نسبة الإلغاء عبر الزمن (آخر 14 يوم)</h3>
      ${cancellationChartHtml}
    </div>
  `;
}

// يرسم مخطط أعمدة بسيط (SVG) لكل يوم من آخر 14 يوم: عدد الطلبات المؤكدة/الملغية ونسبة الإلغاء
function renderCancellationRateChart(orders){
  const DAYS = 14;
  const today = new Date(); today.setHours(0,0,0,0);
  const buckets = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    buckets.push({ date: d, confirmed: 0, cancelled: 0 });
  }
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const bucketByKey = {};
  buckets.forEach(b => bucketByKey[dayKey(b.date)] = b);

  orders.forEach(o => {
    if (!o.created_at) return;
    const created = new Date(o.created_at); created.setHours(0,0,0,0);
    const key = dayKey(created);
    const bucket = bucketByKey[key];
    if (!bucket) return; // خارج نطاق الـ14 يوم
    const status = reviewStatus(o);
    if (status === "confirmed") bucket.confirmed++;
    else if (status === "cancelled") bucket.cancelled++;
  });

  const totalConfirmed = buckets.reduce((s,b)=>s+b.confirmed,0);
  const totalCancelled = buckets.reduce((s,b)=>s+b.cancelled,0);
  const overallRate = (totalConfirmed + totalCancelled) > 0 ? Math.round((totalCancelled / (totalConfirmed + totalCancelled)) * 100) : 0;

  const maxTotal = Math.max(1, ...buckets.map(b => b.confirmed + b.cancelled));
  const barW = 20, gap = 6, chartH = 90;
  const svgW = buckets.length * (barW + gap);

  const bars = buckets.map((b, i) => {
    const total = b.confirmed + b.cancelled;
    const x = i * (barW + gap);
    const confirmedH = total ? Math.round((b.confirmed / maxTotal) * chartH) : 0;
    const cancelledH = total ? Math.round((b.cancelled / maxTotal) * chartH) : 0;
    const rate = total ? Math.round((b.cancelled / total) * 100) : 0;
    const label = b.date.toLocaleDateString("ar", { day: "numeric", month: "numeric" });
    return `
      <g>
        <title>${label} — مؤكد: ${b.confirmed}، ملغي: ${b.cancelled}${total ? ` (نسبة إلغاء ${rate}%)` : ""}</title>
        <rect x="${x}" y="${chartH - confirmedH - cancelledH}" width="${barW}" height="${confirmedH}" fill="var(--moss, #4a7c59)" rx="2"></rect>
        <rect x="${x}" y="${chartH - cancelledH}" width="${barW}" height="${cancelledH}" fill="var(--err, #e5484d)" rx="2"></rect>
      </g>
    `;
  }).join("");

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--moss,#4a7c59);border-radius:3px;margin-left:4px;"></span>مؤكدة</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--err,#e5484d);border-radius:3px;margin-left:4px;"></span>ملغية</span>
      </div>
      <div style="font-size:13px;font-weight:800;">نسبة الإلغاء الإجمالية: ${overallRate}%</div>
    </div>
    <div style="overflow-x:auto;">
      <svg viewBox="0 0 ${svgW} ${chartH}" width="${svgW}" height="${chartH}" style="min-width:${svgW}px;">${bars}</svg>
    </div>
  `;
}

// تصدير الطلبات المعروضة حاليًا (بعد أي فلترة بالحالة/التاريخ) إلى ملف CSV يفتح مباشرة في Excel
// نستخدم BOM (\uFEFF) في البداية حتى يعرض Excel الحروف العربية بشكل صحيح بدل رموز غريبة
function exportOrdersToCsv(orders){
  if (!orders || orders.length === 0) { showToast("لا توجد طلبات لتصديرها ضمن هذا الفلتر", "err"); return; }

  const headers = ["رقم الطلب", "التاريخ", "الحالة", "اسم العميل", "الهاتف", "المدينة", "المنطقة", "العنوان", "المنتج", "الكمية", "الإجمالي (د.ع)", "انستغرام"];
  const statusLabel = { pending: "قيد المراجعة", confirmed: "مؤكد", cancelled: "ملغي" };

  const csvEscape = (val) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = orders.map(o => [
    orderRef(o),
    new Date(o.created_at).toLocaleString("ar"),
    statusLabel[reviewStatus(o)] || reviewStatus(o),
    o.customer_name || "",
    o.phone_number || o.phone || "",
    o.city_name || "",
    o.region_name || "",
    o.address || o.location || "",
    o.product_name || "",
    o.qty || 1,
    o.total || 0,
    o.instagram_username || ""
  ]);

  const csvContent = "\uFEFF" + [headers, ...rows].map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateTag = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `طلبات-QRCODE-${dateTag}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`تم تصدير ${orders.length} طلب بنجاح`);
}

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

  // فلترة حسب التاريخ + تصدير Excel/CSV للمحاسبة والجرد الشهري
  const dateToolsHtml = `
    <div class="panel" style="margin-bottom:16px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:130px;">
          <label class="hint" style="display:block;margin-bottom:4px;">من تاريخ</label>
          <input type="date" id="ordersDateFrom" class="plain-input" style="margin-bottom:0;" value="${esc(state.ordersDateFrom)}">
        </div>
        <div style="flex:1;min-width:130px;">
          <label class="hint" style="display:block;margin-bottom:4px;">إلى تاريخ</label>
          <input type="date" id="ordersDateTo" class="plain-input" style="margin-bottom:0;" value="${esc(state.ordersDateTo)}">
        </div>
        <button class="ghost-btn" id="clearDateFilter" style="height:44px;white-space:nowrap;">مسح الفلتر</button>
        <button class="primary-btn" id="exportOrdersCsv" style="height:44px;white-space:nowrap;">⬇️ تصدير Excel (CSV)</button>
      </div>
    </div>
  `;

  const inDateRange = (o) => {
    if (!state.ordersDateFrom && !state.ordersDateTo) return true;
    const created = new Date(o.created_at);
    if (state.ordersDateFrom && created < new Date(state.ordersDateFrom + "T00:00:00")) return false;
    if (state.ordersDateTo && created > new Date(state.ordersDateTo + "T23:59:59")) return false;
    return true;
  };

  const filtered = state.orders.filter(o => reviewStatus(o) === state.orderFilter && inDateRange(o));

  const listHtml = filtered.length === 0
    ? `<p class="hint center" style="padding:30px 0;">لا توجد حجوزات في هذا القسم.</p>`
    : filtered.map(o => {
      const orderImg = o.product_image ? '<img src="' + esc(o.product_image) + '" loading="lazy" decoding="async" style="object-position:' + esc(o.product_image_position || '50% 50%') + ';">' : '<div class="ph"></div>';
      const cannotSendToAlwaseet = !o.city_id || !o.region_id || o.alwaseet_status === 'sent';
      return `
        <div class="order-card">
          <div class="order-top">
            ${orderImg}
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;">${esc(o.product_name)} <span style="color:var(--muted);font-weight:400;">${o.qty ? `× ${o.qty}` : ''}</span></div>
              <div style="font-size:11px;color:var(--muted);">${orderRef(o)} · ${new Date(o.created_at).toLocaleString("ar")}</div>
            </div>
            <div style="font-weight:700;font-size:14px;">${o.total ? money(o.total) + ' د.ع' : ''}</div>
          </div>
          <div class="order-details">
            <div>👤 ${esc(o.customer_name)}</div>
            <div>📍 ${esc(o.address || o.location)}${o.city_name ? ` — ${esc(o.city_name)}${o.region_name ? " / " + esc(o.region_name) : ""}` : ""}</div>
            <div>📞 <a href="https://wa.me/${formatWhatsapp(o.phone_number || o.phone)}" target="_blank" style="color:var(--ink);text-decoration:underline;">${esc(o.phone_number || o.phone)}</a></div>
            ${o.instagram_username ? `<div>📷 <a href="https://instagram.com/${esc(o.instagram_username)}" target="_blank" style="color:var(--moss);text-decoration:underline;">@${esc(o.instagram_username)}</a></div>` : ""}
            ${o.custom_request ? `<div style="margin-top:6px;background:var(--card);padding:8px;border-radius:8px;">📝 ${esc(o.custom_request)}</div>` : ""}
            ${o.design_image ? `<div style="margin-top:6px;">🎨 <a href="${esc(o.design_image)}" target="_blank" style="color:var(--moss);text-decoration:underline;">عرض التصميم المُرفق من الزبون</a></div>` : ""}
            <div style="margin-top:6px;">${alwaseetStatusText(o)}</div>
          </div>
          <div class="order-actions">
            <button class="btn-cancel" data-cancel="${o.id}" ${reviewStatus(o)==='cancelled' ? 'disabled' : ''}>✕ إلغاء</button>
            <button class="btn-confirm" data-confirm="${o.id}" ${reviewStatus(o)==='confirmed' ? 'disabled' : ''}>✓ تم التأكيد</button>
            <button class="btn-whatsapp" data-wa="${o.id}">💬 واتساب</button>
            <button class="btn-whatsapp" data-wacustomer="${o.id}">📱 واتساب العميل</button>
            <button class="btn-instagram" data-instagram="${o.id}" ${o.instagram_username ? '' : 'disabled'}>📷 انستغرام العميل</button>
            <button class="btn-alwaseet" data-sendalwaseet="${o.id}" ${cannotSendToAlwaseet ? 'disabled' : ''}>${o.alwaseet_status === 'sent' ? '✓ أُرسل للوسيط' : '🚚 إرسال إلى الوسيط'}</button>
            <button class="btn-whatsapp" data-invoice="${o.id}">🧾 فاتورة</button>
            <button class="btn-whatsapp" data-slip="${o.id}">🖨️ إيصال إنتاج</button>
            ${isOwner ? `<button class="btn-delete" data-delorder="${o.id}">🗑 حذف</button>` : ''}
          </div>
        </div>
      `;
    }).join("");

  body.innerHTML = filterTabsHtml + dateToolsHtml + listHtml;

  body.querySelectorAll("[data-orderfilter]").forEach(b => {
    b.onclick = () => { state.orderFilter = b.dataset.orderfilter; renderOrdersTab(body); };
  });

  document.getElementById("ordersDateFrom").onchange = (e) => { state.ordersDateFrom = e.target.value; renderOrdersTab(body); };
  document.getElementById("ordersDateTo").onchange = (e) => { state.ordersDateTo = e.target.value; renderOrdersTab(body); };
  document.getElementById("clearDateFilter").onclick = () => { state.ordersDateFrom = ""; state.ordersDateTo = ""; renderOrdersTab(body); };
  document.getElementById("exportOrdersCsv").onclick = () => exportOrdersToCsv(filtered);

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
    logActivity(status === 'confirmed' ? "تأكيد طلب" : "إلغاء طلب", orderRef(order));
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

  body.querySelectorAll("[data-invoice]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.invoice));
      if (o) printInvoice(o);
    };
  });
  body.querySelectorAll("[data-slip]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.slip));
      if (o) printProductionSlip(o);
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
        const orderBeforeDelete = state.orders.find(o => String(o.id) === String(oid));
        const refStr = orderBeforeDelete ? orderRef(orderBeforeDelete) : null;

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
        logActivity("حذف طلب", refStr);
        renderOrdersTab(body);
      };
    });
  }
}

function renderSettingsTab(body){
  body.innerHTML = `
    <div class="panel">
      <h3>محتوى الواجهة الرئيسية</h3>
      <p class="hint">هذا هو ما يراه الزبون فور دخوله المتجر. أي تعديل هنا يظهر فورًا لكل الزوار على كل الأجهزة.</p>

      <label class="hint" style="display:block;margin:-4px 0 6px;">شعار المتجر</label>
      <div class="upload-box" id="logoUpload" style="aspect-ratio:1;max-width:120px;">
        <img src="${esc(state.settings.logo || 'logo.png')}" alt="الشعار الحالي">
      </div>
      <input type="file" id="logoFile" accept="image/*" style="display:none;">
      <p class="hint" style="margin-top:6px;">اختر صورة مربعة قدر الإمكان (نسبة 1:1) لأفضل نتيجة، مثل تصميم QR الخاص بكم.</p>

      <label class="hint" style="display:block;margin:14px 0 6px;">العنوان الفرعي (تحت اسم المتجر)</label>
      <input class="plain-input" id="eyebrowInput" value="${esc(state.settings.eyebrow || DEFAULT_EYEBROW)}" placeholder="${esc(DEFAULT_EYEBROW)}">

      <label class="hint" style="display:block;margin:0 0 6px;">النص التعريفي</label>
      <textarea class="plain-textarea" id="ledeInput" rows="4" placeholder="${esc(DEFAULT_LEDE)}">${esc(state.settings.lede || DEFAULT_LEDE)}</textarea>

      <div class="err" id="contentErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveContent">حفظ المحتوى</button>
    </div>
    <div class="panel">
      <h3>رقم واتساب استلام الحجوزات</h3>
      <p class="hint">تُرسل كل تفاصيل الحجز تلقائيًا إلى هذا الرقم عبر واتساب. أدخل الرقم مع مفتاح الدولة (مثال: 9647701234567). هذا الرقم مشترك ويظهر فورًا على كل الأجهزة.</p>
      <input class="plain-input" id="waNum" value="${esc(state.settings.whatsapp)}" placeholder="9647xxxxxxxx" dir="ltr">
      <div class="err" id="waErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveWa">حفظ</button>
    </div>
    <div class="panel">
      <h3>نسخة احتياطية</h3>
      <p class="hint">يحمّل ملف يحتوي كل المنتجات والطلبات الحالية كنسخة احتياطية. يُنصح بتنزيلها بشكل دوري (مرة بالشهر مثلًا) وحفظها بمكان آمن.</p>
      <button class="dark-btn" id="exportBackupBtn">⬇️ تنزيل نسخة احتياطية</button>
    </div>
    <div class="panel">
      <h3>من نحن</h3>
      <p class="hint">تظهر هذي للزبون عبر رابط "من نحن" أسفل الصفحة الرئيسية. اكتب قصة المتجر، سنوات الخبرة، أو أي شي يبني ثقة الزبون.</p>
      <textarea class="plain-textarea" id="aboutInput" rows="6" placeholder="مثال:&#10;QR CODE متخصصون بالطباعة والتطريز والليزر منذ عام ...، نفّذنا مئات الطلبات المخصصة بجودة عالية واهتمام بالتفاصيل.">${esc(state.settings.aboutUs || "")}</textarea>
      <div class="err" id="aboutErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="saveAbout">حفظ</button>
    </div>
    <div class="panel">
      <h3>السياسات والشروط</h3>
      <p class="hint">تظهر هذي للزبون عبر رابط "السياسات والشروط" أسفل الصفحة الرئيسية. اكتب فيها سياسة الاستبدال/الإرجاع، مدة التنفيذ، طرق الدفع، أو أي شروط تحب توضحها.</p>
      <textarea class="plain-textarea" id="policiesInput" rows="6" placeholder="مثال:&#10;- مدة التنفيذ: 3-5 أيام عمل حسب نوع الطلب.&#10;- لا يوجد استبدال للمنتجات المخصصة بعد التنفيذ إلا بوجود عيب صناعة.&#10;- الدفع عند الاستلام.">${esc(state.settings.policies || "")}</textarea>
      <div class="err" id="policiesErr" style="margin:-6px 0 10px;color:var(--err);font-size:12px;"></div>
      <button class="primary-btn" id="savePolicies">حفظ السياسات</button>
    </div>
    <div class="panel">
      <h3>تغيير كلمة مرور مدير المتجر</h3>
      <input class="plain-input" id="oldPw" type="password" placeholder="كلمة المرور الحالية">
      <input class="plain-input" id="newPw" type="password" placeholder="كلمة المرور الجديدة">
      <div class="err" id="pwMsg" style="margin:-6px 0 10px;font-size:12px;"></div>
      <button class="dark-btn" id="savePw">حفظ كلمة المرور</button>
    </div>
  `;

  let pendingLogo = state.settings.logo || "";
  document.getElementById("logoUpload").onclick = () => document.getElementById("logoFile").click();
  document.getElementById("logoFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingLogo = await resizeImage(file, 300, 0.85);
    document.getElementById("logoUpload").innerHTML = `<img src="${pendingLogo}" alt="الشعار الجديد">`;
  };

  document.getElementById("exportBackupBtn").onclick = async () => {
    const btn = document.getElementById("exportBackupBtn");
    btn.disabled = true; btn.textContent = "جارِ التجهيز...";
    try {
      await loadOrders();
      const backup = {
        exported_at: new Date().toISOString(),
        products: state.products,
        orders: state.orders,
        settings: state.settings
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qr-code-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("تم تنزيل النسخة الاحتياطية");
    } catch (e) {
      console.error("backup export error", e);
      showToast("تعذر تجهيز النسخة الاحتياطية", "err");
    }
    btn.disabled = false; btn.textContent = "⬇️ تنزيل نسخة احتياطية";
  };

  document.getElementById("saveAbout").onclick = async () => {
    const aboutUs = document.getElementById("aboutInput").value.trim();
    const errEl = document.getElementById("aboutErr");
    errEl.textContent = "";
    const btn = document.getElementById("saveAbout");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";
    try {
      const ok = await saveSiteContent({ aboutUs });
      if (ok) showToast("تم حفظ محتوى \"من نحن\"");
      else showToast("تعذر الحفظ في السحابة، تم الحفظ محليًا فقط", "err");
    } catch (e) {
      console.error("save about error", e);
      errEl.textContent = "تعذر الحفظ";
    }
    btn.disabled = false; btn.textContent = "حفظ";
  };

  document.getElementById("savePolicies").onclick = async () => {
    const policies = document.getElementById("policiesInput").value.trim();
    const errEl = document.getElementById("policiesErr");
    errEl.textContent = "";
    const btn = document.getElementById("savePolicies");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";
    try {
      const ok = await saveSiteContent({ policies });
      if (ok) showToast("تم حفظ السياسات بنجاح");
      else showToast("تعذر الحفظ في السحابة، تم الحفظ محليًا فقط", "err");
    } catch (e) {
      console.error("save policies error", e);
      errEl.textContent = "تعذر الحفظ";
    }
    btn.disabled = false; btn.textContent = "حفظ السياسات";
  };

  document.getElementById("saveContent").onclick = async () => {
    const eyebrow = document.getElementById("eyebrowInput").value.trim();
    const lede = document.getElementById("ledeInput").value.trim();
    const errEl = document.getElementById("contentErr");
    errEl.textContent = "";

    const btn = document.getElementById("saveContent");
    btn.disabled = true; btn.textContent = "جارِ الحفظ...";
    try {
      const ok = await saveSiteContent({
        eyebrow: eyebrow || DEFAULT_EYEBROW,
        lede: lede || DEFAULT_LEDE,
        logo: pendingLogo
      });
      if (ok) showToast("تم حفظ المحتوى بنجاح");
      else showToast("تعذر الحفظ في السحابة، تم الحفظ محليًا فقط", "err");
    } catch (e) {
      console.error("save content error", e);
      errEl.textContent = "تعذر حفظ المحتوى";
    } finally {
      btn.disabled = false; btn.textContent = "حفظ المحتوى";
    }
  };

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
async function loadProducts(){
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
  } catch (e) {
    console.error("Supabase products load error, falling back to local:", e);
    state.products = loadLocal(KEYS.PRODUCTS, []);
  }
}

async function loadReviews(){
  try {
    const { data, error } = await supabaseClient.rpc('get_public_reviews');
    if (!error && data) state.reviews = data;
  } catch (e) {
    console.error("reviews load error", e);
  }
}

async function logActivity(action, orderRefStr){
  try {
    await supabaseClient.from('activity_log').insert([{
      admin_username: state.currentAdmin?.username || "غير معروف",
      action,
      order_ref: orderRefStr || null
    }]);
  } catch (e) {
    console.error("activity log insert error", e);
  }
}

async function loadOrders(){
  try {
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
    console.error("Supabase orders load error, falling back to local:", e);
    state.orders = loadLocal(KEYS.ORDERS, []);
  }
}

/* ======================= تنبيه فوري بالطلبات الجديدة أثناء وجود المشرف بلوحة الإدارة ======================= */
let orderPollTimer = null;

function stopOrderPolling(){
  if (orderPollTimer) { clearInterval(orderPollTimer); orderPollTimer = null; }
}

function playNotifySound(){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (e) { /* المتصفح قد يمنع الصوت التلقائي، لا مشكلة */ }
}

function startOrderPolling(){
  stopOrderPolling();
  orderPollTimer = setInterval(async () => {
    if (state.view !== "admin") { stopOrderPolling(); return; }
    const knownIds = new Set(state.orders.map(o => String(o.id)));
    await loadOrders();
    const newOnes = state.orders.filter(o => !knownIds.has(String(o.id)));
    if (newOnes.length > 0) {
      if (state.adminTab !== "orders") {
        state.newOrdersCount += newOnes.length;
        document.title = `🔴(${state.newOrdersCount}) لوحة QR CODE`;
        playNotifySound();
      }
      render();
    }
  }, 30000);
}

/* ======================= بدء التشغيل ======================= */
async function init(){
  try {
    if (!supabaseClient) throw new Error("Supabase client not initialized");
    initTheme();
    initTopCart();
    state.cart = loadLocal(KEYS.CART, []);
    // المتجر لا يحتاج جدول الطلبات إطلاقًا — يُجلب فقط عند دخول لوحة الإدارة، لتسريع تحميل المتجر للزبون
    await Promise.all([loadProducts(), loadSettings(), loadReviews()]);

    loadingEl.style.display = "none";
    app.style.display = "block";
    render();
  } catch (e) {
    console.error("App init error:", e);
    if (typeof showStoreLoadError === "function") showStoreLoadError();
  }
}

init();
