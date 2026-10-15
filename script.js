/* ======================= تهيئة اتصال Supabase ======================= */
const SUPABASE_URL = "https://hhknbkyjalsbanoudoos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SaukFLYePA4O6j9hm33Xfw_uvyYm1u-";

let supabaseClient;
try {
  if (typeof window.supabase === "undefined") throw new Error("Supabase SDK لم يُحمَّل");
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: true } }); // الجلسة بالذاكرة فقط: إعادة تحميل الصفحة تعني دخولًا جديدًا
} catch (e) {
  console.error("Supabase client init error:", e);
  if (typeof showStoreLoadError === "function") showStoreLoadError();
}

const KEYS = { PRODUCTS: "qrcode:products", ORDERS: "qrcode:orders", SETTINGS: "qrcode:settings", CART: "qrcode:cart" };

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
const THEME_KEY = "qrcode:theme";
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
  activityFilter: "", // فلترة سجل التدقيق حسب اسم المشرف
  storeSearch: "",       // نص البحث الحالي بواجهة المتجر
  storeSort: "new",
  storeCategory: "all",  // فلترة حسب نوع المنتج (category) — "all" يعرض الكل
  ordersDateFrom: "",    // فلترة الطلبات حسب التاريخ (تبويب الحجوزات) — من
  ordersDateTo: "",      // فلترة الطلبات حسب التاريخ (تبويب الحجوزات) — إلى
};

const app = document.getElementById("app");
const loadingEl = document.getElementById("loading");
const modalBg = document.getElementById("modalBg");

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
// يحوّل الأرقام العربية (١٢٣...) والفارسية (۱۲۳...) إلى أرقام لاتينية عادية (1,2,3...).
// ضروري لأن كيبورد العربي بالجوال يكتب أرقامًا شرقية افتراضيًا، وJS (\d و Number()) لا يتعرف
// عليها كأرقام إطلاقًا — أي حقل يتحقق من كون القيمة رقمًا (سعر، كمية، هاتف) لازم يمرّ من هنا أولًا.
function normalizeDigits(str){
  return (str ?? "").toString().replace(/[٠-٩۰-۹]/g, d => {
    const code = d.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    return d;
  });
}
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
  if (!state.currentAdmin) {
    const pub = await loadPublished();
    if (pub && pub.settings) {
      const d = pub.settings;
      state.settings = { whatsapp: d.whatsapp || "", eyebrow: d.eyebrow || DEFAULT_EYEBROW, lede: d.lede || DEFAULT_LEDE, logo: d.logo || "", policies: d.policies || DEFAULT_POLICIES, aboutUs: d.about_us || DEFAULT_ABOUT };
      return;
    }
  }
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
  let d = normalizeDigits(raw||"").replace(/\D/g,"");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "964" + d.slice(1);
  return d;
}
function isValidWhatsapp(raw){
  const d = formatWhatsapp(raw);
  return d.length >= 10 && d.length <= 15;
}

/* ======================= حساب التواصل الاجتماعي (انستغرام أو تيك توك) =======================
   نخزّنه بنفس عمود instagram_username الحالي بصيغة "platform:handle" (مثال: "tiktok:ahmed_123")
   حتى لا نحتاج تعديل جدول قاعدة البيانات. السجلات القديمة (يوزر بدون بادئة) تُعامَل تلقائيًا
   كانستغرام حفاظًا على التوافق مع الطلبات المسجَّلة سابقًا. */
const SOCIAL_PLATFORMS = {
  instagram: { label: "انستغرام", icon: "📷", urlPrefix: "https://instagram.com/" },
  tiktok: { label: "تيك توك", icon: "🎵", urlPrefix: "https://www.tiktok.com/@" },
};

/* ======================= المحافظات والمدن (العراق) =======================
   قائمة عملية للاستخدام بحقول الحجز — وليست تقسيمًا إداريًا رسميًا دقيقًا (بعض العناصر
   أحياء/نواحٍ متعارف عليها للتوصيل وليست "أقضية" رسمية). عدّل/أضف حسب مناطق تغطية التوصيل الفعلية. */
