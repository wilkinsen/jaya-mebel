
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedPermissions = [
  "dashboard",
  "products",
  "orders",
  "payments",
  "stock",
  "po",
  "opname",
  "customers",
  "reports",
  "categories",
  "expenses",
];

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method tidak diizinkan." }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return response({ error: "Token login tidak ditemukan." }, 401);
    }

    // Verifikasi identitas pemanggil menggunakan token login.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user: caller },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !caller) {
      return response({ error: "Sesi login tidak valid." }, 401);
    }

    // Client administratif hanya digunakan di Edge Function.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Pastikan pemanggil adalah Admin Main yang aktif.
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, active")
      .eq("id", caller.id)
      .single();

    if (
      profileError ||
      !callerProfile ||
      callerProfile.role !== "admin" ||
      callerProfile.active === false
    ) {
      return response({ error: "Hanya Admin Main yang boleh melakukan tindakan ini." }, 403);
    }

    const body = await req.json();
    const { action } = body;

    const validPermissions = (perms: unknown) =>
      Array.isArray(perms) &&
      perms.length > 0 &&
      perms.every(
        (p) => typeof p === "string" && allowedPermissions.includes(p),
      );

    const getTarget = async (userId: string) => {
      if (!userId || userId === caller.id) {
        throw new Error("ID akun tidak valid.");
      }

      const { data, error } = await admin
        .from("profiles")
        .select("id, full_name, role, active")
        .eq("id", userId)
        .single();

      if (error || !data) throw new Error("Akun tidak ditemukan.");
      if (data.role === "admin") {
        throw new Error("Akun Admin Main tidak boleh diubah melalui menu Staff.");
      }

      return data;
    };

    // 1. DAFTAR STAFF
    if (action === "list") {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, full_name, username, phone, role, active, created_at")
        .eq("role", "staff")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const { data: users, error: usersError } =
        await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

      if (usersError) throw usersError;

      const ids = (profiles || []).map((p) => p.id);

      let permissions: { staff_id: string; menu_key: string }[] = [];

      if (ids.length) {
        const result = await admin
          .from("staff_permissions")
          .select("staff_id, menu_key")
          .in("staff_id", ids);

        if (result.error) throw result.error;
        permissions = result.data || [];
      }

      const staff = (profiles || []).map((p) => {
        const authUser = users.users.find((u) => u.id === p.id);

        return {
          ...p,
          email: authUser?.email || "",
          title: authUser?.user_metadata?.title || "",
          perms: permissions
            .filter((x) => x.staff_id === p.id)
            .map((x) => x.menu_key),
        };
      });

      return response({ staff });
    }

    // 2. MEMBUAT STAFF BARU
    if (action === "create") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const title = String(body.title || "").trim();
      const perms = body.perms;

      if (!name || !email || password.length < 6 || !validPermissions(perms)) {
        return response({
          error: "Nama, email, password minimal 6 karakter, dan minimal satu permission wajib diisi.",
        }, 400);
      }

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: name, title },
        });

      if (createError) throw createError;

      const newId = created.user.id;

      try {
        const { error: updateError } = await admin
          .from("profiles")
          .update({
            full_name: name,
            role: "staff",
            active: true,
          })
          .eq("id", newId);

        if (updateError) throw updateError;

        const rows = perms.map((menu_key: string) => ({
          staff_id: newId,
          menu_key,
        }));

        const { error: permissionError } = await admin
          .from("staff_permissions")
          .insert(rows);

        if (permissionError) throw permissionError;
      } catch (err) {
        // Batalkan akun Auth yang baru dibuat jika penyimpanan profil gagal.
        await admin.auth.admin.deleteUser(newId);
        throw err;
      }

      return response({ success: true, userId: newId });
    }

    // 3. MENGUBAH JABATAN DAN PERMISSION
    if (action === "update") {
      const userId = String(body.userId || "");
      const name = String(body.name || "").trim();
      const title = String(body.title || "").trim();
      const perms = body.perms;

      const target = await getTarget(userId);

      if (target.role !== "staff") {
        throw new Error("Akun tersebut bukan staff.");
      }

      if (!name || !validPermissions(perms)) {
        return response({ error: "Nama dan permission wajib diisi." }, 400);
      }

      const { error: updateError } = await admin
        .from("profiles")
        .update({ full_name: name })
        .eq("id", userId);

      if (updateError) throw updateError;

      const { error: metadataError } =
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { full_name: name, title },
        });

      if (metadataError) throw metadataError;

      const { error: deleteError } = await admin
        .from("staff_permissions")
        .delete()
        .eq("staff_id", userId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await admin
        .from("staff_permissions")
        .insert(
          perms.map((menu_key: string) => ({
            staff_id: userId,
            menu_key,
          })),
        );

      if (insertError) throw insertError;

      return response({ success: true });
    }

    // 4. MENGAKTIFKAN / MENONAKTIFKAN STAFF
    if (action === "toggle") {
      const userId = String(body.userId || "");
      const active = body.active;

      if (typeof active !== "boolean") {
        return response({ error: "Status akun tidak valid." }, 400);
      }

      const target = await getTarget(userId);

      if (target.role !== "staff") {
        throw new Error("Akun tersebut bukan staff.");
      }

      const { error } = await admin
        .from("profiles")
        .update({ active })
        .eq("id", userId);

      if (error) throw error;

      return response({ success: true, active });
    }

    // 5. MENGUBAH PASSWORD STAFF
    if (action === "set_password") {
      const userId = String(body.userId || "");
      const password = String(body.password || "");

      if (password.length < 6) {
        return response({ error: "Password minimal 6 karakter." }, 400);
      }

      const target = await getTarget(userId);

      if (target.role !== "staff") {
        throw new Error("Password hanya dapat diubah melalui menu Staff.");
      }

      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
      });

      if (error) throw error;

      return response({ success: true });
    }

    // 6. MENGUBAH CUSTOMER YANG SUDAH ADA MENJADI STAFF
    if (action === "promote_existing") {
      const userId = String(body.userId || "");
      const title = String(body.title || "").trim();
      const perms = body.perms;

      const target = await getTarget(userId);

      if (target.role !== "customer") {
        throw new Error("Hanya akun customer yang dapat dipromosikan.");
      }

      if (!validPermissions(perms)) {
        return response({ error: "Pilih minimal satu permission." }, 400);
      }

      const { error: roleError } = await admin
        .from("profiles")
        .update({ role: "staff", active: true })
        .eq("id", userId);

      if (roleError) throw roleError;

      const { error: metaError } =
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: {
            title,
            full_name: target.full_name || "",
          },
        });

      if (metaError) throw metaError;

      const { error: permError } = await admin
        .from("staff_permissions")
        .insert(
          perms.map((menu_key: string) => ({
            staff_id: userId,
            menu_key,
          })),
        );

      if (permError) throw permError;

      return response({ success: true, userId });
    }

    // 7. MENGAKTIFKAN / MENONAKTIFKAN CUSTOMER
    if (action === "toggle_customer") {
      const userId = String(body.userId || "");
      const active = body.active;

      if (typeof active !== "boolean") {
        return response({ error: "Status akun tidak valid." }, 400);
      }

      const target = await getTarget(userId);

      if (target.role !== "customer") {
        throw new Error("Akun tersebut bukan customer.");
      }

      const { error } = await admin
        .from("profiles")
        .update({ active })
        .eq("id", userId);

      if (error) throw error;

      return response({ success: true, active });
    }

    return response({ error: "Action tidak dikenal." }, 400);
  } catch (error) {
    console.error("[MANAGE STAFF]", error);
    return response({
      error: error instanceof Error ? error.message : "Terjadi kesalahan server.",
    }, 400);
  }
});
