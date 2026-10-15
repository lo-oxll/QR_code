// SSG خفيف: صفحة ثابتة لكل منتج (p/<id>/index.html) فيها meta + JSON-LD للزواحف، ثم تحوّل الزائر إلى المتجر #p=ID
// الاستخدام: node scripts/prerender.mjs   (يحتاج Node 18+ واتصال بالإنترنت)
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = "https://lo-oxll.github.io/QR_code/";
const URL_ = "https://hhknbkyjalsbanoudoos.supabase.co", KEY = "sb_publishable_SaukFLYePA4O6j9hm33Xfw_uvyYm1u-";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r = await fetch(`${URL_}/rest/v1/products?select=id,name,description,price,image,stock&order=created_at.desc`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
if (!r.ok) throw new Error("تعذر جلب المنتجات: " + r.status);
const products = await r.json(), urls = [BASE];
for (const p of products) {
  const img = p.image && !p.image.startsWith("data:") ? (p.image.startsWith("http") ? p.image : BASE + p.image) : BASE + "logo.png";
  const sid = String(p.id).slice(0, 8), page = `${BASE}p/${sid}/`, desc = (p.description || p.name).slice(0, 160);
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, description: desc, image: img, offers: { "@type": "Offer", priceCurrency: "IQD", price: Number(p.price) || 0, availability: p.stock != null && Number(p.stock) <= 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock", url: page } };
  mkdirSync(`p/${sid}`, { recursive: true });
  writeFileSync(`p/${sid}/index.html`, `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(p.name)} | QR CODE</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${page}"><meta property="og:type" content="product"><meta property="og:title" content="${esc(p.name)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script><meta http-equiv="refresh" content="0;url=../../#p=${sid}"></head><body><h1>${esc(p.name)}</h1><p>${esc(desc)}</p><a href="../../#p=${sid}">فتح المنتج في المتجر</a><script>location.replace("../../#p=${sid}")</script></body></html>`);
  urls.push(page);
}
writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u}</loc></url>`).join("")}</urlset>`);
console.log("تم توليد", products.length, "صفحة منتج + sitemap.xml");
