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
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return json(401, { error: "Invalid user" });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) {
      return json(500, { error: "Failed to fetch caller profile" });
    }

    if (!callerProfile) {
      return json(401, { error: "Caller profile not found" });
    }

    if (callerProfile.role !== "super_admin") {
      return json(403, { error: "Only super admin can update roles" });
    }

   const body = await req.json();

// ─── Input sanitization ───
const userId = String(body?.userId || "").trim().slice(0, 36);
const newRole = String(body?.newRole || "").trim().slice(0, 20);

if (!userId || !newRole) {
  return json(400, { error: "userId and newRole are required" });
}

// Basic UUID format check
if (!/^[0-9a-f-]{36}$/.test(userId)) {
  return json(400, { error: "Invalid userId format" });
}

if (!["audit", "partner", "super_admin"].includes(newRole)) {
  return json(400, { error: "Invalid role" });
}

    const { error } = await adminClient
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);

    if (error) {
      return json(500, { error: error.message });
    }

    return json(200, { ok: true, message: "Role updated successfully" });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});