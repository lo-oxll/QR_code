/* مكونات واجهة مستوحاة من dqnamo.com/kitchen — JS/CSS عادي بدون مكتبات */

// Dynamic Button: يبدّل نص الزر بحركة سلسة ثم يعيده
function flashButton(btn, text, ms = 1400){
  if (!btn || btn.dataset.busy) return;
  const orig = btn.textContent;
  btn.dataset.busy = "1";
  const swap = (t, cls) => {
    btn.classList.add("dyn-out");
    setTimeout(() => {
      btn.textContent = t;
      btn.classList.toggle("dyn-ok", cls);
      btn.classList.replace("dyn-out", "dyn-in");
      setTimeout(() => btn.classList.remove("dyn-in"), 180);
    }, 140);
  };
  swap(text, true);
  setTimeout(() => { swap(orig, false); setTimeout(() => delete btn.dataset.busy, 340); }, ms);
}

// Hold to Confirm: يرجع Promise<boolean> — بديل confirm() بالضغط المطوّل
function holdConfirm(message, holdMs = 1200){
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "hold-ov";
    ov.innerHTML = `
      <div class="hold-box" role="dialog" aria-modal="true">
        <p class="hold-msg"></p>
        <button type="button" class="hold-btn"><span class="hold-fill"></span><span class="hold-label">اضغط باستمرار للحذف</span></button>
        <button type="button" class="hold-cancel">إلغاء</button>
      </div>`;
    ov.querySelector(".hold-msg").textContent = message;
    document.body.appendChild(ov);
    const btn = ov.querySelector(".hold-btn");
    const fill = ov.querySelector(".hold-fill");
    let raf = 0, t0 = 0, done = false;
    const finish = v => { if (done) return; done = true; cancelAnimationFrame(raf); ov.remove(); resolve(v); };
    const tick = now => {
      const p = Math.min((now - t0) / holdMs, 1);
      fill.style.transform = `scaleX(${p})`;
      if (p >= 1) { if (navigator.vibrate) navigator.vibrate(30); finish(true); return; }
      raf = requestAnimationFrame(tick);
    };
    const start = e => { e.preventDefault(); t0 = performance.now(); fill.style.transition = "none"; raf = requestAnimationFrame(tick); };
    const stop = () => { if (done) return; cancelAnimationFrame(raf); fill.style.transition = "transform .25s"; fill.style.transform = "scaleX(0)"; };
    btn.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener("contextmenu", e => e.preventDefault());
    ov.querySelector(".hold-cancel").onclick = () => finish(false);
    ov.addEventListener("click", e => { if (e.target === ov) finish(false); });
  });
}

/* ---------- تراجع بعد الحذف (Hold to Confirm + Undo) ---------- */
function showUndoToast(text, onUndo, ms = 6000){
  const host = document.getElementById("toastHost") || document.body;
  const el = document.createElement("div");
  el.className = "toast undo-toast";
  el.innerHTML = "<span></span><button type=\"button\">تراجع</button>";
  el.firstChild.textContent = text;
  host.appendChild(el);
  let done = false;
  const kill = () => { if (!done) { done = true; el.remove(); } };
  el.querySelector("button").onclick = async () => {
    if (done) return; kill();
    try { await onUndo(); showToast("تم التراجع ✓"); } catch (e) { console.error("undo error", e); showToast("تعذر التراجع", "err"); }
  };
  setTimeout(kill, ms);
}

/* ---------- Scroll Fade List: تلاشي حواف القوائم القابلة للتمرير ---------- */
function updateFade(el){
  const vert = el.classList.contains("fade-y");
  const rtl = getComputedStyle(el).direction === "rtl";
  const pos = vert ? el.scrollTop : Math.abs(el.scrollLeft);
  const max = vert ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  el.style.setProperty("--dir", vert ? "to bottom" : (rtl ? "to left" : "to right"));
  el.style.setProperty("--f1", pos > 2 ? "28px" : "0px");
  el.style.setProperty("--f2", max - pos > 2 ? "28px" : "0px");
}
function initFadeLists(){
  document.querySelectorAll(".card .size-row, .card .color-row, .fade-y").forEach(el => {
    if (!el.dataset.fade) {
      el.dataset.fade = "1";
      el.classList.add("fade-list");
      el.addEventListener("scroll", () => updateFade(el), { passive: true });
    }
    updateFade(el);
  });
}

