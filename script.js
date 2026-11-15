  /* ==========================================================
    JAYA MEBEL - script.js (VERSI SUPABASE PENUH)
    Semua data (produk, kategori, pesanan, customer, staff, pengeluaran,
    purchase order, stock opname, alamat, favorit, ulasan) disimpan di
    Supabase. Tidak ada lagi localStorage untuk data toko.
    Jalankan supabase-setup.sql di Supabase SQL Editor lebih dulu.
    ========================================================== */

  /* ---------- AUTH & KERANJANG (Supabase) ---------- */

  window.JM_SUPABASE = {
    user: null,

    // ---------- AUTH ----------

    async register(email, password, fullName, phone = "") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone
          }
        }
      });

      if (error) throw error;

      this.user = data.user;

      return {
        user: data.user,
        session: data.session,
        message: data.session
          ? "Registrasi berhasil."
          : "Registrasi berhasil. Periksa email untuk konfirmasi."
      };
    },

    async login(email, password) {
      const { data, error } =
        await supabaseClient.auth.signInWithPassword({
          email,
          password
        });

      if (error) throw error;

      this.user = data.user;
      return data;
    },

    async logout() {
      const { error } = await supabaseClient.auth.signOut();

      if (error) throw error;

      this.user = null;
      return true;
    },

    async currentUser() {
      const { data, error } =
        await supabaseClient.auth.getUser();

      if (error) throw error;

      this.user = data.user;
      return data.user;
    },

    // ---------- KERANJANG ----------

    async addCart(productId, quantity = 1) {
      const { data, error } = await supabaseClient.rpc(
        "jm_cart_add",
        {
          p_product_id: productId,
          p_quantity: quantity
        }
      );

      if (error) throw error;

      return data;
    },

    async setCartQuantity(productId, quantity) {
      const { data, error } = await supabaseClient.rpc(
        "jm_cart_set_quantity",
        {
          p_product_id: productId,
          p_quantity: quantity
        }
      );

      if (error) throw error;

      return data;
    },

    async removeCart(productId) {
      const { data, error } = await supabaseClient.rpc(
        "jm_cart_remove",
        {
          p_product_id: productId
        }
      );

      if (error) throw error;

      return data;
    },

    async getCart() {
      const user = await this.currentUser();

      if (!user) {
        throw new Error("Silakan login terlebih dahulu.");
      }

      const { data: carts, error: cartError } =
        await supabaseClient
          .from("carts")
          .select("id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

      if (cartError) throw cartError;

      if (!carts || carts.length === 0) return [];

      const { data: items, error: itemError } =
        await supabaseClient
          .from("cart_items")
          .select("id, product_id, quantity")
          .eq("cart_id", carts[0].id);

      if (itemError) throw itemError;

      if (!items || items.length === 0) return [];

      const ids = items.map(item => item.product_id);

      const { data: products, error: productError } =
        await supabaseClient
          .from("products")
          .select("id, name, price, stock, image_url, active")
          .in("id", ids);

      if (productError) throw productError;

      return items.map(item => ({
        ...item,
        product: products.find(
          product => product.id === item.product_id
        ) || null
      }));
    },
  };


  /* ---------- DATA (disimpan di memori; sumbernya Supabase) ---------- */
  const FLOW = ["Menunggu Konfirmasi", "Pesanan Dikonfirmasi", "Pesanan Sedang Diproses", "Pesanan Dikirim", "Pesanan Selesai"];
  const BATAL = "Pesanan Dibatalkan";
  const PAYS = ["Menunggu Verifikasi", "Terverifikasi", "Ditolak", "Lunas COD", "Bayar di Tempat"];

  let db = {
    products: [], categories: [], categoryRows: [], reviews: [],
    carts: {}, wishlist: [], addresses: [],
    orders: [], customers: [], staff: [],
    expenses: [], suppliers: [], pos: [],
    opnames: [], moves: [], log: []
  };
  let currentProfile = null;
  let booting = true;

  /* ---------- AKSES DATABASE ---------- */
  const rpc = async (name, args = {}) => {
    const { data, error } = await supabaseClient.rpc(name, args);
    if (error) throw error;
    return data;
  };

  // Query Supabase.
  // Jika query gagal, error diteruskan agar tidak dianggap sebagai data kosong.
  async function q(builder, fallback = []) {
    const { data, error } = await builder;

    if (error) {
      console.error("[SUPABASE QUERY ERROR]", error);

      throw error;
    }

    return data ?? fallback;
  }

  /* ---------- NORMALISASI STATUS (data lama berbahasa Inggris tetap terbaca) ---------- */
  function normStatus(s) {
    const t = String(s || "").trim();
    const hit = [...FLOW, BATAL].find(x => x.toLowerCase() === t.toLowerCase());
    if (hit) return hit;
    const l = t.toLowerCase();
    if (/cancel|batal/.test(l)) return BATAL;
    if (/pending|menunggu|waiting/.test(l)) return FLOW[0];
    if (/complete|done|deliver|selesai/.test(l)) return FLOW[4];
    if (/ship|kirim/.test(l)) return FLOW[3];
    if (/process|proses/.test(l)) return FLOW[2];
    if (/confirm|konfirm/.test(l)) return FLOW[1];
    return FLOW[0];
  }
  function normPay(s, method) {
    const t = String(s || "").trim(), cod = String(method).toUpperCase() === "COD";
    const hit = PAYS.find(x => x.toLowerCase() === t.toLowerCase());
    if (hit) return hit;
    const l = t.toLowerCase();
    if (/reject|tolak|fail|denied/.test(l)) return "Ditolak";
    if (/paid|verif|settle|success|lunas/.test(l)) return cod ? "Lunas COD" : "Terverifikasi";
    return cod ? "Bayar di Tempat" : "Menunggu Verifikasi";
  }

  /* ---------- PEMETAAN BARIS DATABASE KE BENTUK YANG DIPAKAI TAMPILAN ---------- */
  function mapOrder(order) {
    const payment = order.payments?.[0] || {};
    const method = order.payment_method || "COD";
    const pay = normPay(order.payment_status, method);
    const paid = ["Terverifikasi", "Lunas COD"].includes(pay);
    return {
      id: order.order_number,
      dbId: order.id,
      userId: order.user_id,
      name: order.recipient_name,
      phone: order.phone,
      address: order.address,
      note: order.note || "",
      total: Number(order.total || 0),
      method,
      pay,
      status: normStatus(order.order_status),
      courier: order.courier || "",
      vehicle: order.vehicle || "",
      resi: order.tracking_number || "",
      shipDate: order.shipped_at || "",
      cancelReason: order.cancelled_reason || "",
      created: order.created_at,
      paidAt: order.paid_at || (paid ? order.created_at : ""),
      verifiedBy: order.verified_by || "",
      verifiedAt: order.verified_at || "",
      rejectReason: order.reject_reason || "",
      proof: order.proof_path || payment.proof_url || "",
      refund: order.refund_status || "",
      refundInfo: order.refund_info || "",
      items: (order.order_items || []).map(i => ({
        pid: String(i.product_id), name: i.product_name,
        price: Number(i.price || 0), cost: Number(i.cost || 0), qty: Number(i.quantity || 0)
      })),
      track: (order.order_status_history || [])
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(h => ({ s: h.note || h.status, at: h.created_at }))
    };
  }
  const mapProfile = p => ({
    id: p.id,
    name: p.full_name || "-",
    username: p.username || p.email || "",
    email: p.email || "",
    phone: p.phone || "",
    active: p.active !== false,
    created: p.created_at || "",
    company: "",
    npwp: "",
    title: p.title || "",
    perms: p.perms || []
  });
  const userById = id => (me() && me().id === id) ? me() : (db.customers.find(c => c.id === id) || {});

  /* ---------- PEMUAT DATA ---------- */
  async function loadCatalog() {
    const c = await JM_CATALOG.fetch();
    db.products = c.products;
    db.categoryRows = c.categories;
    db.categories = c.categories.map(x => x.name);
  }
  window.refreshJayaMebelCatalog = () => loadCatalog().then(() => safeRender());

  async function loadReviews() {
    const rows = await q(supabaseClient.from("reviews").select("*").order("created_at", { ascending: false }));
    db.reviews = rows.map(r => ({
      id: r.id, orderId: String(r.order_id), productId: String(r.product_id), userId: r.user_id,
      userName: r.user_name || "Pembeli", rating: Number(r.rating), text: r.comment || "", at: r.created_at
    }));
  }

  async function loadOrders() {
    const u = me();
    if (!u) { db.orders = []; return []; }
    let query = supabaseClient.from("orders")
      .select("*, order_items(*), order_status_history(*), payments(*)")
      .order("created_at", { ascending: false });
    if (u.role === "customer") query = query.eq("user_id", u.id);
    const { data, error } = await query;
    if (error) throw error;
    db.orders = (data || []).map(mapOrder);
    return db.orders;
  }



  async function loadMyExtras() {
    const u = me();

    const [ad, wl] = await Promise.all([
      q(supabaseClient
        .from("addresses")
        .select("*")
        .eq("user_id", u.id)
        .order("created_at")),

      q(supabaseClient
        .from("wishlists")
        .select("product_id")
        .eq("user_id", u.id))
    ]);

    db.addresses = ad.map(a => ({
      id: a.id,
      label: a.note || "Alamat",
      receiver: a.recipient_name || "",
      phone: a.phone || "",
      text: a.address || "",
      main: !!a.is_default
    })).sort((a, b) => Number(b.main) - Number(a.main));

    db.wishlist = wl.map(w => String(w.product_id));
  }



  async function loadCustomerData() {
    await Promise.all([loadOrders(), syncCartFromSupabase(), loadMyExtras()]);
  }


  async function loadAdminData() {
    const u = me();
    const admin = u.role === "admin";
    const can = t => canOpen(u, t);
    const sb = supabaseClient;

    const [
      ,
      customers,
      staff,
      expenses,
      pos,
      poItems,
      receipts,
      suppliers,
      opnames,
      moves,
      logs
    ] = await Promise.all([
      loadOrders().catch(e => console.warn("[ORDERS]", e.message)),

admin || can("customers")
  ? (async () => {
      const { data, error } = await sb
        .from("profiles")
        .select("id, full_name, username, phone, role, active, created_at")
        .eq("role", "customer")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[LOAD CUSTOMERS]", error);
        throw error;
      }

      return data || [];
    })()
  : [],


(async () => {
  // Ambil seluruh akun dengan role staff.
  const { data: staffRows, error: staffError } = await sb
    .from("profiles")
    .select("id, full_name, username, phone, role, active, created_at")
    .eq("role", "staff")
    .order("created_at", { ascending: false });

  if (staffError) throw staffError;

  const staffIds = (staffRows || []).map(s => s.id);

  // Ambil hak akses menu masing-masing staff.
  let permissionRows = [];

  if (staffIds.length > 0) {
    const { data, error } = await sb
      .from("staff_permissions")
      .select("staff_id, menu_key")
      .in("staff_id", staffIds);

    if (error) throw error;
    permissionRows = data || [];
  }

  // Gabungkan profil dan hak akses.
  return (staffRows || []).map(s => ({
    ...mapProfile(s),
    email: s.username || "",
    perms: permissionRows
      .filter(p => p.staff_id === s.id)
      .map(p => p.menu_key)
  }));
})(),


      can("expenses") || can("reports")
        ? q(sb.from("expenses").select("*")
            .order("expense_date", { ascending: false })
            .order("created_at", { ascending: false }))
        : [],

      can("po") || can("reports")
        ? q(sb.from("purchase_orders").select("*")
            .order("created_at", { ascending: false }))
        : [],

      can("po") || can("reports")
        ? q(sb.from("purchase_order_items").select("*"))
        : [],

can("po") || can("reports")
  ? q(sb.from("purchase_receipts").select("*")
      .order("receipt_date", { ascending: false }))
  : [],

      can("po")
        ? q(sb.from("suppliers").select("*")
            .eq("active", true)
            .order("name"))
        : [],

      can("opname")
        ? q(sb.from("stock_opnames").select("*")
            .order("created_at", { ascending: false })
            .limit(100))
        : [],

      q(sb.from("stock_movements").select("*")
        .order("created_at", { ascending: false })
        .limit(100)),

      can("reports")
        ? q(sb.from("activity_logs").select("*")
            .order("created_at", { ascending: false })
            .limit(50))
        : [],

      loadCatalog().catch(e => console.warn("[CATALOG]", e.message))
    ]);