const IRAQ_LOCATIONS = {
  "بغداد": ["الكرخ","الرصافة","الكاظمية","الأعظمية","الدورة","الشعلة","الحرية","المنصور","الكرادة","زيونة","المشتل","الغزالية","أبو غريب","الطارمية","المدائن","مدينة الصدر","الشعب","اليرموك","الجادرية","بغداد الجديدة"],
  "البصرة": ["مركز البصرة","الزبير","أبو الخصيب","القرنة","شط العرب","الفاو","المعقل","الهارثة"],
  "نينوى": ["الموصل","تلعفر","سنجار","الحمدانية","تلكيف","الشيخان","البعاج","الحضر"],
  "أربيل": ["أربيل","شقلاوة","سوران","كويسنجق","مخمور","خبات"],
  "دهوك": ["دهوك","زاخو","سميل","العمادية","عقرة"],
  "السليمانية": ["السليمانية","حلبجة","رانية","دوكان","بنجوين","دربندخان"],
  "كركوك": ["كركوك","الحويجة","داقوق","الدبس"],
  "ديالى": ["بعقوبة","المقدادية","بلدروز","خانقين","الخالص","كفري"],
  "صلاح الدين": ["تكريت","سامراء","بيجي","الدور","الشرقاط","بلد","الدجيل"],
  "الأنبار": ["الرمادي","الفلوجة","هيت","حديثة","عنه","القائم","الرطبة"],
  "بابل": ["الحلة","المسيب","الهاشمية","المحاويل","القاسم"],
  "كربلاء": ["كربلاء","عين التمر","الهندية"],
  "النجف": ["النجف","الكوفة","المناذرة"],
  "واسط": ["الكوت","الحي","النعمانية","الصويرة","بدرة"],
  "القادسية": ["الديوانية","عفك","الشامية","الحمزة"],
  "المثنى": ["السماوة","الرميثة","الخضر"],
  "ذي قار": ["الناصرية","الشطرة","سوق الشيوخ","الرفاعي","الجبايش"],
  "ميسان": ["العمارة","المجر الكبير","علي الغربي","قلعة صالح"],
};

