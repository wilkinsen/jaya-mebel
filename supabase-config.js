
/* =========================================
   JAYA MEBEL - KONFIGURASI SUPABASE
   ========================================= */

const SUPABASE_URL =
  "https://ybnlzjrdahfykloughpi.supabase.co";

// Gunakan publishable key yang sudah
// berhasil pada pengujian Console kamu.
const SUPABASE_ANON_KEY =
  "sb_publishable_XgBbKXqrUGabkVhyONvmxg_45R622y5";

if (!window.supabase) {
  throw new Error(
    "Library Supabase gagal dimuat. Periksa koneksi internet."
  );
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

window.supabaseClient = supabaseClient;

console.log("Supabase Jaya Mebel berhasil diinisialisasi!");
