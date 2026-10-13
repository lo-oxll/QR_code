/* قاعدة بيانات محلية (IndexedDB) بنفس واجهة Supabase المستخدمة في script.js — بدون أي خادم خارجي.
   البيانات تُحفظ في متصفح هذا الجهاز فقط.
   دخول الإدارة الافتراضي أول مرة: admin / Admin@12345 — غيّر الرمز فورًا من لوحة الإدارة. */
(function(){
  const STORE = "kv", KEY = "db";
  let mem = null, loading = null;
  const files = new Map();

  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open("qrcode-local", 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const LS = "qrcode:localdb";
  const idbGet0 = async () => { const d = await openDb(); return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  const idbSet0 = async v => { const d = await openDb(); return new Promise((res, rej) => { const t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).put(v, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); };

  const idbGet = async () => { try { return await idbGet0(); } catch (e) { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } } };
  const idbSet = async v => { try { await idbSet0(v); } catch (e) { localStorage.setItem(LS, JSON.stringify(v)); } };

  async function sha256Hex(text){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const clone = x => JSON.parse(JSON.stringify(x));
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  };
  const now = () => new Date().toISOString();
  const persist = () => idbSet(mem);

  function load(){
    if (mem) return Promise.resolve();
    return loading || (loading = (async () => {
      mem = await idbGet();
      if (!mem) {
        mem = {
          products: [], orders: [], activity_log: [],
          settings: [{ id: 1 }],
          admins: [{ username: "admin", password_hash: await sha256Hex("Admin@12345"), role: "owner", created_at: now() }]
        };
        await persist();
      }
    })());
  }

  class Q {
    constructor(t){ this.t = t; this.op = "select"; this.f = []; this.ord = null; this.lim = null; this.one = false; this.sel = false; }
    select(){ this.sel = true; return this; }
    insert(rows){ this.op = "insert"; this.rows = rows; return this; }
    update(p){ this.op = "update"; this.patch = p; return this; }
    delete(){ this.op = "delete"; return this; }
    eq(c, v){ this.f.push([c, v]); return this; }
    order(c, o){ this.ord = [c, !(o && o.ascending === false)]; return this; }
    limit(n){ this.lim = n; return this; }
    single(){ this.one = true; return this; }
    then(a, b){ return this.run().then(a, b); }
    async run(){
      try {
        await load();
        const tbl = mem[this.t] || (mem[this.t] = []);
        const match = r => this.f.every(([c, v]) => String(r[c]) === String(v));
        if (this.op === "insert") {
          const ins = this.rows.map(r => {
            const row = { id: uuid(), created_at: now(), ...clone(r) };
            if (this.t === "orders" && !row.review_status) row.review_status = "pending";
            return row;
          });
          tbl.push(...ins);
          await persist();
          return { data: this.sel ? clone(this.one ? ins[0] : ins) : null, error: null };
        }
        if (this.op === "update") { tbl.filter(match).forEach(r => Object.assign(r, clone(this.patch))); await persist(); return { data: null, error: null }; }
        if (this.op === "delete") { mem[this.t] = tbl.filter(r => !match(r)); await persist(); return { data: null, error: null }; }
        let rows = tbl.filter(match);
        if (this.ord) { const [c, asc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
        if (this.lim) rows = rows.slice(0, this.lim);
        rows = clone(rows);
        if (this.one) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } };
        return { data: rows, error: null };
      } catch (e) { return { data: null, error: { message: e.message || String(e) } }; }
    }
  }

  const ref = o => String(o.id).slice(-6).toUpperCase();
  const digits = s => String(s || "").replace(/\D/g, "").slice(-9);
  const uq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const findAdmin = (u, h) => mem.admins.find(a => uq(a.username, u) && a.password_hash === h);
  const owner = (u, h) => { const a = findAdmin(u, h); if (!a || a.role !== "owner") throw new Error("غير مصرح"); return a; };
  const staff = (u, h) => { if (!findAdmin(u, h)) throw new Error("غير مصرح"); };

  const rpcs = {
    verify_admin_login: async p => { const a = findAdmin(p.p_username, p.p_password_hash); return a ? [{ username: a.username, role: a.role }] : []; },
    track_order: async p => {
      const r = String(p.p_ref || "").replace("#", "").trim().toUpperCase();
      const o = mem.orders.find(x => ref(x) === r && digits(x.phone_number) === digits(p.p_phone));
      return o ? [clone(o)] : [];
    },
    submit_order_review: async p => {
      const o = mem.orders.find(x => x.id === p.p_order_id && digits(x.phone_number) === digits(p.p_phone));
      if (!o || o.review_status !== "confirmed") throw new Error("تعذر التقييم");
      o.customer_rating = p.p_rating; o.customer_review = p.p_review; await persist(); return null;
    },
    get_public_reviews: async () => mem.orders.filter(o => o.customer_rating).map(o => ({ customer_rating: o.customer_rating, customer_review: o.customer_review, product_name: o.product_name })),
    update_order_secure: async p => { staff(p.p_username, p.p_password_hash); const o = mem.orders.find(x => x.id === p.p_order_id); if (!o) throw new Error("الطلب غير موجود"); Object.assign(o, clone(p.p_fields)); await persist(); return null; },
    delete_order_secure: async p => { owner(p.p_username, p.p_password_hash); mem.orders = mem.orders.filter(x => x.id !== p.p_order_id); await persist(); return null; },
    change_owner_password: async p => { const a = owner(p.p_owner_username, p.p_old_password_hash); a.password_hash = p.p_new_password_hash; await persist(); return null; },
    add_staff_admin: async p => {
      owner(p.p_owner_username, p.p_owner_password_hash);
      if (mem.admins.some(a => uq(a.username, p.p_new_username))) throw new Error("اسم المستخدم موجود");
      mem.admins.push({ username: p.p_new_username, password_hash: p.p_new_password_hash, role: "staff", created_at: now() }); await persist(); return null;
    },
    list_staff_admins: async p => { owner(p.p_owner_username, p.p_owner_password_hash); return mem.admins.filter(a => a.role !== "owner").map(a => ({ username: a.username, created_at: a.created_at })); },
    remove_staff_admin: async p => { owner(p.p_owner_username, p.p_owner_password_hash); mem.admins = mem.admins.filter(a => !(a.role !== "owner" && uq(a.username, p.p_target_username))); await persist(); return null; }
  };

  const client = {
    from: t => new Q(t),
    rpc: async (name, params) => {
      try { await load(); if (!rpcs[name]) throw new Error("rpc غير معروف: " + name); return { data: await rpcs[name](params || {}), error: null }; }
      catch (e) { return { data: null, error: { message: e.message || String(e) } }; }
    },
    storage: { from: () => ({
      upload: async (path, blob) => {
        try { files.set(path, await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); })); return { error: null }; }
        catch (e) { return { error: { message: e.message } }; }
      },
      getPublicUrl: path => ({ data: { publicUrl: files.get(path) } })
    }) }
  };

  window.supabase = { createClient: () => client };
})();
