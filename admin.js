/* لوحة الإدارة — تُحمَّل عند الحاجة فقط (تسجيل الدخول) حتى لا يحمّلها الزبائن */
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
        await Promise.all([loadProducts(), loadSettings()]);
        state.view = "admin";
        state.adminTab = data[0].role === "owner" ? "products" : "orders";
        await loadOrders();
        startOrderPolling();
        render();
        logActivity("تسجيل دخول");
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
      <button class="tab ${state.adminTab==='activity'?'active':''}" data-tab="activity">سجل النشاط</button>
      <button class="tab ${state.adminTab==='settings'?'active':''}" data-tab="settings">الإعدادات</button>
      <button class="tab ${state.adminTab==='admins'?'active':''}" data-tab="admins">المشرفون</button>
    `
    : `
      <button class="tab ${state.adminTab==='orders'?'active':''}" data-tab="orders">الحجوزات (${state.orders.length})${ordersBadge}</button>
      <button class="tab ${state.adminTab==='products'?'active':''}" data-tab="products">المنتجات</button>
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
  document.getElementById("logoutBtn").onclick = async () => {
    await logActivity("تسجيل خروج");
    stopOrderPolling();
    state.newOrdersCount = 0;
    document.title = "QR CODE | طباعة · تطريز · ليزر";
    state.currentAdmin = null;
    state.view = "store";
    await Promise.all([loadProducts(), loadSettings()]);
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
  // المشرف (staff) يُسمح له فقط بـ orders و products (عرض فقط)
  if (!isOwner && !["orders", "products"].includes(state.adminTab)) state.adminTab = "orders";

  const body = document.getElementById("adminBody");
  if (state.adminTab === "products") {
    if (isOwner) renderProductsTab(body);
    else renderProductsReadOnly(body);
  }
  else if (state.adminTab === "orders") renderOrdersTab(body);
  else if (state.adminTab === "stats" && isOwner) renderStatsTab(body);
  else if (state.adminTab === "activity" && isOwner) renderActivityTab(body);
  else if (state.adminTab === "settings" && isOwner) renderSettingsTab(body);
  else if (state.adminTab === "admins" && isOwner) renderAdminsTab(body);
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
      <label class="hint" style="display:flex;align-items:center;gap:8px;margin:0 0 16px;cursor:pointer;"><input type="checkbox" id="pFeatured"> منتج مميز (تظهر عليه شارة ✦ مميز)</label>

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
    e.target.value = normalizeDigits(e.target.value).replace(/\D/g, "");
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
    if (document.getElementById("pFeatured")?.checked) row.featured = true;
    if (pendingImage) row.image_position = `${pendingPos.x}% ${pendingPos.y}%`;
    if (pendingSizes.size) row.sizes = [...pendingSizes].join(",");
    if (pendingColors.length) row.colors = pendingColors;
    const stockVal = normalizeDigits(document.getElementById("pStock").value.trim());
    if (stockVal !== "" && !isNaN(Number(stockVal))) row.stock = Math.max(0, Math.floor(Number(stockVal)));

    const { error } = await supabaseClient.from('products').insert([row]);

    if (error) {
      console.error("Error inserting product:", error);
      showToast("تعذر إضافة المنتج: " + (error.message || "خطأ غير معروف"), "err");
      btn.disabled = false; btn.textContent = "+ إضافة المنتج";
      return;
    }

    showToast("تمت إضافة المنتج — لينشر للجميع: الإعدادات ← تنزيل ملف النشر");
    logActivity("إضافة منتج", name);
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
        const raw = normalizeDigits(input.value.trim());
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
        logActivity("تحديث مخزون", `${p2 ? p2.name : pid} → ${newStock}`);
        renderAdmin();
      };
    });
    list.querySelectorAll("[data-del]").forEach(b => {
      b.onclick = async () => {
        const confirmDelete = await holdConfirm("حذف هذا المنتج؟");
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

        const deletedProduct = state.products.find(p => String(p.id) === String(pid));
        const { error } = await supabaseClient
          .from('products')
          .delete()
          .eq('id', pid);

        if (error) {
          console.error("Error deleting product:", error);
          showToast("تعذر حذف المنتج: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }

        showUndoToast("تم حذف المنتج", async () => {
          await supabaseClient.from('products').insert([deletedProduct]);
          await loadProducts(); renderAdmin();
        });
        logActivity("حذف منتج", pid);
        await loadProducts();
        renderAdmin();
      };
    });
  }
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
      <tr><td class="label">العنوان</td><td>${esc(o.address || o.location || "")}</td></tr>
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

/* ======================= تبويب سجل النشاط ======================= */
async function renderActivityTab(body){
  body.innerHTML = `<p class="hint center" style="padding:20px 0;">جارِ التحميل...</p>`;
  let logs = [];
  try {
    const { data, error } = await supabaseClient
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data) logs = data;
  } catch (e) { console.error("activity log load error", e); }

  const admins = [...new Set(logs.map(l => l.admin_username))];
  const filter = state.activityFilter || "";
  const filtered = filter ? logs.filter(l => l.admin_username === filter) : logs;

  body.innerHTML = `
    <div class="panel">
      <h3>سجل التدقيق — آخر 200 عملية</h3>
      ${admins.length > 1 ? `
      <select id="activityFilter" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:13px;margin-bottom:12px;">
        <option value="">كل المشرفين</option>
        ${admins.map(a => `<option value="${esc(a)}" ${a===filter?'selected':''}>${esc(a)}</option>`).join("")}
      </select>` : ""}
      ${filtered.length === 0 ? `<p class="hint">لا يوجد نشاط مسجَّل بعد.</p>` : filtered.map(l => `
        <div style="padding:10px 0;border-bottom:1px solid var(--line);font-size:13px;">
          <div><strong>${esc(l.admin_username)}</strong> — ${esc(l.action)}</div>
          ${l.order_ref ? `<div class="hint">${esc(l.order_ref)}</div>` : ""}
          <div class="hint" style="font-size:11px;margin-top:2px;">${new Date(l.created_at).toLocaleString("ar")}</div>
        </div>
      `).join("")}
    </div>
  `;
  const filterEl = document.getElementById("activityFilter");
  if (filterEl) filterEl.onchange = (e) => { state.activityFilter = e.target.value; renderActivityTab(body); };
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

  const headers = ["رقم الطلب", "التاريخ", "الحالة", "اسم العميل", "الهاتف", "العنوان", "المنتج", "الكمية", "الإجمالي (د.ع)", "حساب التواصل"];
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
    o.address || o.location || "",
    o.product_name || "",
    o.qty || 1,
    o.total || 0,
    (() => { const s = parseSocial(o.instagram_username); return s ? `${SOCIAL_PLATFORMS[s.platform].label}: ${s.handle}` : ""; })()
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
            <div>📍 ${esc(o.address || o.location)}</div>
            <div>📞 <a href="https://wa.me/${formatWhatsapp(o.phone_number || o.phone)}" target="_blank" style="color:var(--ink);text-decoration:underline;">${esc(o.phone_number || o.phone)}</a></div>
            ${(() => { const s = parseSocial(o.instagram_username); if (!s) return ""; const p = SOCIAL_PLATFORMS[s.platform]; return `<div>${p.icon} <a href="${esc(socialUrl(s.platform, s.handle))}" target="_blank" style="color:var(--moss);text-decoration:underline;">@${esc(s.handle)}</a></div>`; })()}
            ${o.custom_request ? `<div style="margin-top:6px;background:var(--card);padding:8px;border-radius:8px;">📝 ${esc(o.custom_request)}</div>` : ""}
            ${o.design_image ? `<div style="margin-top:6px;">🎨 <a href="${esc(o.design_image)}" target="_blank" style="color:var(--moss);text-decoration:underline;">عرض التصميم المُرفق من الزبون</a></div>` : ""}
          </div>
          <div class="order-actions">
            <button class="btn-cancel" data-cancel="${o.id}" ${reviewStatus(o)==='cancelled' ? 'disabled' : ''}>✕ إلغاء</button>
            <button class="btn-confirm" data-confirm="${o.id}" ${reviewStatus(o)==='confirmed' ? 'disabled' : ''}>✓ تم التأكيد</button>
            <button class="btn-whatsapp" data-wa="${o.id}">💬 واتساب</button>
            <button class="btn-whatsapp" data-wacustomer="${o.id}">📱 واتساب العميل</button>
            <button class="btn-instagram" data-instagram="${o.id}" ${o.instagram_username ? '' : 'disabled'}>${parseSocial(o.instagram_username) ? SOCIAL_PLATFORMS[parseSocial(o.instagram_username).platform].icon : '📷'} حساب العميل</button>
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
      const { error } = await supabaseClient.rpc('update_order_secure', {
        p_username: state.currentAdmin.username,
        p_password_hash: state.currentAdmin.passwordHash,
        p_order_id: orderId,
        p_fields: { review_status: status }
      });
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
      const msg = `تفاصيل الحجز - QR CODE\nالمنتج: ${o.product_name}\nالعميل: ${o.customer_name}\nالهاتف: ${o.phone_number || o.phone || ""}\nالموقع: ${o.address || o.location || ""}\nالإجمالي: ${money(o.total)} د.ع`;
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

  // فتح صفحة التواصل الاجتماعي للعميل (انستغرام أو تيك توك) كما كتبها بنفسه عند الحجز
  body.querySelectorAll("[data-instagram]").forEach(b => {
    b.onclick = () => {
      const o = state.orders.find(x => String(x.id) === String(b.dataset.instagram));
      const s = o ? parseSocial(o.instagram_username) : null;
      if (!s) return;
      window.open(socialUrl(s.platform, s.handle), "_blank");
    };
  });

  if (isOwner) {
    body.querySelectorAll("[data-delorder]").forEach(b => {
      b.onclick = async () => {
        if (!(await holdConfirm("حذف هذا الطلب نهائيًا؟"))) return;
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

        const { error } = await supabaseClient.rpc('delete_order_secure', {
          p_username: state.currentAdmin.username,
          p_password_hash: state.currentAdmin.passwordHash,
          p_order_id: oid
        });
        if (error) {
          console.error("delete order error", error);
          showToast("تعذر حذف الطلب: " + (error.message || "خطأ غير معروف"), "err");
          return;
        }
        state.orders = state.orders.filter(o => String(o.id) !== String(oid));
        if (orderBeforeDelete) {
          const { product_image, product_image_position, ...orderRow } = orderBeforeDelete;
          showUndoToast("تم حذف الطلب", async () => {
            await supabaseClient.from('orders').insert([orderRow]);
            await loadOrders(); renderOrdersTab(body);
          });
        } else showToast("تم حذف الطلب");
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
    <div class="panel" id="publishPanel"></div>
    <div class="panel" id="couponsPanel"></div>
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
  renderPublishPanel(document.getElementById("publishPanel"));
  renderCouponsPanel(document.getElementById("couponsPanel"));

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
      if (ok) { showToast("تم حفظ محتوى \"من نحن\""); logActivity("تعديل محتوى من نحن"); }
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
      if (ok) { showToast("تم حفظ السياسات بنجاح"); logActivity("تعديل السياسات"); }
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
      if (ok) { showToast("تم حفظ المحتوى بنجاح"); logActivity("تعديل محتوى الصفحة الرئيسية"); }
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
    if (ok) { showToast("تم حفظ الإعدادات"); logActivity("تعديل رقم واتساب المتجر"); }
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
      logActivity("تغيير كلمة مرور المالك");
    } catch (e) {
      console.error("change password error", e);
      msgEl.style.color = "var(--err)";
      msgEl.textContent = "كلمة المرور الحالية غير صحيحة أو تعذر الاتصال";
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
      logActivity("إضافة مشرف", newUsr);
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
        if (!(await holdConfirm(`إزالة صلاحية ${b.dataset.removeusr}؟`))) return;
        try {
          const { error } = await supabaseClient.rpc('remove_staff_admin', {
            p_owner_username: state.currentAdmin.username,
            p_owner_password_hash: state.currentAdmin.passwordHash,
            p_target_username: b.dataset.removeusr
          });
          if (error) throw error;
          showToast("تمت الإزالة");
          logActivity("إزالة مشرف", b.dataset.removeusr);
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

async function loadOrders(){
  try {
    if (!state.currentAdmin) { state.orders = []; return; }
    let { data: dbOrders, error: ordErr } = await supabaseClient.rpc('list_orders_secure', { p_username: state.currentAdmin.username, p_password_hash: state.currentAdmin.passwordHash });
    if (ordErr) ({ data: dbOrders, error: ordErr } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false }));
    else if (Array.isArray(dbOrders)) dbOrders.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));

    if (!ordErr && dbOrders) {
      state.orders = dbOrders;
    } else {
      console.error("orders fetch error:", ordErr);
      showToast("تعذر تحديث الطلبات من الخادم: " + (ordErr?.message || "خطأ غير معروف"), "err");
      state.orders = loadLocal(KEYS.ORDERS, []);
    }
  } catch (e) {
    console.error("Supabase orders load error, falling back to local:", e);
    showToast("تعذر تحديث الطلبات من الخادم: " + (e.message || "خطأ غير معروف"), "err");
    state.orders = loadLocal(KEYS.ORDERS, []);
  }
}

/* ======================= تنبيه فوري بالطلبات الجديدة أثناء وجود المشرف بلوحة الإدارة ======================= */
let orderPollTimer = null;

let orderChannel = null;
function startOrderRealtime(cb){
  try {
    if (orderChannel || !supabaseClient.channel) return;
    orderChannel = supabaseClient.channel('orders-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_events' }, cb).subscribe();
  } catch (e) { console.warn('realtime غير متاح، يعمل الاحتياطي', e); }
}
function stopOrderPolling(){
  if (orderChannel) { try { supabaseClient.removeChannel(orderChannel); } catch (e) {} orderChannel = null; }
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
  const checkNewOrders = async () => {
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
  };
  orderPollTimer = setInterval(checkNewOrders, 120000); // احتياطي فقط
  startOrderRealtime(checkNewOrders);
}

