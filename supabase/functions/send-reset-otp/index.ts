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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  try {
    const body = await req.json();

// ─── Input sanitization ───
const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);

if (!email || email.length < 5 || !email.includes("@")) {
  return json(400, { error: "Valid email is required" });
}

// Block obviously malicious input
if (/[<>'";\{\}]/.test(email)) {
  return json(400, { error: "Invalid email address" });
}

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ─── Rate limit: max 3 OTP requests per email per hour ───
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count, error: countErr } = await adminClient
      .from("password_reset_otps")
      .select("*", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", oneHourAgo);

    if (countErr) {
      console.error("Rate limit check error:", countErr);
      return json(500, { error: "Server error" });
    }

    if ((count ?? 0) >= 3) {
      return json(429, {
        error: "Too many OTP requests. Please wait 1 hour before trying again."
      });
    }

    // ─── Check email exists in profiles ───
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    // Don't reveal if email exists — same message either way
    if (!profile) {
      return json(200, { message: "If that email is registered, an OTP has been sent." });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    // Delete old unused OTPs for this email
    await adminClient
      .from("password_reset_otps")
      .delete()
      .eq("email", email)
      .eq("used", false);

    // Insert new OTP
    const { error: insertErr } = await adminClient
      .from("password_reset_otps")
      .insert([{ email, otp, expires_at: expiresAt }]);

    if (insertErr) {
      console.error("OTP insert error:", insertErr);
      return json(500, { error: "Failed to save OTP" });
    }

    // Send email via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ANM Audit Tool <onboarding@resend.dev>",
        to: [email],
        subject: "Your Password Reset OTP",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;
                      background:#0f172a;border-radius:16px;color:#e2e8f0;">
            <h2 style="margin:0 0 12px;color:#fff;">Password Reset OTP</h2>
            <p style="color:#94a3b8;margin:0 0 24px;">
              Use the code below to reset your password. 
              It expires in <strong style="color:#fff;">10 minutes</strong>.
            </p>
            <div style="font-size:36px;font-weight:bold;letter-spacing:10px;
                        text-align:center;padding:24px;background:#1e293b;
                        border-radius:12px;margin:0 0 24px;color:#4f7cff;">
              ${otp}
            </div>
            <p style="color:#475569;font-size:12px;margin:0;">
              If you didn't request this, you can safely ignore this email.
              This OTP can only be used once.
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return json(500, { error: "Failed to send OTP email" });
    }

    return json(200, { message: "If that email is registered, an OTP has been sent." });

  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});