/* ---------- Iridescent Foil: شارات "جديد" و"مميز" ---------- */
let lastPtr = 0;
function updateFoil(){
  if (Date.now() - lastPtr < 500) return;
  const h = window.innerHeight || 800;
  document.querySelectorAll(".foil").forEach(el => {
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (r.top + r.height / 2) / h));
    el.style.setProperty("--fx", (p * 100).toFixed(1) + "%");
  });
}
window.addEventListener("scroll", () => {
  if (updateFoil.t) return;
  updateFoil.t = requestAnimationFrame(() => { updateFoil.t = 0; updateFoil(); });
}, { passive: true });
document.addEventListener("pointermove", e => {
  const c = e.target.closest && e.target.closest(".card");
  if (!c) return;
  lastPtr = Date.now();
  const r = c.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%";
  c.querySelectorAll(".foil").forEach(f => f.style.setProperty("--fx", x));
}, { passive: true });

/* ---------- Magnetic Drop Zone: منطقة رفع تنجذب للملف أثناء السحب ---------- */
function dropInput(zone){
  for (let n = zone.previousElementSibling; n; n = n.previousElementSibling) if (n.matches && n.matches("input[type=file]")) return n;
  for (let n = zone.nextElementSibling; n; n = n.nextElementSibling) if (n.matches && n.matches("input[type=file]")) return n;
  return null;
}
let magZone = null;
function resetZone(z){ if (!z) return; z.classList.remove("mag-near", "mag-over"); z.style.transform = ""; }
function resetZones(){ document.querySelectorAll(".upload-box").forEach(resetZone); magZone = null; }
document.addEventListener("dragover", e => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
  const zones = Array.from(document.querySelectorAll(".upload-box"));
  if (!zones.length) return;
  let best = null, bd = Infinity;
  zones.forEach(z => {
    const r = z.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (d < bd) { bd = d; best = z; }
  });
  zones.forEach(z => { if (z !== best) resetZone(z); });
  const r = best.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (bd < Math.max(r.width, r.height) / 2 + 140) {
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    magZone = best;
    const clamp = v => Math.max(-14, Math.min(14, v));
    const dx = clamp((e.clientX - (r.left + r.width / 2)) * 0.08), dy = clamp((e.clientY - (r.top + r.height / 2)) * 0.08);
    best.classList.add("mag-near"); best.classList.toggle("mag-over", inside);
    best.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + (inside ? 1.04 : 1.02) + ")";
  } else { resetZone(best); magZone = null; }
});
document.addEventListener("dragleave", e => { if (!e.relatedTarget) resetZones(); });
document.addEventListener("dragend", resetZones);
document.addEventListener("drop", e => {
  if (!magZone) return;
  e.preventDefault();
  const inp = dropInput(magZone), f = e.dataTransfer && e.dataTransfer.files;
  resetZones();
  if (!inp || !f || !f.length) return;
  const dt = new DataTransfer();
  Array.from(inp.multiple ? f : [f[0]]).forEach(x => dt.items.add(x));
  inp.files = dt.files;
  inp.dispatchEvent(new Event("change", { bubbles: true }));
});

