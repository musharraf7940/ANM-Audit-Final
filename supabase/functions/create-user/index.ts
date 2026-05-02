import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Use POST" });
  }

  try {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");

    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();

    if (userErr || !user) {
      return json(401, { error: "Invalid user" });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) return json(500, { error: "Failed to fetch caller profile" });
    if (!callerProfile) return json(401, { error: "Caller profile not found" });
    if (callerProfile.role !== "super_admin") {
      return json(403, { error: "Only super admin can create users" });
    }

    // ─── Parse body + Input sanitization ─────────────
    const body = await req.json();

    const email    = String(body?.email    || "").trim().toLowerCase().slice(0, 254);
    const password = String(body?.password || "").slice(0, 128);
    const role     = String(body?.role     || "").trim().slice(0, 20);

    if (!email || !password || !role) {
      return json(400, { error: "Email, password, and role are required" });
    }
    if (!email.includes("@") || email.length < 5) {
      return json(400, { error: "Invalid email address" });
    }
    if (password.length < 6) {
      return json(400, { error: "Password must be at least 6 characters" });
    }
    if (!["audit", "partner", "super_admin"].includes(role)) {
      return json(400, { error: "Invalid role" });
    }
    // ─────────────────────────────────────────────────

    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createErr || !created?.user) {
      return json(400, { error: createErr?.message || "Failed to create auth user" });
    }

    const { error: profileInsertErr } = await adminClient
      .from("profiles")
      .upsert([{ id: created.user.id, email, role }], { onConflict: "id" });

    if (profileInsertErr) {
      return json(500, { error: profileInsertErr.message });
    }

    return json(200, {
      ok: true,
      message: "User created successfully",
      userId: created.user.id,
    });

  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});