// يبني حقلي "المحافظة" و"المدينة" (المدينة تعتمد على المحافظة المختارة، ومعطّلة قبل اختيارها)
function locationFieldsHtml(vals){
  const cities = vals.governorate ? (IRAQ_LOCATIONS[vals.governorate] || []) : [];
  return `
    <div class="field">
      <div class="box">🗺️<select id="fGov">
        <option value="">اختر المحافظة</option>
        ${Object.keys(IRAQ_LOCATIONS).map(g => `<option value="${esc(g)}" ${vals.governorate === g ? "selected" : ""}>${esc(g)}</option>`).join("")}
      </select></div>
      <div class="err" id="errGov"></div>
    </div>
    <div class="field">
      <div class="box">📍<select id="fCity" ${vals.governorate ? "" : "disabled"}>
        <option value="">${vals.governorate ? "اختر المدينة" : "اختر المحافظة أولًا"}</option>
        ${cities.map(c => `<option value="${esc(c)}" ${vals.city === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select></div>
      <div class="err" id="errCity"></div>
    </div>
  `;
}

// يربط أحداث حقلي المحافظة/المدينة؛ يستدعي paint() عند تغيير المحافظة لإعادة بناء قائمة المدن
function bindLocationFields(vals, paint){
  document.getElementById("fGov").onchange = (e) => {
    vals.governorate = e.target.value;
    vals.city = "";
    paint();
  };
  document.getElementById("fCity").onchange = (e) => { vals.city = e.target.value; };
}
function encodeSocial(platform, handle){
  const h = (handle || "").trim().replace(/^@/, "");
  if (!h) return null;
  return `${platform}:${h}`;
}
function parseSocial(raw){
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx > -1 && SOCIAL_PLATFORMS[raw.slice(0, idx)]) {
    return { platform: raw.slice(0, idx), handle: raw.slice(idx + 1) };
  }
  return { platform: "instagram", handle: raw }; // سجل قديم بدون بادئة منصة
}
function socialUrl(platform, handle){
  return (SOCIAL_PLATFORMS[platform] || SOCIAL_PLATFORMS.instagram).urlPrefix + handle;
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
let adminP = null;
function loadAdminCode(){
  return adminP || (adminP = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = "admin.js?v=23"; el.onload = res;
    el.onerror = () => { adminP = null; rej(new Error("admin.js")); };
    document.head.appendChild(el);
  }));
}
let adminReady = false;
function render(){
  if (state.view === "store") return renderStore();
  if (!adminReady) app.innerHTML = '<div class="loading-page" style="position:static;min-height:60vh"><div class="spinner"></div><p>جارِ تحميل لوحة الإدارة...</p></div>';
  loadAdminCode().then(() => {
    adminReady = true;
    if (state.view === "adminLogin") renderAdminLogin();
    else if (state.view === "admin") renderAdmin();
  }).catch(() => {
    app.innerHTML = '<div class="loading-page" style="position:static;min-height:60vh"><p style="font-weight:700">تعذر تحميل لوحة الإدارة</p><button class="ghost-btn" id="adminRetry" style="max-width:220px;margin:8px auto">إعادة المحاولة</button><button class="ghost-btn" id="adminBack" style="max-width:220px;margin:0 auto">رجوع للمتجر</button></div>';
    document.getElementById("adminRetry").onclick = () => render();
    document.getElementById("adminBack").onclick = () => { state.view = "store"; render(); };
  });
}

function renderStore(){
  // --- بحث + فلترة حسب النوع (category) ---
  // يعتمد على عمود "category" إن وُجد بجدول products؛ المنتجات بدون هذا الحقل تبقى ضمن "الكل" فقط
  const q = (state.storeSearch || "").trim().toLowerCase();
  const availableCategories = Array.from(new Set(state.products.map(p => p.category).filter(Boolean)));
  let visibleProducts = state.products.filter(p => {
    const matchesSearch = !q
      || (p.name || "").toLowerCase().includes(q)
      || (p.description || "").toLowerCase().includes(q);
    const matchesCategory = state.storeCategory === "all" || p.category === state.storeCategory;
    return matchesSearch && matchesCategory;
  });

  if (state.storeSort === "low") visibleProducts = visibleProducts.slice().sort((a, b) => Number(a.price) - Number(b.price));
  else if (state.storeSort === "high") visibleProducts = visibleProducts.slice().sort((a, b) => Number(b.price) - Number(a.price));

  const searchBarHtml = state.products.length > 0 ? `
    <div class="store-search-bar" style="margin:18px 0 14px;">
      <input type="search" id="storeSearchInput" class="plain-input" style="margin-bottom:10px;" placeholder="🔍 ابحث عن منتج..." value="${esc(state.storeSearch)}">
      <select id="storeSortSel" class="plain-input" style="margin-bottom:10px;" aria-label="ترتيب المنتجات">
        <option value="new" ${state.storeSort==="new"?"selected":""}>الأحدث</option>
        <option value="low" ${state.storeSort==="low"?"selected":""}>السعر: من الأقل</option>
        <option value="high" ${state.storeSort==="high"?"selected":""}>السعر: من الأعلى</option>
      </select>
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
          ${!outOfStock && (p.featured || (p.created_at && Date.now() - new Date(p.created_at) < 14 * 864e5)) ? `<span class="foil">${p.featured ? "✦ مميز" : "جديد"}</span>` : ""}
        </div>
        ${colorRow}
        ${sizeRow}
        <div class="body">
          <div class="seal">${money(p.price)} د.ع</div>
          <div class="info" data-open="${esc(p.id)}" style="cursor:pointer;" role="button" tabindex="0">
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
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <div style="font-weight:700;font-size:14px;">${esc(r.customer_name || "عميل")}</div>
                  <div style="font-size:16px;color:#f5a623;white-space:nowrap;">${"⭐".repeat(r.customer_rating)}${"☆".repeat(5 - r.customer_rating)}</div>
                </div>
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
  const sortSel = document.getElementById("storeSortSel");
  if (sortSel) sortSel.addEventListener("change", () => { state.storeSort = sortSel.value; renderStore(); });
  app.querySelectorAll("[data-open]").forEach(el => {
    el.addEventListener("click", () => openProductModal(el.dataset.open));
    el.addEventListener("keydown", e => { if (e.key === "Enter") openProductModal(el.dataset.open); });
  });
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
      flashButton(btn, "✓ أُضيف للسلة");
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

/* ---------- صفحة المنتج: معرض صور + رابط مباشر #p=ID + مشاركة ---------- */
function findProduct(q){
  q = String(q);
  return state.products.find(x => String(x.id) === q) || (q.length >= 8 ? state.products.find(x => String(x.id).startsWith(q)) : null);
}
function openProductModal(pid, push = true){
  const p = findProduct(pid);
  if (!p) { showToast("المنتج غير متاح حاليًا", "err"); if (/^#p=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); return; }
  const colors = parseColors(p), sizes = parseSizes(p), vs = getVariantState(p.id);
  if (vs.colorIdx >= colors.length) vs.colorIdx = 0;
  const out = (p.stock !== undefined && p.stock !== null) && Number(p.stock) <= 0;
  const galleryOf = () => {
    const ac = colors[vs.colorIdx];
    const list = ac && ac.images && ac.images.length ? ac.images : (p.image ? [p.image] : []);
    return Array.from(new Set(list));
  };
  modalBg.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-lg-head"><div><h2>${esc(p.name)}</h2><p>${money(p.price)} د.ع</p></div><button class="close-x" id="closeModal" aria-label="إغلاق">✕</button></div>
      <div class="modal-lg-body">
        <div id="pmGal"></div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}
        ${colors.length ? `<div class="color-row" id="pmColors">${colors.map((c, i) => `<button type="button" class="color-dot ${i === vs.colorIdx ? "active" : ""}" data-pc="${i}" style="background:${esc(c.hex || "#ccc")}" title="${esc(c.name || "")}" aria-label="${esc(c.name || "لون " + (i + 1))}"></button>`).join("")}</div>` : ""}
        ${sizes.length ? `<div class="size-row">${sizes.map(sz => `<button type="button" class="size-chip ${vs.size === sz ? "active" : ""}" data-psize="${esc(sz)}">${esc(sz)}</button>`).join("")}</div>` : ""}
        ${out ? `<button class="book-btn" disabled style="opacity:.5">نفذت الكمية</button>` : `<button class="book-btn" id="pmAdd">🛒 أضف للسلة</button>`}
        <button class="ghost-btn" id="pmShare" style="margin-top:10px;">🔗 مشاركة المنتج</button>
      </div>
    </div>`;
  const paintGal = () => {
    const g = galleryOf(), box = document.getElementById("pmGal");
    box.innerHTML = (g.length ? `<img id="pmMain" src="${esc(g[0])}" alt="${esc(p.name)}" style="width:100%;border-radius:14px;max-height:60vh;object-fit:contain;">` : "")
      + (g.length > 1 ? `<div class="size-row" style="margin:10px 0;">${g.map((x, i) => `<button type="button" class="size-chip" data-pm="${i}" aria-label="صورة ${i + 1}"><img src="${esc(x)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;"></button>`).join("")}</div>` : "");
    box.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { document.getElementById("pmMain").src = g[+b.dataset.pm]; });
  };
  paintGal();
  modalBg.querySelectorAll("[data-pc]").forEach(b => b.onclick = () => {
    vs.colorIdx = +b.dataset.pc;
    modalBg.querySelectorAll("[data-pc]").forEach(x => x.classList.toggle("active", x === b));
    paintGal();
  });
  modalBg.querySelectorAll("[data-psize]").forEach(b => b.onclick = () => {
    vs.size = b.dataset.psize;
    modalBg.querySelectorAll("[data-psize]").forEach(x => x.classList.toggle("active", x === b));
  });
  const add = document.getElementById("pmAdd");
  if (add) add.onclick = () => {
    if (sizes.length && !vs.size) { showToast("الرجاء اختيار القياس أولًا", "err"); return; }
    const ac = colors[vs.colorIdx] || null;
    addToCart(p, { colorName: ac?.name || null, size: vs.size || null });
    flashButton(add, "✓ أُضيف للسلة"); updateCartBadge();
  };
  const short = String(p.id).slice(0, 8);
  document.getElementById("pmShare").onclick = async () => {
    const url = location.origin + location.pathname + "#p=" + short;
    try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); showToast("تم نسخ الرابط ✓"); } } catch (e) {}
  };
  document.getElementById("closeModal").onclick = closeModal;
  modalBg.onclick = e => { if (e.target === modalBg) closeModal(); };
  modalBg.classList.add("open");
  document.title = p.name + " | QR CODE";
  if (push) history.replaceState(null, "", "#p=" + short);
}
function openFromHash(){
  const m = /^#p=(.+)$/.exec(location.hash);
  if (m && state.view === "store") openProductModal(decodeURIComponent(m[1]), false);
}
window.addEventListener("hashchange", openFromHash);

function openAboutModal(){
  modalBg.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-lg-head">
        <div>
          <h2>من نحن</h2>
          <p>تعرّف على قصتنا</p>
        </div>
        <button class="close-x" id="closeModal">✕</button>
      </div>
      <div class="modal-lg-body">${formatRichText(state.settings.aboutUs)}</div>
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
    const phone = normalizeDigits(document.getElementById("trackPhone").value.trim());
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
                ${o.review_moderation === "pending" ? `<div class="hint" style="margin-top:8px;">⏳ تقييمك بانتظار موافقة الإدارة قبل نشره في المتجر.</div>` : ""}
              </div>
            `;
          } else if (o.review_moderation !== "rejected") {
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
        <div class="fade-y">${itemsHtml}</div>
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

// يحوّل نص عادي (كتبه صاحب المتجر بمربع نص بسيط) إلى عرض منظّم:
// الأسطر التي تنتهي بـ ":" تصير عنوان قسم فرعي، والأسطر المتتالية التي تبدأ بـ "-"/"•"/"*" تصير قائمة نقطية،
// وبقية الأسطر تصير فقرات عادية. لا يتطلب من صاحب المتجر تعلم أي صيغة خاصة، فقط كتابة طبيعية.
function formatRichText(text){
  const rawBlocks = (text || "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (!rawBlocks.length) return `<p style="color:var(--muted);">لم تتم إضافة أي محتوى بعد.</p>`;

  return rawBlocks.map(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let heading = "";
    let bodyLines = lines;
    if (lines.length > 1 && /:\s*$/.test(lines[0]) && lines[0].length < 60) {
      heading = lines[0].replace(/:\s*$/, "");
      bodyLines = lines.slice(1);
    }

    const isBullet = (l) => /^[-•*]\s+/.test(l) || /^\d+[.)]\s+/.test(l);
    let html = "";
    let i = 0;
    while (i < bodyLines.length) {
      if (isBullet(bodyLines[i])) {
        const items = [];
        while (i < bodyLines.length && isBullet(bodyLines[i])) {
          items.push(esc(bodyLines[i].replace(/^[-•*]\s+/, "").replace(/^\d+[.)]\s+/, "")));
          i++;
        }
        html += `<ul>${items.map(t => `<li>${t}</li>`).join("")}</ul>`;
      } else {
        html += `<p>${esc(bodyLines[i])}</p>`;
        i++;
      }
    }
    return `<div class="policy-block">${heading ? `<h3>${esc(heading)}</h3>` : ""}${html}</div>`;
  }).join("");
}

function openPoliciesModal(){
  modalBg.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-lg-head">
        <div>
          <h2>السياسات والشروط</h2>
          <p>كل ما تحتاج معرفته قبل إتمام طلبك</p>
        </div>
        <button class="close-x" id="closeModal">✕</button>
      </div>
      <div class="modal-lg-body">${formatRichText(state.settings.policies)}</div>
    </div>
  `;
  document.getElementById("closeModal").onclick = closeModal;
  modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
  modalBg.classList.add("open");
}

/* ---------- نافذة إتمام الطلب (سلة متعددة المنتجات) ---------- */
let checkoutKey = null;
async function syncCartPrices(){
  if (!state.cart.length) return;
  try { await loadProducts(); } catch (e) { return; }
  let changed = false;
  state.cart = state.cart.filter(i => {
    const p = state.products.find(x => String(x.id) === String(i.productId));
    if (!p) { changed = true; return false; }
    if (Number(p.price) !== Number(i.price)) { i.price = Number(p.price); changed = true; }
    i.name = p.name; return true;
  });
  if (changed) { saveCart(); updateCartBadge(); showToast("تم تحديث أسعار السلة حسب آخر تغييرات المتجر", "err"); }
}
async function placeOrder(fn, params){
  const r = await supabaseClient.rpc(fn, params);
  if (!r.error) return { data: r.data, error: null };
  const msg = String(r.error.message || "") + String(r.error.code || "");
  if (/PGRST202|schema cache|Could not find the function|does not exist/i.test(msg)) return null; // الدالة غير مثبّتة بعد → نرجع للإدخال المباشر
  return { data: null, error: r.error };
}
async function openCartCheckoutModal(){
  await syncCartPrices();
  if (!state.cart.length) { closeModal(); return; }
  checkoutKey = (crypto.randomUUID ? crypto.randomUUID() : uid() + uid());
  openCartCheckoutModal0();
}
function openCartCheckoutModal0(){
  const vals = { name: "", governorate: "", city: "", phone: "", socialPlatform: "instagram", socialHandle: "" };

  function paint(){
    const sub = cartSubtotal();
    const total = sub - couponDiscount(vals.coupon, sub);
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
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>إتمام الطلب</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <div style="margin-bottom:14px;">${itemsHtml}</div>
        <input id="fWebsite" type="text" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" aria-hidden="true">
        <div class="field"><div class="box">👤<input id="fName" placeholder="الاسم الكامل" value="${esc(vals.name)}"></div><div class="err" id="errName"></div></div>
        ${locationFieldsHtml(vals)}
        <div class="field"><div class="box">📞<input id="fPhone" placeholder="رقم الهاتف" type="tel" value="${esc(vals.phone)}"></div><div class="err" id="errPhone"></div></div>

        <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">حساب التواصل (اختياري)</p>
        <div class="size-row" id="socialPlatformRow" style="margin-bottom:8px;">
          ${Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => `<button type="button" class="size-chip ${vals.socialPlatform===key?'active':''}" data-social-platform="${key}">${p.icon} ${p.label}</button>`).join("")}
        </div>
        <div class="field"><div class="box">${SOCIAL_PLATFORMS[vals.socialPlatform].icon}<input id="fSocial" placeholder="يوزر ${esc(SOCIAL_PLATFORMS[vals.socialPlatform].label)} (اختياري)" value="${esc(vals.socialHandle)}" dir="ltr"></div></div>

        ${couponBlockHtml(vals, sub)}
        <div class="total-row"><span style="font-weight:400;color:var(--muted)">الإجمالي</span><span>${money(total)} د.ع</span></div>
        <button class="primary-btn" id="submitOrder">تأكيد الطلب</button>
      </div>
    `;
    document.getElementById("closeModal").onclick = closeModal;
    modalBg.onclick = (e) => { if (e.target === modalBg) closeModal(); };
    document.getElementById("submitOrder").onclick = submit;
    // حفظ القيم فور كتابتها حتى تبقى محفوظة عبر أي إعادة رسم لاحقة
    document.getElementById("fName").oninput = (e) => vals.name = e.target.value;
    bindLocationFields(vals, paint);
    bindCoupon(vals, paint);
    document.getElementById("fPhone").oninput = (e) => vals.phone = e.target.value;
    document.getElementById("fSocial").oninput = (e) => vals.socialHandle = e.target.value;
    document.querySelectorAll("#socialPlatformRow [data-social-platform]").forEach(chip => {
      chip.onclick = () => { vals.socialPlatform = chip.dataset.socialPlatform; paint(); };
    });
  }

  async function submit(){
    if (document.getElementById("fWebsite")?.value) return;
    if (state.cart.length === 0) { showToast("السلة فارغة", "err"); return; }
    const name = vals.name.trim();
    const loc = (vals.governorate && vals.city) ? `${vals.governorate} - ${vals.city}` : "";
    const phone = normalizeDigits(vals.phone.trim());
    const socialHandle = vals.socialHandle.trim().replace(/^@/, "");
    let ok = true;
    document.getElementById("errName").textContent = "";
    document.getElementById("errGov").textContent = "";
    document.getElementById("errCity").textContent = "";
    document.getElementById("errPhone").textContent = "";
    if (!name){ document.getElementById("errName").textContent = "أدخل الاسم"; ok = false; }
    if (!vals.governorate){ document.getElementById("errGov").textContent = "اختر المحافظة"; ok = false; }
    else if (!vals.city){ document.getElementById("errCity").textContent = "اختر المدينة"; ok = false; }
    if (!phone || phone.replace(/\D/g,"").length < 8){ document.getElementById("errPhone").textContent = "أدخل رقم هاتف صحيح"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("submitOrder");
    btn.disabled = true; btn.textContent = "جارِ الإرسال...";

    const cartItems = state.cart.map(i => ({
      product_id: i.productId, name: i.name, price: i.price, qty: i.qty,
      colorName: i.colorName, size: i.size
    }));
    const subtotal = cartSubtotal();
    const discount = couponDiscount(vals.coupon, subtotal);
    const total = subtotal - discount;
    const totalQty = state.cart.reduce((s, i) => s + i.qty, 0);
    const productSummary = state.cart.map(i => {
      const parts = [];
      if (i.colorName) parts.push(i.colorName);
      if (i.size) parts.push(i.size);
      return `${i.name}${parts.length ? ` (${parts.join(" · ")})` : ""} × ${i.qty}`;
    }).join(", ");

    const rpcRes = await placeOrder("create_order", { p_name: name, p_phone: phone, p_address: loc, p_items: cartItems, p_coupon: vals.coupon ? vals.coupon.code : null, p_social: encodeSocial(vals.socialPlatform, socialHandle), p_key: checkoutKey });
    const viaRpc = !!rpcRes && !rpcRes.error;
    const { data: inserted, error } = rpcRes || await supabaseClient
      .from('orders')
      .insert([
        {
          customer_name: name,
          phone_number: phone,
          address: loc,
          product_name: productSummary,
          cart_items: cartItems,
          instagram_username: encodeSocial(vals.socialPlatform, socialHandle),
          qty: totalQty,
          total,
          ...(discount ? { coupon_code: vals.coupon.code, discount } : {})
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      showToast("تعذر حفظ الطلب: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "تأكيد الطلب";
      return;
    }

    // خصم الكمية من مخزون كل منتج بالسلة (فقط للمنتجات اللي حدّد لها صاحب المتجر كمية محدودة)
    if (viaRpc) state.cart.forEach(i => { const lp = state.products.find(x => String(x.id) === String(i.productId)); if (lp && lp.stock != null) lp.stock = Math.max(0, Number(lp.stock) - i.qty); });
    else for (const item of state.cart) {
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

    const num = formatWhatsapp(state.settings.whatsapp);
    if (num){
      const socialLine = socialHandle ? `\n${SOCIAL_PLATFORMS[vals.socialPlatform].label}: ${socialUrl(vals.socialPlatform, socialHandle)}` : "";
      const msg = `حجز جديد من QR CODE\nرقم الطلب: ${orderRef(inserted)}\nالمنتجات:\n${productSummary}${discount ? `\nكود الخصم: ${vals.coupon.code} (-${discount} د.ع)` : ""}\nالسعر الإجمالي: ${total} د.ع\nاسم العميل: ${name}\nالموقع: ${loc}\nرقم الهاتف: ${phone}${socialLine}`;
      const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;

      // الإيصال يُطبع أولًا، وبعد اكتماله يضغط الزبون "تم" فيُفتح واتساب (بنقرة مباشرة، فلا تظهر تبويبات فارغة)
      // واتساب يُفتح بعد انتهاء حركة الشاحنة (خارج لحظة النقر)، وبعض المتصفحات (خاصة iOS) تحجب window.open هنا — فإن حُجب ننتقل للرابط مباشرة
      showReceiptScreen({ ref: orderRef(inserted), items: cartItems, subtotal, discount, total, coupon: vals.coupon, name, phone, loc }, waUrl, () => {
        const w = window.open(waUrl, "_blank");
        closeModal(); render();
        if (!w) location.href = waUrl;
      });
      return;
    }
    showReceiptScreen({ ref: orderRef(inserted), items: cartItems, subtotal, discount, total, coupon: vals.coupon, name, phone, loc }, null, () => { closeModal(); render(); });
  }

  paint();
  modalBg.classList.add("open");
}

/* ======================= نافذة الطلب المخصص (بدون منتج محدد من الكتالوج) ======================= */
function openCustomOrderModal(){
  const vals = { name: "", governorate: "", city: "", phone: "", socialPlatform: "instagram", socialHandle: "", serviceType: "طباعة", desc: "" };
  const SERVICE_TYPES = ["طباعة", "تطريز", "سجاد Tufting", "باجات / أقلام", "أخرى"];

  function paint(){
    modalBg.innerHTML = `
      <div class="modal">
        <div class="row">
          <h2>اطلب تصميمك الخاص</h2>
          <button class="close-x" id="closeModal">✕</button>
        </div>
        <p class="hint" style="margin:-6px 0 14px;">اشرح لنا فكرتك وسنتواصل معك لتحديد السعر وتفاصيل التنفيذ.</p>

        <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">نوع الخدمة</p>
        <div class="size-row" id="serviceTypeRow" style="margin-bottom:14px;">
          ${SERVICE_TYPES.map(t => `<button type="button" class="size-chip ${vals.serviceType===t?'active':''}" data-svc="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>

        <textarea class="plain-textarea" id="fCustomDesc" placeholder="اشرح طلبك (المقاس، الكمية، الألوان، أي تفاصيل مهمة...)" rows="3">${esc(vals.desc)}</textarea>
        <div class="err" id="errDesc" style="margin:-6px 0 10px;"></div>

        <input id="fWebsite" type="text" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" aria-hidden="true">
        <div class="field"><div class="box">👤<input id="fName" placeholder="الاسم الكامل" value="${esc(vals.name)}"></div><div class="err" id="errName"></div></div>
        ${locationFieldsHtml(vals)}
        <div class="field"><div class="box">📞<input id="fPhone" placeholder="رقم الهاتف" type="tel" value="${esc(vals.phone)}"></div><div class="err" id="errPhone"></div></div>

        <p class="hint" style="margin:0 0 6px;font-weight:700;color:var(--ink);">حساب التواصل (اختياري)</p>
        <div class="size-row" id="socialPlatformRow" style="margin-bottom:8px;">
          ${Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => `<button type="button" class="size-chip ${vals.socialPlatform===key?'active':''}" data-social-platform="${key}">${p.icon} ${p.label}</button>`).join("")}
        </div>
        <div class="field"><div class="box">${SOCIAL_PLATFORMS[vals.socialPlatform].icon}<input id="fSocial" placeholder="يوزر ${esc(SOCIAL_PLATFORMS[vals.socialPlatform].label)} (اختياري)" value="${esc(vals.socialHandle)}" dir="ltr"></div></div>

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
    bindLocationFields(vals, paint);
    document.getElementById("fPhone").oninput = (e) => vals.phone = e.target.value;
    document.getElementById("fSocial").oninput = (e) => vals.socialHandle = e.target.value;
    document.querySelectorAll("#socialPlatformRow [data-social-platform]").forEach(chip => {
      chip.onclick = () => { vals.socialPlatform = chip.dataset.socialPlatform; paint(); };
    });

  }

  async function submit(){
    if (document.getElementById("fWebsite")?.value) return;
    const name = vals.name.trim();
    const loc = (vals.governorate && vals.city) ? `${vals.governorate} - ${vals.city}` : "";
    const phone = normalizeDigits(vals.phone.trim());
    const socialHandle = vals.socialHandle.trim().replace(/^@/, "");
    const desc = vals.desc.trim();
    let ok = true;
    document.getElementById("errName").textContent = "";
    document.getElementById("errGov").textContent = "";
    document.getElementById("errCity").textContent = "";
    document.getElementById("errPhone").textContent = "";
    document.getElementById("errDesc").textContent = "";
    if (!desc){ document.getElementById("errDesc").textContent = "اشرح لنا طلبك بإيجاز"; ok = false; }
    if (!name){ document.getElementById("errName").textContent = "أدخل الاسم"; ok = false; }
    if (!vals.governorate){ document.getElementById("errGov").textContent = "اختر المحافظة"; ok = false; }
    else if (!vals.city){ document.getElementById("errCity").textContent = "اختر المدينة"; ok = false; }
    if (!phone || phone.replace(/\D/g,"").length < 8){ document.getElementById("errPhone").textContent = "أدخل رقم هاتف صحيح"; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("submitOrder");
    btn.disabled = true; btn.textContent = "جارِ الإرسال...";

    const rpcRes2 = await placeOrder("create_custom_order", { p_name: name, p_phone: phone, p_address: loc, p_service: vals.serviceType, p_desc: desc, p_social: encodeSocial(vals.socialPlatform, socialHandle) });
    const { data: inserted, error } = rpcRes2 || await supabaseClient
      .from('orders')
      .insert([
        {
          customer_name: name,
          phone_number: phone,
          address: loc,
          product_name: `طلب مخصص - ${vals.serviceType}`,
          instagram_username: encodeSocial(vals.socialPlatform, socialHandle),
          qty: 1,
          total: null,
          custom_request: desc
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      showToast("تعذر إرسال الطلب: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "إرسال الطلب";
      return;
    }

    const localOrder = { ...inserted };
    state.orders.unshift(localOrder);

    const num = formatWhatsapp(state.settings.whatsapp);
    if (num){
      const socialLine = socialHandle ? `\n${SOCIAL_PLATFORMS[vals.socialPlatform].label}: ${socialUrl(vals.socialPlatform, socialHandle)}` : "";
      const msg = `طلب مخصص جديد من QR CODE\nرقم الطلب: ${orderRef(inserted)}\nنوع الخدمة: ${vals.serviceType}\nالتفاصيل: ${desc}\nاسم العميل: ${name}\nالموقع: ${loc}\nرقم الهاتف: ${phone}${socialLine}`;
      const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;

      modalBg.querySelector(".modal").innerHTML = `
        <div class="center" style="padding:6px 0;">
          <div class="seal" style="margin:0 auto 16px;">✓</div>
          <h2 style="margin-bottom:4px;">تم إرسال طلبك</h2>
          <p style="font-weight:800;font-size:15px;margin-bottom:10px;">رقم طلبك: ${orderRef(inserted)}</p>
          <p class="hint" style="margin-bottom:12px;">اضغط "تم" لفتح محادثة واتساب بتفاصيل طلبك — أرسلها وسنتواصل معك لتحديد السعر وتأكيد التنفيذ. احتفظ برقم الطلب لمتابعة حالته لاحقًا.</p>
          <p style="margin:0 0 22px;padding:10px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line);font-size:13px;font-weight:700;line-height:1.8;">🎨 بعد إرسال الرسالة، أرسل التصميم أو الصورة المرجعية في نفس محادثة واتساب.</p>
          ${truckBtnHtml("closeWaitBtn", "تم", "تم الإرسال")}
        </div>
      `;
      // واتساب يُفتح بعد انتهاء حركة الشاحنة؛ إن حجب المتصفح النافذة ننتقل للرابط مباشرة
      bindTruckBtn(document.getElementById("closeWaitBtn"), () => {
        const w = window.open(waUrl, "_blank");
        closeModal(); render();
        if (!w) location.href = waUrl;
      });
      return;
    }
    showToast(`تم إرسال طلبك بنجاح — رقم طلبك: ${orderRef(inserted)}`);
    closeModal();
    render();
  }

  paint();
  modalBg.classList.add("open");
}

const BASE_TITLE = document.title;
function closeModal(){
  if (/^#p=/.test(location.hash)) { history.replaceState(null, "", location.pathname + location.search); document.title = BASE_TITLE; }
  modalBg.classList.remove("open");
  modalBg.innerHTML = "";
}

/* ======================= جلب البيانات من Supabase ======================= */
async function loadProducts(){
  if (!state.currentAdmin) {
    const pub = await loadPublished();
    if (pub && Array.isArray(pub.products)) { state.products = pub.products; return; }
  } else { try { await seedFromPublished(); } catch (e) { console.error("seed error", e); } }
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

async function logActivity(action, details){
  try {
    await supabaseClient.from('activity_log').insert([{
      admin_username: state.currentAdmin?.username || "غير معروف",
      action,
      order_ref: details || null
    }]);
  } catch (e) {
    console.error("activity log insert error", e);
  }
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
    openFromHash();
  } catch (e) {
    console.error("App init error:", e);
    if (typeof showStoreLoadError === "function") showStoreLoadError();
  }
}

init();