/* ---------- Ticket / Stamp: كوبونات الخصم وبطاقات الهدايا ---------- */
function ticketHtml(c, discount){
  const pct = c.type === "percent";
  return `<div class="ticket">
    <div class="tk-main"><small>${pct ? "كوبون خصم" : "بطاقة هدية"}</small><b dir="ltr">${esc(c.code)}</b>${discount != null ? `<span>وفّرت ${money(discount)} د.ع</span>` : ""}</div>
    <div class="tk-cut"></div>
    <div class="tk-stamp"><div class="stamp"><b>${pct ? Number(c.value) + "%" : money(c.value)}</b><small>${pct ? "خصم" : "د.ع"}</small></div></div>
  </div>`;
}
function couponDiscount(c, sub){
  if (!c) return 0;
  const v = Number(c.value) || 0;
  const d = c.type === "percent" ? Math.round(sub * Math.min(v, 100) / 100) : v;
  return Math.max(0, Math.min(d, sub));
}
async function findCoupon(code){
  const k = String(code || "").trim().toUpperCase();
  if (!k) return null;
  if (!state.currentAdmin) {
    const pub = await loadPublished();
    if (pub && Array.isArray(pub.coupons)) {
      const h = await sha256Hex(k);
      const m = pub.coupons.find(x => x.code_hash === h);
      return m ? { code: k, type: m.type, value: m.value } : null;
    }
  }
  const { data } = await supabaseClient.from("coupons").select("*").eq("code", k);
  const c = (data || [])[0];
  return c && c.active !== false ? c : null;
}
function couponBlockHtml(vals, sub){
  if (vals.coupon) {
    const d = couponDiscount(vals.coupon, sub);
    return ticketHtml(vals.coupon, d) + `<button type="button" class="cp-remove" id="cpRemove">إزالة الكوبون</button>
      <div class="total-row" style="margin:6px 0 0;color:var(--ok);"><span>الخصم</span><span>-${money(d)} د.ع</span></div>`;
  }
  return `<div class="cp-row"><div class="field" style="flex:1;margin:0;"><div class="box">🎟️<input id="cpInput" placeholder="كود الخصم (اختياري)" dir="ltr" autocomplete="off"></div></div><button type="button" class="size-chip" id="cpApply">تطبيق</button></div><div class="err" id="cpErr" style="margin:4px 0 0;"></div>`;
}
function bindCoupon(vals, repaint){
  const rm = document.getElementById("cpRemove");
  if (rm) rm.onclick = () => { vals.coupon = null; repaint(); };
  const ap = document.getElementById("cpApply");
  if (!ap) return;
  ap.onclick = async () => {
    const err = document.getElementById("cpErr");
    const c = await findCoupon(document.getElementById("cpInput").value);
    if (!c) { err.textContent = "الكود غير صحيح أو غير فعّال"; return; }
    vals.coupon = c; repaint();
  };
}
async function renderCouponsPanel(el){
  if (!el) return;
  const { data } = await supabaseClient.from("coupons").select("*").order("created_at", { ascending: false });
  const list = data || [];
  let type = "percent";
  el.innerHTML = `<h3>كوبونات الخصم وبطاقات الهدايا</h3>
    <p class="hint">الكوبون بنسبة مئوية، وبطاقة الهدية بمبلغ ثابت. يُدخل الزبون الكود عند إتمام الطلب فيُخصم من الإجمالي.</p>
    <input class="plain-input" id="cpCode" placeholder="الكود (مثال: EID25)" dir="ltr">
    <div class="size-row" id="cpTypeRow" style="margin-bottom:10px;padding:0;">
      <button type="button" class="size-chip active" data-cptype="percent">نسبة %</button>
      <button type="button" class="size-chip" data-cptype="fixed">مبلغ ثابت (بطاقة هدية)</button>
    </div>
    <input class="plain-input" id="cpValue" placeholder="القيمة" inputmode="numeric">
    <div class="err" id="cpAdminErr" style="margin:-6px 0 10px;"></div>
    <button class="primary-btn" id="cpAdd">+ إضافة</button>
    <div style="margin-top:16px;">${list.length ? list.map(c => `<div class="cp-item">${ticketHtml(c, null)}<button class="del-btn" data-cpdel="${esc(c.id)}">🗑</button></div>`).join("") : '<p class="hint center">لا توجد كوبونات بعد.</p>'}</div>`;
  el.querySelectorAll("[data-cptype]").forEach(b => b.onclick = () => {
    type = b.dataset.cptype;
    el.querySelectorAll("[data-cptype]").forEach(x => x.classList.toggle("active", x === b));
  });
  document.getElementById("cpAdd").onclick = async () => {
    const err = document.getElementById("cpAdminErr");
    const code = document.getElementById("cpCode").value.trim().toUpperCase();
    const value = Number(normalizeDigits(document.getElementById("cpValue").value.trim()));
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) { err.textContent = "الكود: 3-20 حرفًا إنجليزيًا أو أرقامًا"; return; }
    if (!value || value <= 0 || (type === "percent" && value > 100)) { err.textContent = type === "percent" ? "النسبة بين 1 و100" : "أدخل مبلغًا صحيحًا"; return; }
    if (list.some(c => c.code === code)) { err.textContent = "هذا الكود موجود مسبقًا"; return; }
    const { error } = await supabaseClient.from("coupons").insert([{ code, type, value, active: true }]);
    if (error) { err.textContent = "تعذر الحفظ: " + error.message; return; }
    logActivity("إضافة كوبون", code);
    showToast("تمت إضافة الكوبون");
    renderCouponsPanel(el);
  };
  el.querySelectorAll("[data-cpdel]").forEach(b => b.onclick = async () => {
    if (!(await holdConfirm("حذف هذا الكوبون؟"))) return;
    const row = list.find(c => String(c.id) === b.dataset.cpdel);
    await supabaseClient.from("coupons").delete().eq("id", b.dataset.cpdel);
    logActivity("حذف كوبون", row && row.code);
    renderCouponsPanel(el);
    showUndoToast("تم حذف الكوبون", async () => { await supabaseClient.from("coupons").insert([row]); renderCouponsPanel(el); });
  });
}

