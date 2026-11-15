/* =========================================
   JAYA MEBEL - KATALOG SUPABASE (versi baru)
   File ini TIDAK lagi menggambar ulang halaman
   atau mengubah db sendiri. Tugasnya hanya
   mengambil produk + kategori dari Supabase,
   lalu script.js yang memakainya lewat
   JM_CATALOG.fetch().
   ========================================= */

window.JM_CATALOG = {
  async fetch() {
    const client = window.supabaseClient;
    if (!client) throw new Error("Supabase client belum tersedia.");

    // Ambil kategori dan produk secara bersamaan.
    const [catResult, productResult] = await Promise.all([
      client.from("categories").select("*").order("name"),
      client.from("products").select("*").order("created_at", { ascending: false })
    ]);

    if (catResult.error) throw catResult.error;
    if (productResult.error) throw productResult.error;

    // Kategori: [{ id, name }]
    const categories = (catResult.data || []).map((c) => ({
      id: String(c.id),
      name: c.name || c.title || "Lainnya"
    }));

    // Pasangan id kategori -> nama kategori
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));

    // Ubah baris produk Supabase menjadi bentuk yang dipakai tampilan.
    const products = (productResult.data || []).map((p) => ({
      id: String(p.id),
      name: p.name || "Produk Tanpa Nama",
      category: categoryName.get(String(p.category_id)) || "Lainnya",
      price: Number(p.price || 0),
      cost: Number(p.cost || 0),
      stock: Number(p.stock || 0),
      min: Number(p.min_stock ?? 3),
      material: p.material || "",
      size: p.size || "",
      color: p.color || "",
      desc: p.description || "",
      image: p.image_url || "",
      active: p.active !== false,
      created: p.created_at || ""
    }));

    return { products, categories };
  }
};