db.customers = (customers || []).map(mapProfile);
db.staff = staff || [];

    db.expenses = expenses.map(x => ({
      id: x.id,
      date: x.expense_date,
      type: x.category,
      amount: Number(x.amount || 0),
      note: x.note || "",
      by: x.created_by || ""
    }));

    db.suppliers = suppliers;

    // Gabungkan detail barang dan penerimaan ke masing-masing header PO.
    db.pos = pos.map(po => {
      const items = poItems
        .filter(item => item.purchase_order_id === po.id)
        .map(item => {
          const product = db.products.find(
            p => String(p.id) === String(item.product_id)
          );

const itemReceipts = [];

          return {
            id: item.id,
            productId: String(item.product_id),
            productName: product?.name || "Produk tidak ditemukan",
            qty: Number(item.quantity),
            received: Number(item.received_quantity),
            cost: Number(item.unit_cost),
            receipts: itemReceipts
          };
        });

      const supplier = db.suppliers.find(
        s => String(s.id) === String(po.supplier_id)
      );

      return {
        id: po.id,
        number: po.po_number,
        supplierId: po.supplier_id,
        supplier: supplier?.name || "Supplier tidak ditemukan",
        items,
        date: po.order_date,
        eta: po.estimated_date,
        note: po.note || "",
        status: po.status,
        created: po.created_at
      };
    });

    db.opnames = opnames.map(x => {
      const product = db.products.find(
        p => String(p.id) === String(x.product_id)
      );

      return {
        id: x.id,
        productId: String(x.product_id),
        name: product?.name || "Produk tidak ditemukan",
        before: Number(x.system_stock),
        physical: Number(x.physical_stock),
        diff: Number(x.difference || 0),
        note: x.note || "",
        by: x.created_by || "-",
        at: x.created_at
      };
    });

    db.moves = moves.map(x => {
      const product = db.products.find(
        p => String(p.id) === String(x.product_id)
      );

      return {
        id: x.id,
        productId: String(x.product_id),
        name: product?.name || "Produk tidak ditemukan",
        type: x.movement_type,
        qty: Number(x.quantity || 0),
        note: x.note || "",
        at: x.created_at
      };
    }).reverse();

    db.log = logs.map(x => ({
      text: x.activity || "-",
      by: x.user_id || "-",
      detail: x.detail || {},
      at: x.created_at
    }));
  }


  function resetCaches() {
    Object.assign(db, {
      carts: {},
      wishlist: [],
      addresses: [],
      orders: [],
      customers: [],
      staff: [],
      expenses: [],
      suppliers: [],
      pos: [],
      opnames: [],
      moves: [],
      log: []
    });

    if (typeof unchecked !== "undefined") {
      unchecked.clear();
    }
  }


  /* ---------- HELPER ---------- */

  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(+n || 0);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = () => new Date().toISOString();
  const fmt = d => new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const me = () => currentProfile;
  const stars = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  const statusTag = s => s === FLOW[4] ? "ok" : s === BATAL ? "bad" : "warn";
  const isPaid = o => ["Terverifikasi", "Lunas COD"].includes(o.pay) && o.status !== BATAL; // hanya yang benar-benar sudah dibayar

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800);
  }
  function openModal(html) { $("modal").innerHTML = `<div class="box">${html}</div>`; $("modal").hidden = false; }
  function closeModal() { $("modal").hidden = true; }

  /* Jendela kecil untuk meminta isian (alasan, kurir, jumlah, dll) */
  function ask(title, fields, onOk) {
    openModal(`<h3>${title}</h3><form id="askForm">${fields.map(f => `<label>${f.label}${f.area
      ? `<textarea name="${f.k}" rows="3" ${f.req ? "required" : ""}></textarea>`
      : `<input name="${f.k}" type="${f.type || "text"}" ${f.req ? "required" : ""} min="${f.min ?? ""}" max="${f.max ?? ""}">`}</label>`).join("")}
      <div class="row"><button class="btn">Lanjutkan</button><button type="button" class="btn ghost" onclick="closeModal()">Batal</button></div></form>`);
    $("askForm").onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); closeModal(); onOk(v); };
  }

  const stockInfo = p => p.stock <= 0 ? ["Stok habis", "bad"] : p.stock <= p.min ? ["Stok menipis", "warn"] : ["Tersedia", "ok"];
  const thumb = p => p.image
    ? `<img
        src="${esc(p.image)}"
        alt="${esc(p.name)}"
        onerror="this.onerror=null;this.outerHTML='<div class=&quot;ph&quot;><span>Foto tidak tersedia</span></div>'"
      >`
    : `<div class="ph">
        <span>${esc(p.name?.[0] || "J")}</span>
      </div>`;

  function ratingOf(pid) {
    const list = db.reviews.filter(r => r.productId === pid);

    return {
      list,
      n: list.length,
      avg: list.length
        ? sum(list, r => r.rating) / list.length
        : 0
    };
  }
  /* Membuat tabel dari header + baris (<tr>) */
  const table = (head, rows) => `<div class="tbl"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">Belum ada data.</td></tr>`}</tbody></table></div>`;


  /* Catatan aktivitas disimpan ke tabel activity_log (tanpa menunggu hasilnya). */
  const log = (activity, detail = {}) => {
    const u = me();

    supabaseClient.from("activity_logs").insert({
      activity,
      user_id: u?.id || null,
      detail
    }).then(({ error }) => {
      if (error) console.warn("[LOG]", error.message);
    });
  };

  /* ---------- 3. NAVIGASI ---------- */
  const pages = {};            // pages.nama = fungsi yang mengembalikan HTML halaman customer
  const PROTECTED = ["cart", "checkout", "account", "order"];   // wajib login
  let view = { page: "home", id: null };
  let filter = { q: "", cat: "", sort: "" };
  let authMode = "login", accTab = "overview", ordFilter = "", adminTab = "dashboard", aFilter = "";

  function go(page, id) {
    view = { page, id };
    render();
    scrollTo(0, 0);
    if (me()?.role === "customer" && ["account", "order"].includes(page)) refreshData(true);
  }

  function render() {
    const app = $("app");
    if (booting) { app.innerHTML = `<div class="wrap"><div class="empty">Memuat data...</div></div>`; return; }
    const u = me();
    if (u?.role === "admin" || u?.role === "staff") { app.innerHTML = adminShell(u); return; }
    let page = view.page;
    if (!pages[page] || (PROTECTED.includes(page) && !u)) page = PROTECTED.includes(view.page) ? "auth" : "home";
    app.innerHTML = header(u) + `<main>${pages[page](u)}</main>` + footer();
  }

  /* Jangan menggambar ulang ketika pengguna sedang mengisi form, agar isian tidak hilang. */
  const READONLY_TABS = ["dashboard", "orders", "payments", "stock", "customers", "reports"];
  function busy() {
    const a = document.activeElement;
    return !$("modal").hidden || (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName));
  }
  function safeRender() {
    if (booting || busy()) return;
    const u = me();
    if (u && (u.role === "admin" || u.role === "staff")) { if (!READONLY_TABS.includes(adminTab)) return; }
    else if (view.page === "checkout" || (view.page === "account" && ["address", "profile", "security"].includes(accTab))) return;
    render();
  }

  /* Muat ulang data dari Supabase. force = true: gambar ulang segera setelah data masuk (jika tidak sedang mengetik). */
  async function refreshData(force = false) {
    const u = me();
    if (!u) return;
    try {
      if (u.role === "customer") await Promise.all([loadOrders(), loadCatalog(), loadReviews()]);
      else await loadAdminData();
    } catch (e) { console.error("[REFRESH]", e); }
    if (force) { if (!busy() && !booting) render(); } else safeRender();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !booting) refreshData(false); });


  async function syncCartFromSupabase() {
    const user = await JM_SUPABASE.currentUser();

    if (!user) {
      throw new Error("Silakan login terlebih dahulu.");
    }

    const items = await JM_SUPABASE.getCart();

    db.carts[user.id] = {};

    items.forEach(item => {
      if (item.product) {
        db.carts[user.id][item.product_id] = Number(item.quantity);
      }
    });

    return db.carts[user.id];
  }


  const cart = () => { const u = me(); return u ? (db.carts[u.id] ??= {}) : {}; };
  const cartItems = () => Object.entries(cart()).map(([id, q]) => ({ p: db.products.find(x => x.id === id), q })).filter(i => i.p && i.p.active !== false);
  // Produk yang TIDAK dicentang di keranjang (default: semua dicentang)
  const unchecked = new Set();
  const selectedItems = () => cartItems().filter(i => !unchecked.has(i.p.id));
  const cartTotal = () => sum(selectedItems(), i => i.p.price * i.q);

  /* Profil perusahaan: dipakai di kop surat invoice, surat jalan, dan laporan. GANTI dengan data asli toko. */
  const COMPANY = {
    name: "Jaya Mebel", tagline: "Furniture & Interior",
    address: "Jl. Maleran, Medan, Sumatera Utara 20111",
    phone: "0878-8229-8286", email: "halo@jayamebel.id", web: "jayamebel.id",
    npwp: "",
    bankName: "",
    bankNo: "",
    bankOwner: "",
    get bank() { return `${this.bankName} ${this.bankNo} a.n. ${this.bankOwner}`; },
    signer: "Admin Jaya Mebel", owner: "Pemilik Jaya Mebel"
  };
  const DOC_CSS = `
  .d-page{font:13px/1.5 Arial,Helvetica,sans-serif;color:#1c2420;max-width:780px;margin:0 auto}
  .d-kop{display:flex;gap:16px;align-items:center;border-bottom:3px double #1f5c4d;padding-bottom:12px;margin-bottom:16px}
  .d-logo{width:56px;height:56px;border-radius:8px;background:#1f5c4d;color:#fff;display:grid;place-items:center;font:700 24px Georgia,serif}
  .d-co{flex:1}.d-co b{font-size:20px;color:#1f5c4d;display:block}.d-co small{display:block;color:#555;font-size:11.5px;line-height:1.4}
  .d-title{text-align:right}.d-title h1{font-size:22px;letter-spacing:2px;margin:0;color:#1f5c4d}.d-title small{display:block;color:#555}
  .d-stamp{display:inline-block;border:2px solid;border-radius:4px;padding:2px 10px;font-weight:700;margin-top:6px;transform:rotate(-4deg)}
  .d-stamp.ok{color:#17583f}.d-stamp.warn{color:#9a6a12}.d-stamp.bad{color:#b5402f}
  .d-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  .d-box{border:1px solid #cfd3d0;border-radius:6px;padding:10px 12px;break-inside:avoid}
  .d-box h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#1f5c4d}
  .d-box table{width:100%;border:0;border-collapse:collapse}.d-box td{border:0;padding:1px 0;vertical-align:top}.d-box td:first-child{width:38%;color:#666}
  table.d-items{width:100%;border-collapse:collapse;margin:8px 0}
  .d-items th{background:#1f5c4d;color:#fff;text-align:left;padding:7px 8px;font-size:12px}
  .d-items td{padding:7px 8px;border-bottom:1px solid #ddd;vertical-align:top}.d-items small{color:#666;display:block}
  .d-r{text-align:right!important}.d-c{text-align:center!important}
  table.d-total{margin-left:auto;width:55%;border-collapse:collapse}.d-total td{padding:4px 8px;border:0}.d-total tr:last-child td{font-weight:700;font-size:15px;border-top:2px solid #1f5c4d}
  .d-say{background:#f3f2ee;border-radius:6px;padding:8px 12px;margin:10px 0;font-style:italic}
  .d-note{font-size:11.5px;color:#444;margin:10px 0}.d-note ol{margin:4px 0 0 18px;padding:0}
  .d-sign{display:grid;gap:14px;margin-top:22px;text-align:center;break-inside:avoid}
  .d-sign>div{min-height:130px;display:flex;flex-direction:column}.d-line{margin-top:auto;border-top:1px solid #333;padding-top:3px}
  .d-esig{border:1px dashed #1f5c4d;border-radius:6px;padding:8px;background:#f7faf8;display:flex;flex-direction:column}
  .d-esig small{color:#555;font-size:11px}
  .d-script{font:italic 24px "Brush Script MT","Segoe Script",cursive;color:#154036;margin:4px 0}
  .d-code{font:11px monospace;color:#1f5c4d;word-break:break-all;margin-top:4px}
  .d-foot{margin-top:16px;border-top:1px solid #ccc;padding-top:6px;font-size:10.5px;color:#666;text-align:center}`;
  const custId = u => "CUST-" + String(u.id).slice(-6).toUpperCase();
  const drow = (a, b) => `<tr><td>${a}</td><td>${esc(b) || "-"}</td></tr>`;
  // Kode verifikasi dokumen (hash 16 karakter dari isi dokumen)
  function sig(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).toUpperCase().match(/.{4}/g).join("-");
  }
  const SAT = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  function terbilang(n) {
    n = Math.floor(n);
    if (n === 0) return "nol";
    if (n < 12) return SAT[n];
    if (n < 20) return terbilang(n - 10) + " belas";
    if (n < 100) return terbilang(Math.floor(n / 10)) + " puluh" + (n % 10 ? " " + terbilang(n % 10) : "");
    if (n < 200) return "seratus" + (n % 100 ? " " + terbilang(n % 100) : "");
    if (n < 1000) return terbilang(Math.floor(n / 100)) + " ratus" + (n % 100 ? " " + terbilang(n % 100) : "");
    if (n < 2000) return "seribu" + (n % 1000 ? " " + terbilang(n % 1000) : "");
    if (n < 1e6) return terbilang(Math.floor(n / 1000)) + " ribu" + (n % 1000 ? " " + terbilang(n % 1000) : "");
    if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + " juta" + (n % 1e6 ? " " + terbilang(n % 1e6) : "");
    return terbilang(Math.floor(n / 1e9)) + " miliar" + (n % 1e9 ? " " + terbilang(n % 1e9) : "");
  }
  const kop = (title, sub, stamp = "") => `<div class="d-kop"><div class="d-logo">JM</div><div class="d-co"><b>${esc(COMPANY.name)}</b><small>${esc(COMPANY.tagline)}</small><small>${esc(COMPANY.address)}</small><small>Telp/WA ${esc(COMPANY.phone)} · ${esc(COMPANY.email)} · ${esc(COMPANY.web)}</small><small>NPWP ${esc(COMPANY.npwp)}</small></div><div class="d-title"><h1>${title}</h1><small>${sub}</small>${stamp}</div></div>`;
  const esig = (name, role, at, code) => `<div class="d-esig"><small>Ditandatangani secara elektronik</small><div class="d-script">${esc(name)}</div><b>${esc(name)}</b><small>${esc(role)}</small><small>${fmt(at)}</small><div class="d-code">Kode verifikasi<br>${code}</div></div>`;

  const header = u => {
    const on = p => view.page === p ? "on" : "", n = sum(Object.values(cart()), x => x);
    return `<div class="util"><span>Jaya Mebel buka Senin sampai Sabtu, 08.00 sampai 17.00</span><span>WhatsApp ${esc(COMPANY.phone)} · ${esc(COMPANY.email)}</span></div>
    <header class="top">
      <a class="logo" onclick="go('home')"><b>JM</b><span>${esc(COMPANY.name)}<small>${esc(COMPANY.tagline)}</small></span></a>
      <nav><a class="${on("home")}" onclick="go('home')">Beranda</a><a class="${on("catalog")}" onclick="go('catalog')">Katalog</a><a class="${on("help")}" onclick="go('help')">Bantuan</a></nav>
      <div class="acts"><a class="cartlink hbtn" onclick="go('cart')">Keranjang<i id="cartCount">${n}</i></a>
      ${u ? `<a class="hbtn user" onclick="accTab='overview';go('account')"><span class="avatar sm">${esc(u.name[0] || "?")}</span>${esc(u.name.split(" ")[0])}</a>`
        : `<button class="btn ghost sm" onclick="authMode='login';go('auth')">Masuk</button><button class="btn sm" onclick="authMode='register';go('auth')">Daftar</button>`}</div></header>`;
  };

  const footer = () => `<footer class="foot"><div><b>${esc(COMPANY.name)}</b><br><small>${esc(COMPANY.address)}</small><br><small>Furniture kayu untuk rumah dan usaha.</small></div>
    <div><b>Menu</b><br><small><a onclick="go('catalog')">Katalog</a> · <a onclick="go('help')">Bantuan</a> · <a onclick="accTab='overview';go('account')">Akun saya</a></small></div>
    <div><b>Kontak</b><br><small>WhatsApp ${esc(COMPANY.phone)}<br>${esc(COMPANY.email)}</small></div>
    <div><small>© ${new Date().getFullYear()} ${esc(COMPANY.name)}</small></div></footer>`;

  /* ---------- 4. HALAMAN CUSTOMER ---------- */
  function card(p) {
    const [t, c] = stockInfo(p), r = ratingOf(p.id);
    return `<article class="card"><div class="imgwrap"><a class="img" onclick="go('product','${p.id}')">${thumb(p)}</a>${heartButton(p.id)}</div><div class="body">
      <small>${esc(p.category)}</small><h3 onclick="go('product','${p.id}')">${esc(p.name)}</h3>
      ${r.n ? `<span class="stars">${stars(r.avg)} <small>(${r.n})</small></span>` : ""}
      <div class="row between"><b class="price">${money(p.price)}</b><span class="tag ${c}">${t}</span></div>
      <button class="btn sm" onclick="addToCart('${p.id}')" ${p.stock <= 0 ? "disabled" : ""}>Tambah ke keranjang</button></div></article>`;
  }

  pages.home = () => {
    const act = db.products.filter(p => p.active !== false), cats = [...new Set(act.map(p => p.category))];
    return `<section class="wrap hero"><div><h1>Furniture kayu yang awet untuk setiap sudut rumah Anda</h1>
      <p>Kursi, meja, lemari, dan rak dari workshop Jaya Mebel. Pesan online, bayar lewat COD, QRIS, atau transfer, lalu pantau pesanan sampai tiba.</p>
      <div class="row"><button class="btn" onclick="go('catalog')">Lihat katalog</button><button class="btn ghost" onclick="go('help')">Cara pemesanan</button></div></div>
      <div class="mosaic">${act.slice(0, 4).map(p => `<a onclick="go('product','${p.id}')">${thumb(p)}<span>${esc(p.name)}<b>${money(p.price)}</b></span></a>`).join("")}</div></section>
    <section class="wrap perks"><div><b>Kayu pilihan</b><br><small>Bahan diseleksi sebelum dikerjakan.</small></div><div><b>Stok jelas</b><br><small>Ketersediaan terlihat di setiap produk.</small></div>
      <div><b>Pesanan bisa dilacak</b><br><small>Status dan nomor resi tampil di akun Anda.</small></div><div><b>Tiga cara bayar</b><br><small>COD, QRIS, atau transfer bank.</small></div></section>
    <section class="wrap"><h2>Cara berbelanja</h2><div class="steps">
      <div><b>1. Pilih produk</b><small>Lihat katalog, simpan favorit, lalu masukkan ke keranjang.</small></div>
      <div><b>2. Isi pengiriman &amp; bayar</b><small>Centang produk yang ingin dibeli, isi alamat, pilih COD, QRIS, atau transfer.</small></div>
      <div><b>3. Pantau pesanan</b><small>Status dan nomor resi tampil di menu Akun saya. Beri ulasan setelah barang tiba.</small></div></div></section>
    <section class="wrap"><h2>Kategori</h2><div class="cats">${cats.map(c => `<a class="cat" data-c="${esc(c)}" onclick="goCat(this.dataset.c)"><b>${esc(c)}</b><small>${act.filter(p => p.category === c).length} produk</small></a>`).join("")}</div></section>
    <section class="wrap"><h2>Produk terbaru</h2><div class="grid">${[...act].reverse().slice(0, 4).map(card).join("")}</div></section>
    <section class="wrap band"><div><h2>Ingin melihat langsung?</h2><p>Jaya Mebel buka Senin sampai Sabtu, 08.00 sampai 17.00.</p></div><button class="btn" onclick="go('help')">Lihat alamat &amp; kontak</button></section>`;
  };
  function goCat(c) { filter.cat = c; go("catalog"); }

  function listHTML() {
    let l = db.products.filter(p => p.active !== false && (p.name + " " + p.desc).toLowerCase().includes(filter.q.toLowerCase()) && (!filter.cat || p.category === filter.cat));
    if (filter.sort === "low") l.sort((a, b) => a.price - b.price);
    if (filter.sort === "high") l.sort((a, b) => b.price - a.price);
    return l.length ? l.map(card).join("") : `<div class="empty">Produk tidak ditemukan. Coba kata kunci atau kategori lain.</div>`;
  }
  function setFilter(k, v) { filter[k] = v; $("list").innerHTML = listHTML(); }   // hanya daftar yang diperbarui, kolom cari tidak hilang fokus

  pages.catalog = () => {
    const cats = [...new Set(db.products.filter(p => p.active !== false).map(p => p.category))];
    return `<section class="wrap"><h2>Katalog furniture</h2><div class="tools">
      <input placeholder="Cari nama produk" value="${esc(filter.q)}" oninput="setFilter('q',this.value)">
      <select onchange="setFilter('cat',this.value)"><option value="">Semua kategori</option>${cats.map(c => `<option ${c === filter.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select onchange="setFilter('sort',this.value)"><option value="">Urutkan</option><option value="low" ${filter.sort === "low" ? "selected" : ""}>Harga termurah</option><option value="high" ${filter.sort === "high" ? "selected" : ""}>Harga termahal</option></select>
      </div><div class="grid" id="list">${listHTML()}</div></section>`;
  };

  pages.product = () => {
    const p = db.products.find(x => x.id === view.id);
    if (!p || p.active === false) return `<section class="wrap"><div class="empty">Produk tidak tersedia.</div></section>`;
    const [t, c] = stockInfo(p), r = ratingOf(p.id), rel = db.products.filter(x => x.category === p.category && x.id !== p.id && x.active !== false).slice(0, 4);
    return `<section class="wrap detail"><div class="big">${thumb(p)}</div><div>
      <small>${esc(p.category)}</small><h1>${esc(p.name)}</h1>
      ${r.n ? `<span class="stars">${stars(r.avg)} <small>${r.avg.toFixed(1)} dari ${r.n} ulasan</small></span>` : `<small>Belum ada ulasan</small>`}
      <p class="price lg">${money(p.price)}</p><span class="tag ${c}">${t}${p.stock > 0 ? ", sisa " + p.stock : ""}</span>
      <p style="margin-top:14px">${esc(p.desc)}</p>
      <table class="spec"><tr><th>Bahan</th><td>${esc(p.material || "-")}</td></tr><tr><th>Ukuran</th><td>${esc(p.size || "-")}</td></tr><tr><th>Warna</th><td>${esc(p.color || "-")}</td></tr></table>
      <div class="row">${heartButton(p.id)}<input id="qty" class="qty" type="number" min="1" max="${p.stock}" value="1"><button class="btn" onclick="addToCart('${p.id}',+$('qty').value)" ${p.stock <= 0 ? "disabled" : ""}>Tambah ke keranjang</button></div></div></section>
    <section class="wrap"><h2>Ulasan pembeli</h2>${r.n ? r.list.map(v => `<div class="rv"><span class="stars">${stars(v.rating)}</span> <b>${esc(v.userName)}</b> <small>${fmt(v.at)}</small><p>${esc(v.text) || "<small>Tanpa komentar</small>"}</p></div>`).join("") : `<div class="empty">Ulasan muncul setelah pembeli menerima pesanannya.</div>`}</section>
    ${rel.length ? `<section class="wrap"><h2>Produk terkait</h2><div class="grid">${rel.map(card).join("")}</div></section>` : ""}`;
  };

  /* --- Keranjang --- */

  async function addToCart(id, qty = 1) {
    const u = me();

    if (!u || u.role !== "customer") {
      toast("Masuk sebagai customer dulu untuk berbelanja.");
      authMode = "login";
      return go("auth");
    }

    qty = Math.max(1, Math.floor(qty) || 1);

    const p = db.products.find(x => x.id === id);

    if (!p || p.stock <= 0) {
      return toast("Stok produk habis.");
    }

    try {
      await JM_SUPABASE.addCart(id, qty);
      await syncCartFromSupabase();

      render();
      toast("Produk berhasil ditambahkan ke keranjang Supabase.");
    } catch (error) {
      console.error("[ADD CART]", error);
      toast(error.message || "Gagal menambahkan produk.");
    }
  }


  async function setQty(id, q) {
    const p = db.products.find(x => x.id === id);

    if (q > 0 && (!p || q > p.stock)) {
      return toast("Jumlah melebihi stok tersedia.");
    }

    try {
      if (q <= 0) {
        await JM_SUPABASE.removeCart(id);
      } else {
        await JM_SUPABASE.setCartQuantity(id, q);
      }

      await syncCartFromSupabase();

      render();
      toast(q <= 0
        ? "Produk dihapus dari keranjang."
        : "Jumlah keranjang diperbarui."
      );
    } catch (error) {
      console.error("[UPDATE CART]", error);
      toast(error.message || "Gagal memperbarui keranjang.");
    }
  }

  function goCheckout() {
    if (!selectedItems().length) return toast("Centang minimal satu produk.");
    const bad = selectedItems().find(i => i.q > i.p.stock);
    if (bad) return toast(`Stok ${bad.p.name} tinggal ${bad.p.stock}. Ubah jumlahnya dulu.`);
    go("checkout");
  }

  /* --- Checkout --- */
  pages.checkout = u => {
    const it = selectedItems();
    if (!it.length) return pages.cart(u);

    return `<section class="wrap two">
      <form class="panel" onsubmit="createOrder(event)">
        <h2>Pengiriman</h2>

        <label>Nama penerima
          <input id="rName" required value="${esc(u.name)}">
        </label>

        <label>Nomor telepon
          <input id="rPhone" required value="${esc(u.phone)}">
        </label>

        ${addressPicker(u)}

        <label>Alamat lengkap
          <textarea id="rAddr" rows="3" required>${esc(defaultAddress())}</textarea>
        </label>

        <label>Catatan (opsional)
          <textarea id="rNote" rows="2"></textarea>
        </label>

        <h3>Metode pembayaran</h3>

        <select id="rPay" onchange="payHint()">
          <option value="COD">COD</option>
          <option value="QRIS">QRIS</option>
          <option value="Transfer Bank">Transfer Bank</option>
        </select>

        <p class="hint" id="payHint">
          Bayar tunai saat barang tiba.
        </p>

        <!-- Informasi QRIS -->
        <div id="qrisBox" class="panel" hidden>
          <h3>Pembayaran QRIS</h3>
          <p>Scan kode QRIS berikut untuk melakukan pembayaran.</p>

          <img
            src="assets/QRIS.jpg"
            alt="QRIS Jaya Mebel"
            style="width:220px;max-width:100%;display:block;margin:12px auto"
          >

          <p>Pastikan nama merchant sesuai sebelum membayar.</p>
        </div>

        <!-- Informasi rekening -->
        <div id="bankBox" class="panel" hidden>
          <h3>Transfer Bank</h3>

        <p>Bank: <b>${esc(COMPANY.bankName || "Bank Mandiri")}</b></p>
        <p>Nomor rekening: <b>${esc(COMPANY.bankNo || "1060023392221")}</b></p>
        <p>Atas nama: <b>${esc(COMPANY.bankOwner || "CV Jaya Mebel")}</b></p>
        </div>

        <!-- Upload bukti pembayaran -->
  <label id="proofBox" hidden>
    Bukti pembayaran <span style="color:red">*</span>
    <input
      type="file"
      id="rProof"
      accept="image/jpeg,image/png,image/webp"
      onchange="validatePaymentProof()"
    >
    <small id="proofError" style="color:red;display:none">
      Bukti pembayaran wajib diunggah.
    </small>
  </label>

        <button class="btn">Buat pesanan</button>
      </form>

      <aside class="panel">
        <h3>Ringkasan</h3>

        ${it.map(({ p, q }) => `
          <div class="row between">
            <span>${esc(p.name)} × ${q}</span>
            <b>${money(p.price * q)}</b>
          </div>
        `).join("")}

        <div class="sum">
          <span>Total</span>
          <b>${money(cartTotal())}</b>
        </div>
      </aside>
    </section>`;
  };
  function payHint() {
    const method = $("rPay").value;
    const proofBox = $("proofBox");
    const proofInput = $("rProof");

    proofBox.hidden = method === "COD";

    // COD tidak membutuhkan bukti.
    // QRIS dan Transfer Bank wajib mengunggah bukti.
    proofInput.required = method !== "COD";

    if (method === "COD") {
      proofInput.value = "";
      $("proofError").style.display = "none";
    }

    $("qrisBox").hidden = method !== "QRIS";
    $("bankBox").hidden = method !== "Transfer Bank";

    $("payHint").textContent = {
      COD: "Bayar tunai saat barang tiba.",
      QRIS: "Silakan scan QRIS Jaya Mebel dan unggah bukti pembayaran.",
      "Transfer Bank": "Silakan transfer ke rekening Jaya Mebel dan unggah bukti pembayaran."
    }[method];
  }

  function validatePaymentProof() {
    const method = $("rPay").value;
    const file = $("rProof").files?.[0];
    const error = $("proofError");

    const valid = method === "COD" || !!file;

    error.style.display = valid ? "none" : "block";

    return valid;
  }


  /* ---------- BUKTI PEMBAYARAN (Supabase Storage, bucket privat "payment-proofs") ---------- */
  async function uploadPaymentProof(file) {
    if (!file) throw new Error("Silakan pilih bukti pembayaran terlebih dahulu.");
    if (!file.type.startsWith("image/")) throw new Error("Bukti pembayaran harus berupa gambar.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran bukti pembayaran maksimal 5 MB.");
    const user = await JM_SUPABASE.currentUser();
    if (!user) throw new Error("Sesi login berakhir. Silakan login kembali.");
    const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    const name = window.crypto?.randomUUID ? crypto.randomUUID() : uid();
    const path = `${user.id}/${name}.${ext}`;           // folder pertama = id customer (dipakai aturan keamanan)
    const { error } = await supabaseClient.storage.from("payment-proofs")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
    if (error) throw error;
    return path;
  }
  const dropProof = path => { if (path) supabaseClient.storage.from("payment-proofs").remove([path]); };

  /* ---------- CHECKOUT ---------- */
  async function createOrder(e) {
    e.preventDefault();
    if (createOrder.busy) return;
    createOrder.busy = true;
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try { await placeOrder(); }
    finally { createOrder.busy = false; if (btn) btn.disabled = false; }
  }

  async function placeOrder() {
    const u = me(), it = selectedItems();
    if (!u) return toast("Silakan login terlebih dahulu.");
    if (!it.length) return toast("Keranjang kosong.");

    const recipientName = $("rName").value.trim();
    const phone = $("rPhone").value.trim();
    const address = $("rAddr").value.trim();
    const note = $("rNote").value.trim();
    const selectedMethod = $("rPay").value;

    if (!recipientName || !address) return toast("Nama penerima dan alamat wajib diisi.");
    if (!/^[0-9+\-\s]{8,15}$/.test(phone)) return toast("Nomor telepon tidak valid.");
    const bad = it.find(item => item.q > item.p.stock);
    if (bad) return toast(`Stok ${bad.p.name} tidak mencukupi.`);

  const proofFile = $("rProof")?.files?.[0];

  if (selectedMethod !== "COD") {
    if (!proofFile) {
      $("proofError").style.display = "block";
      $("rProof").focus();
      return toast("Wajib unggah bukti pembayaran sebelum membuat pesanan.");
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(proofFile.type)) {
      return toast("Format bukti harus JPG, PNG, atau WEBP.");
    }

    if (proofFile.size > 5 * 1024 * 1024) {
      return toast("Ukuran bukti pembayaran maksimal 5 MB.");
    }
  }

    const paymentMethod = selectedMethod === "Transfer Bank" ? "TRANSFER BANK" : selectedMethod;
    let proofPath = null;

  
    try {
      // 1. Upload bukti pembayaran jika bukan COD.
      if (paymentMethod !== "COD") {
        proofPath = await uploadPaymentProof(proofFile);
      }

      // 2. Buat pesanan di database.
      const result = await rpc("jm_checkout_selected", {
        p_recipient_name: recipientName,
        p_phone: phone,
        p_address: address,
        p_note: note,
        p_shipping_cost: 0,
        p_payment_method: paymentMethod,
        p_product_ids: it.map(item => String(item.p.id))
      });

      // 3. Simpan lokasi bukti ke tabel payments.
      let proofWarning = "";

      if (proofPath && result.order_id) {
        try {
          await rpc("jm_submit_proof", {
            p_order_id: String(result.order_id),
            p_path: proofPath
          });
        } catch (proofError) {
          console.error("[SAVE PAYMENT PROOF]", proofError);
          proofWarning =
            " Pesanan berhasil dibuat, tetapi bukti pembayaran belum tersimpan. Silakan hubungi admin.";
        }
      }

      // 4. Muat ulang data website.
      await Promise.all([
        loadOrders(),
        syncCartFromSupabase(),
        loadCatalog()
      ]);

      unchecked.clear();

      // 5. Tampilkan hasil checkout.
      if (proofWarning) {
        toast("Pesanan berhasil dibuat. Nomor pesanan: " +
          result.order_number + "." + proofWarning);
      } else {
        toast("Pesanan berhasil dibuat. Nomor pesanan: " +
          result.order_number);
      }

      accTab = "orders";
      go("account");

    } catch (error) {
      // File hanya dibersihkan jika proses checkout gagal.
      // Jangan hapus file jika pesanan sudah berhasil dibuat.
      if (!error.orderCreated) {
        dropProof(proofPath);
      }

      console.error("[CHECKOUT ERROR]", error);
      toast(error.message || "Checkout gagal. Silakan coba kembali.");
    }
  }


  /* ---------- LIHAT BUKTI PEMBAYARAN (admin, staff, dan pemilik pesanan) ---------- */
  async function viewProof(id) {
    const o = db.orders.find(x => x.id === id);
    if (!o) return toast("Pesanan tidak ditemukan.");
    if (!o.proof) return toast("Bukti pembayaran belum tersedia.");
    try {
      let imageUrl = o.proof;
      if (!/^https?:\/\//i.test(o.proof)) {
        const { data, error } = await supabaseClient.storage.from("payment-proofs").createSignedUrl(o.proof, 300);
        if (error) throw error;
        imageUrl = data.signedUrl;
      }
      openModal(`<h3>Bukti ${esc(o.id)}</h3>
        <img src="${esc(imageUrl)}" alt="Bukti pembayaran" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px">
        <div class="row" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Tutup</button></div>`);
    } catch (error) {
      console.error("[VIEW PAYMENT PROOF]", error);
      toast("Gagal membuka bukti pembayaran: " + error.message);
    }
  }

  /* ---------- DETAIL PESANAN CUSTOMER ---------- */
  pages.order = u => {
    const o = db.orders.find(x => x.id === view.id);
    if (!o || o.userId !== u.id) return `<section class="wrap"><div class="empty">Pesanan tidak ditemukan.</div></section>`;
    const idx = FLOW.indexOf(o.status), done = o.status === FLOW[4];
    const reviews = !done ? "" : `<div class="panel"><h3>Beri penilaian</h3>${o.items.map(i => {
      const v = db.reviews.find(r => r.orderId === o.id && r.productId === i.pid);
      return v ? `<div class="rv"><b>${esc(i.name)}</b><br><span class="stars">${stars(v.rating)}</span><p>${esc(v.text)}</p><small>Ulasan terkirim, terima kasih.</small></div>`
        : `<div class="rv"><b>${esc(i.name)}</b><div class="stars pick" id="st-${i.pid}" data-v="0">${[1, 2, 3, 4, 5].map(n => `<button type="button" onclick="pickStar('${i.pid}',${n})">★</button>`).join("")}</div>
          <textarea id="tx-${i.pid}" rows="2" placeholder="Ceritakan kualitas dan kenyamanan produk ini"></textarea><button class="btn sm" onclick="sendReview('${o.id}','${i.pid}')">Kirim ulasan</button></div>`;
    }).join("")}</div>`;

    // Aturan pembatalan: selama dana belum dikonfirmasi admin dan pesanan belum dikonfirmasi.
    const refundable = o.method !== "COD" && o.pay === "Menunggu Verifikasi";
    const canCancel = o.status === FLOW[0] && o.pay !== "Terverifikasi";
    const cancelArea = canCancel
      ? `<button class="btn red sm" onclick="customerCancel('${o.id}')">${refundable ? "Batalkan &amp; ajukan pengembalian dana" : "Batalkan pesanan"}</button>
        ${refundable ? `<p style="margin-top:6px"><small>Dana Anda belum dikonfirmasi admin, jadi pesanan masih bisa dibatalkan dan dana dikembalikan.</small></p>` : ""}`
      : (o.status === BATAL || done) ? ""
      : o.status === FLOW[0] ? `<small>Pembayaran sudah dikonfirmasi admin. Untuk pembatalan, hubungi toko lewat WhatsApp.</small>`
      : `<small>Pesanan sudah diproses. Hubungi toko untuk pembatalan.</small>`;
    const proofBtn = o.method !== "COD" && o.proof ? `<div style="margin-top:8px"><button class="btn ghost sm" onclick="viewProof('${o.id}')">Lihat bukti pembayaran</button></div>` : "";
    const refundBox = o.refund ? `<div class="alert">Pengembalian dana: <b>${esc(o.refund)}</b>${o.refundInfo ? `<br><small>Tujuan: ${esc(o.refundInfo)}</small>` : ""}${o.refund === "Diajukan" ? `<br><small>Admin akan memeriksa dan mengembalikan dana Anda.</small>` : ""}</div>` : "";

    return `<section class="wrap two"><div><div class="row"><button class="btn ghost sm" onclick="go('account')">Kembali</button><button class="btn sm" onclick="printDoc('${o.id}','invoice')">Cetak invoice</button>${o.courier ? `<button class="btn ghost sm" onclick="printDoc('${o.id}','sj')">Surat jalan</button>` : ""}<button class="btn ghost sm" onclick="reorder('${o.id}')">Beli lagi</button></div><h2 style="margin-top:14px">${o.id}</h2>
      <div class="panel"><b>${esc(o.name)}</b>, ${esc(o.phone)}<br>${esc(o.address)}${o.note ? `<br><small>Catatan: ${esc(o.note)}</small>` : ""}</div>
      <div class="panel"><h3>Barang</h3>${o.items.map(i => `<div class="row between"><span>${esc(i.name)} × ${i.qty}</span><b>${money(i.price * i.qty)}</b></div>`).join("")}<div class="sum"><span>Total</span><b>${money(o.total)}</b></div>
        <small>Pembayaran ${esc(o.method)}: ${esc(o.pay)}${o.rejectReason ? `. Alasan penolakan: ${esc(o.rejectReason)}` : ""}</small>${proofBtn}</div>${reviews}</div>
      <aside class="panel"><h3>Status pesanan</h3><span class="tag ${statusTag(o.status)}">${o.status}</span>${stepper(o)}${o.cancelReason ? `<div class="alert">Alasan pembatalan: ${esc(o.cancelReason)}</div>` : ""}${refundBox}${reuploadBox(o)}
        ${o.courier ? `<p style="margin-top:10px"><small>Kurir: ${esc(o.courier)}${o.resi ? ", resi " + esc(o.resi) : ""}</small></p>` : ""}
        <ul class="tl">${o.track.map(t => `<li>${esc(t.s)}<small>${fmt(t.at)}</small></li>`).join("")}</ul>
        ${cancelArea}</aside></section>`;
  };

  function customerCancel(id) {
    const o = db.orders.find(x => x.id === id);
    if (!o || o.userId !== me().id) return toast("Pesanan tidak ditemukan.");
    if (o.status !== FLOW[0]) return toast("Pesanan yang sudah dikonfirmasi tidak dapat dibatalkan.");
    if (o.pay === "Terverifikasi") return toast("Dana sudah dikonfirmasi admin. Hubungi toko untuk pembatalan.");

    const refund = o.method !== "COD" && o.pay === "Menunggu Verifikasi";
    const fields = [{ k: "reason", label: "Alasan pembatalan", area: 1, req: 1 }];
    if (refund) fields.push({ k: "refund", label: "Tujuan pengembalian dana (bank atau e-wallet, nomor rekening, atas nama)", area: 1, req: 1 });

    ask(refund ? "Batalkan &amp; ajukan pengembalian dana" : "Batalkan pesanan", fields, async v => {
      try {
        await rpc("jm_cancel_order", { p_order_id: String(o.dbId), p_reason: v.reason, p_refund_info: v.refund || null });
        await Promise.all([loadOrders(), loadCatalog()]);
        toast(refund ? "Pesanan dibatalkan. Pengembalian dana sudah diajukan ke admin." : "Pesanan dibatalkan.");
        render();
      } catch (error) {
        console.error("[CANCEL]", error);
        toast(error.message || "Pesanan gagal dibatalkan.");
      }
    });
  }

  /* ---------- KIRIM ULANG BUKTI BAYAR (jika ditolak) ---------- */
  async function reuploadProof(orderId) {
    const o = db.orders.find(x => x.id === orderId);
    if (!o || o.userId !== me().id || o.pay !== "Ditolak") return toast("Bukti tidak bisa dikirim ulang.");
    const file = $("newProof").files[0];
    if (!file) return toast("Pilih foto bukti pembayaran dulu.");
    let path = null;
    try {
      path = await uploadPaymentProof(file);
      await rpc("jm_submit_proof", { p_order_id: String(o.dbId), p_path: path });
      await loadOrders();
      toast("Bukti baru terkirim.");
      render();
    } catch (error) {
      dropProof(path);
      toast(error.message || "Gagal mengirim bukti.");
    }
  }

  /* ---------- ULASAN ---------- */
  async function sendReview(orderId, pid) {
    const u = me(), o = db.orders.find(x => x.id === orderId), rating = +$("st-" + pid).dataset.v;
    if (!o || o.userId !== u.id || o.status !== FLOW[4]) return toast("Ulasan hanya bisa dikirim setelah pesanan selesai.");
    if (db.reviews.some(r => r.orderId === orderId && r.productId === pid)) return toast("Anda sudah menilai produk ini.");
    if (rating < 1) return toast("Pilih jumlah bintang dulu.");
    try {
      const { error } = await supabaseClient.from("reviews").insert({
        order_id: orderId, product_id: String(pid), user_id: u.id, user_name: u.name,
        rating, comment: $("tx-" + pid).value.trim()
      });
      if (error) throw error;
      await loadReviews();
      toast("Terima kasih atas penilaian Anda.");
      render();
    } catch (error) {
      toast(error.code === "23505" ? "Anda sudah menilai produk ini." : (error.message || "Gagal mengirim ulasan."));
    }
  }


  function pickStar(pid, n) {
    const box = $("st-" + pid); box.dataset.v = n;
    [...box.children].forEach((b, i) => b.classList.toggle("on", i < n));
  }

  pages.help = () => {
    const kontak = [
      ["Showroom", "Jl. Maleran, Medan, Sumatera Utara 20111"],
      ["Jam buka", "Senin sampai Sabtu<br>08.00 sampai 17.00"],
      ["WhatsApp", "0878-8229-8286"]
    ];
    const layanan = [
      ["Pembayaran", "COD dibayar saat barang tiba. QRIS dan transfer bank dibayar di muka, lalu bukti diunggah dan diperiksa admin."],
      ["Pengiriman", "Pesanan dikirim setelah dikonfirmasi dan diproses. Nama kurir dan nomor resi tampil di detail pesanan."],
      ["Pembatalan", "Pesanan bisa dibatalkan sendiri sampai berstatus dikonfirmasi. Setelah diproses, hubungi kami lewat WhatsApp."]
    ];
    const faq = [
      ["Bagaimana cara memesan?", "Masuk atau daftar, pilih produk, masukkan ke keranjang, centang produk yang ingin dibeli, lalu isi data pengiriman di checkout."],
      ["Apakah bisa membeli sebagian isi keranjang?", "Bisa. Centang produk yang ingin dibeli sekarang. Produk lain tetap tersimpan di keranjang."],
      ["Bukti pembayaran saya ditolak, bagaimana?", "Buka Akun saya, pilih pesanannya, lalu unggah bukti pembayaran yang baru."],
      ["Bagaimana mencetak invoice?", "Buka detail pesanan di Akun saya, lalu tekan Cetak invoice."],
      ["Kapan saya bisa memberi ulasan?", "Setelah status pesanan menjadi Pesanan Selesai."]
    ];
    return `<section class="wrap"><div class="helphero"><h1>Ada yang bisa kami bantu?</h1>
        <p>Temukan jawabannya di sini, atau hubungi kami langsung.</p>
        <a class="btn" href="https://wa.me/6281200000000" target="_blank" rel="noopener">Chat WhatsApp</a></div></section>
      <section class="wrap"><div class="infogrid">${kontak.map(([judul, isi]) => `<div class="info"><small>${judul}</small><b>${isi}</b></div>`).join("")}</div></section>
      <section class="wrap"><h2>Informasi layanan</h2><div class="infogrid">${layanan.map(([judul, isi]) => `<div class="info"><h3>${judul}</h3><p>${isi}</p></div>`).join("")}</div></section>
      <section class="wrap narrow"><h2>Pertanyaan umum</h2>${faq.map(([tanya, jawab]) => `<details><summary>${tanya}</summary><p>${jawab}</p></details>`).join("")}</section>`;
  };

  function togglePw(b) { const i = b.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Lihat" : "Sembunyikan"; }
  pages.auth = () => {
    const login = authMode === "login";
    const pw = (id, label, extra = "", ac = "current-password") => `<label>${label}<div class="pw"><input id="${id}" type="password" ${extra} required autocomplete="${ac}"><button type="button" onclick="togglePw(this)">Lihat</button></div></label>`;
    return `<section class="authwrap"><aside class="authside"><div class="logo"><b>JM</b><span>${esc(COMPANY.name)}<small>${esc(COMPANY.tagline)}</small></span></div>
      <h2>${login ? "Selamat datang kembali" : "Buat akun, belanja jadi lebih mudah"}</h2>
      <ul><li>Pantau status pesanan dan nomor resi</li><li>Simpan favorit dan beberapa alamat pengiriman</li><li>Unduh invoice dan surat jalan kapan saja</li></ul></aside>
      <div class="authform"><div class="seg"><button class="${login ? "on" : ""}" onclick="authMode='login';render()">Masuk</button><button class="${login ? "" : "on"}" onclick="authMode='register';render()">Daftar</button></div>
      <h1>${login ? "Masuk ke akun Anda" : "Buat akun baru"}</h1><p class="sub">${login ? "Gunakan email yang terdaftar." : "Cukup satu menit. Data dipakai untuk memproses pesanan Anda."}</p>
      ${login
        ? `<form onsubmit="doLogin(event,'customer')"><label>Email<input id="aUser" type="email" required autocomplete="username" placeholder="contoh: budi@email.com"></label>${pw("aPass", "Password")}<button class="btn block">Masuk</button></form>
          <p class="swap">Belum punya akun? <a onclick="authMode='register';render()">Daftar sekarang</a></p>`
        : `<form onsubmit="doRegister(event)"><label>Nama lengkap<input id="aName" required autocomplete="name"></label><div class="fgrid"><label>Email<input id="aUser" type="email" required autocomplete="username"></label><label>Nomor telepon<input id="aPhone" required autocomplete="tel" placeholder="08xxxxxxxxxx"></label></div>
          <div class="fgrid">${pw("aPass", "Password (min. 6 karakter)", 'minlength="6"', "new-password")}${pw("aPass2", "Ulangi password", 'minlength="6"', "new-password")}</div>
          <label class="agree"><input type="checkbox" class="check" required> Saya setuju data saya dipakai untuk memproses pesanan.</label><button class="btn block">Buat akun</button></form>
          <p class="swap">Sudah punya akun? <a onclick="authMode='login';render()">Masuk</a></p>`}
      </div></section>`;
  };


  /* ==========================================================
    SESI, LOGIN, DAFTAR, KELUAR (Supabase Auth + tabel profiles)
    ========================================================== */

  // Mengambil profil dari tabel profiles lalu memuat data sesuai peran.
  async function startSession(authUser) {
    const { data: profile, error } = await supabaseClient
      .from("profiles").select("*").eq("id", authUser.id).single();
    if (error) throw error;

    if (!profile || profile.active === false) {
      await supabaseClient.auth.signOut();
      throw new Error("Akun dinonaktifkan atau profil tidak ditemukan.");
    }

    let staffPerms = [];
let staffTitle = "";

if (profile.role === "staff") {
  const { data: permissionRows, error: permissionError } =
    await supabaseClient
      .from("staff_permissions")
      .select("menu_key")
      .eq("staff_id", authUser.id);

  if (permissionError) throw permissionError;

  staffPerms = (permissionRows || []).map(x => x.menu_key);
  staffTitle = authUser.user_metadata?.title || "";
}

    currentProfile = {
      id: authUser.id,
      name: profile.full_name || authUser.email,
      username: profile.username || authUser.email,
      email: authUser.email,
      phone: profile.phone || "",
      role: String(profile.role || "customer"),
      active: profile.active !== false,
      company: profile.company || "",
      npwp: profile.npwp || "",
      title: staffTitle,
      perms: staffPerms,
      created: profile.created_at || authUser.created_at,
      lastLogin: authUser.last_sign_in_at || ""
    };

    resetCaches();
if (currentProfile.role === "customer") {
  await loadCustomerData();
} else if (
  currentProfile.role === "admin" ||
  currentProfile.role === "staff"
) {
  try {
    await loadAdminData();
  } catch (error) {
    console.error("[LOAD ADMIN DATA]", error);

    // Jangan menghapus sesi Auth yang sudah berhasil.
    // Dashboard tetap bisa dibuka, tetapi data yang gagal
    // dimuat harus diperiksa kembali.
    toast("Login berhasil, tetapi sebagian data dashboard gagal dimuat.");
  }
} else {
  throw new Error("Role akun tidak dikenali.");
}
    return currentProfile;
  }

  const friendlyAuthError = m =>
    /invalid login credentials/i.test(m) ? "Email atau password salah."
    : /email not confirmed/i.test(m) ? "Email belum dikonfirmasi. Periksa kotak masuk email Anda."
    : m;

  async function doLogin(e) {
    e.preventDefault();
    const email = $("aUser").value.trim().toLowerCase();
    const password = $("aPass").value;
    try {
      const result = await JM_SUPABASE.login(email, password);
      await startSession(result.user);
      const u = me();
      if (u.role === "admin" || u.role === "staff") {
        adminTab = "dashboard";
        toast("Login berhasil. Selamat datang, " + u.name);
        render();
        return;
      }
      toast("Selamat datang, " + u.name);
      go("home");
    } catch (error) {
      console.error("[SUPABASE LOGIN]", error);
      toast(friendlyAuthError(error.message || "Login gagal. Periksa email dan password."));
    }
  }

  async function doRegister(e) {
    e.preventDefault();
    const email = $("aUser").value.trim().toLowerCase();
    const name = $("aName").value.trim();
    const phone = $("aPhone").value.trim();
    const password = $("aPass").value;

    if (!/^[0-9+\-\s]{8,15}$/.test(phone)) return toast("Nomor telepon tidak valid.");
    if (password !== $("aPass2").value) return toast("Konfirmasi password tidak sama.");

    try {
      const result = await JM_SUPABASE.register(email, password, name, phone);
      if (!result.session) {
        toast("Registrasi berhasil. Silakan konfirmasi email, lalu masuk.");
        authMode = "login";
        render();
        return;
      }
      await startSession(result.user);
      toast("Akun berhasil dibuat. Selamat datang, " + me().name);
      go("home");
    } catch (error) {
      console.error("[SUPABASE REGISTER]", error);
      toast(error.message || "Registrasi gagal.");
    }
  }

  async function logout() {
    try {
      await JM_SUPABASE.logout();
      currentProfile = null;
      resetCaches();
      view = { page: "home" };
      render();
      toast("Anda sudah keluar.");
    } catch (error) {
      console.error("[SUPABASE LOGOUT]", error);
      toast(error.message || "Gagal logout.");
    }
  }

  // Sesi berakhir dari tab lain atau kedaluwarsa: kembali ke tampilan tamu.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    JM_SUPABASE.user = session?.user || null;
    if (event === "SIGNED_OUT" && currentProfile) {
      currentProfile = null;
      resetCaches();
      render();
    }
  });


  const TABS = [["dashboard", "Ringkasan"], ["products", "Produk"], ["orders", "Pesanan"], ["payments", "Verifikasi bayar"], ["stock", "Persediaan"], ["po", "Purchase order"], ["opname", "Stock opname"], ["customers", "Customer"], ["reports", "Laporan"]];
  const adm = {};
  const stat = (label, value, cls = "") => `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`;


  /* ---------- ADMIN SHELL ---------- */
  function setTab(k) {
    adminTab = k;
    render();
    refreshData(true);        // ambil data terbaru dari Supabase setiap pindah menu
  }

  function adminShell(u) {
    // Staff hanya melihat menu yang diizinkan admin utama (fungsi canOpen ada di bagian staff)
    const allowed = TABS.filter(t => canOpen(u, t[0]));
    if (!allowed.length) return `<div class="wrap"><div class="empty">Akun staff ini belum diberi akses menu. <a onclick="logout()">Keluar</a></div></div>`;
    if (!canOpen(u, adminTab)) adminTab = allowed[0][0];
    const badge = {
      orders: db.orders.filter(o => o.status === FLOW[0]).length,
      payments: db.orders.filter(o => (o.pay === "Menunggu Verifikasi" && o.status !== BATAL) || o.refund === "Diajukan").length
    };
    return `<div class="adm"><aside class="side"><div class="brand"><b>Jaya Mebel</b><small>Ruang kerja ${u.role === "admin" ? "admin" : "staff"}</small></div>
      ${allowed.map(([k, l]) => `<button class="${k === adminTab ? "on" : ""}" onclick="setTab('${k}')">${l}${badge[k] ? `<i>${badge[k]}</i>` : ""}</button>`).join("")}
      <button class="out" onclick="logout()">Keluar</button></aside>
      <main class="main"><header class="ahead"><h1>${TABS.find(t => t[0] === adminTab)[1]}</h1><div class="row"><small>${esc(u.name)}</small><button class="btn ghost sm noprint" onclick="refreshData(true).then(()=>toast('Data diperbarui.'))">Muat ulang</button></div></header>${adm[adminTab]()}</main></div>`;
  }

  /* ---------- PRODUK ---------- */
  async function ensureCategory(name) {
    const hit = db.categoryRows.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const { data, error } = await supabaseClient.from("categories").insert({ name }).select("id").single();
    if (error) throw error;
    db.categoryRows.push({ id: String(data.id), name });
    db.categories.push(name);
    return data.id;
  }

  async function saveProduct(e, id) {
    e.preventDefault();
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      const file = $("fImg").files[0];
      const fields = {
        name: $("fName").value.trim(),
        category_id: await ensureCategory($("fCat").value.trim()),
        price: +$("fPrice").value,
        cost: +$("fCost").value,
        min_stock: Math.floor(+$("fMin").value),
        material: $("fMat").value.trim(),
        size: $("fSize").value.trim(),
        color: $("fColor").value.trim(),
        description: $("fDesc").value.trim()
      };
      const sb = supabaseClient;

      if (id) {
        if (file) fields.image_url = await uploadProductImage(file, id);
        const { error } = await sb.from("products").update(fields).eq("id", id);
        if (error) throw error;
        log("Mengubah produk " + fields.name);
      } else {
        const stock = Math.floor(+$("fStock").value);
        const { data, error } = await sb.from("products").insert({ ...fields, stock, active: true }).select("id").single();
        if (error) throw error;
        if (file) {
          const url = await uploadProductImage(file, data.id);
          const { error: e2 } = await sb.from("products").update({ image_url: url }).eq("id", data.id);
          if (e2) throw e2;
        }
        if (stock > 0) {
  const { error: stockError } = await sb
    .from("stock_movements")
    .insert({
      product_id: String(data.id),
      movement_type: "Masuk",
      quantity: stock,
      note: "Stok awal",
      created_by: me().id
    });

  if (stockError) throw stockError;
}
        log("Menambah produk " + fields.name);
      }
      await loadCatalog();
      closeModal();
      toast("Produk tersimpan.");
      render();
    } catch (error) {
      console.error("[SAVE PRODUCT]", error);
      toast(error.message || "Produk gagal disimpan.");
      if (btn) btn.disabled = false;
    }
  }

  async function toggleProduct(id) {
    const p = db.products.find(x => x.id === id);
    if (!p) return;
    const aktif = p.active === false;
    const { error } = await supabaseClient.from("products").update({ active: aktif }).eq("id", id);
    if (error) return toast(error.message);
    log((aktif ? "Mengaktifkan " : "Menonaktifkan ") + p.name);
    await loadCatalog();
    render();
  }

  async function deleteProduct(id) {
    const p = db.products.find(x => x.id === id);
    if (!p) return;
    const used = db.orders.some(o => o.items.some(i => i.pid === id) && o.status !== FLOW[4] && o.status !== BATAL);
    if (used) return toast("Produk masih ada di pesanan aktif. Nonaktifkan saja.");
    if (!confirm("Hapus produk ini secara permanen?")) return;
    const { error } = await supabaseClient.from("products").delete().eq("id", id);
    if (error) return toast(/foreign key|violates/i.test(error.message) ? "Produk sudah pernah dipesan. Nonaktifkan saja." : error.message);
    log("Menghapus produk " + p.name);
    await loadCatalog();
    render();
  }

  /* ---------- PESANAN ---------- */
  function adminOrder(id) {
    const o = db.orders.find(x => x.id === id);
    if (!o) return;
    const u = me(), i = FLOW.indexOf(o.status), final = i === 4 || o.status === BATAL;
    const labels = ["Konfirmasi pesanan", "Proses pesanan", "Kirim pesanan", "Selesaikan pesanan"];
    const needPay = o.method !== "COD" && o.pay !== "Terverifikasi", act = ["confirm", "process", "ship", "done"][i];
    const proof = o.method !== "COD" ? (o.proof ? `<br><button class="btn ghost sm" onclick="viewProof('${o.id}')">Lihat bukti bayar</button>` : `<br><small>Belum ada bukti bayar</small>`) : "";
    const refund = o.refund ? `<br><b class="red">Pengembalian dana: ${esc(o.refund)}</b>${o.refundInfo ? `<br>Tujuan: ${esc(o.refundInfo)}` : `<br><small>Tujuan belum diisi, hubungi customer.</small>`}` : "";
    openModal(`<h3>${o.id}</h3><div class="cols"><div><b>${esc(o.name)}</b><br>${esc(o.phone)}<br>${esc(o.address)}${o.note ? `<br><small>${esc(o.note)}</small>` : ""}</div>
      <div>${esc(o.method)}: ${esc(o.pay)}<br>Status: ${o.status}${o.courier ? `<br>Kurir: ${esc(o.courier)}${o.resi ? ", resi " + esc(o.resi) : ""}` : ""}${o.cancelReason ? `<br>Alasan batal: ${esc(o.cancelReason)}` : ""}${proof}${refund}</div></div>
      ${table(["Barang", "Qty", "Subtotal"], o.items.map(x => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${money(x.price * x.qty)}</td></tr>`))}
      <div class="sum"><span>Total</span><b>${money(o.total)}</b></div>
      <ul class="tl">${o.track.map(t => `<li>${esc(t.s)}<small>${fmt(t.at)}</small></li>`).join("")}</ul>
      <div class="row">${final ? "" : needPay ? `<small class="red">Verifikasi pembayaran dulu di menu Verifikasi bayar.</small>` : `<button class="btn" onclick="orderAction('${o.id}','${act}')">${labels[i]}</button>`}
      ${final ? "" : `<button class="btn red" onclick="orderAction('${o.id}','cancel')">Batalkan</button>`}
      ${o.refund === "Diajukan" && canOpen(u, "payments") ? `<button class="btn" onclick="refundDone('${o.id}')">Dana sudah dikembalikan</button>` : ""}
      <button class="btn ghost" onclick="printDoc('${o.id}','invoice')">Invoice</button><button class="btn ghost" onclick="printDoc('${o.id}','sj')">Surat jalan</button><button class="btn ghost" onclick="closeModal()">Tutup</button></div>`);
  }

  async function runOrderRpc(o, act, v) {
    try {
      await rpc("jm_set_order_status", {
        p_order_id: String(o.dbId), p_action: act,
        p_courier: v.courier || null, p_vehicle: v.vehicle || null, p_resi: v.resi || null
      });
      await loadOrders();
      closeModal();
      toast("Status diperbarui.");
      render();
      await loadAdminData();
    } catch (error) {
      console.error("[ORDER STATUS]", error);
      toast(error.message || "Status gagal diperbarui.");
    }
  }

  function orderAction(id, act) {
    const o = db.orders.find(x => x.id === id);
    if (!o || o.status === BATAL || o.status === FLOW[4]) return toast("Pesanan sudah final.");
    if (act === "cancel") return adminCancelForm(o.id);
    if (act === "ship") {
      return ask("Data pengiriman", [
        { k: "courier", label: "Nama kurir / petugas", req: 1 },
        { k: "vehicle", label: "Nomor kendaraan" },
        { k: "resi", label: "Nomor resi (jika ekspedisi)" }
      ], v => runOrderRpc(o, "ship", v));
    }
    if (act === "done" && o.method === "COD" && !confirm("Pembayaran COD sudah diterima?")) return;
    runOrderRpc(o, act, {});
  }

  async function submitAdminCancel(e, orderId) {
    e.preventDefault();
    const o = db.orders.find(x => x.id === orderId);
    if (!o || o.status === BATAL || o.status === FLOW[4]) return toast("Pesanan sudah final.");
    const catatan = $("cancelNote").value.trim();
    const alasan = $("cancelReason").value + (catatan ? " - " + catatan : "");
    try {
      await rpc("jm_cancel_order", { p_order_id: String(o.dbId), p_reason: alasan, p_refund_info: null });
      await Promise.all([loadOrders(), loadCatalog()]);
      closeModal();
      toast("Pesanan dibatalkan.");
      render();
    } catch (error) {
      toast(error.message || "Pesanan gagal dibatalkan.");
    }
  }

  /* ---------- VERIFIKASI PEMBAYARAN & PENGEMBALIAN DANA ---------- */
  adm.payments = () => `<div class="panel">${table(["Pesanan", "Metode", "Jumlah", "Status bayar", "Bukti", ""], db.orders.filter(o => o.method !== "COD").map(o => `<tr><td><b>${o.id}</b><br><small>${esc(o.name)}</small></td><td>${esc(o.method)}</td><td>${money(o.total)}</td>
    <td>${esc(o.pay)}${o.status === BATAL ? `<br><small>Pesanan dibatalkan</small>` : ""}${o.rejectReason ? `<br><small>${esc(o.rejectReason)}</small>` : ""}${o.verifiedBy ? `<br><small>oleh ${esc(o.verifiedBy)}, ${fmt(o.verifiedAt)}</small>` : ""}${o.refund ? `<br><small class="red">Pengembalian dana: ${esc(o.refund)}</small>${o.refundInfo ? `<br><small>${esc(o.refundInfo)}</small>` : ""}` : ""}</td>
    <td>${o.proof ? `<button class="btn ghost sm" onclick="viewProof('${o.id}')">Lihat</button>` : `<small>Belum ada</small>`}</td>
    <td>${o.pay === "Menunggu Verifikasi" && o.status !== BATAL ? `<button class="btn sm" onclick="payAction('${o.id}','ok')">Setujui</button><button class="btn red sm" onclick="payAction('${o.id}','no')">Tolak</button>` : ""}${o.refund === "Diajukan" ? `<button class="btn sm" onclick="refundDone('${o.id}')">Dana dikembalikan</button>` : ""}</td></tr>`))}</div>`;

  async function callPay(o, ok, reason, msg) {
    try {
      await rpc("jm_verify_payment", { p_order_id: String(o.dbId), p_ok: ok, p_reason: reason });
      await loadOrders();
      toast(msg);
      render();
    } catch (error) { toast(error.message || "Gagal memproses pembayaran."); }
  }

  function payAction(id, act) {
    const o = db.orders.find(x => x.id === id);
    if (!o || o.method === "COD" || o.pay !== "Menunggu Verifikasi" || o.status === BATAL) return toast("Pembayaran ini sudah diproses.");
    if (act === "ok") {
      if (!o.proof) return toast("Customer belum mengunggah bukti pembayaran.");
      if (!confirm("Pastikan dana sudah masuk ke rekening atau QRIS. Setujui pembayaran?")) return;
      return callPay(o, true, null, "Pembayaran disetujui.");
    }
    ask("Tolak bukti pembayaran", [{ k: "reason", label: "Alasan penolakan", area: 1, req: 1 }], v => callPay(o, false, v.reason, "Bukti pembayaran ditolak."));
  }

  async function refundDone(id) {
    const o = db.orders.find(x => x.id === id);
    if (!o || o.refund !== "Diajukan") return toast("Tidak ada pengembalian dana yang menunggu.");
    if (!confirm(`Tandai dana ${money(o.total)} untuk ${o.id} sudah dikembalikan ke customer?`)) return;
    try {
      await rpc("jm_refund_done", { p_order_id: String(o.dbId) });
      await loadOrders();
      closeModal();
      toast("Pengembalian dana dicatat.");
      render();
    } catch (error) { toast(error.message || "Gagal mencatat pengembalian dana."); }
  }

  /* ---------- PURCHASE ORDER ---------- */

  async function savePO(e) {
    e.preventDefault();


  const supplierName = $("poSup").value.trim();
  const productId = $("poProd").value;
  const product = db.products.find(
    p => String(p.id) === String(productId)
  );

  const qty = Number($("poQty").value);
  const cost = Number($("poCost").value);
  const orderDate = $("poDate").value;
  const eta = $("poEta").value;
  const note = $("poNote").value.trim();

  if (!supplierName) {
    return toast("Nama supplier wajib diisi.");
  }

  if (!product) return toast("Produk tidak ditemukan.");

  if (!Number.isInteger(qty) || qty < 1) {
    return toast("Jumlah pesanan minimal 1.");
  }

  if (!Number.isFinite(cost) || cost < 0) {
    return toast("Harga beli tidak valid.");
  }

  if (!orderDate) return toast("Tanggal pesan wajib diisi.");

  if (eta && eta < orderDate) {
    return toast("Estimasi tiba tidak boleh sebelum tanggal pesan.");
  }

  // Cari supplier yang sudah terdaftar.
  let supplier = db.suppliers.find(
    s => s.name.trim().toLowerCase() === supplierName.toLowerCase()
  );

  // Jika belum ada, daftarkan supplier baru.
  if (!supplier) {
    const { data, error } = await supabaseClient
      .from("suppliers")
      .insert({
        name: supplierName,
        active: true
      })
      .select("*")
      .single();

    if (error) {
      console.error("[CREATE SUPPLIER]", error);
      return toast("Gagal menambahkan supplier: " + error.message);
    }

    supplier = data;
    db.suppliers.push(supplier);
  }

  const supplierId = supplier.id;

    const poNumber = "JM-PO-" +
      new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

    let createdPOId = null;

    try {
      // 1. Simpan header PO.
      const { data: header, error: headerError } =
        await supabaseClient
          .from("purchase_orders")
          .insert({
            po_number: poNumber,
            supplier_id: supplierId,
            status: "Menunggu",
            order_date: orderDate,
            estimated_date: eta || null,
            note: note || null,
            created_by: me().id
          })
          .select("id")
          .single();

      if (headerError) throw headerError;

      createdPOId = header.id;

      // 2. Simpan detail barang PO.
      const { error: itemError } =
        await supabaseClient
          .from("purchase_order_items")
          .insert({
            purchase_order_id: createdPOId,
            product_id: product.id,
            quantity: qty,
            received_quantity: 0,
            unit_cost: cost
          });

      if (itemError) {
        // Hanya hapus header baru yang baru saja dibuat,
        // jika penyimpanan detail gagal.
        const { error: cleanupError } = await supabaseClient
          .from("purchase_orders")
          .delete()
          .eq("id", createdPOId);

        if (cleanupError) {
          console.error("[PO CLEANUP]", cleanupError);
        }

        throw itemError;
      }

      await loadAdminData();
      toast("Purchase Order berhasil dibuat: " + poNumber);
      render();

    } catch (error) {
      console.error("[SAVE PO]", error);
      toast(error.message || "Gagal menyimpan Purchase Order.");
    }
  }


  async function poAction(id, act) {
    const po = db.pos.find(x => x.id === id);
    if (!po) return;
    let from, to;
    if (act === "order") { from = ["Menunggu"]; to = "Dipesan ke Supplier"; }
    else if (act === "cancel") { from = ["Menunggu", "Dipesan ke Supplier"]; to = "Dibatalkan"; }
    if (!from || !from.includes(po.status)) return toast("Status PO tidak bisa diubah.");
    const { error } = await supabaseClient.from("purchase_orders").update({ status: to }).eq("id", id).in("status", from);
    if (error) return toast(error.message);
    log(po.id + ": " + to);
    await loadAdminData();
    render();
  }


  function receivePO(itemId) {
    const po = db.pos.find(x =>
      x.items.some(item => String(item.id) === String(itemId))
    );

    const item = po?.items.find(
      x => String(x.id) === String(itemId)
    );

    if (!po || !item) {
      return toast("Detail barang PO tidak ditemukan.");
    }

    const left = item.qty - item.received;

    if (
      left <= 0 ||
      !["Dipesan ke Supplier", "Sebagian Diterima"].includes(po.status)
    ) {
      return toast("Barang tidak dapat diterima pada status PO ini.");
    }

    ask(
      "Terima barang " + item.productName,
      [
        {
          k: "qty",
          label: `Jumlah yang benar-benar datang (sisa ${left})`,
          type: "number",
          min: 1,
          max: left,
          req: 1
        },
        {
          k: "note",
          label: "Catatan penerimaan (opsional)"
        }
      ],
      async v => {
        const n = Math.floor(Number(v.qty));

        if (!Number.isInteger(n) || n < 1 || n > left) {
          return toast("Jumlah penerimaan tidak valid.");
        }

        try {
          await rpc("jm_receive_po", {
            p_po_item_id: item.id,
            p_qty: n,
            p_note: v.note?.trim() || null
          });

          await loadAdminData();
          toast("Penerimaan berhasil. Stok bertambah " + n + " unit.");
          render();

        } catch (error) {
          console.error("[RECEIVE PO]", error);
          toast(error.message || "Penerimaan gagal dicatat.");
        }
      }
    );
  }


  /* ---------- STOCK OPNAME ---------- */
  async function saveOpname(e) {
    e.preventDefault();
    const p = db.products.find(x => x.id === $("opProd").value), physical = +$("opQty").value, note = $("opNote").value.trim();
    if (!p || !Number.isInteger(physical) || physical < 0) return toast("Stok fisik tidak valid.");
    const diff = physical - p.stock;
    if (diff !== 0 && !note) return toast("Isi penyebab selisih stok.");
    if (!confirm(`Stok sistem ${p.stock}, fisik ${physical}, selisih ${diff}. Sesuaikan stok sistem?`)) return;
    try {
      await rpc("jm_stock_opname", { p_product_id: String(p.id), p_physical: physical, p_note: note });
      await loadAdminData();
      toast("Stock opname tersimpan.");
      render();
    } catch (error) { toast(error.message || "Stock opname gagal."); }
  }


/* ---------- CUSTOMER (dibaca dari tabel profiles) ---------- */
adm.customers = () => `<div class="panel">${table(["Nama", "Kontak", "Pesanan", "Total belanja", "Status", ""], db.customers.map(u => {
  const mine = db.orders.filter(o => o.userId === u.id);
  return `<tr><td><b>${esc(u.name)}</b><br><small>${custId(u)}</small></td><td>${esc(u.email || u.username)}<br><small>${esc(u.phone)}</small></td><td>${mine.length}</td><td>${money(sum(mine.filter(isPaid), o => o.total))}</td>
    <td><span class="tag ${u.active === false ? "bad" : "ok"}">${u.active === false ? "Nonaktif" : "Aktif"}</span></td>
    <td>${me().role === "admin" ? `<button class="btn ghost sm" onclick="toggleUser('${u.id}')">${u.active === false ? "Aktifkan" : "Nonaktifkan"}</button>` : ""}</td></tr>`;
}))}</div>`;

async function toggleUser(id) {
  if (me()?.role !== "admin") {
    return toast("Hanya Admin Main yang boleh mengubah status akun.");
  }

  const isStaff = db.staff.some(s => s.id === id);
  const target = isStaff
    ? db.staff.find(s => s.id === id)
    : db.customers.find(c => c.id === id);

  if (!target) {
    return toast("Akun tidak ditemukan.");
  }

  const active = target.active === false;

  if (!confirm(
    `${active ? "Aktifkan" : "Nonaktifkan"} akun ${target.name}?`
  )) return;

  try {
    const { data, error } =
      await supabaseClient.functions.invoke("manage-staff", {
        body: {
          action: isStaff ? "toggle" : "toggle_customer",
          userId: id,
          active
        }
      });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await loadAdminData();

    toast("Status akun berhasil diperbarui.");
    render();

  } catch (error) {
    console.error("[TOGGLE USER]", error);
    toast(error.message || "Gagal mengubah status akun.");
  }
}

adm.dashboard = () => {

    const paid = db.orders.filter(isPaid), low = db.products.filter(p => p.stock <= p.min);
    const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return { d, v: sum(paid.filter(o => (o.paidAt || "").slice(0, 10) === d), o => o.total) }; });
    const max = Math.max(...days.map(x => x.v), 1);
    return `<div class="stats">${stat("Produk", db.products.length)}${stat("Customer", db.customers.length)}${stat("Total pesanan", db.orders.length)}
      ${stat("Menunggu konfirmasi", db.orders.filter(o => o.status === FLOW[0]).length, "warn")}${stat("Menunggu verifikasi bayar", db.orders.filter(o => o.pay === "Menunggu Verifikasi" && o.status !== BATAL).length, "warn")}
      ${stat("Penjualan terbayar", money(sum(paid, o => o.total)))}${stat("Stok menipis", low.length, low.length ? "warn" : "")}</div>
      <div class="panel"><h3>Penjualan terbayar, 7 hari terakhir</h3><div class="bars">${days.map(x => `<div><i style="height:${x.v / max * 100}%" title="${money(x.v)}"></i><small>${x.d.slice(5)}</small></div>`).join("")}</div></div>
      <div class="panel"><h3>Pesanan terbaru</h3>${table(["Pesanan", "Customer", "Total", "Status"], db.orders.slice(0, 6).map(o => `<tr><td>${o.id}</td><td>${esc(o.name)}</td><td>${money(o.total)}</td><td><span class="tag ${statusTag(o.status)}">${o.status}</span></td></tr>`))}</div>`;
  };

  adm.products = () => `<div class="panel"><div class="row between"><h3>Daftar produk</h3><button class="btn" onclick="productForm()">Tambah produk</button></div>
    ${table(["Produk", "Kategori", "Harga jual", "Modal", "Stok", "Status", ""], db.products.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td>${money(p.cost)}</td>
      <td>${p.stock} <small>(min ${p.min})</small></td><td><span class="tag ${p.active === false ? "bad" : "ok"}">${p.active === false ? "Nonaktif" : "Aktif"}</span></td>
      <td><button class="btn ghost sm" onclick="productForm('${p.id}')">Ubah</button><button class="btn ghost sm" onclick="toggleProduct('${p.id}')">${p.active === false ? "Aktifkan" : "Nonaktifkan"}</button><button class="btn red sm" onclick="deleteProduct('${p.id}')">Hapus</button></td></tr>`))}</div>`;

  function productForm(id) {
    const p = db.products.find(x => x.id === id) || {}, cats = allCategories();
    openModal(`<h3>${id ? "Ubah produk" : "Produk baru"}</h3><form class="fgrid" onsubmit="saveProduct(event,'${id || ""}')">
      <label>Nama<input id="fName" required value="${esc(p.name)}"></label>
      <label>Kategori<input id="fCat" list="catList" required value="${esc(p.category)}"><datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label>Harga jual<input id="fPrice" type="number" min="0" required value="${p.price ?? ""}"></label><label>Harga modal<input id="fCost" type="number" min="0" required value="${p.cost ?? ""}"></label>
      <label>${id ? "Stok (ubah lewat PO atau opname)" : "Stok awal"}<input id="fStock" type="number" min="0" step="1" required value="${p.stock ?? ""}" ${id ? "disabled" : ""}></label>
      <label>Batas minimum stok<input id="fMin" type="number" min="0" step="1" required value="${p.min ?? 3}"></label>
      <label>Bahan<input id="fMat" value="${esc(p.material)}"></label><label>Ukuran<input id="fSize" value="${esc(p.size)}"></label>
      <label>Warna<input id="fColor" value="${esc(p.color)}"></label><label>Foto produk<input id="fImg" type="file" accept="image/*"></label>
      <label class="full">Deskripsi<textarea id="fDesc" rows="3">${esc(p.desc)}</textarea></label>
      <div class="row full"><button class="btn">Simpan</button><button type="button" class="btn ghost" onclick="closeModal()">Batal</button></div></form>`);
  }

  async function uploadProductImage(file, productId) {
    if (!file) return null;

    if (!file.type.startsWith("image/")) {
      throw new Error("File harus berupa gambar.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Ukuran foto maksimal 5 MB.");
    }

    const extension =
      file.name.split(".").pop().toLowerCase();

    const filePath =
      `${productId}/${Date.now()}.${extension}`;

    const { error: uploadError } =
      await supabaseClient.storage
        .from("product-images")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true
        });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage
      .from("product-images")
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  adm.orders = () => `<div class="panel"><div class="tools"><select onchange="aFilter=this.value;render()"><option value="">Semua status</option>${[...FLOW, BATAL].map(s => `<option ${s === aFilter ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    ${table(["Pesanan", "Customer", "Total", "Pembayaran", "Status", ""], db.orders.filter(o => !aFilter || o.status === aFilter).map(o => `<tr><td><b>${o.id}</b><br><small>${fmt(o.created)}</small></td><td>${esc(o.name)}</td><td>${money(o.total)}</td>
      <td>${esc(o.method)}<br><small>${esc(o.pay)}</small>${o.refund ? `<br><small class="red">Refund: ${esc(o.refund)}</small>` : ""}</td><td><span class="tag ${statusTag(o.status)}">${o.status}</span></td><td><button class="btn ghost sm" onclick="adminOrder('${o.id}')">Kelola</button></td></tr>`))}</div>`;

  function printDoc(id, type) {
    const o = db.orders.find(x => x.id === id), sj = type === "sj", w = window.open("", "_blank");
    if (!o || (me().role === "customer" && o.userId !== me().id)) { w?.close(); return toast("Pesanan tidak ditemukan."); }
    if (!w) return toast("Izinkan pop-up untuk mencetak.");
    const u = userById(o.userId), paid = isPaid(o), at = now();
    const st = o.status === BATAL ? ["DIBATALKAN", "bad"] : paid ? ["LUNAS", "ok"] : ["BELUM LUNAS", "warn"];
    const noDoc = (sj ? "SJ-" : "INV-") + o.id.replace("JM-", "");
    const due = new Date(new Date(o.created).getTime() + 2 * 864e5).toLocaleDateString("id-ID", { dateStyle: "long" });
    const code = sig([type, o.id, o.total, o.created, o.status, o.items.map(i => [i.pid, i.qty, i.price])].join("|"));
    const spec = pid => { const p = db.products.find(x => x.id === pid) || {}; return [p.material, p.size, p.color].filter(Boolean).join(" · "); };
    const subtotal = sum(o.items, i => i.price * i.qty), qtyAll = sum(o.items, i => i.qty);
    const boxes = `<div class="d-meta">
      <div class="d-box"><h4>Data customer</h4><table>${drow("Nama akun", u.name || o.name)}${drow("ID customer", u.id ? custId(u) : "")}${drow("Username/email", u.username)}${drow("Telepon", u.phone || o.phone)}${u.company ? drow("Perusahaan", u.company) : ""}${u.npwp ? drow("NPWP", u.npwp) : ""}</table></div>
      <div class="d-box"><h4>Alamat pengiriman</h4><table>${drow("Penerima", o.name)}${drow("Telepon", o.phone)}${drow("Alamat", o.address)}${o.note ? drow("Catatan", o.note) : ""}</table></div>
      <div class="d-box"><h4>Rincian dokumen</h4><table>${drow("No. dokumen", noDoc)}${drow("No. pesanan", o.id)}${drow("Tanggal pesanan", fmt(o.created))}${drow("Tanggal terbit", fmt(at))}${!sj && !paid && o.method !== "COD" && o.status !== BATAL ? drow("Jatuh tempo", due) : ""}${drow("Status pesanan", o.status)}</table></div>
      <div class="d-box"><h4>${sj ? "Pengiriman" : "Pembayaran"}</h4><table>${sj
        ? drow("Kurir", o.courier) + drow("Kendaraan", o.vehicle) + drow("No. resi", o.resi) + drow("Tgl kirim", o.shipDate ? fmt(o.shipDate) : "")
        : drow("Metode", o.method) + drow("Status bayar", o.pay) + drow("Tanggal bayar", o.paidAt ? fmt(o.paidAt) : "") + (o.verifiedBy ? drow("Diverifikasi", o.verifiedBy) : "")}</table></div></div>`;
    const items = sj
      ? `<table class="d-items"><tr><th class="d-c">No</th><th>Nama barang</th><th>Spesifikasi</th><th class="d-c">Qty</th><th class="d-c">Kondisi baik</th></tr>${o.items.map((i, n) => `<tr><td class="d-c">${n + 1}</td><td>${esc(i.name)}</td><td>${esc(spec(i.pid)) || "-"}</td><td class="d-c">${i.qty}</td><td class="d-c">☐</td></tr>`).join("")}<tr><td colspan="3" class="d-r"><b>Total unit</b></td><td class="d-c"><b>${qtyAll}</b></td><td></td></tr></table>`
      : `<table class="d-items"><tr><th class="d-c">No</th><th>Deskripsi produk</th><th class="d-c">Qty</th><th class="d-r">Harga satuan</th><th class="d-r">Subtotal</th></tr>${o.items.map((i, n) => `<tr><td class="d-c">${n + 1}</td><td>${esc(i.name)}<small>${esc(spec(i.pid))}</small></td><td class="d-c">${i.qty}</td><td class="d-r">${money(i.price)}</td><td class="d-r">${money(i.price * i.qty)}</td></tr>`).join("")}</table>
        <table class="d-total"><tr><td>Subtotal</td><td class="d-r">${money(subtotal)}</td></tr><tr><td>Sudah dibayar</td><td class="d-r">${money(paid ? o.total : 0)}</td></tr><tr><td>${paid ? "Sisa tagihan" : "Total tagihan"}</td><td class="d-r">${money(paid ? 0 : o.total)}</td></tr></table>
        <div class="d-say">Terbilang: ${esc(terbilang(o.total).replace(/^./, c => c.toUpperCase()))} rupiah</div>`;
    const notes = sj
      ? ["Periksa jumlah dan kondisi barang saat diterima, lalu tanda tangani surat jalan ini.", "Keluhan kerusakan akibat pengiriman wajib disampaikan saat barang diterima."]
      : [!paid && o.method !== "COD" ? `Pembayaran ke ${COMPANY.bank} (atau QRIS ${COMPANY.name}), lalu unggah bukti pembayaran di akun Anda.` : "Terima kasih, pembayaran Anda telah kami catat.", "Barang yang sudah diterima dalam kondisi baik tidak dapat dikembalikan.", "Simpan invoice ini sebagai bukti pembelian."];
    const signs = sj
      ? `<div class="d-sign" style="grid-template-columns:repeat(3,1fr)"><div><small>Dibuat oleh</small>${esig(COMPANY.signer, "Admin gudang", at, code)}</div><div><small>Kurir / pengirim</small><div class="d-line">${esc(o.courier || "............")}</div></div><div><small>Diterima oleh</small><div class="d-line">${esc(o.name)}<br><small>Tanggal: ..............</small></div></div></div>`
      : `<div class="d-sign" style="grid-template-columns:1fr 1fr"><div><small>Customer</small><div class="d-line">${esc(o.name)}</div></div><div><small>Hormat kami</small>${esig(o.verifiedBy || COMPANY.signer, "Admin " + COMPANY.name, at, code)}</div></div>`;
    w.document.write(`<!doctype html><html lang="id"><meta charset="utf-8"><title>${sj ? "Surat Jalan" : "Invoice"} ${o.id}</title>
      <style>@page{size:A4;margin:14mm}body{margin:0;padding:16px}.bar{max-width:780px;margin:0 auto 12px;text-align:right}.bar button{padding:8px 16px;font:600 14px Arial;cursor:pointer}@media print{.bar{display:none}body{padding:0}}${DOC_CSS}</style>
      <div class="bar"><button onclick="print()">Cetak / Simpan PDF</button></div>
      <div class="d-page">${kop(sj ? "SURAT JALAN" : "INVOICE", noDoc, sj ? "" : `<div class="d-stamp ${st[1]}">${st[0]}</div>`)}${boxes}${items}
      <div class="d-note"><b>Catatan &amp; ketentuan</b><ol>${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ol></div>${signs}
      <div class="d-foot">Dokumen ini diterbitkan secara elektronik oleh sistem ${esc(COMPANY.name)} dan sah tanpa tanda tangan basah. Kode verifikasi: ${code}. Dicetak ${fmt(at)}.</div></div></html>`);
    w.document.close(); setTimeout(() => w.print(), 400);
  }

  adm.stock = () => {
    const low = db.products.filter(p => p.stock <= p.min);
    return `<div class="stats">${stat("Nilai persediaan (modal)", money(sum(db.products, p => p.stock * (p.cost || 0))))}${stat("Stok menipis", low.length, low.length ? "warn" : "")}${stat("Stok habis", db.products.filter(p => p.stock <= 0).length)}</div>
    ${low.length ? `<div class="alert">Perlu restock: ${low.map(p => `<b>${esc(p.name)}</b> (${p.stock})`).join(", ")}. <a onclick="adminTab='po';render()">Buat purchase order</a></div>` : ""}
    <div class="panel"><h3>Stok produk</h3>${table(["Produk", "Stok", "Minimum", "Status", "Nilai"], db.products.map(p => { const [t, c] = stockInfo(p); return `<tr><td>${esc(p.name)}</td><td>${p.stock}</td><td>${p.min}</td><td><span class="tag ${c}">${t}</span></td><td>${money(p.stock * (p.cost || 0))}</td></tr>`; }))}</div>
    <div class="panel"><h3>Riwayat pergerakan stok</h3>${table(["Waktu", "Produk", "Jenis", "Jumlah", "Keterangan"], db.moves.slice(-40).reverse().map(m => `<tr><td>${fmt(m.at)}</td><td>${esc(m.name)}</td><td>${esc(m.type)}</td><td>${m.qty}</td><td>${esc(m.note)}</td></tr>`))}</div>`;
  };


  adm.po = () => `
    <div class="panel">
      <h3>Buat purchase order</h3>

      <form class="fgrid" onsubmit="savePO(event)">

  <label>Supplier
    <input
      id="poSup"
      type="text"
      list="supplierOptions"
      placeholder="Pilih atau ketik nama supplier..."
      autocomplete="off"
      required
    >
    <datalist id="supplierOptions">
      ${db.suppliers.map(s => `
        <option value="${esc(s.name)}"></option>
      `).join("")}
    </datalist>
  </label>


        <label>Produk
          <select id="poProd" required>
            ${db.products.filter(p => p.active !== false).map(p => `
              <option value="${p.id}">${esc(p.name)}</option>
            `).join("")}
          </select>
        </label>

        <label>Jumlah
          <input id="poQty" type="number" min="1" step="1" required>
        </label>

        <label>Harga beli per unit
          <input id="poCost" type="number" min="0" step="1" required>
        </label>

        <label>Tanggal pesan
          <input id="poDate" type="date" required
            value="${now().slice(0, 10)}">
        </label>

        <label>Estimasi tiba
          <input id="poEta" type="date">
        </label>

        <label class="full">Catatan
          <input id="poNote">
        </label>

        <button class="btn full">Simpan PO</button>
      </form>
    </div>

    <div class="panel">
      <h3>Daftar PO</h3>

      ${table(
        ["Nomor PO", "Supplier", "Produk", "Pesan", "Diterima", "Estimasi", "Status", "Aksi"],
        db.pos.flatMap(po =>
          po.items.map(item => `
            <tr>
              <td>${esc(po.number)}</td>
              <td>${esc(po.supplier)}</td>
              <td>${esc(item.productName)}</td>
              <td>${item.qty}</td>
              <td>${item.received}</td>
              <td>${esc(po.eta || "-")}</td>
              <td>${esc(po.status)}</td>
              <td>
                ${po.status === "Menunggu"
                  ? `<button class="btn ghost sm"
                      onclick="poAction('${po.id}','order')">
                      Tandai dipesan
                    </button>`
                  : ""}

                ${["Dipesan ke Supplier", "Sebagian Diterima"].includes(po.status)
                  ? `<button class="btn sm"
                      onclick="receivePO('${item.id}')">
                      Terima barang
                    </button>`
                  : ""}

                ${["Menunggu", "Dipesan ke Supplier"].includes(po.status)
                  ? `<button class="btn red sm"
                      onclick="poAction('${po.id}','cancel')">
                      Batalkan
                    </button>`
                  : ""}
              </td>
            </tr>
          `)
        )
      )}
    </div>
  `;


  adm.opname = () => `<div class="panel"><h3>Hitung stok fisik</h3><form class="fgrid" onsubmit="saveOpname(event)">
    <label>Produk<select id="opProd">${db.products.map(p => `<option value="${p.id}">${esc(p.name)} (sistem: ${p.stock})</option>`).join("")}</select></label>
    <label>Stok fisik di gudang<input id="opQty" type="number" min="0" step="1" required></label>
    <label class="full">Penyebab selisih (wajib jika ada selisih)<input id="opNote"></label><button class="btn full">Hitung selisih &amp; sesuaikan</button></form></div>
    <div class="panel"><h3>Riwayat stock opname</h3>${table(["Waktu", "Produk", "Sebelum", "Fisik", "Selisih", "Catatan", "Oleh"], db.opnames.map(x => `<tr><td>${fmt(x.at)}</td><td>${esc(x.name)}</td><td>${x.before}</td><td>${x.physical}</td><td>${x.diff > 0 ? "+" : ""}${x.diff}</td><td>${esc(x.note)}</td><td>${esc(x.by)}</td></tr>`))}</div>`;

  /* --- Laporan --- */
  let rep = { from: "", to: "" };
  const inRange = d => { const x = (d || "").slice(0, 10); return (!rep.from || x >= rep.from) && (!rep.to || x <= rep.to); };
  const paidInRange = () => db.orders.filter(o => isPaid(o) && inRange(o.paidAt));

  adm.reports = () => {
    const paid = paidInRange(), rev = sum(paid, o => o.total), cogs = sum(paid, o => sum(o.items, i => i.cost * i.qty));
    const buy = sum(
    db.pos,
    po => sum(
      po.items || [],
      item => sum(
        item.receipts || [],
        r => inRange(r.at) ? r.qty * item.cost : 0
      )
    )
  );
    const spend = sum(db.expenses.filter(x => inRange(x.date)), x => x.amount);
    const pending = db.orders.filter(o => !isPaid(o) && o.status !== BATAL && inRange(o.created)), top = {};
    paid.forEach(o => o.items.forEach(i => top[i.name] = (top[i.name] || 0) + i.qty));
    return `<div class="panel noprint repbar">
      <div class="repfield"><label for="repFrom">Dari tanggal</label><input id="repFrom" type="date" value="${rep.from}" onchange="rep.from=this.value;render()"></div>
      <div class="repfield"><label for="repTo">Sampai tanggal</label><input id="repTo" type="date" value="${rep.to}" onchange="rep.to=this.value;render()"></div>
      <div class="repactions"><button class="btn ghost" onclick="rep={from:'',to:''};render()">Reset</button><button class="btn" onclick="exportCSV()">Unduh CSV</button><button class="btn ghost" onclick="print()">Cetak / simpan PDF</button></div></div>
    ${reportHead()}
    <div class="stats">${stat("Pendapatan (sudah dibayar)", money(rev))}${stat("Laba kotor", money(rev - cogs))}${stat("Pembelian supplier", money(buy))}${stat("Pengeluaran operasional", money(spend))}${stat("Kas bersih", money(rev - buy - spend))}
      ${stat("Pendapatan COD", money(sum(paid.filter(o => o.method === "COD"), o => o.total)))}${stat("Pendapatan non-COD", money(sum(paid.filter(o => o.method !== "COD"), o => o.total)))}${stat("Belum terealisasi", money(sum(pending, o => o.total)), "warn")}</div>
    <div class="panel"><h3>Produk terlaris</h3>${table(["Produk", "Terjual"], Object.entries(top).sort((a, b) => b[1] - a[1]).map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td></tr>`))}</div>
    <div class="panel"><h3>Penjualan terbayar</h3>${table(["Pesanan", "Tanggal bayar", "Metode", "Total"], paid.map(o => `<tr><td>${o.id}</td><td>${fmt(o.paidAt)}</td><td>${o.method}</td><td>${money(o.total)}</td></tr>`))}</div>
    <div class="panel"><h3>Riwayat aktivitas</h3>${table(["Waktu", "Oleh", "Aktivitas"], db.log.slice(0, 25).map(l => `<tr><td>${fmt(l.at)}</td><td>${esc(l.by)}</td><td>${esc(l.text)}</td></tr>`))}</div>${reportFoot()}`;
  };
  const period = () => rep.from || rep.to ? `${rep.from || "awal"} s.d. ${rep.to || "sekarang"}` : "Semua periode";
  const reportHead = () => `<div class="onlyprint d-page"><style>${DOC_CSS}</style>${kop("LAPORAN PENJUALAN", "Periode: " + esc(period()))}
    <div class="d-meta"><div class="d-box"><h4>Informasi laporan</h4><table>${drow("Periode", period())}${drow("Dicetak oleh", me().name)}${drow("Waktu cetak", fmt(now()))}</table></div>
    <div class="d-box"><h4>Catatan</h4><table>${drow("Dasar data", "Pesanan yang sudah dibayar")}${drow("Mata uang", "Rupiah (IDR)")}</table></div></div></div>`;
  function reportFoot() {
    const p = paidInRange(), code = sig("LAP|" + period() + "|" + p.length + "|" + sum(p, o => o.total));
    return `<div class="onlyprint d-page"><div class="d-sign" style="grid-template-columns:1fr 1fr"><div><small>Dibuat oleh</small>${esig(me().name, me().role === "admin" ? "Administrator" : "Staff", now(), code)}</div>
      <div><small>Disetujui oleh</small><div class="d-line">${esc(COMPANY.owner)}<br><small>Pimpinan</small></div></div></div>
      <div class="d-foot">Laporan ini dihasilkan otomatis oleh sistem ${esc(COMPANY.name)}. Kode verifikasi: ${code}.</div></div>`;
  }
  function exportCSV() {
    const p = paidInRange(), q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["LAPORAN PENJUALAN " + COMPANY.name.toUpperCase()], ["Periode", period()], ["Diunduh oleh", me().name], ["Waktu unduh", fmt(now())], [],
      ["No", "Pesanan", "Tanggal bayar", "Customer", "Telepon", "Metode", "Status bayar", "Total (Rp)"],
      ...p.map((o, i) => [i + 1, o.id, fmt(o.paidAt), o.name, o.phone, o.method, o.pay, o.total]), [], ["", "", "", "", "", "", "TOTAL", sum(p, o => o.total)]];
    const csv = rows.map(r => r.map(q).join(";")).join("\r\n");   // pemisah titik koma agar terbuka rapi di Excel Indonesia
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "laporan-penjualan-jaya-mebel.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  adm.categories = () => {
    const baris = allCategories().map(nama => {
      const jumlah = db.products.filter(p => p.category === nama).length;
      return `<tr>
        <td>${esc(nama)}</td>
        <td>${jumlah} produk</td>
        <td>
          <button class="btn ghost sm" data-nama="${esc(nama)}" onclick="renameCategory(this.dataset.nama)">Ubah nama</button>
          <button class="btn red sm" data-nama="${esc(nama)}" onclick="deleteCategory(this.dataset.nama)">Hapus</button>
        </td>
      </tr>`;
    });

    return `<div class="panel">
        <h3>Tambah kategori</h3>
        <form class="row" onsubmit="addCategory(event)">
          <input id="catName" placeholder="Nama kategori" required style="max-width:280px">
          <button class="btn">Tambah</button>
        </form>
      </div>
      <div class="panel">${table(["Kategori", "Jumlah produk", ""], baris)}</div>`;
  };

  const sechead = (t, d) => `<div class="sechead"><h3>${t}</h3><small>${d}</small></div>`;
  pages.account = u => {
    const groups = [["Ringkasan", [["overview", "Ringkasan akun"]]], ["Belanja", [["orders", "Pesanan saya"], ["docs", "Invoice &amp; dokumen"], ["wish", "Favorit"], ["reviews", "Ulasan saya"]]], ["Pengaturan", [["profile", "Data diri"], ["address", "Buku alamat"], ["security", "Keamanan"]]]];
    const views = { overview: accountOverview, orders: accountOrders, docs: accountDocs, wish: accountWishlist, reviews: accountReviews, profile: accountProfile, address: accountAddresses, security: accountSecurity };
    if (!views[accTab]) accTab = "overview";
    const nav = groups.map(([g, items]) => `<h4 class="ghead">${g}</h4>${items.map(([k, n]) => `<button class="${accTab === k ? "on" : ""}" onclick="accTab='${k}';render()">${n}</button>`).join("")}`).join("");
    const since = u.created ? new Date(u.created).toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "-";
    return `<section class="wrap"><div class="acchead"><div class="avatar">${esc(u.name[0] || "?")}</div><div><h2 style="margin:0">Halo, ${esc(u.name.split(" ")[0])}</h2><small>${custId(u)} · ${esc(u.username)} · anggota sejak ${since}</small></div></div>
      <div class="acc"><aside class="accnav panel">${nav}<button class="out" onclick="logout()">Keluar</button></aside><div class="accbody">${views[accTab](u)}</div></div></section>`;
  };

  function accountOverview(u) {
    const mine = db.orders.filter(o => o.userId === u.id), run = mine.filter(o => o.status !== BATAL && o.status !== FLOW[4]), todo = [];
    mine.filter(o => o.pay === "Ditolak" && o.status !== BATAL).forEach(o => todo.push(`Bukti bayar <b>${o.id}</b> ditolak. <a onclick="go('order','${o.id}')">Unggah ulang</a>`));
    mine.filter(o => o.status === FLOW[3]).forEach(o => todo.push(`Pesanan <b>${o.id}</b> sedang dikirim${o.resi ? ", resi " + esc(o.resi) : ""}. <a onclick="go('order','${o.id}')">Lacak</a>`));
    mine.filter(o => o.status === FLOW[4] && o.items.some(i => !db.reviews.some(r => r.orderId === o.id && r.productId === i.pid))).forEach(o => todo.push(`Pesanan <b>${o.id}</b> selesai. <a onclick="go('order','${o.id}')">Beri ulasan</a>`));
    return sechead("Ringkasan akun", "Gambaran singkat aktivitas belanja Anda.") +
      `<div class="stats">${stat("Total pesanan", mine.length)}${stat("Sedang berjalan", run.length, run.length ? "warn" : "")}${stat("Total belanja", money(sum(mine.filter(isPaid), o => o.total)))}${stat("Favorit", myWishlist().length)}</div>` +
      (todo.length ? `<div class="alert"><b>Perlu tindakan Anda</b><br>${todo.join("<br>")}</div>` : "") +
      `<div class="panel"><h3>Pesanan terakhir</h3>${mine.map(o => `<div class="line"><div class="grow"><b>${o.id}</b><br><small>${fmt(o.created)}</small></div><span class="tag ${statusTag(o.status)}">${o.status}</span><b>${money(o.total)}</b><button class="btn ghost sm" onclick="go('order','${o.id}')">Detail</button></div>`).join("") || `<div class="empty">Belum ada pesanan. <a onclick="go('catalog')">Mulai belanja</a></div>`}</div>
      <div class="row"><button class="btn" onclick="go('catalog')">Lanjut belanja</button><button class="btn ghost" onclick="go('cart')">Lihat keranjang</button></div>`;
  }

  function accountDocs(u) {
    const list = db.orders.filter(o => o.userId === u.id);
    return sechead("Invoice &amp; dokumen", "Cetak atau simpan sebagai PDF. Surat jalan tersedia setelah pesanan dikirim.") +
      `<div class="panel">${table(["Pesanan", "Tanggal", "Total", "Dokumen"], list.map(o => `<tr><td><b>${o.id}</b><br><span class="tag ${statusTag(o.status)}">${o.status}</span></td><td>${fmt(o.created)}</td><td>${money(o.total)}</td><td><button class="btn ghost sm" onclick="printDoc('${o.id}','invoice')">Invoice</button>${o.courier ? `<button class="btn ghost sm" onclick="printDoc('${o.id}','sj')">Surat jalan</button>` : ""}</td></tr>`))}</div>`;
  }

  function accountReviews(u) {
    const mine = db.reviews.filter(r => r.userId === u.id), wait = [];
    db.orders.filter(o => o.userId === u.id && o.status === FLOW[4]).forEach(o => o.items.forEach(i => { if (!db.reviews.some(r => r.orderId === o.id && r.productId === i.pid)) wait.push([o, i]); }));
    return sechead("Ulasan saya", "Bantu pembeli lain dengan menilai produk yang sudah Anda terima.") +
      `<div class="panel"><h3>Menunggu ulasan</h3>${wait.map(([o, i]) => `<div class="line"><div class="grow"><b>${esc(i.name)}</b><br><small>Pesanan ${o.id}</small></div><button class="btn sm" onclick="go('order','${o.id}')">Beri ulasan</button></div>`).join("") || "<small>Tidak ada yang menunggu.</small>"}</div>
      <div class="panel"><h3>Ulasan terkirim</h3>${mine.map(r => `<div class="rv"><b>${esc((db.products.find(p => p.id === r.productId) || {}).name || "Produk")}</b><br><span class="stars">${stars(r.rating)}</span> <small>${fmt(r.at)}</small><p>${esc(r.text) || "<small>Tanpa komentar</small>"}</p></div>`).join("") || "<small>Belum ada ulasan.</small>"}</div>`;
  }

  function accountOrders(u) {
    const daftar = db.orders.filter(o => o.userId === u.id && (!ordFilter || o.status === ordFilter));
    const pilihanStatus = [...FLOW, BATAL].map(s => `<option ${s === ordFilter ? "selected" : ""}>${s}</option>`).join("");
    const filterBox = `<div class="tools"><select onchange="ordFilter=this.value;render()"><option value="">Semua status</option>${pilihanStatus}</select></div>`;

    if (!daftar.length) {
      return filterBox + `<div class="empty">Belum ada pesanan. <a onclick="go('catalog')">Mulai belanja</a></div>`;
    }
    const baris = daftar.map(o => `<div class="line">
        <div class="grow"><b>${o.id}</b><br><small>${fmt(o.created)}</small></div>
        <span class="tag ${statusTag(o.status)}">${o.status}</span>
        <b>${money(o.total)}</b>
        <button class="btn ghost sm" onclick="go('order','${o.id}')">Detail</button><button class="btn ghost sm" onclick="printDoc('${o.id}','invoice')">Invoice</button><button class="btn ghost sm" onclick="reorder('${o.id}')">Beli lagi</button>
      </div>`).join("");
    return filterBox + baris;
  }

  function accountWishlist() {
    const produk = myWishlist().map(id => db.products.find(p => p.id === id)).filter(p => p && p.active !== false);
    if (!produk.length) return `<div class="empty">Belum ada favorit. Tekan ikon hati pada produk untuk menyimpannya.</div>`;
    return `<div class="grid">${produk.map(card).join("")}</div>`;
  }

  function accountSecurity(u) {
    return sechead("Keamanan", "Ganti password secara berkala.") +
      `<form class="panel" onsubmit="changePassword(event)"><label>Password saat ini<input id="sOld" type="password" required autocomplete="current-password"></label>
        <label>Password baru (min. 6 karakter)<input id="sNew" type="password" minlength="6" required autocomplete="new-password"></label><label>Ulangi password baru<input id="sNew2" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn">Ubah password</button></form>
      <div class="panel"><h3>Aktivitas akun</h3><small>Login terakhir: ${u.lastLogin ? fmt(u.lastLogin) : "-"}<br>Akun dibuat: ${u.created ? fmt(u.created) : "-"}</small></div>`;
  }

async function changePassword(e) {
  e.preventDefault();

  const u = me();
  const oldPassword = $("sOld").value;
  const newPassword = $("sNew").value;
  const confirmPassword = $("sNew2").value;

  if (!u || !u.email) {
    return toast("Sesi akun tidak ditemukan. Silakan login ulang.");
  }

  if (newPassword.length < 6) {
    return toast("Password baru minimal 6 karakter.");
  }

  if (newPassword !== confirmPassword) {
    return toast("Konfirmasi password tidak sama.");
  }

  try {
    const { error: verifyError } =
      await supabaseClient.auth.signInWithPassword({
        email: u.email,
        password: oldPassword
      });

    if (verifyError) {
      throw new Error("Password saat ini salah.");
    }

    const { error: updateError } =
      await supabaseClient.auth.updateUser({
        password: newPassword
      });

    if (updateError) throw updateError;

    $("sOld").value = "";
    $("sNew").value = "";
    $("sNew2").value = "";

    toast("Password berhasil diperbarui.");

  } catch (error) {
    console.error("[CHANGE PASSWORD]", error);
    toast(error.message || "Gagal mengganti password.");
  }
}

  function reuploadBox(o) {
    if (o.pay !== "Ditolak" || o.status === BATAL) return "";
    return `<div class="alert">Bukti pembayaran ditolak. Unggah bukti yang baru:<br>
        <input type="file" id="newProof" accept="image/*" style="margin:8px 0">
        <button class="btn sm" onclick="reuploadProof('${o.id}')">Kirim ulang bukti</button>
      </div>`;
  }

  function stepper(o) {
    if (o.status === BATAL) return "";
    const sekarang = FLOW.indexOf(o.status);
    const nama = ["Menunggu", "Dikonfirmasi", "Diproses", "Dikirim", "Selesai"];
    return `<div class="stepper">${nama.map((n, i) => `<div class="step ${i <= sekarang ? "done" : ""}"><span></span><small>${n}</small></div>`).join("")}</div>`;
  }

  pages.cart = () => {
    const semua = cartItems();
    if (!semua.length) {
      return `<section class="wrap narrow"><h2>Keranjang</h2><div class="empty">Keranjang masih kosong. <a onclick="go('catalog')">Pilih produk</a></div></section>`;
    }
    const dipilih = selectedItems();
    const semuaTercentang = dipilih.length === semua.length;

    const baris = semua.map(({ p, q }) => `<div class="line">
        <input type="checkbox" class="check" ${unchecked.has(p.id) ? "" : "checked"} onchange="toggleCheck('${p.id}')">
        <div class="mini">${thumb(p)}</div>
        <div class="grow"><b>${esc(p.name)}</b><br><small>${money(p.price)}</small>
          ${q > p.stock ? `<br><small class="red">Stok tinggal ${p.stock}, kurangi jumlahnya</small>` : ""}</div>
        <div class="qtybox"><button onclick="setQty('${p.id}',${q - 1})">−</button><span>${q}</span><button onclick="setQty('${p.id}',${q + 1})">+</button></div>
        <b>${money(p.price * q)}</b>
        <button class="btn ghost sm" onclick="setQty('${p.id}',0)">Hapus</button>
      </div>`).join("");

    return `<section class="wrap two">
      <div>
        <h2>Keranjang</h2>
        <label class="row" style="margin-bottom:6px"><input type="checkbox" class="check" ${semuaTercentang ? "checked" : ""} onchange="toggleAll(this.checked)"> Pilih semua</label>
        ${baris}
      </div>
      <aside class="panel">
        <h3>Ringkasan</h3>
        <p><small>${dipilih.length} dari ${semua.length} produk dipilih</small></p>
        <div class="sum"><span>Total</span><b>${money(cartTotal())}</b></div>
        <button class="btn" onclick="goCheckout()" ${dipilih.length ? "" : "disabled"}>Checkout (${dipilih.length})</button>
        <p style="margin-top:10px"><small>Produk yang tidak dicentang tetap ada di keranjang untuk dibeli nanti.</small></p>
      </aside>
    </section>`;
  };

  function toggleCheck(productId) {
    if (unchecked.has(productId)) unchecked.delete(productId);
    else unchecked.add(productId);
    render();
  }

  function toggleAll(centang) {
    cartItems().forEach(i => centang ? unchecked.delete(i.p.id) : unchecked.add(i.p.id));
    render();
  }

  function adminCancelForm(orderId) {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    openModal(`<h3>Batalkan ${o.id}</h3>
      <form onsubmit="submitAdminCancel(event,'${o.id}')">
        <label>Alasan
          <select id="cancelReason">
            <option>Stok tidak tersedia</option>
            <option>Pembayaran tidak valid</option>
            <option>Permintaan customer</option>
            <option>Alamat di luar jangkauan</option>
            <option>Lainnya</option>
          </select>
        </label>
        <label>Keterangan tambahan (opsional)<textarea id="cancelNote" rows="3"></textarea></label>
        <div class="row">
          <button class="btn red">Batalkan pesanan</button>
          <button type="button" class="btn ghost" onclick="closeModal()">Kembali</button>
        </div>
      </form>`);
  }

  const ADMIN_ONLY = ["staff", "backup"];     // menu ini hanya boleh dibuka admin utama

  // Admin boleh semua menu. Staff hanya menu yang dicentang saat akunnya dibuat.
  function canOpen(u, tab) {
    if (u.role === "admin") return true;
    if (ADMIN_ONLY.includes(tab)) return false;
    return (u.perms || []).includes(tab);
  }


  /* ---------- KATEGORI (tabel categories) ---------- */
  const allCategories = () => db.categoryRows.map(c => c.name);

  async function addCategory(e) {
    e.preventDefault();
    const nama = $("catName").value.trim();
    if (allCategories().some(c => c.toLowerCase() === nama.toLowerCase())) return toast("Kategori sudah ada.");
    try {
      await ensureCategory(nama);
      log("Menambah kategori " + nama);
      await loadCatalog();
      render();
    } catch (error) { toast(error.message); }
  }

  function renameCategory(namaLama) {
    const row = db.categoryRows.find(c => c.name === namaLama);
    if (!row) return;
    ask("Ubah nama kategori", [{ k: "nama", label: "Nama baru", req: 1 }], async v => {
      const namaBaru = v.nama.trim();
      if (allCategories().some(c => c !== namaLama && c.toLowerCase() === namaBaru.toLowerCase())) return toast("Nama kategori sudah dipakai.");
      const { error } = await supabaseClient.from("categories").update({ name: namaBaru }).eq("id", row.id);
      if (error) return toast(error.message);
      log(`Kategori ${namaLama} diganti menjadi ${namaBaru}`);
      await loadCatalog();
      render();
    });
  }

  async function deleteCategory(nama) {
    const row = db.categoryRows.find(c => c.name === nama);
    if (!row) return;
    if (db.products.some(p => p.category === nama)) return toast("Kategori masih dipakai produk.");
    if (!confirm("Hapus kategori ini?")) return;
    const { error } = await supabaseClient.from("categories").delete().eq("id", row.id);
    if (error) return toast(error.message);
    log("Menghapus kategori " + nama);
    await loadCatalog();
    render();
  }

  /* ---------- FAVORIT (tabel wishlist_items) ---------- */
  const myWishlist = () => db.wishlist;

  function heartButton(productId) {
    const aktif = myWishlist().includes(String(productId)) ? "on" : "";
    return `<button class="heart ${aktif}" onclick="toggleWish('${productId}')" title="Simpan ke favorit">♥</button>`;
  }

  async function toggleWish(productId) {
    const u = me();

    if (!u || u.role !== "customer") {
      toast("Masuk dulu untuk menyimpan favorit.");
      authMode = "login";
      return go("auth");
    }

    productId = String(productId);

    const sudah = db.wishlist.includes(productId);
    const sebelum = [...db.wishlist];

    // Perbarui tampilan sementara.
    db.wishlist = sudah
      ? db.wishlist.filter(id => id !== productId)
      : [...db.wishlist, productId];

    render();

    try {
      let result;

      if (sudah) {
        result = await supabaseClient
          .from("wishlists")
          .delete()
          .eq("user_id", u.id)
          .eq("product_id", productId);
      } else {
        result = await supabaseClient
          .from("wishlists")
          .insert({
            user_id: u.id,
            product_id: productId
          });
      }

      if (result.error) throw result.error;

      await loadMyExtras();
      render();

      toast(
        sudah
          ? "Produk dihapus dari favorit."
          : "Produk berhasil disimpan ke favorit."
      );

    } catch (error) {
      console.error("[WISHLIST]", error);

      db.wishlist = sebelum;
      render();

      toast("Favorit gagal diperbarui: " + error.message);
    }
  }


  /* ---------- BELI LAGI ---------- */
  async function reorder(id) {
    const o = db.orders.find(x => x.id === id && x.userId === me().id);
    if (!o) return;
    let n = 0;
    try {
      for (const i of o.items) {
        const p = db.products.find(x => x.id === i.pid);
        if (p && p.active !== false && p.stock > 0) {
          await JM_SUPABASE.addCart(i.pid, Math.min(p.stock, i.qty));
          unchecked.delete(p.id);
          n++;
        }
      }
      await syncCartFromSupabase();
      toast(n ? n + " produk dimasukkan ke keranjang." : "Produk pesanan ini sudah tidak tersedia.");
      if (n) go("cart");
    } catch (error) { toast(error.message || "Gagal memasukkan ke keranjang."); }
  }

  /* ---------- BUKU ALAMAT (tabel addresses) ---------- */
  const defaultAddress = () => (db.addresses.find(a => a.main) || db.addresses[0])?.text || "";

  function accountAddresses(u) {
    const baris = db.addresses.map(a => `<div class="line"><div class="grow"><b>${esc(a.label)}</b> ${a.main ? '<span class="tag ok">Utama</span>' : ""}<br><small>${a.receiver ? esc(a.receiver) + (a.phone ? ", " + esc(a.phone) : "") + "<br>" : ""}${esc(a.text)}</small></div>
        <button class="btn ghost sm" onclick="editAddress('${a.id}')">Ubah</button>${a.main ? "" : `<button class="btn ghost sm" onclick="mainAddress('${a.id}')">Jadikan utama</button>`}<button class="btn ghost sm" onclick="deleteAddress('${a.id}')">Hapus</button></div>`).join("");
    return sechead("Buku alamat", "Alamat utama otomatis terisi saat checkout.") +
      `<div class="panel"><h3>Alamat tersimpan</h3>${baris || "<small>Belum ada alamat tersimpan.</small>"}</div>
      <form class="panel" onsubmit="addAddress(event)"><h3>Tambah alamat</h3><div class="fgrid"><label>Nama alamat (Rumah, Kantor)<input id="adLabel" required></label><label>Nama penerima<input id="adRecv" required value="${esc(u.name)}"></label>
        <label>Telepon penerima<input id="adPhone" required value="${esc(u.phone)}"></label><label class="full">Alamat lengkap<textarea id="adText" rows="3" required></textarea></label></div><button class="btn">Simpan alamat</button></form>`;
  }


  async function addAddress(e) {
    e.preventDefault();

    const u = me();

    const { error } = await supabaseClient
      .from("addresses")
      .insert({
        user_id: u.id,
        note: $("adLabel").value.trim(),
        recipient_name: $("adRecv").value.trim(),
        phone: $("adPhone").value.trim(),
        address: $("adText").value.trim(),
        is_default: db.addresses.length === 0
      });

    if (error) return toast(error.message);

    await loadMyExtras();
    toast("Alamat berhasil disimpan.");
    render();
  }

  function editAddress(id) {
    const a = db.addresses.find(x => x.id === id);
    if (!a) return;
    openModal(`<h3>Ubah alamat</h3><form onsubmit="saveAddressEdit(event,'${a.id}')">
      <label>Nama alamat<input id="eLabel" required value="${esc(a.label)}"></label>
      <label>Nama penerima<input id="eRecv" required value="${esc(a.receiver)}"></label>
      <label>Telepon penerima<input id="ePhone" required value="${esc(a.phone)}"></label>
      <label>Alamat lengkap<textarea id="eText" rows="3" required>${esc(a.text)}</textarea></label>
      <div class="row"><button class="btn">Simpan perubahan</button><button type="button" class="btn ghost" onclick="closeModal()">Batal</button></div></form>`);
  }


  async function saveAddressEdit(e, id) {
    e.preventDefault();

    const phone = $("ePhone").value.trim();

    if (!/^[0-9+\-\s]{8,15}$/.test(phone)) {
      return toast("Nomor telepon tidak valid.");
    }

    const { error } = await supabaseClient
      .from("addresses")
      .update({
        note: $("eLabel").value.trim(),
        recipient_name: $("eRecv").value.trim(),
        phone,
        address: $("eText").value.trim()
      })
      .eq("id", id)
      .eq("user_id", me().id);

    if (error) return toast(error.message);

    await loadMyExtras();
    closeModal();
    toast("Alamat berhasil diperbarui.");
    render();
  }



  async function mainAddress(id) {
    const u = me();

    const { error: resetError } = await supabaseClient
      .from("addresses")
      .update({ is_default: false })
      .eq("user_id", u.id);

    if (resetError) return toast(resetError.message);

    const { error } = await supabaseClient
      .from("addresses")
      .update({ is_default: true })
      .eq("id", id)
      .eq("user_id", u.id);

    if (error) return toast(error.message);

    await loadMyExtras();
    toast("Alamat utama berhasil diubah.");
    render();
  }



  async function deleteAddress(id) {
    if (!confirm("Hapus alamat ini?")) return;

    const u = me();
    const wasMain = db.addresses.find(a => a.id === id)?.main;

    const { error } = await supabaseClient
      .from("addresses")
      .delete()
      .eq("id", id)
      .eq("user_id", u.id);

    if (error) return toast(error.message);

    await loadMyExtras();

    // Jika alamat utama dihapus, pilih alamat pertama sebagai alamat utama.
    if (wasMain && db.addresses.length > 0) {
      const { error: mainError } = await supabaseClient
        .from("addresses")
        .update({ is_default: true })
        .eq("id", db.addresses[0].id)
        .eq("user_id", u.id);

      if (mainError) return toast(mainError.message);

      await loadMyExtras();
    }

    toast("Alamat berhasil dihapus.");
    render();
  }


  // Pilihan alamat tersimpan di halaman checkout
  function addressPicker(u) {
    if (!db.addresses.length) return "";
    return `<label>Pilih alamat tersimpan
        <select onchange="pickAddress(this.value)"><option value="">Isi alamat baru</option>${db.addresses.map((a, i) => `<option value="${i}">${esc(a.label)}${a.main ? " (utama)" : ""}</option>`).join("")}</select>
      </label>`;
  }
  function pickAddress(i) {
    const a = db.addresses[i];
    if (!a) return;
    $("rAddr").value = a.text;
    if (a.receiver) $("rName").value = a.receiver;
    if (a.phone) $("rPhone").value = a.phone;
  }

  /* ---------- DATA DIRI ---------- */
  function accountProfile(u) {
    return sechead("Data diri", "Data ini tercetak pada invoice Anda.") +
      `<form class="panel" onsubmit="saveProfile(event)"><div class="fgrid"><label>Nama lengkap<input id="pName" required value="${esc(u.name)}"></label><label>Email (untuk login)<input value="${esc(u.email || "")}" disabled></label>
        <label>Nomor telepon<input id="pPhone" required value="${esc(u.phone)}"></label><label>Nama perusahaan (opsional)<input id="pCompany" value="${esc(u.company || "")}"></label>
        <label>NPWP (opsional)<input id="pNpwp" value="${esc(u.npwp || "")}"></label></div><button class="btn">Simpan perubahan</button></form>`;
  }

  async function saveProfile(e) {
    e.preventDefault();

    const u = me();

    if (!u) {
      return toast("Silakan login terlebih dahulu.");
    }

    const fullName = $("pName").value.trim();
    const phone = $("pPhone").value.trim();

    // Validasi nama
    if (!fullName) {
      return toast("Nama lengkap wajib diisi.");
    }

    // Validasi nomor telepon
    if (!/^[0-9+\-\s]{8,15}$/.test(phone)) {
      return toast("Nomor telepon tidak valid.");
    }

    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .update({
          full_name: fullName,
          phone: phone,
          updated_at: new Date().toISOString()
        })
        .eq("id", u.id)
        .select("id, full_name, phone")
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("Data profil tidak ditemukan.");
      }

      // Perbarui cache tampilan setelah database berhasil diperbarui
      Object.assign(u, {
        name: data.full_name,
        phone: data.phone || ""
      });

      toast("Profil berhasil diperbarui di database.");

      render();

    } catch (error) {
      console.error("[SAVE PROFILE]", error);

      toast(
        "Gagal memperbarui profil: " +
        (error.message || "Terjadi kesalahan database.")
      );
    }
  }


  /* ---------- PENGELUARAN OPERASIONAL (staff: tambah saja; admin utama: ubah & hapus) ---------- */
  const EXPENSE_TYPES = ["Gaji", "Listrik & air", "Transportasi", "Sewa", "Lainnya"];

  adm.expenses = () => {
    const admin = me().role === "admin";
    const baris = db.expenses.map(x => `<tr>
        <td>${esc(x.date)}</td><td>${esc(x.type)}</td><td>${esc(x.note)}${x.by ? `<br><small>dicatat oleh ${esc(x.by)}</small>` : ""}</td><td>${money(x.amount)}</td>
        <td>${admin ? `<button class="btn ghost sm" onclick="editExpense('${x.id}')">Ubah</button><button class="btn red sm" onclick="deleteExpense('${x.id}')">Hapus</button>` : ""}</td>
      </tr>`);
    return `<div class="panel">
        <h3>Catat pengeluaran</h3>
        <form class="fgrid" onsubmit="saveExpense(event)">
          <label>Tanggal<input id="exDate" type="date" required value="${now().slice(0, 10)}"></label>
          <label>Jenis<select id="exType">${EXPENSE_TYPES.map(t => `<option>${esc(t)}</option>`).join("")}</select></label>
          <label>Jumlah (Rp)<input id="exAmount" type="number" min="1" required></label>
          <label>Keterangan<input id="exNote"></label>
          <button class="btn full">Simpan pengeluaran</button>
        </form>
      </div>
      <div class="panel"><h3>Riwayat pengeluaran</h3>${admin ? "" : `<p class="hint">Staff hanya dapat menambah catatan. Perubahan dan penghapusan dilakukan admin utama.</p>`}${table(["Tanggal", "Jenis", "Keterangan", "Jumlah", ""], baris)}</div>`;
  };


  async function saveExpense(e) {
    e.preventDefault();

    const amount = Number($("exAmount").value);

    if (!(amount > 0)) {
      return toast("Jumlah harus lebih dari 0.");
    }

    const u = me();

    const { error } = await supabaseClient
      .from("expenses")
      .insert({
        expense_date: $("exDate").value,
        category: $("exType").value,
        amount,
        note: $("exNote").value.trim(),
        created_by: u.id
      });

    if (error) {
      console.error("[SAVE EXPENSE]", error);
      return toast("Gagal menyimpan pengeluaran: " + error.message);
    }

    log("Mencatat pengeluaran " + $("exType").value);

    await loadAdminData();

    toast("Pengeluaran berhasil disimpan.");
    render();
  }

  function editExpense(id) {
    if (me().role !== "admin") return toast("Hanya admin utama yang boleh mengubah pengeluaran.");
    const x = db.expenses.find(v => v.id === id);
    if (!x) return;
    openModal(`<h3>Ubah pengeluaran</h3><form onsubmit="saveExpenseEdit(event,'${x.id}')">
      <label>Tanggal<input id="xDate" type="date" required value="${esc(x.date)}"></label>
      <label>Jenis<select id="xType">${EXPENSE_TYPES.map(t => `<option ${t === x.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Jumlah (Rp)<input id="xAmount" type="number" min="1" required value="${x.amount}"></label>
      <label>Keterangan<input id="xNote" value="${esc(x.note)}"></label>
      <div class="row"><button class="btn">Simpan perubahan</button><button type="button" class="btn ghost" onclick="closeModal()">Batal</button></div></form>`);
  }


  async function saveExpenseEdit(e, id) {
    e.preventDefault();

    if (me().role !== "admin") {
      return toast("Hanya admin utama yang boleh mengubah pengeluaran.");
    }

    const amount = Number($("xAmount").value);

    if (!(amount > 0)) {
      return toast("Jumlah harus lebih dari 0.");
    }

    const { data, error } = await supabaseClient
      .from("expenses")
      .update({
        expense_date: $("xDate").value,
        category: $("xType").value,
        amount,
        note: $("xNote").value.trim()
      })
      .eq("id", id)
      .select("id");

    if (error) {
      console.error("[EDIT EXPENSE]", error);
      return toast("Gagal memperbarui pengeluaran: " + error.message);
    }

    if (!data?.length) {
      return toast("Perubahan tidak berhasil. Periksa hak akses database.");
    }

    log("Mengubah catatan pengeluaran " + $("xType").value);

    await loadAdminData();

    closeModal();
    toast("Pengeluaran berhasil diperbarui.");
    render();
  }


  async function deleteExpense(id) {
    if (me().role !== "admin") return toast("Hanya admin utama yang boleh menghapus pengeluaran.");
    if (!confirm("Hapus catatan pengeluaran ini?")) return;
    const { data, error } = await supabaseClient.from("expenses").delete().eq("id", id).select("id");
    if (error) return toast(error.message);
    if (!data?.length) return toast("Penghapusan ditolak database. Pastikan SQL setup sudah dijalankan.");
    log("Menghapus catatan pengeluaran");
    await loadAdminData();
    render();
  }

  /* ---------- STAFF (akun login Supabase + hak akses menu) ---------- */
  adm.staff = () => {
    const menuBoleh = TABS.filter(t => !ADMIN_ONLY.includes(t[0]));
    const centang = menuBoleh.map(([kode, nama]) =>
      `<label style="margin:0"><input type="checkbox" class="perm" value="${kode}" style="width:auto"> ${nama}</label>`).join("");
    const baris = db.staff.map(s => {
      const akses = (s.perms || []).map(k => TABS.find(t => t[0] === k)?.[1]).filter(Boolean).join(", ");
      return `<tr>
        <td><b>${esc(s.name)}</b><br><small>${esc(s.title || "")}</small></td>
        <td>${esc(s.email || s.username)}</td>
        <td><small>${esc(akses) || "-"}</small></td>
        <td><span class="tag ${s.active === false ? "bad" : "ok"}">${s.active === false ? "Nonaktif" : "Aktif"}</span></td>
        <td>
          <button class="btn ghost sm" onclick="staffAccess('${s.id}')">Atur akses</button>
          <button class="btn ghost sm" onclick="toggleUser('${s.id}')">${s.active === false ? "Aktifkan" : "Nonaktifkan"}</button>
          <button class="btn ghost sm" onclick="staffPassword('${s.id}')">Ubah password</button>
        </td>
      </tr>`;
    });
    return `<div class="panel">
        <h3>Buat akun staff</h3>
        <form class="fgrid" onsubmit="saveStaff(event)">
          <label>Nama<input id="stName" required></label>
          <label>Jabatan<input id="stTitle" placeholder="Contoh: Kasir, Gudang"></label>
          <label>Email (dipakai untuk login)<input id="stEmail" type="email" required placeholder="nama@email.com"></label>
          <label>Password (min. 6 karakter)<input id="stPass" type="password" minlength="6" required autocomplete="new-password"></label>
          <div class="full"><b>Menu yang boleh dibuka</b><div class="row" style="margin:8px 0 14px">${centang}</div></div>
          <button class="btn full">Simpan staff</button>
        </form>
      </div>
      <div class="panel"><h3>Daftar staff</h3>${table(["Nama", "Email login", "Akses menu", "Status", ""], baris)}</div>`;
  };

  async function saveStaff(e) {
    e.preventDefault();
    if (me()?.role !== "admin") {
    return toast("Hanya Admin Main yang boleh membuat staff.");
  }
    const btn = e.submitter;
    const email = $("stEmail").value.trim().toLowerCase();
    const name = $("stName").value.trim(), title = $("stTitle").value.trim(), password = $("stPass").value;
    const perms = [...document.querySelectorAll(".perm:checked")].map(c => c.value);
    if (!perms.length) return toast("Pilih minimal satu menu untuk staff.");
    if (btn) btn.disabled = true;
    try {
      // Klien kedua tanpa penyimpanan sesi: mendaftarkan akun staff TANPA mengeluarkan admin dari sesinya.
  const { data, error } = await supabaseClient.functions.invoke(
    "manage-staff",
    {
      body: {
        action: "create",
        name,
        email,
        password,
        title,
        perms
      }
    }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

      log("Membuat akun staff " + email);
      await loadAdminData();
      toast("Akun staff dibuat. Staff bisa login memakai email dan password tadi.");
      render();
    } catch (error) {
      console.error("[SAVE STAFF]", error);
      toast(error.message || "Akun staff gagal dibuat.");
      if (btn) btn.disabled = false;
    }
  }

  function staffAccess(id) {
    const s = db.staff.find(x => x.id === id);
    if (!s) return;
    const menuBoleh = TABS.filter(t => !ADMIN_ONLY.includes(t[0]));
    openModal(`<h3>Akses menu ${esc(s.name)}</h3><form onsubmit="saveStaffAccess(event,'${s.id}')">
      <label>Jabatan<input id="saTitle" value="${esc(s.title || "")}"></label>
      <div class="row" style="margin:8px 0 14px">${menuBoleh.map(([k, n]) => `<label style="margin:0"><input type="checkbox" class="permEdit" value="${k}" style="width:auto" ${(s.perms || []).includes(k) ? "checked" : ""}> ${n}</label>`).join("")}</div>
      <div class="row"><button class="btn">Simpan</button><button type="button" class="btn ghost" onclick="closeModal()">Batal</button></div></form>`);
  }
  async function saveStaffAccess(e, id) {
    e.preventDefault();
    const s = db.staff.find(x => x.id === id);
    const perms = [...document.querySelectorAll(".permEdit:checked")].map(c => c.value);
    if (!perms.length) return toast("Pilih minimal satu menu.");
    try {
      const { data, error } = await supabaseClient.functions.invoke(
    "manage-staff",
    {
      body: {
        action: "update",
        userId: id,
        name: s.name,
        title: $("saTitle").value.trim(),
        perms
      }
    }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
    await loadAdminData();
    closeModal();
    toast("Akses staff berhasil diperbarui.");
    render();
    } catch (error) { toast(error.message); }
  }

  function staffPassword(id) {
    ask("Ubah password staff", [{ k: "pass", label: "Password baru (min. 6 karakter)", type: "password", req: 1 }], async v => {
      if (v.pass.length < 6) return toast("Password minimal 6 karakter.");
      try {
        const { data, error } = await supabaseClient.functions.invoke(
    "manage-staff",
    {
      body: {
        action: "set_password",
        userId: id,
        password: v.pass
      }
    }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
        log("Mengubah password staff");
        toast("Password diubah.");
      } catch (error) { toast(error.message || "Password gagal diubah."); }
    });
  }

  /* ---------- EKSPOR DATA (data utama tersimpan di Supabase) ---------- */
  adm.backup = () => `<div class="panel">
      <h3>Ekspor data</h3>
      <p style="margin-bottom:12px">
        File ini merupakan ekspor data yang sudah dimuat di aplikasi,
        bukan backup penuh database Supabase. Untuk backup lengkap,
        gunakan fitur backup database Supabase.
      </p>      
      <button class="btn" onclick="downloadBackup()">Unduh salinan data</button>
    </div>`;

  function downloadBackup() {
    const { products, categories, orders, customers, staff, expenses, pos, opnames, moves } = db;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify({ products, categories, orders, customers, staff, expenses, pos, opnames, moves }, null, 2)], { type: "application/json" }));
    link.download = "data-jaya-mebel-" + now().slice(0, 10) + ".json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ---------- MULAI ---------- */
  // Menu admin baru ditambahkan ke daftar TABS (bagian Panel Admin)
  TABS.push(["categories", "Kategori"], ["expenses", "Pengeluaran"], ["staff", "Staff"], ["backup", "Ekspor data"]);

  async function boot() {
    render();                                       // tampilkan "Memuat data..."
    try { await Promise.all([loadCatalog(), loadReviews()]); }
    catch (error) { console.error("[BOOT CATALOG]", error); toast("Katalog database gagal dimuat."); }
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.user) await startSession(session.user);
    } catch (error) {
      console.error("[BOOT SESSION]", error);
      currentProfile = null;
    }
    booting = false;
    render();
  }
  boot();