/* ---------- Receipt Printer (منقول من dqnamo.com/experiments/receipt-printer): معالجة ← طباعة ← اكتمال ---------- */
function receiptHtml(o){
  const rows = o.items.map(i => {
    const v = [i.colorName, i.size].filter(Boolean).join(" · ");
    return `<div class="rcp-item"><div class="rcp-iname">${esc(i.name)}${v ? `<small>${esc(v)}</small>` : ""}</div><div class="rcp-iqty">× ${i.qty}</div><div class="rcp-iprice">${money(i.price * i.qty)}</div></div>`;
  }).join("");
  const meta = (k, v) => v ? `<div class="rcp-meta"><span>${k}</span><b>${esc(v)}</b></div>` : "";
  return `<section class="rcp" data-stage="processing" aria-label="طابعة الفواتير">
    <div class="rcp-machine">
      <div class="rcp-header"><span class="rcp-brand">QR CODE</span><span class="rcp-led"></span></div>
      <div class="rcp-screen"><div class="rcp-status" role="status" aria-live="polite">
        <span class="rcp-ind" aria-hidden="true"><i class="rcp-spin"></i><i class="rcp-check">✓</i></span>
        <span class="rcp-label"></span></div></div>
      <div class="rcp-slot" aria-hidden="true"></div>
    </div>
    <div class="rcp-output">
      <div class="rcp-topshadow" aria-hidden="true"></div>
      <div class="rcp-feed"><article class="rcp-paper">
        <div class="rcp-title"><b>QR CODE</b><span>فاتورة طلب</span></div>
        <div class="rcp-sep"></div>
        ${meta("رقم الطلب", o.ref)}${meta("التاريخ", new Date().toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }))}
        ${meta("الاسم", o.name)}${meta("الهاتف", o.phone)}${meta("الموقع", o.loc)}
        <div class="rcp-sep"></div>${rows}<div class="rcp-sep"></div>
        ${o.discount ? `<div class="rcp-meta"><span>المجموع</span><b>${money(o.subtotal)}</b></div><div class="rcp-meta"><span>خصم (${esc(o.coupon.code)})</span><b>-${money(o.discount)}</b></div>` : ""}
        <div class="rcp-meta rcp-total"><span>الإجمالي</span><b>${money(o.total)} د.ع</b></div>
        <div class="rcp-bar" aria-hidden="true"></div>
        <p class="rcp-thanks">شكرًا لثقتكم ♥</p>
      </article></div>
    </div>
  </section>`;
}
function receiptText(o){
  const lines = ["فاتورة طلب — QR CODE", "رقم الطلب: " + o.ref, "التاريخ: " + new Date().toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })];
  if (o.name) lines.push("الاسم: " + o.name);
  if (o.phone) lines.push("الهاتف: " + o.phone);
  if (o.loc) lines.push("الموقع: " + o.loc);
  lines.push("------------------");
  o.items.forEach(i => lines.push(`${i.name}${[i.colorName, i.size].filter(Boolean).length ? " (" + [i.colorName, i.size].filter(Boolean).join(" · ") + ")" : ""} × ${i.qty} — ${money(i.price * i.qty)}`));
  lines.push("------------------");
  if (o.discount) lines.push(`خصم (${o.coupon.code}): -${money(o.discount)}`);
  lines.push("الإجمالي: " + money(o.total) + " د.ع");
  return lines.join("\n");
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try { const x = document.createElement("textarea"); x.value = t; x.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(x); x.select(); const ok = document.execCommand("copy"); x.remove(); return ok; }
    catch { return false; }
  }
}
function runReceiptStages(root, done){
  const label = root.querySelector(".rcp-label");
  const L = { processing: "جارٍ معالجة طلبك", printing: "جارٍ طباعة الفاتورة", complete: "اكتمل الطلب" };
  const set = st => { root.dataset.stage = st; label.textContent = L[st]; label.classList.remove("rcp-in"); void label.offsetWidth; label.classList.add("rcp-in"); };
  set("processing");
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { set("complete"); done(); return; }
  setTimeout(() => { set("printing"); setTimeout(() => { set("complete"); done(); }, 1800); }, 1300);
}
/* شاشة نجاح الطلب: الإيصال يُطبع أولًا، وبعد اكتماله تظهر أزرار النسخ والمتابعة (لقطة الشاشة تُؤخذ من الفاتورة الكاملة) */
function showReceiptScreen(o, waUrl, onDone){
  const modal = modalBg.querySelector(".modal");
  modal.innerHTML = `<div class="center" style="padding:6px 0;">
    ${receiptHtml(o)}
    <div class="rcp-actions" id="rcpActions">
      <button type="button" class="ghost-btn" id="rcpCopy">📋 نسخ الفاتورة</button>
      <p class="hint">${waUrl ? "خذ لقطة شاشة للفاتورة ثم اضغط «تم» لفتح واتساب وأرسلها مع رسالة الطلب." : "خذ لقطة شاشة للفاتورة واحتفظ برقم الطلب لمتابعة حالته لاحقًا."}</p>
      <button class="primary-btn" id="closeWaitBtn">تم</button>
    </div></div>`;
  document.getElementById("rcpCopy").onclick = async function(){
    const ok = await copyText(receiptText(o));
    this.textContent = ok ? "✓ تم نسخ الفاتورة" : "تعذر النسخ";
    setTimeout(() => { this.textContent = "📋 نسخ الفاتورة"; }, 2000);
  };
  document.getElementById("closeWaitBtn").onclick = onDone;
  runReceiptStages(modal.querySelector(".rcp"), () => document.getElementById("rcpActions").classList.add("show"));
}

/* مراقب DOM: يفعّل التلاشي على أي قائمة جديدة تُرسم */
const uiObserver = new MutationObserver(() => {
  if (uiObserver.t) return;
  uiObserver.t = requestAnimationFrame(() => { uiObserver.t = 0; initFadeLists(); updateFoil(); });
});
uiObserver.observe(document.body, { childList: true, subtree: true });
