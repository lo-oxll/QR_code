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
