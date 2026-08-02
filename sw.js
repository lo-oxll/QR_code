/* ======================= Service Worker — QR CODE =======================
   يوفّر: (1) تحميل أسرع بعد أول زيارة عبر تخزين الملفات الثابتة بالكاش،
          (2) عمل جزئي بدون إنترنت لواجهة المتجر بعد أول تحميل ناجح.
   لا يخزّن أي بيانات من Supabase (منتجات/طلبات) — هذه تبقى تُجلب دائمًا من الشبكة مباشرة
   حتى لا يرى الزبون بيانات قديمة (أسعار/مخزون/طلبات) بسبب الكاش.
========================================================================= */

const CACHE_NAME = "qrcode-static-v1";

// الملفات الثابتة فقط (لا تتغير كثيرًا) — يُحدَّث رقم النسخة أعلاه عند أي تعديل بها لإجبار تحديث الكاش
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./logo.png",
  "./favicon-32x32.png",
  "./favicon-16x16.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // لا نتدخل إطلاقًا في طلبات Supabase (بيانات المنتجات/الطلبات/الصور المرفوعة) — تبقى دائمًا Network فقط
  if (url.hostname.includes("supabase.co")) return;

  // نفس الأصل فقط (ملفات الموقع الثابتة) — نطبّق: كاش أولًا، ثم شبكة كنسخة احتياطية، مع تحديث الكاش بصمت
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
