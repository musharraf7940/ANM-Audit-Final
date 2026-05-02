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

const EMAIL_SUBJECTS: Record<string, string> = {
  upload:     "📁 New Audit File Uploaded",
  reupload:   "🔄 Audit File Re-submitted",
  comment:    "💬 New Comment on Audit File",
  approve:    "✅ Audit File Approved",
  disapprove: "❌ Changes Requested on Audit File",
};

function buildEmailHtml(message: string, type: string): string {
  const colorMap: Record<string, string> = {
    upload:     "#4f7cff",
    reupload:   "#fbbf24",
    comment:    "#a78bfa",
    approve:    "#2dd4bf",
    disapprove: "#ff4f6d",
  };
  const color = colorMap[type] || "#4f7cff";

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;
                background:#0f172a;border-radius:16px;color:#e2e8f0;">
      <div style="margin-bottom:24px;">
        <div style="display:inline-block;padding:8px 16px;border-radius:999px;
                    background:${color}22;border:1px solid ${color}66;
                    color:${color};font-size:13px;font-weight:600;">
          ANM Audit Tool
        </div>
      </div>
      <h2 style="margin:0 0 12px;font-size:20px;color:#fff;">
        ${EMAIL_SUBJECTS[type] || "Audit Notification"}
      </h2>
      <p style="margin:0 0 24px;color:#94a3b8;line-height:1.6;font-size:15px;">
        ${message}
      </p>
      <div style="border-top:1px solid #1e293b;padding-top:16px;
                  color:#475569;font-size:12px;">
        This is an automated notification from ANM Audit Tool.
      </div>
    </div>
  `;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "ANM Audit Tool <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Use POST" });
  }

  try {
    const body = await req.json();
    const { targetUserId, auditId, type, message } = body;

    if (!targetUserId || !type || !message) {
      return json(400, { error: "targetUserId, type, and message are required" });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get target user's email from profiles
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", targetUserId)
      .maybeSingle();

    if (profileErr || !profile?.email) {
      console.error("Could not find target user email:", profileErr);
      return json(404, { error: "Target user email not found" });
    }

    const subject = EMAIL_SUBJECTS[type] || "Audit Notification";
    const html = buildEmailHtml(message, type);

    const sent = await sendEmail(profile.email, subject, html);

    if (!sent) {
      return json(500, { error: "Failed to send email" });
    }

    return json(200, { ok: true, message: "Email sent successfully" });

  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});