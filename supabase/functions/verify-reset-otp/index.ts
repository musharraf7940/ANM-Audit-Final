import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  try {
   const body = await req.json();

// ─── Input sanitization ───
const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
const otp = String(body?.otp || "").trim().slice(0, 6);
const newPassword = String(body?.newPassword || "").slice(0, 128);

if (!email || !otp || !newPassword) {
  return json(400, { error: "email, otp, and newPassword are required" });
}

if (!email.includes("@") || email.length < 5) {
  return json(400, { error: "Invalid email address" });
}

if (!/^\d{6}$/.test(otp)) {
  return json(400, { error: "OTP must be 6 digits" });
}

if (newPassword.length < 6) {
  return json(400, { error: "Password must be at least 6 characters" });
}

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ─── Brute force protection: check failed attempts ───
    const { data: record, error: fetchErr } = await adminClient
      .from("password_reset_otps")
      .select("id, otp, expires_at, used, failed_attempts")
      .eq("email", email)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      console.error("OTP fetch error:", fetchErr);
      return json(500, { error: "Server error" });
    }

    if (!record) {
      return json(400, { error: "Invalid or expired OTP. Please request a new one." });
    }

    // ─── Check if too many failed attempts ───
    if ((record.failed_attempts ?? 0) >= 5) {
      // Invalidate the OTP
      await adminClient
        .from("password_reset_otps")
        .update({ used: true })
        .eq("id", record.id);

      return json(400, {
        error: "Too many incorrect attempts. Please request a new OTP."
      });
    }

    // ─── Check expiry ───
    if (new Date(record.expires_at) < new Date()) {
      return json(400, { error: "OTP has expired. Please request a new one." });
    }

    // ─── Check OTP match ───
    if (record.otp !== otp) {
      // Increment failed attempts
      await adminClient
        .from("password_reset_otps")
        .update({ failed_attempts: (record.failed_attempts ?? 0) + 1 })
        .eq("id", record.id);

      const remaining = 4 - (record.failed_attempts ?? 0);
      return json(400, {
        error: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      });
    }

    // ─── Find user by email ───
    const { data: { users }, error: listErr } = await adminClient.auth.admin.listUsers();

    if (listErr) {
      return json(500, { error: "Failed to find user" });
    }

    const authUser = users.find(u => u.email === email);

    if (!authUser) {
      return json(400, { error: "No account found for this email" });
    }

    // ─── Update password ───
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      authUser.id,
      { password: newPassword }
    );

    if (updateErr) {
      return json(500, { error: "Failed to update password" });
    }

    // ─── Mark OTP as used ───
    await adminClient
      .from("password_reset_otps")
      .update({ used: true })
      .eq("id", record.id);

    return json(200, { message: "Password updated successfully" });

  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});