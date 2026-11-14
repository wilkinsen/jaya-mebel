/* ==========================================================
   JAYA MEBEL - script.js
   Isi file:  1. Data   2. Helper   3. Navigasi   4. Customer
              5. Pesanan (aturan stok & status)   6. Admin
              7. Fitur tambahan (kategori, favorit, alamat, staff, backup)
   Prototype: data disimpan di localStorage browser.
   Login admin demo: admin / admin123
   (Untuk produksi, ganti dengan database + autentikasi aman.)
   ========================================================== */

/* ---------- 1. DATA AWAL ---------- */
const KEY = "jayamebel_v3", SESSION = "jayamebel_login";
const FLOW = ["Menunggu Konfirmasi", "Pesanan Dikonfirmasi", "Pesanan Sedang Diproses", "Pesanan Dikirim", "Pesanan Selesai"];
const BATAL = "Pesanan Dibatalkan";

const SEED = {
  users: [{ id: "admin", name: "Admin Jaya Mebel", username: "admin", password: "admin123", phone: "", role: "admin", active: true }],
  products: [
    { id: "p1", name: "Kursi Makan Kayu Jati", category: "Kursi", price: 650000, cost: 420000, stock: 12, min: 3, material: "Kayu jati", size: "45 x 48 x 90 cm", color: "Natural", desc: "Kursi makan dengan sandaran lengkung yang nyaman untuk makan keluarga.", image: "", active: true, created: "2026-01-10" },
    { id: "p2", name: "Meja Tamu Minimalis", category: "Meja", price: 1250000, cost: 820000, stock: 7, min: 3, material: "Kayu mahoni", size: "100 x 50 x 45 cm", color: "Walnut", desc: "Meja tamu rendah dengan rak bawah untuk majalah dan remote.", image: "", active: true, created: "2026-03-15" },
    { id: "p3", name: "Lemari Pakaian 2 Pintu", category: "Lemari", price: 2350000, cost: 1600000, stock: 2, min: 3, material: "MDF finishing HPL", size: "90 x 50 x 180 cm", color: "Putih", desc: "Lemari dua pintu dengan gantungan dan dua laci dalam.", image: "", active: true, created: "2026-05-20" },
    { id: "p4", name: "Rak Serbaguna 4 Susun", category: "Rak", price: 480000, cost: 300000, stock: 15, min: 3, material: "Besi dan kayu", size: "80 x 30 x 150 cm", color: "Hitam-cokelat", desc: "Rak empat susun untuk buku, tanaman, atau perlengkapan dapur.", image: "", active: true, created: "2026-08-01" }
  ],
  orders: [], pos: [], opnames: [], moves: [], reviews: [], carts: {}, log: [],
  categories: ["Kursi", "Meja", "Lemari", "Rak"], expenses: [], wishlist: {}
};

let db = loadDB();
function loadDB() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.users && saved.products) return { ...structuredClone(SEED), ...saved };
  } catch (e) { console.error(e); }
  return structuredClone(SEED);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) { toast("Penyimpanan penuh. Gunakan foto yang lebih kecil."); return false; }
}

/* ---------- 2. HELPER ---------- */
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(+n || 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = () => new Date().toISOString();
const fmt = d => new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const me = () => db.users.find(u => u.id === localStorage.getItem(SESSION) && u.active !== false);
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

function readImage(file) {
  return new Promise((ok, fail) => {
    if (!file) return ok("");
    if (!file.type.startsWith("image/")) return fail(new Error("File harus berupa gambar."));
    if (file.size > 1000000) return fail(new Error("Ukuran gambar maksimal 1 MB."));
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(new Error("Gagal membaca gambar.")); r.readAsDataURL(file);
  });
}

const log = text => { db.log.unshift({ text, by: me()?.name || "-", at: now() }); db.log = db.log.slice(0, 200); };
const move = (p, type, qty, note) => db.moves.push({ id: uid(), productId: p.id, name: p.name, type, qty, note, at: now() });
const stockInfo = p => p.stock <= 0 ? ["Stok habis", "bad"] : p.stock <= p.min ? ["Stok menipis", "warn"] : ["Tersedia", "ok"];
const thumb = p => p.image ? `<img src="${p.image}" alt="${esc(p.name)}">`
  : `<div class="ph" style="--h:${[...p.category].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}"><span>${esc(p.name[0])}</span></div>`;
function ratingOf(pid) {
  const list = db.reviews.filter(r => r.productId === pid);
  return { list, n: list.length, avg: list.length ? sum(list, r => r.rating) / list.length : 0 };
}
/* Membuat tabel dari header + baris (<tr>) */
const table = (head, rows) => `<div class="tbl"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">Belum ada data.</td></tr>`}</tbody></table></div>`;

/* ---------- 3. NAVIGASI ---------- */
const pages = {};            // pages.nama = fungsi yang mengembalikan HTML halaman customer
const PROTECTED = ["cart", "checkout", "account", "order"];   // wajib login
let view = { page: "home", id: null };
let filter = { q: "", cat: "", sort: "" };
let authMode = "login", accTab = "overview", ordFilter = "", adminTab = "dashboard", aFilter = "";

function go(page, id) { view = { page, id }; render(); scrollTo(0, 0); }

function render() {
  const u = me();
  if (u?.role === "admin" || u?.role === "staff") { $("app").innerHTML = adminShell(u); return; }   // admin: tampilan sendiri, tanpa keranjang
  let page = view.page;
  if (!pages[page] || (PROTECTED.includes(page) && !u)) page = PROTECTED.includes(view.page) ? "auth" : "home";
  $("app").innerHTML = header(u) + `<main>${pages[page](u)}</main>` + footer();
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
  npwp: "00.000.000.0-000.000", bank: "BCA 123-456-7890 a.n. Jaya Mebel",
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
function addToCart(id, qty = 1) {
  const u = me();
  if (!u || u.role !== "customer") { toast("Masuk sebagai customer dulu untuk berbelanja."); authMode = "login"; return go("auth"); }
  const p = db.products.find(x => x.id === id), c = cart();
  qty = Math.max(1, Math.floor(qty) || 1);
  if (!p || p.stock <= 0) return toast("Stok produk habis.");
  if ((c[id] || 0) + qty > p.stock) return toast(`Stok tersedia hanya ${p.stock} unit.`);
  c[id] = (c[id] || 0) + qty; save();
  $("cartCount").textContent = sum(Object.values(c), x => x);
  toast("Ditambahkan ke keranjang.");
}
function setQty(id, q) {
  const p = db.products.find(x => x.id === id), c = cart();
  if (q <= 0) delete c[id];
  else if (!p || q > p.stock) return toast("Jumlah melebihi stok tersedia.");
  else c[id] = q;
  save(); render();
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
  return `<section class="wrap two"><form class="panel" onsubmit="createOrder(event)"><h2>Pengiriman</h2>
    <label>Nama penerima<input id="rName" required value="${esc(u.name)}"></label>
    <label>Nomor telepon<input id="rPhone" required value="${esc(u.phone)}"></label>
    ${addressPicker(u)}
    <label>Alamat lengkap<textarea id="rAddr" rows="3" required>${esc(u.address || "")}</textarea></label>
    <label>Catatan (opsional)<textarea id="rNote" rows="2"></textarea></label>
    <h3>Metode pembayaran</h3><select id="rPay" onchange="payHint()"><option>COD</option><option>QRIS</option><option>Transfer Bank</option></select>
    <p class="hint" id="payHint">Bayar tunai saat barang tiba.</p>
    <label id="proofBox" hidden>Bukti pembayaran<input type="file" id="rProof" accept="image/*"></label>
    <button class="btn">Buat pesanan</button></form>
    <aside class="panel"><h3>Ringkasan</h3>${it.map(({ p, q }) => `<div class="row between"><span>${esc(p.name)} × ${q}</span><b>${money(p.price * q)}</b></div>`).join("")}
    <div class="sum"><span>Total</span><b>${money(cartTotal())}</b></div></aside></section>`;
};
function payHint() {
  const m = $("rPay").value; $("proofBox").hidden = m === "COD";
  // Ganti nomor rekening di bawah dengan rekening asli toko
  $("payHint").textContent = { COD: "Bayar tunai saat barang tiba.", QRIS: "Bayar lewat QRIS Jaya Mebel, lalu unggah bukti pembayaran.", "Transfer Bank": "Transfer ke BCA 123-456-7890 a.n. Jaya Mebel, lalu unggah bukti pembayaran." }[m];
}
async function createOrder(e) {
  e.preventDefault();
  if (createOrder.busy) return;                 // cegah klik ganda
  createOrder.busy = true;
  try { await placeOrder(); } finally { createOrder.busy = false; }
}
async function placeOrder() {
  const u = me(), it = selectedItems(), backup = { ...cart() };
  if (!it.length) return toast("Keranjang kosong.");
  const bad = it.find(i => i.q > i.p.stock);
  if (bad) return toast(`Stok ${bad.p.name} tidak mencukupi.`);
  const phone = $("rPhone").value.trim(), method = $("rPay").value;
  if (!/^[0-9+\-\s]{8,15}$/.test(phone)) return toast("Nomor telepon tidak valid.");
  let proof = "";
  if (method !== "COD") {
    try { proof = await readImage($("rProof").files[0]); } catch (er) { return toast(er.message); }
    if (!proof) return toast("Unggah bukti pembayaran dulu.");
  }
  const o = {
    id: "JM-" + Date.now(), userId: u.id, name: $("rName").value.trim(), phone, address: $("rAddr").value.trim(), note: $("rNote").value.trim(),
    items: it.map(({ p, q }) => ({ pid: p.id, name: p.name, price: p.price, cost: p.cost || 0, qty: q })),
    total: cartTotal(), method, proof,
    pay: method === "COD" ? "Bayar Saat Diterima" : "Menunggu Verifikasi",
    status: FLOW[0], stockOut: false, stockBack: false, courier: "", resi: "",
    created: now(), track: [{ s: "Pesanan dibuat", at: now() }]
  };
  db.orders.unshift(o);
  it.forEach(i => delete db.carts[u.id][i.p.id]);   // hanya produk yang dicentang keluar dari keranjang
  if (!save()) { db.orders.shift(); db.carts[u.id] = backup; return; }
  toast("Pesanan " + o.id + " berhasil dibuat."); accTab = "orders"; go("account");
}

/* --- Akun, pesanan, tracking, ulasan --- */
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
  return `<section class="wrap two"><div><div class="row"><button class="btn ghost sm" onclick="go('account')">Kembali</button><button class="btn sm" onclick="printDoc('${o.id}','invoice')">Cetak invoice</button>${o.courier ? `<button class="btn ghost sm" onclick="printDoc('${o.id}','sj')">Surat jalan</button>` : ""}<button class="btn ghost sm" onclick="reorder('${o.id}')">Beli lagi</button></div><h2 style="margin-top:14px">${o.id}</h2>
    <div class="panel"><b>${esc(o.name)}</b>, ${esc(o.phone)}<br>${esc(o.address)}${o.note ? `<br><small>Catatan: ${esc(o.note)}</small>` : ""}</div>
    <div class="panel"><h3>Barang</h3>${o.items.map(i => `<div class="row between"><span>${esc(i.name)} × ${i.qty}</span><b>${money(i.price * i.qty)}</b></div>`).join("")}<div class="sum"><span>Total</span><b>${money(o.total)}</b></div>
      <small>Pembayaran ${o.method}: ${o.pay}${o.rejectReason ? `. Alasan penolakan: ${esc(o.rejectReason)}` : ""}</small></div>${reviews}</div>
    <aside class="panel"><h3>Status pesanan</h3><span class="tag ${statusTag(o.status)}">${o.status}</span>${stepper(o)}${o.cancelReason ? `<div class="alert">Alasan pembatalan: ${esc(o.cancelReason)}</div>` : ""}${reuploadBox(o)}
      ${o.courier ? `<p style="margin-top:10px"><small>Kurir: ${esc(o.courier)}${o.resi ? ", resi " + esc(o.resi) : ""}</small></p>` : ""}
      <ul class="tl">${o.track.map(t => `<li>${esc(t.s)}<small>${fmt(t.at)}</small></li>`).join("")}</ul>
      ${idx >= 0 && idx <= 1 ? `<button class="btn red sm" onclick="customerCancel('${o.id}')">Batalkan pesanan</button>` : o.status !== BATAL && !done ? `<small>Pesanan sudah diproses. Hubungi toko untuk pembatalan.</small>` : ""}</aside></section>`;
};
function customerCancel(id) {
  const o = db.orders.find(x => x.id === id), i = FLOW.indexOf(o?.status);
  if (!o || o.userId !== me().id || i < 0 || i > 1) return toast("Pesanan ini tidak bisa dibatalkan.");
  ask("Batalkan pesanan", [{ k: "reason", label: "Alasan pembatalan", area: 1, req: 1 }], v => {
    cancelOrder(o, "Dibatalkan oleh customer: " + v.reason);
    save(); toast("Pesanan dibatalkan."); render();
  });
}
function pickStar(pid, n) {
  const box = $("st-" + pid); box.dataset.v = n;
  [...box.children].forEach((b, i) => b.classList.toggle("on", i < n));
}
function sendReview(orderId, pid) {
  const u = me(), o = db.orders.find(x => x.id === orderId), rating = +$("st-" + pid).dataset.v;
  if (!o || o.userId !== u.id || o.status !== FLOW[4]) return toast("Ulasan hanya bisa dikirim setelah pesanan selesai.");
  if (db.reviews.some(r => r.orderId === orderId && r.productId === pid)) return toast("Anda sudah menilai produk ini.");
  if (rating < 1) return toast("Pilih jumlah bintang dulu.");
  db.reviews.push({ id: uid(), orderId, productId: pid, userId: u.id, userName: u.name, rating, text: $("tx-" + pid).value.trim(), at: now() });
  save(); toast("Terima kasih atas penilaian Anda."); render();
}

pages.help = () => {
  const kontak = [
    ["Showroom", "Jl. Contoh Raya No. 12, Medan"],
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

/* --- Login & daftar --- */
function togglePw(b) { const i = b.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Lihat" : "Sembunyikan"; }
pages.auth = () => {
  const login = authMode === "login";
  const pw = (id, label, extra = "", ac = "current-password") => `<label>${label}<div class="pw"><input id="${id}" type="password" ${extra} required autocomplete="${ac}"><button type="button" onclick="togglePw(this)">Lihat</button></div></label>`;
  return `<section class="authwrap"><aside class="authside"><div class="logo"><b>JM</b><span>${esc(COMPANY.name)}<small>${esc(COMPANY.tagline)}</small></span></div>
    <h2>${login ? "Selamat datang kembali" : "Buat akun, belanja jadi lebih mudah"}</h2>
    <ul><li>Pantau status pesanan dan nomor resi</li><li>Simpan favorit dan beberapa alamat pengiriman</li><li>Unduh invoice dan surat jalan kapan saja</li></ul></aside>
    <div class="authform"><div class="seg"><button class="${login ? "on" : ""}" onclick="authMode='login';render()">Masuk</button><button class="${login ? "" : "on"}" onclick="authMode='register';render()">Daftar</button></div>
    <h1>${login ? "Masuk ke akun Anda" : "Buat akun baru"}</h1><p class="sub">${login ? "Gunakan username atau email yang terdaftar." : "Cukup satu menit. Data dipakai untuk memproses pesanan Anda."}</p>
    ${login
      ? `<form onsubmit="doLogin(event,'customer')"><label>Username atau email<input id="aUser" required autocomplete="username" placeholder="contoh: budi@email.com"></label>${pw("aPass", "Password")}<button class="btn block">Masuk</button></form>
         <p class="swap">Belum punya akun? <a onclick="authMode='register';render()">Daftar sekarang</a></p>`
      : `<form onsubmit="doRegister(event)"><label>Nama lengkap<input id="aName" required autocomplete="name"></label><div class="fgrid"><label>Username atau email<input id="aUser" required autocomplete="username"></label><label>Nomor telepon<input id="aPhone" required autocomplete="tel" placeholder="08xxxxxxxxxx"></label></div>
         <div class="fgrid">${pw("aPass", "Password (min. 6 karakter)", 'minlength="6"', "new-password")}${pw("aPass2", "Ulangi password", 'minlength="6"', "new-password")}</div>
         <label class="agree"><input type="checkbox" class="check" required> Saya setuju data saya dipakai untuk memproses pesanan.</label><button class="btn block">Buat akun</button></form>
         <p class="swap">Sudah punya akun? <a onclick="authMode='login';render()">Masuk</a></p>`}
    </div></section>`;
};

function doLogin(e, role) {
  e.preventDefault();
  const name = $("aUser").value.trim().toLowerCase(), u = db.users.find(x => x.username.toLowerCase() === name && x.password === $("aPass").value);
  if (!u) return toast("Username atau password salah.");
  if (u.active === false) return toast("Akun ini dinonaktifkan. Hubungi toko.");
  u.lastLogin = now(); localStorage.setItem(SESSION, u.id);
  if (u.role !== "customer") { log("Login " + u.role); save(); adminTab = "dashboard"; render(); } else { toast("Selamat datang, " + u.name.split(" ")[0] + "."); go("home"); }
}
function doRegister(e) {
  e.preventDefault();
  const username = $("aUser").value.trim().toLowerCase(), phone = $("aPhone").value.trim();
  if (db.users.some(x => x.username.toLowerCase() === username)) return toast("Username atau email sudah dipakai.");
  if (!/^[0-9+\-\s]{8,15}$/.test(phone)) return toast("Nomor telepon tidak valid.");
  if ($("aPass").value !== $("aPass2").value) return toast("Konfirmasi password tidak sama.");
  const u = { id: uid(), name: $("aName").value.trim(), username, email: username.includes("@") ? username : "", password: $("aPass").value, phone, address: "", role: "customer", active: true, created: now() };
  db.users.push(u); save(); localStorage.setItem(SESSION, u.id); toast("Akun berhasil dibuat."); go("home");
}
function logout() { localStorage.removeItem(SESSION); view = { page: "home" }; render(); toast("Anda sudah keluar."); }

/* ---------- 5. ATURAN PESANAN, STOK & STATUS ---------- */
function setStatus(o, status, text) { o.status = status; o.track.push({ s: text || status, at: now() }); }

/* Stok dikurangi TEPAT SATU KALI per pesanan (dijaga oleh flag stockOut) */
function takeStock(o) {
  if (o.stockOut) return true;
  for (const i of o.items) {
    const p = db.products.find(x => x.id === i.pid);
    if (!p || p.stock < i.qty) { toast("Stok " + i.name + " tidak cukup."); return false; }
  }
  o.items.forEach(i => { const p = db.products.find(x => x.id === i.pid); p.stock -= i.qty; move(p, "Keluar", i.qty, "Pesanan " + o.id); });
  o.stockOut = true; return true;
}
/* Pembatalan: stok dikembalikan hanya jika sudah pernah dikurangi, dan hanya satu kali (flag stockBack) */
function cancelOrder(o, reason) {
  if (o.stockOut && !o.stockBack) {
    o.items.forEach(i => { const p = db.products.find(x => x.id === i.pid); if (p) { p.stock += i.qty; move(p, "Masuk", i.qty, "Pembatalan " + o.id); } });
    o.stockBack = true;
  }
  o.cancelReason = reason; setStatus(o, BATAL, "Pesanan dibatalkan: " + reason); log("Membatalkan " + o.id + ": " + reason);
}

/* ---------- 6. PANEL ADMIN ---------- */
const TABS = [["dashboard", "Ringkasan"], ["products", "Produk"], ["orders", "Pesanan"], ["payments", "Verifikasi bayar"], ["stock", "Persediaan"], ["po", "Purchase order"], ["opname", "Stock opname"], ["customers", "Customer"], ["reports", "Laporan"]];
const adm = {};
const stat = (label, value, cls = "") => `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`;

function adminShell(u) {
  // Staff hanya melihat menu yang diizinkan admin (fungsi canOpen ada di bagian 7)
  const allowed = TABS.filter(t => canOpen(u, t[0]));
  if (!allowed.length) return `<div class="wrap"><div class="empty">Akun staff ini belum diberi akses menu. <a onclick="logout()">Keluar</a></div></div>`;
  if (!canOpen(u, adminTab)) adminTab = allowed[0][0];
  const badge = { orders: db.orders.filter(o => o.status === FLOW[0]).length, payments: db.orders.filter(o => o.pay === "Menunggu Verifikasi" && o.status !== BATAL).length };
  return `<div class="adm"><aside class="side"><div class="brand"><b>Jaya Mebel</b><small>Ruang kerja admin</small></div>
    ${allowed.map(([k, l]) => `<button class="${k === adminTab ? "on" : ""}" onclick="adminTab='${k}';render()">${l}${badge[k] ? `<i>${badge[k]}</i>` : ""}</button>`).join("")}
    <button class="out" onclick="logout()">Keluar</button></aside>
    <main class="main"><header class="ahead"><h1>${TABS.find(t => t[0] === adminTab)[1]}</h1><small>${esc(u.name)}</small></header>${adm[adminTab]()}</main></div>`;
}

/* --- Ringkasan --- */
adm.dashboard = () => {
  const paid = db.orders.filter(isPaid), low = db.products.filter(p => p.stock <= p.min);
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return { d, v: sum(paid.filter(o => (o.paidAt || "").slice(0, 10) === d), o => o.total) }; });
  const max = Math.max(...days.map(x => x.v), 1);
  return `<div class="stats">${stat("Produk", db.products.length)}${stat("Customer", db.users.filter(u => u.role === "customer").length)}${stat("Total pesanan", db.orders.length)}
    ${stat("Menunggu konfirmasi", db.orders.filter(o => o.status === FLOW[0]).length, "warn")}${stat("Menunggu verifikasi bayar", db.orders.filter(o => o.pay === "Menunggu Verifikasi" && o.status !== BATAL).length, "warn")}
    ${stat("Penjualan terbayar", money(sum(paid, o => o.total)))}${stat("Stok menipis", low.length, low.length ? "warn" : "")}</div>
    <div class="panel"><h3>Penjualan terbayar, 7 hari terakhir</h3><div class="bars">${days.map(x => `<div><i style="height:${x.v / max * 100}%" title="${money(x.v)}"></i><small>${x.d.slice(5)}</small></div>`).join("")}</div></div>
    <div class="panel"><h3>Pesanan terbaru</h3>${table(["Pesanan", "Customer", "Total", "Status"], db.orders.slice(0, 6).map(o => `<tr><td>${o.id}</td><td>${esc(o.name)}</td><td>${money(o.total)}</td><td><span class="tag ${statusTag(o.status)}">${o.status}</span></td></tr>`))}</div>`;
};

/* --- Produk --- */
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
async function saveProduct(e, id) {
  e.preventDefault();
  let img; try { img = await readImage($("fImg").files[0]); } catch (er) { return toast(er.message); }
  const p = id ? db.products.find(x => x.id === id) : { id: uid(), stock: Math.floor(+$("fStock").value), active: true, created: now(), image: "" };
  const price = +$("fPrice").value;
  if (id && p.price !== price) log(`Harga ${p.name}: ${money(p.price)} menjadi ${money(price)}`);
  Object.assign(p, { name: $("fName").value.trim(), category: $("fCat").value.trim(), price, cost: +$("fCost").value, min: Math.floor(+$("fMin").value), material: $("fMat").value.trim(), size: $("fSize").value.trim(), color: $("fColor").value.trim(), desc: $("fDesc").value.trim() });
  if (img) p.image = img;
  if (!id) { db.products.push(p); if (p.stock > 0) move(p, "Masuk", p.stock, "Stok awal"); log("Menambah produk " + p.name); } else log("Mengubah produk " + p.name);
  if (!save()) { if (!id) db.products.pop(); return; }
  closeModal(); toast("Produk tersimpan."); render();
}
function toggleProduct(id) { const p = db.products.find(x => x.id === id); p.active = p.active === false; log((p.active ? "Mengaktifkan " : "Menonaktifkan ") + p.name); save(); render(); }
function deleteProduct(id) {
  const used = db.orders.some(o => o.items.some(i => i.pid === id) && o.status !== FLOW[4] && o.status !== BATAL);
  if (used) return toast("Produk masih ada di pesanan aktif. Nonaktifkan saja.");
  if (!confirm("Hapus produk ini secara permanen?")) return;
  log("Menghapus produk " + db.products.find(p => p.id === id)?.name); db.products = db.products.filter(p => p.id !== id); save(); render();
}

/* --- Pesanan --- */
adm.orders = () => `<div class="panel"><div class="tools"><select onchange="aFilter=this.value;render()"><option value="">Semua status</option>${[...FLOW, BATAL].map(s => `<option ${s === aFilter ? "selected" : ""}>${s}</option>`).join("")}</select></div>
  ${table(["Pesanan", "Customer", "Total", "Pembayaran", "Status", ""], db.orders.filter(o => !aFilter || o.status === aFilter).map(o => `<tr><td><b>${o.id}</b><br><small>${fmt(o.created)}</small></td><td>${esc(o.name)}</td><td>${money(o.total)}</td>
    <td>${o.method}<br><small>${o.pay}</small></td><td><span class="tag ${statusTag(o.status)}">${o.status}</span></td><td><button class="btn ghost sm" onclick="adminOrder('${o.id}')">Kelola</button></td></tr>`))}</div>`;

function adminOrder(id) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  const i = FLOW.indexOf(o.status), final = i === 4 || o.status === BATAL, labels = ["Konfirmasi pesanan", "Proses pesanan", "Kirim pesanan", "Selesaikan pesanan"];
  const needPay = o.method !== "COD" && o.pay !== "Terverifikasi", act = ["confirm", "process", "ship", "done"][i];
  openModal(`<h3>${o.id}</h3><div class="cols"><div><b>${esc(o.name)}</b><br>${esc(o.phone)}<br>${esc(o.address)}${o.note ? `<br><small>${esc(o.note)}</small>` : ""}</div>
    <div>${o.method}: ${o.pay}<br>Status: ${o.status}${o.courier ? `<br>Kurir: ${esc(o.courier)}${o.resi ? ", resi " + esc(o.resi) : ""}` : ""}${o.cancelReason ? `<br>Alasan batal: ${esc(o.cancelReason)}` : ""}</div></div>
    ${table(["Barang", "Qty", "Subtotal"], o.items.map(x => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${money(x.price * x.qty)}</td></tr>`))}
    <div class="sum"><span>Total</span><b>${money(o.total)}</b></div>
    <ul class="tl">${o.track.map(t => `<li>${esc(t.s)}<small>${fmt(t.at)}</small></li>`).join("")}</ul>
    <div class="row">${final ? "" : needPay ? `<small class="red">Verifikasi pembayaran dulu di menu Verifikasi bayar.</small>` : `<button class="btn" onclick="orderAction('${o.id}','${act}')">${labels[i]}</button>`}
    ${final ? "" : `<button class="btn red" onclick="orderAction('${o.id}','cancel')">Batalkan</button>`}
    <button class="btn ghost" onclick="printDoc('${o.id}','invoice')">Invoice</button><button class="btn ghost" onclick="printDoc('${o.id}','sj')">Surat jalan</button><button class="btn ghost" onclick="closeModal()">Tutup</button></div>`);
}
function orderAction(id, act) {
  const o = db.orders.find(x => x.id === id), step = { confirm: 0, process: 1, ship: 2, done: 3 };
  if (!o || o.status === BATAL || o.status === FLOW[4]) return toast("Pesanan sudah final.");
  if (act in step) {
    if (FLOW.indexOf(o.status) !== step[act]) return toast("Urutan status tidak sesuai.");
    if (o.method !== "COD" && o.pay !== "Terverifikasi") return toast("Pembayaran belum terverifikasi.");
  }
  if (act === "confirm") { if (!takeStock(o)) return; setStatus(o, FLOW[1]); }
  else if (act === "process") setStatus(o, FLOW[2]);
  else if (act === "ship") return ask("Data pengiriman", [{ k: "courier", label: "Nama kurir / petugas", req: 1 }, { k: "vehicle", label: "Nomor kendaraan" }, { k: "resi", label: "Nomor resi (jika ekspedisi)" }],
    v => { Object.assign(o, v, { shipDate: now() }); setStatus(o, FLOW[3]); done(o, "Pesanan dikirim."); });
  else if (act === "done") {
    if (o.method === "COD") { if (!confirm("Pembayaran COD sudah diterima?")) return; o.pay = "Lunas COD"; o.paidAt = now(); }
    setStatus(o, FLOW[4]);
  }
  else if (act === "cancel") return adminCancelForm(o.id);
  else return;
  done(o, "Status diperbarui.");
}
function done(o, msg) { log(o.id + ": " + o.status); save(); toast(msg); closeModal(); render(); }

function printDoc(id, type) {
  const o = db.orders.find(x => x.id === id), sj = type === "sj", w = window.open("", "_blank");
  if (!o || (me().role === "customer" && o.userId !== me().id)) { w?.close(); return toast("Pesanan tidak ditemukan."); }
  if (!w) return toast("Izinkan pop-up untuk mencetak.");
  const u = db.users.find(x => x.id === o.userId) || {}, paid = isPaid(o), at = now();
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

/* --- Verifikasi pembayaran --- */
adm.payments = () => `<div class="panel">${table(["Pesanan", "Metode", "Jumlah", "Status bayar", "Bukti", ""], db.orders.filter(o => o.method !== "COD").map(o => `<tr><td><b>${o.id}</b><br><small>${esc(o.name)}</small></td><td>${o.method}</td><td>${money(o.total)}</td>
  <td>${o.pay}${o.rejectReason ? `<br><small>${esc(o.rejectReason)}</small>` : ""}${o.verifiedBy ? `<br><small>oleh ${esc(o.verifiedBy)}, ${fmt(o.verifiedAt)}</small>` : ""}</td>
  <td><button class="btn ghost sm" onclick="viewProof('${o.id}')">Lihat</button></td>
  <td>${o.pay === "Menunggu Verifikasi" && o.status !== BATAL ? `<button class="btn sm" onclick="payAction('${o.id}','ok')">Setujui</button><button class="btn red sm" onclick="payAction('${o.id}','no')">Tolak</button>` : ""}</td></tr>`))}</div>`;
function viewProof(id) { const o = db.orders.find(x => x.id === id); openModal(`<h3>Bukti ${o.id}</h3><img src="${o.proof}" alt="Bukti pembayaran" style="max-width:100%;border-radius:8px"><div class="row" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Tutup</button></div>`); }
function payAction(id, act) {
  const o = db.orders.find(x => x.id === id);
  if (!o || o.method === "COD" || o.pay !== "Menunggu Verifikasi" || o.status === BATAL) return toast("Pembayaran ini sudah diproses.");
  if (act === "ok") {
    Object.assign(o, { pay: "Terverifikasi", paidAt: now(), verifiedAt: now(), verifiedBy: me().name }); o.track.push({ s: "Pembayaran terverifikasi", at: now() });
    log("Verifikasi pembayaran " + o.id); save(); toast("Pembayaran disetujui."); render();
  } else ask("Tolak bukti pembayaran", [{ k: "reason", label: "Alasan penolakan", area: 1, req: 1 }], v => {
    o.pay = "Ditolak"; o.rejectReason = v.reason; o.track.push({ s: "Bukti pembayaran ditolak: " + v.reason, at: now() });
    log("Menolak pembayaran " + o.id); save(); toast("Bukti pembayaran ditolak."); render();
  });
}

/* --- Persediaan --- */
adm.stock = () => {
  const low = db.products.filter(p => p.stock <= p.min);
  return `<div class="stats">${stat("Nilai persediaan (modal)", money(sum(db.products, p => p.stock * (p.cost || 0))))}${stat("Stok menipis", low.length, low.length ? "warn" : "")}${stat("Stok habis", db.products.filter(p => p.stock <= 0).length)}</div>
  ${low.length ? `<div class="alert">Perlu restock: ${low.map(p => `<b>${esc(p.name)}</b> (${p.stock})`).join(", ")}. <a onclick="adminTab='po';render()">Buat purchase order</a></div>` : ""}
  <div class="panel"><h3>Stok produk</h3>${table(["Produk", "Stok", "Minimum", "Status", "Nilai"], db.products.map(p => { const [t, c] = stockInfo(p); return `<tr><td>${esc(p.name)}</td><td>${p.stock}</td><td>${p.min}</td><td><span class="tag ${c}">${t}</span></td><td>${money(p.stock * (p.cost || 0))}</td></tr>`; }))}</div>
  <div class="panel"><h3>Riwayat pergerakan stok</h3>${table(["Waktu", "Produk", "Jenis", "Jumlah", "Keterangan"], db.moves.slice(-40).reverse().map(m => `<tr><td>${fmt(m.at)}</td><td>${esc(m.name)}</td><td>${esc(m.type)}</td><td>${m.qty}</td><td>${esc(m.note)}</td></tr>`))}</div>`;
};

/* --- Purchase order --- */
adm.po = () => `<div class="panel"><h3>Buat purchase order</h3><form class="fgrid" onsubmit="savePO(event)">
  <label>Supplier<input id="poSup" required></label><label>Produk<select id="poProd">${db.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
  <label>Jumlah<input id="poQty" type="number" min="1" step="1" required></label><label>Harga beli per unit<input id="poCost" type="number" min="0" required></label>
  <label>Tanggal pesan<input id="poDate" type="date" required value="${now().slice(0, 10)}"></label><label>Estimasi tiba<input id="poEta" type="date" required></label>
  <label class="full">Catatan<input id="poNote"></label><button class="btn full">Simpan PO</button></form></div>
  <div class="panel"><h3>Daftar PO</h3>${table(["PO", "Supplier", "Produk", "Pesan", "Diterima", "Estimasi", "Status", ""], db.pos.map(po => `<tr><td>${po.id}</td><td>${esc(po.supplier)}</td><td>${esc(po.productName)}</td><td>${po.qty}</td><td>${po.received}</td><td>${po.eta}</td><td>${po.status}</td>
    <td>${po.status === "Menunggu" ? `<button class="btn ghost sm" onclick="poAction('${po.id}','order')">Tandai dipesan</button>` : ""}
    ${["Dipesan ke Supplier", "Sebagian Diterima"].includes(po.status) ? `<button class="btn sm" onclick="receivePO('${po.id}')">Terima barang</button>` : ""}
    ${["Menunggu", "Dipesan ke Supplier"].includes(po.status) ? `<button class="btn red sm" onclick="poAction('${po.id}','cancel')">Batalkan</button>` : ""}</td></tr>`))}</div>`;
function savePO(e) {
  e.preventDefault(); const p = db.products.find(x => x.id === $("poProd").value), qty = +$("poQty").value;
  if (!p || !Number.isInteger(qty) || qty < 1) return toast("Data PO tidak valid.");
  db.pos.unshift({ id: "PO-" + Date.now(), supplier: $("poSup").value.trim(), productId: p.id, productName: p.name, qty, cost: +$("poCost").value, date: $("poDate").value, eta: $("poEta").value, note: $("poNote").value.trim(), status: "Menunggu", received: 0, receipts: [], created: now() });
  log("Membuat PO " + p.name + " x" + qty); save(); toast("PO tersimpan."); render();
}
function poAction(id, act) {
  const po = db.pos.find(x => x.id === id);
  if (act === "order" && po.status === "Menunggu") po.status = "Dipesan ke Supplier";
  else if (act === "cancel" && ["Menunggu", "Dipesan ke Supplier"].includes(po.status)) po.status = "Dibatalkan";
  else return toast("Status PO tidak bisa diubah.");
  log(po.id + ": " + po.status); save(); render();
}
function receivePO(id) {
  const po = db.pos.find(x => x.id === id), left = po ? po.qty - po.received : 0;
  if (!po || left <= 0 || !["Dipesan ke Supplier", "Sebagian Diterima"].includes(po.status)) return toast("PO ini sudah selesai diterima.");
  ask("Terima barang " + po.id, [{ k: "qty", label: `Jumlah yang benar-benar datang (sisa ${left})`, type: "number", min: 1, max: left, req: 1 }], v => {
    const n = Math.floor(+v.qty), p = db.products.find(x => x.id === po.productId), remain = po.qty - po.received;   // dicek ulang agar tidak ganda
    if (!p || !(n >= 1 && n <= remain)) return toast("Jumlah penerimaan tidak valid.");
    p.stock += n; po.received += n; po.receipts.push({ qty: n, at: now() });
    po.status = po.received >= po.qty ? "Diterima" : "Sebagian Diterima";
    move(p, "Masuk", n, "Penerimaan " + po.id); log("Menerima " + n + " unit " + p.name + " dari " + po.id); save(); toast("Stok bertambah " + n + " unit."); render();
  });
}

/* --- Stock opname --- */
adm.opname = () => `<div class="panel"><h3>Hitung stok fisik</h3><form class="fgrid" onsubmit="saveOpname(event)">
  <label>Produk<select id="opProd">${db.products.map(p => `<option value="${p.id}">${esc(p.name)} (sistem: ${p.stock})</option>`).join("")}</select></label>
  <label>Stok fisik di gudang<input id="opQty" type="number" min="0" step="1" required></label>
  <label class="full">Penyebab selisih (wajib jika ada selisih)<input id="opNote"></label><button class="btn full">Hitung selisih &amp; sesuaikan</button></form></div>
  <div class="panel"><h3>Riwayat stock opname</h3>${table(["Waktu", "Produk", "Sebelum", "Fisik", "Selisih", "Catatan", "Oleh"], db.opnames.map(x => `<tr><td>${fmt(x.at)}</td><td>${esc(x.name)}</td><td>${x.before}</td><td>${x.physical}</td><td>${x.diff > 0 ? "+" : ""}${x.diff}</td><td>${esc(x.note)}</td><td>${esc(x.by)}</td></tr>`))}</div>`;
function saveOpname(e) {
  e.preventDefault(); const p = db.products.find(x => x.id === $("opProd").value), physical = +$("opQty").value, note = $("opNote").value.trim();
  if (!p || !Number.isInteger(physical) || physical < 0) return toast("Stok fisik tidak valid.");
  const diff = physical - p.stock;
  if (diff !== 0 && !note) return toast("Isi penyebab selisih stok.");
  if (!confirm(`Stok sistem ${p.stock}, fisik ${physical}, selisih ${diff}. Sesuaikan stok sistem?`)) return;
  db.opnames.unshift({ id: uid(), productId: p.id, name: p.name, before: p.stock, physical, diff, note, by: me().name, at: now() });
  if (diff !== 0) { p.stock = physical; move(p, diff > 0 ? "Penyesuaian masuk" : "Penyesuaian keluar", Math.abs(diff), "Stock opname: " + note); }
  log(`Stock opname ${p.name}: selisih ${diff}`); save(); toast("Stock opname tersimpan."); render();
}

/* --- Customer --- */
adm.customers = () => `<div class="panel">${table(["Nama", "Kontak", "Pesanan", "Total belanja", "Status", ""], db.users.filter(u => u.role === "customer").map(u => {
  const mine = db.orders.filter(o => o.userId === u.id);
  return `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}<br><small>${esc(u.phone)}</small></td><td>${mine.length}</td><td>${money(sum(mine.filter(isPaid), o => o.total))}</td>
    <td><span class="tag ${u.active === false ? "bad" : "ok"}">${u.active === false ? "Nonaktif" : "Aktif"}</span></td><td><button class="btn ghost sm" onclick="toggleUser('${u.id}')">${u.active === false ? "Aktifkan" : "Nonaktifkan"}</button></td></tr>`;
}))}</div>`;
function toggleUser(id) { const u = db.users.find(x => x.id === id); u.active = u.active === false; log((u.active ? "Mengaktifkan " : "Menonaktifkan ") + "akun " + u.name); save(); render(); }

/* --- Laporan --- */
let rep = { from: "", to: "" };
const inRange = d => { const x = (d || "").slice(0, 10); return (!rep.from || x >= rep.from) && (!rep.to || x <= rep.to); };
const paidInRange = () => db.orders.filter(o => isPaid(o) && inRange(o.paidAt));

adm.reports = () => {
  const paid = paidInRange(), rev = sum(paid, o => o.total), cogs = sum(paid, o => sum(o.items, i => i.cost * i.qty));
  const buy = sum(db.pos, po => sum(po.receipts.filter(r => inRange(r.at)), r => r.qty * po.cost));
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

/* ==========================================================
   7. FITUR TAMBAHAN
   Kategori, favorit, alamat, keranjang pilihan, pembatalan admin,
   pengeluaran, staff, dan backup. Semua ada di satu file ini.
   ========================================================== */

/* ---------- 1. KATEGORI ---------- */

// Semua kategori = kategori yang dibuat admin + kategori yang dipakai produk
function allCategories() {
  const semua = [...db.categories, ...db.products.map(p => p.category)];
  return [...new Set(semua)];
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

function addCategory(e) {
  e.preventDefault();
  const nama = $("catName").value.trim();
  const sudahAda = allCategories().some(c => c.toLowerCase() === nama.toLowerCase());
  if (sudahAda) return toast("Kategori sudah ada.");

  db.categories.push(nama);
  log("Menambah kategori " + nama);
  save();
  render();
}

function renameCategory(namaLama) {
  ask("Ubah nama kategori", [{ k: "nama", label: "Nama baru", req: 1 }], v => {
    const namaBaru = v.nama.trim();
    db.categories = db.categories.filter(c => c !== namaLama);
    db.categories.push(namaBaru);
    db.products.forEach(p => { if (p.category === namaLama) p.category = namaBaru; });
    log(`Kategori ${namaLama} diganti menjadi ${namaBaru}`);
    save();
    render();
  });
}

function deleteCategory(nama) {
  if (db.products.some(p => p.category === nama)) return toast("Kategori masih dipakai produk.");
  if (!confirm("Hapus kategori ini?")) return;
  db.categories = db.categories.filter(c => c !== nama);
  save();
  render();
}

/* ---------- 2. FAVORIT ---------- */

// Daftar id produk favorit milik customer yang sedang login
function myWishlist() {
  const u = me();
  if (!u) return [];
  db.wishlist[u.id] ??= [];
  return db.wishlist[u.id];
}

function heartButton(productId) {
  const aktif = myWishlist().includes(productId) ? "on" : "";
  return `<button class="heart ${aktif}" onclick="toggleWish('${productId}')" title="Simpan ke favorit">♥</button>`;
}

function toggleWish(productId) {
  const u = me();
  if (!u || u.role !== "customer") {
    toast("Masuk dulu untuk menyimpan favorit.");
    authMode = "login";
    return go("auth");
  }
  const daftar = myWishlist();
  if (daftar.includes(productId)) {
    db.wishlist[u.id] = daftar.filter(id => id !== productId);   // hapus dari favorit
  } else {
    daftar.push(productId);                                       // tambah ke favorit
  }
  save();
  render();
}

/* ---------- 3. HALAMAN AKUN (pesanan, favorit, alamat, profil) ---------- */

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
    `<div class="panel"><h3>Pesanan terakhir</h3>${mine.slice(0, 3).map(o => `<div class="line"><div class="grow"><b>${o.id}</b><br><small>${fmt(o.created)}</small></div><span class="tag ${statusTag(o.status)}">${o.status}</span><b>${money(o.total)}</b><button class="btn ghost sm" onclick="go('order','${o.id}')">Detail</button></div>`).join("") || `<div class="empty">Belum ada pesanan. <a onclick="go('catalog')">Mulai belanja</a></div>`}</div>
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
function reorder(id) {
  const o = db.orders.find(x => x.id === id && x.userId === me().id); if (!o) return;
  const c = cart(); let n = 0;
  o.items.forEach(i => { const p = db.products.find(x => x.id === i.pid); if (p && p.active !== false && p.stock > 0) { c[p.id] = Math.min(p.stock, (c[p.id] || 0) + i.qty); unchecked.delete(p.id); n++; } });
  save(); toast(n ? n + " produk dimasukkan ke keranjang." : "Produk pesanan ini sudah tidak tersedia."); if (n) go("cart");
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

function accountAddresses(u) {
  const daftar = u.addresses || [];
  const baris = daftar.map((a, i) => `<div class="line"><div class="grow"><b>${esc(a.label)}</b> ${i === 0 ? '<span class="tag ok">Utama</span>' : ""}<br><small>${a.receiver ? esc(a.receiver) + (a.phone ? ", " + esc(a.phone) : "") + "<br>" : ""}${esc(a.text)}</small></div>
      ${i ? `<button class="btn ghost sm" onclick="mainAddress('${a.id}')">Jadikan utama</button>` : ""}<button class="btn ghost sm" onclick="deleteAddress('${a.id}')">Hapus</button></div>`).join("");
  return sechead("Buku alamat", "Alamat utama otomatis terisi saat checkout.") +
    `<div class="panel"><h3>Alamat tersimpan</h3>${baris || "<small>Belum ada alamat tersimpan.</small>"}</div>
    <form class="panel" onsubmit="addAddress(event)"><h3>Tambah alamat</h3><div class="fgrid"><label>Nama alamat (Rumah, Kantor)<input id="adLabel" required></label><label>Nama penerima<input id="adRecv" required value="${esc(u.name)}"></label>
      <label>Telepon penerima<input id="adPhone" required value="${esc(u.phone)}"></label><label class="full">Alamat lengkap<textarea id="adText" rows="3" required></textarea></label></div><button class="btn">Simpan alamat</button></form>`;
}
function mainAddress(id) {
  const u = me(), a = (u.addresses || []).find(x => x.id === id); if (!a) return;
  u.addresses = [a, ...u.addresses.filter(x => x.id !== id)]; u.address = a.text; save(); toast("Alamat utama diubah."); render();
}

function accountProfile(u) {
  return sechead("Data diri", "Data ini tercetak pada invoice Anda.") +
    `<form class="panel" onsubmit="saveProfile(event)"><div class="fgrid"><label>Nama lengkap<input id="pName" required value="${esc(u.name)}"></label><label>Username<input value="${esc(u.username)}" disabled></label>
      <label>Email<input id="pEmail" type="email" value="${esc(u.email || "")}"></label><label>Nomor telepon<input id="pPhone" required value="${esc(u.phone)}"></label>
      <label>Nama perusahaan (opsional)<input id="pCompany" value="${esc(u.company || "")}"></label><label>NPWP (opsional)<input id="pNpwp" value="${esc(u.npwp || "")}"></label></div><button class="btn">Simpan perubahan</button></form>`;
}
function saveProfile(e) {
  e.preventDefault();
  const u = me(), phone = $("pPhone").value.trim();
  if (!/^[0-9+\-\s]{8,15}$/.test(phone)) return toast("Nomor telepon tidak valid.");
  Object.assign(u, { name: $("pName").value.trim(), phone, email: $("pEmail").value.trim(), company: $("pCompany").value.trim(), npwp: $("pNpwp").value.trim() });
  save(); toast("Profil diperbarui."); render();
}
function accountSecurity(u) {
  return sechead("Keamanan", "Ganti password secara berkala.") +
    `<form class="panel" onsubmit="changePassword(event)"><label>Password saat ini<input id="sOld" type="password" required autocomplete="current-password"></label>
      <label>Password baru (min. 6 karakter)<input id="sNew" type="password" minlength="6" required autocomplete="new-password"></label><label>Ulangi password baru<input id="sNew2" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn">Ubah password</button></form>
    <div class="panel"><h3>Aktivitas akun</h3><small>Login terakhir: ${u.lastLogin ? fmt(u.lastLogin) : "-"}<br>Akun dibuat: ${u.created ? fmt(u.created) : "-"}</small></div>`;
}
function changePassword(e) {
  e.preventDefault(); const u = me();
  if ($("sOld").value !== u.password) return toast("Password saat ini salah.");
  if ($("sNew").value !== $("sNew2").value) return toast("Konfirmasi password tidak sama.");
  u.password = $("sNew").value; save(); toast("Password diubah."); render();
}
function addAddress(e) {
  e.preventDefault();
  const u = me(); u.addresses ??= [];
  u.addresses.push({ id: uid(), label: $("adLabel").value.trim(), receiver: $("adRecv").value.trim(), phone: $("adPhone").value.trim(), text: $("adText").value.trim() });
  u.address = u.addresses[0].text; save(); toast("Alamat disimpan."); render();
}
function deleteAddress(id) {
  const u = me(); u.addresses = (u.addresses || []).filter(a => a.id !== id); u.address = u.addresses[0]?.text || ""; save(); render();
}

// Pilihan alamat tersimpan di halaman checkout
function addressPicker(u) {
  const daftar = u.addresses || [];
  if (!daftar.length) return "";
  const opsi = daftar.map(a => `<option value="${esc(a.text)}">${esc(a.label)}</option>`).join("");
  return `<label>Pilih alamat tersimpan
      <select onchange="$('rAddr').value = this.value"><option value="">Isi alamat baru</option>${opsi}</select>
    </label>`;
}

/* ---------- 4. KIRIM ULANG BUKTI PEMBAYARAN ---------- */

// Tampil di halaman detail pesanan customer, hanya jika bukti ditolak
function reuploadBox(o) {
  if (o.pay !== "Ditolak" || o.status === BATAL) return "";
  return `<div class="alert">Bukti pembayaran ditolak. Unggah bukti yang baru:<br>
      <input type="file" id="newProof" accept="image/*" style="margin:8px 0">
      <button class="btn sm" onclick="reuploadProof('${o.id}')">Kirim ulang bukti</button>
    </div>`;
}

async function reuploadProof(orderId) {
  const o = db.orders.find(x => x.id === orderId);
  if (!o || o.userId !== me().id || o.pay !== "Ditolak") return toast("Bukti tidak bisa dikirim ulang.");

  let foto = "";
  try { foto = await readImage($("newProof").files[0]); }
  catch (err) { return toast(err.message); }
  if (!foto) return toast("Pilih foto bukti pembayaran dulu.");

  o.proof = foto;
  o.pay = "Menunggu Verifikasi";          // kembali masuk antrean verifikasi admin
  o.rejectReason = "";
  o.track.push({ s: "Bukti pembayaran dikirim ulang", at: now() });
  if (save()) { toast("Bukti baru terkirim."); render(); }
}

// Garis kemajuan status di halaman detail pesanan
function stepper(o) {
  if (o.status === BATAL) return "";
  const sekarang = FLOW.indexOf(o.status);
  const nama = ["Menunggu", "Dikonfirmasi", "Diproses", "Dikirim", "Selesai"];
  return `<div class="stepper">${nama.map((n, i) => `<div class="step ${i <= sekarang ? "done" : ""}"><span></span><small>${n}</small></div>`).join("")}</div>`;
}

/* ---------- 5. KERANJANG: PILIH PRODUK YANG DI-CHECKOUT ---------- */
// "unchecked", selectedItems(), dan cartTotal() didefinisikan di bagian Keranjang (atas).
// Produk yang tidak dicentang tetap tinggal di keranjang.

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

/* ---------- 6. PEMBATALAN OLEH ADMIN ---------- */

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

function submitAdminCancel(e, orderId) {
  e.preventDefault();
  const o = db.orders.find(x => x.id === orderId);
  if (!o || o.status === BATAL || o.status === FLOW[4]) return toast("Pesanan sudah final.");

  const catatan = $("cancelNote").value.trim();
  const alasan = $("cancelReason").value + (catatan ? " - " + catatan : "");
  cancelOrder(o, alasan);          // stok dikembalikan satu kali jika sebelumnya sudah dikurangi
  done(o, "Pesanan dibatalkan.");
}

/* ---------- 7. PENGELUARAN OPERASIONAL ---------- */

adm.expenses = () => {
  const baris = db.expenses.map(x => `<tr>
      <td>${x.date}</td><td>${esc(x.type)}</td><td>${esc(x.note)}</td><td>${money(x.amount)}</td>
      <td><button class="btn red sm" onclick="deleteExpense('${x.id}')">Hapus</button></td>
    </tr>`);

  return `<div class="panel">
      <h3>Catat pengeluaran</h3>
      <form class="fgrid" onsubmit="saveExpense(event)">
        <label>Tanggal<input id="exDate" type="date" required value="${now().slice(0, 10)}"></label>
        <label>Jenis
          <select id="exType"><option>Gaji</option><option>Listrik &amp; air</option><option>Transportasi</option><option>Sewa</option><option>Lainnya</option></select>
        </label>
        <label>Jumlah (Rp)<input id="exAmount" type="number" min="1" required></label>
        <label>Keterangan<input id="exNote"></label>
        <button class="btn full">Simpan pengeluaran</button>
      </form>
    </div>
    <div class="panel"><h3>Riwayat pengeluaran</h3>${table(["Tanggal", "Jenis", "Keterangan", "Jumlah", ""], baris)}</div>`;
};

function saveExpense(e) {
  e.preventDefault();
  db.expenses.unshift({
    id: uid(),
    date: $("exDate").value,
    type: $("exType").value,
    amount: +$("exAmount").value,
    note: $("exNote").value.trim()
  });
  log("Mencatat pengeluaran " + $("exType").value);
  save();
  toast("Pengeluaran tersimpan.");
  render();
}

function deleteExpense(id) {
  if (!confirm("Hapus catatan pengeluaran ini?")) return;
  db.expenses = db.expenses.filter(x => x.id !== id);
  save();
  render();
}

/* ---------- 8. STAFF DAN HAK AKSES ---------- */

const ADMIN_ONLY = ["staff", "backup"];     // menu ini hanya boleh dibuka admin utama

// Admin boleh semua menu. Staff hanya menu yang dicentang saat akunnya dibuat.
function canOpen(u, tab) {
  if (u.role === "admin") return true;
  if (ADMIN_ONLY.includes(tab)) return false;
  return (u.perms || []).includes(tab);
}

adm.staff = () => {
  const menuBoleh = TABS.filter(t => !ADMIN_ONLY.includes(t[0]));
  const daftarStaff = db.users.filter(u => u.role === "staff");

  const centang = menuBoleh.map(([kode, nama]) =>
    `<label style="margin:0"><input type="checkbox" class="perm" value="${kode}" style="width:auto"> ${nama}</label>`).join("");

  const baris = daftarStaff.map(s => {
    const akses = (s.perms || []).map(k => TABS.find(t => t[0] === k)?.[1]).filter(Boolean).join(", ");
    return `<tr>
      <td><b>${esc(s.name)}</b><br><small>${esc(s.title || "")}</small></td>
      <td>${esc(s.username)}</td>
      <td><small>${akses || "-"}</small></td>
      <td><span class="tag ${s.active === false ? "bad" : "ok"}">${s.active === false ? "Nonaktif" : "Aktif"}</span></td>
      <td>
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
        <label>Username<input id="stUser" required></label>
        <label>Password (min. 6 karakter)<input id="stPass" type="password" minlength="6" required></label>
        <div class="full"><b>Menu yang boleh dibuka</b><div class="row" style="margin:8px 0 14px">${centang}</div></div>
        <button class="btn full">Simpan staff</button>
      </form>
    </div>
    <div class="panel"><h3>Daftar staff</h3>${table(["Nama", "Username", "Akses menu", "Status", ""], baris)}</div>`;
};

function saveStaff(e) {
  e.preventDefault();
  const username = $("stUser").value.trim().toLowerCase();
  if (db.users.some(u => u.username.toLowerCase() === username)) return toast("Username sudah dipakai.");

  const perms = [...document.querySelectorAll(".perm:checked")].map(c => c.value);
  if (!perms.length) return toast("Pilih minimal satu menu untuk staff.");

  db.users.push({
    id: uid(), name: $("stName").value.trim(), title: $("stTitle").value.trim(),
    username, password: $("stPass").value, phone: "", role: "staff",
    perms, active: true, created: now()
  });
  log("Membuat akun staff " + username);
  save();
  toast("Akun staff dibuat.");
  render();
}

function staffPassword(id) {
  ask("Ubah password staff", [{ k: "pass", label: "Password baru (min. 6 karakter)", type: "password", req: 1 }], v => {
    if (v.pass.length < 6) return toast("Password minimal 6 karakter.");
    db.users.find(u => u.id === id).password = v.pass;
    log("Mengubah password staff");
    save();
    toast("Password diubah.");
  });
}

/* ---------- 9. BACKUP DAN PULIHKAN DATA ---------- */

adm.backup = () => `<div class="panel">
    <h3>Cadangkan data</h3>
    <p style="margin-bottom:12px">Unduh seluruh data toko (produk, pesanan, stok, akun) ke satu file.</p>
    <button class="btn" onclick="downloadBackup()">Unduh backup</button>
  </div>
  <div class="panel">
    <h3>Pulihkan data</h3>
    <p class="hint">Memulihkan akan mengganti SEMUA data yang ada sekarang.</p>
    <input type="file" id="restoreFile" accept=".json" style="margin-bottom:12px">
    <button class="btn red" onclick="restoreBackup()">Pulihkan dari file</button>
  </div>`;

function downloadBackup() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: "application/json" }));
  link.download = "backup-jaya-mebel-" + now().slice(0, 10) + ".json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function restoreBackup() {
  const file = $("restoreFile").files[0];
  if (!file) return toast("Pilih file backup dulu.");

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.users || !data.products || !data.orders) throw new Error("Format file backup tidak dikenali.");
      if (!confirm("Semua data saat ini akan diganti. Lanjutkan?")) return;
      db = { ...structuredClone(SEED), ...data };
      save();
      toast("Data berhasil dipulihkan.");
      render();
    } catch (err) {
      toast(err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- MULAI ---------- */
// Menu admin baru ditambahkan ke daftar TABS (bagian Panel Admin)
TABS.push(["categories", "Kategori"], ["expenses", "Pengeluaran"], ["staff", "Staff"], ["backup", "Backup"]);

render();

