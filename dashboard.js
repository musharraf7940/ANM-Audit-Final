import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs";

import { createClient } from 
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabase = createClient(
  'https://tdcusqldrsrogtsafeev.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkY3VzcWxkcnNyb2d0c2FmZWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4NDE1NTMsImV4cCI6MjA4MjQxNzU1M30.9fdzFs34W4_o3NSHJ_dEFZf2zGjVH1ogDpWBRrtQHxU'
);

let currentUser = null;
let currentRole = null;
let activeReviewFileId = null;
let activePdfDoc = null;
let highlightMode = false;
let _confirmResolve = null;
let allAudits = [];      // store all rows from DB
let currentSearch = "";  // current search text
let currentStatus = "all";

async function createNotification(targetUserId, auditId, type, message) {
  // 1) Save in-app notification (your current system)
  const { error: notifErr } = await supabase.from("notifications").insert([{
    user_id: targetUserId,
    audit_id: auditId,
    type,
    message
  }]);

  if (notifErr) {
    console.error("createNotification insert error:", notifErr);
    return; // stop here
  }

  // 2) Send email via Edge Function (NEW)
  try {
    const { data, error } = await supabase.functions.invoke("send-notification-email", {
  body: {
    targetUserId: targetUserId,
    auditId: auditId,
    type: type,
    message: message
  }
});

    if (error) {
      console.error("email function invoke error:", error);
    } else {
      console.log("email function ok:", data);
    }
  } catch (e) {
    console.error("email function invoke crashed:", e);
  }
}

async function sendEmailNotification(targetUserId, auditId, type, message) {
  const { data, error } = await supabase.functions.invoke("send-notification-email", {
    body: { targetUserId, auditId, type, message }
  });

  if (error) {
    console.error("Email invoke error:", error);
  }
  return data;
}

async function renderNotifications() {
  const panelList = document.getElementById("notificationsList");
  if (!panelList) return;

  const { data, error } = await supabase
    .from("notifications")
    .select("id, message, type, created_at, is_read")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("load notifications error:", error);
    panelList.innerHTML = "<em>Failed to load notifications.</em>";
    return;
  }

  if (!data || data.length === 0) {
    panelList.innerHTML = "<em>No notifications</em>";
    return;
  }

  panelList.innerHTML = data.map(n => `
    <div class="notif-item">
      <div class="notif-msg">${escapeHtml(n.message)}</div>
      <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
    </div>
  `).join("");
}

async function markAllNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", currentUser.id)
    .eq("is_read", false);

  if (error) {
    console.error("markAllNotificationsRead error:", error);
  }
}

async function getPartners() {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "partner");
  return data || [];
}


function confirmModal({ title="Confirm", message="Are you sure?", okText="OK" } = {}) {
  const modal = document.getElementById("confirmModal");
  const titleEl = document.getElementById("confirmTitle");
  const msgEl = document.getElementById("confirmMessage");
  const okBtn = document.getElementById("confirmOkBtn");
  const cancelBtn = document.getElementById("confirmCancelBtn");

  titleEl.textContent = title;
  msgEl.textContent = message;
  okBtn.textContent = okText;

  modal.style.display = "flex";

  return new Promise((resolve) => {
    _confirmResolve = resolve;

    okBtn.onclick = () => {
      modal.style.display = "none";
      _confirmResolve(true);
    };

    cancelBtn.onclick = () => {
      modal.style.display = "none";
      _confirmResolve(false);
    };
  });
}

function renameModal(defaultValue = "") {
  const modal = document.getElementById("renameModal");
  const input = document.getElementById("renameInput");
  const okBtn = document.getElementById("renameOkBtn");
  const cancelBtn = document.getElementById("renameCancelBtn");

  modal.style.display = "flex";
  input.value = defaultValue;
  input.focus();

  return new Promise((resolve) => {
    okBtn.onclick = () => {
      const value = input.value.trim();
      modal.style.display = "none";
      resolve(value || null);
    };

    cancelBtn.onclick = () => {
      modal.style.display = "none";
      resolve(null);
    };
  });
}

function setLoading(isLoading, text = "Please wait...") {
  const overlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");

  if (!overlay) return;

  loadingText.textContent = text;
  overlay.style.display = isLoading ? "flex" : "none";
}


async function loadUser() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return console.error("getUser error:", userErr);

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  // Create profile row if missing (safe)
  const { error: upsertErr } = await supabase
    .from("profiles")
    .upsert([{ id: user.id, email: user.email }], { onConflict: "id" });

  if (upsertErr) console.error("profiles upsert error:", upsertErr);

  // Now fetch role
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) return console.error("Profile fetch error:", profileErr);

  currentRole = profile?.role || "audit"; // fallback if role is null

  document.getElementById("welcome").innerText = `Welcome (${currentRole})`;

  // Role badge
  const badge = document.getElementById("roleBadge");
  const dot = document.getElementById("roleDot");
  const text = document.getElementById("roleText");

  if (badge && dot && text) {
    badge.style.display = "inline-flex";
    dot.className = `role-dot ${currentRole}`;
    text.textContent = currentRole === "partner" ? "Partner" : "Audit Team";
  }

  wireCommentsClose();
  wireFilters();
  await loadAudits();
  await loadNotifications();
}

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const selectBtn = document.getElementById("selectFileBtn");

  if (fileInput && selectBtn) {
    selectBtn.onclick = () => fileInput.click();

    fileInput.onchange = () => {
      const name = fileInput.files?.[0]?.name;
      selectBtn.textContent = name ? name : "Select file";
    };
  }
});

async function loadNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", currentUser.id)
    .eq("is_read", false);

  if (error) {
    console.error("loadNotifications error:", error);
    return;
  }

  const count = data?.length || 0;
  const badge = document.getElementById("notifCount");
  if (!badge) return;

  if (count > 0) {
    badge.innerText = count;
    badge.style.display = "block";
  } else {
    badge.style.display = "none";
  }
}
async function loadAudits() {

  const { data, error } = await supabase
    .from('audit')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allAudits = data || [];
  renderAudits(); // ✅ this will handle container + UI

}

function renderAudits() {
  const container = document.getElementById("fileList");
  const emptyState = document.getElementById("emptyState");
  if (!container) return;

  const q = currentSearch.trim().toLowerCase();

  const filtered = allAudits.filter(a => {
    // status filter
    const statusOk = (currentStatus === "all") || (a.status === currentStatus);

    // search filter (by file_name)
    const searchOk = !q || (a.file_name || "").toLowerCase().includes(q);

    return statusOk && searchOk;
  });

  container.innerHTML = "";

  if (emptyState) emptyState.style.display = filtered.length ? "none" : "block";

  filtered.forEach(audit => {
    const row = document.createElement("div");

    const badgeClass =
      audit.status === "approved" ? "good" :
      audit.status === "changes_requested" ? "danger" :
      "warn";

    row.className = "card";

    row.innerHTML = `
      <div class="card-top">
        <div>
          <p class="file-name">${audit.file_name}</p>
          <div class="meta">
            <span>Uploaded: ${new Date(audit.created_at).toLocaleString()}</span>
          </div>
        </div>
        <span class="badge ${badgeClass}">${audit.status}</span>
      </div>

      <div class="actions">
        <button class="btn" onclick="downloadFile('${audit.file_url}')">Download</button>

        <button class="btn" onclick="openHistory('${audit.id}')">History</button>

        <button class="btn" onclick="openFiles('${audit.id}', '${audit.file_url}', '${audit.file_name}')">Files</button>

        ${
          audit.preview_url
            ? `<button class="btn" onclick="openReview('${audit.id}', '${audit.preview_url}')">Review</button>`
            : `<button class="btn" onclick="openComments('${audit.id}')">Comments</button>`
        }

   ${
  (audit.status !== "approved")
    ? `<button class="btn" onclick="renameAuditStorage('${audit.id}', '${escapeHtml(audit.file_name || "")}', '${audit.file_url || ""}', '${audit.preview_url || ""}')">Rename</button>`
    : ``
}

        ${
          ((currentRole === "audit" || currentRole === "partner") && audit.status !== "approved")
            ? `
              <div class="file-inline">
                <input type="file" id="reupload-${audit.id}" />
                <button class="btn btn-primary" onclick="reuploadFile('${audit.id}')">Re-upload</button>
              </div>
            `
            : ``
        }

        ${
          (currentRole === "partner" && audit.status !== "approved")
            ? `<button class="btn btn-primary" onclick="approveAudit('${audit.id}')">Approve</button>`
            : ``
        }

        ${
          (currentRole === "partner" && audit.status === "approved")
            ? `<button class="btn btn-danger" onclick="disapproveAudit('${audit.id}')">Disapprove</button>`
            : ``
        }

        ${
          (currentRole === "partner") ||
          (currentRole === "audit" && audit.status === "under_review")
            ? `<button class="btn btn-danger" onclick="deleteAudit('${audit.id}','${audit.file_url || ''}','${audit.preview_url || ''}')">Delete</button>`
            : ``
        }
      </div>
    `;

    container.appendChild(row);
  });
}


function downloadFile(url) {
  window.open(url, '_blank')
}

async function uploadFile() {
  const input = document.getElementById("fileInput");
  const file = input?.files?.[0];
  if (!file) return toast("Please choose a file first", "warning");

  // Ask name ONCE
  const raw = await renameModal("");
  if (raw === null) return; // user cancelled -> do nothing

  const baseName = sanitizeName(raw);
  if (!baseName) return toast("File name is required.", "warning");

  const finalName = buildFinalName(file.name, baseName);
  const filePath = `audits/${Date.now()}_${finalName}`;

  setLoading(true, "Uploading...");
  try {
    // 1) Upload to storage
    const { error: uploadErr } = await supabase.storage
      .from("audit-files")
      .upload(filePath, file, { upsert: false });

    if (uploadErr) {
      console.error(uploadErr);
      return toast("Upload failed", "error");
    }

    // 2) Get public URL
    const { data: pub } = supabase.storage.from("audit-files").getPublicUrl(filePath);

    // 3) Insert into audit (current/latest file)
    const { data: inserted, error: insertErr } = await supabase
      .from("audit")
      .insert([{
        file_name: finalName,
        file_url: pub.publicUrl,
        status: "under_review",
        audit_team_id: currentUser.id
      }])
      .select("id")
      .single();

    if (insertErr) {
      console.error(insertErr);
      return toast("DB insert failed", "error");
    }

    // ✅ STEP 2: Save first version into audit_versions
    const { error: verErr } = await supabase
      .from("audit_versions")
      .insert([{
        audit_id: inserted.id,
        file_name: finalName,
        file_url: pub.publicUrl,
        uploaded_by: currentUser.id,
        uploaded_by_role: currentRole
      }]);

    if (verErr) {
      console.error("audit_versions insert error:", verErr);
      // Not fatal, but tell user (optional)
      toast("Uploaded, but history save failed (check RLS).", "warning");
    }

    toast("Uploaded ✅", "success");
    input.value = "";

    await loadAudits();
    await loadNotifications();
  } finally {
    setLoading(false);
  }
}

window.uploadFile = uploadFile;



async function renameAuditStorage(auditId, currentFileName, fileUrl, previewUrl) {
  if (!auditId || !fileUrl) {
    toast("Missing file info", "error");
    return;
  }

  // Block audit renaming approved files (partner rule: you can decide; this blocks everyone by UI already)
  // DB/RLS should also protect approved rows from audit updates.
  const baseCurrent = (currentFileName || "").includes(".")
    ? currentFileName.slice(0, currentFileName.lastIndexOf("."))
    : (currentFileName || "");

 const raw = await renameModal(baseCurrent);
if (raw === null) return;

const newBase = sanitizeName(raw);
if (!newBase) return toast("File name is required.", "warning");

  // Keep same extension from currentFileName (fallback from URL if needed)
  const ext = (currentFileName || "").includes(".")
    ? currentFileName.split(".").pop()
    : "";

  const newFileName = ext ? `${newBase}.${ext}` : newBase;

  // OLD PATH in storage (audit-files bucket)
  const oldPath = extractStoragePath(fileUrl, "audit-files");
  if (!oldPath) return toast("Could not read old storage path", "error");

  // Put renamed file in SAME folder as oldPath
  const folder = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
  const newPath = `${folder}${Date.now()}_${newFileName}`;

  setLoading(true, "Renaming...");
  try {
    // 1) Move XLSX file in storage
    const { error: moveErr } = await supabase.storage
      .from("audit-files")
      .move(oldPath, newPath);

    if (moveErr) {
      console.error("move error:", moveErr);
      toast("Rename failed (storage permission / RLS).", "error");
      return;
    }

    // 2) New public URL
    const { data: pub } = supabase.storage.from("audit-files").getPublicUrl(newPath);
    const newFileUrl = pub?.publicUrl;

    // 3) If you also have preview PDF, rename/move it too (optional)
    let newPreviewUrl = previewUrl || null;

    if (previewUrl) {
      const oldPreviewPath = extractStoragePath(previewUrl, "audit-previews");
      if (oldPreviewPath) {
        const previewFolder = oldPreviewPath.includes("/")
          ? oldPreviewPath.slice(0, oldPreviewPath.lastIndexOf("/") + 1)
          : "";

        const newPreviewPath = `${previewFolder}${Date.now()}_${newBase}.pdf`;

        const { error: movePrevErr } = await supabase.storage
          .from("audit-previews")
          .move(oldPreviewPath, newPreviewPath);

        if (movePrevErr) {
          // Not fatal — XLSX rename succeeded, preview rename failed
          console.warn("preview move warning:", movePrevErr);
        } else {
          const { data: pubPrev } = supabase.storage.from("audit-previews").getPublicUrl(newPreviewPath);
          newPreviewUrl = pubPrev?.publicUrl || newPreviewUrl;
        }
      }
    }

    // 4) Update DB display name + file URL (+ preview URL if changed)
    const updatePayload = {
      file_name: newFileName,
      file_url: newFileUrl
    };
    if (newPreviewUrl !== previewUrl) updatePayload.preview_url = newPreviewUrl;

    const { error: dbErr } = await supabase
      .from("audit")
      .update(updatePayload)
      .eq("id", auditId);

    if (dbErr) {
      console.error("db update error:", dbErr);
      toast("Renamed in storage, but DB update failed.", "error");
      return;
    }

    toast("Renamed ✅", "success");
    loadAudits(); // or renderAudits() if you're using that pattern
  } finally {
    setLoading(false);
  }
}

window.renameAuditStorage = renameAuditStorage;

async function reuploadFile(auditId) {
  const fileInput = document.getElementById(`reupload-${auditId}`);
  const file = fileInput?.files?.[0];

  if (!file) return toast("Please select a file first", "warning");

  // Ask new name for re-upload (you can change to renameModal later if you want)
  const raw = prompt("Enter NEW file name (without extension):", "");
  if (raw === null) return; // cancelled

  const baseName = sanitizeName(raw);
  if (!baseName) return toast("File name is required.", "warning");

  const finalName = buildFinalName(file.name, baseName);
  const filePath = `audits/${Date.now()}_${finalName}`;

  setLoading(true, "Re-uploading...");
  try {
    // 1) Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("audit-files")
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      console.error(uploadError);
      return toast("Upload failed", "error");
    }

    // 2) Get public URL
    const { data } = supabase.storage
      .from("audit-files")
      .getPublicUrl(filePath);

    // ✅ STEP 3: Save this new version into audit_versions BEFORE updating audit row
    const { error: verErr } = await supabase
      .from("audit_versions")
      .insert([{
        audit_id: auditId,
        file_name: finalName,
        file_url: data.publicUrl,
        uploaded_by: currentUser.id,
        uploaded_by_role: currentRole
      }]);

    if (verErr) {
      console.error("audit_versions insert error:", verErr);
      toast("Re-uploaded, but history save failed (check RLS).", "warning");
      // continue anyway
    }

    // 3) Update audit table (current/latest file)
    const { error: updateErr } = await supabase
      .from("audit")
      .update({
        file_name: finalName,
        file_url: data.publicUrl,
        status: "resubmitted"
      })
      .eq("id", auditId);

    if (updateErr) {
      console.error(updateErr);
      return toast("DB update failed", "error");
    }

    // Notify partners (your existing logic)
    const partners = await getPartners();
    for (const p of partners) {
      await createNotification(
        p.id,
        auditId,
        "reupload",
        "Audit team re-submitted an audit file."
      );
    }

    toast("Re-uploaded ✅", "success");
    fileInput.value = "";

    await loadAudits();
    await loadNotifications();
  } finally {
    setLoading(false);
  }
}

window.reuploadFile = reuploadFile;


function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/[\/\\:*?"<>|]/g, "-"); // Windows/URL unsafe characters
}

function buildFinalName(originalFileName, customBaseName) {
  const ext = originalFileName.includes(".") ? originalFileName.split(".").pop() : "";
  const base = sanitizeName(customBaseName);
  return ext ? `${base}.${ext}` : base;
}


async function approveAudit(auditId) {
  if (currentRole !== "partner") return toast("Only partner can approve.");

  const { data: auditRow, error } = await supabase
    .from("audit")
    .update({ status: "approved" })
    .eq("id", auditId)
    .select("audit_team_id")
    .single();

  if (error) {
    console.error(error);
    return toast("Approve failed", "error");
  }

  await createNotification(
    auditRow.audit_team_id,
    auditId,
    "approve",
    "Your audit file has been approved."
  );

  toast("Approved ✅", "success");
  await loadAudits();
  await loadNotifications();
}
async function deleteAudit(auditId, fileUrl, previewUrl) {
  const ok = await confirmModal({
    title: "Delete this file?",
    message: "This will delete the record and remove the stored files (if allowed).",
    okText: "Delete"
  });
  if (!ok) return;

  setLoading(true, "Deleting...");
  try {
    // 1) Delete files from storage (best effort)
    try {
      const filePath = extractStoragePath(fileUrl, "audit-files");
      if (filePath) {
        await supabase.storage.from("audit-files").remove([filePath]);
      }

      const previewPath = extractStoragePath(previewUrl, "audit-previews");
      if (previewPath) {
        await supabase.storage.from("audit-previews").remove([previewPath]);
      }
    } catch (e) {
      console.warn("Storage delete warning:", e);
    }

    // 2) Delete the audit row (RLS will enforce who can delete)
    const { error } = await supabase.from("audit").delete().eq("id", auditId);

    if (error) {
      console.error(error);
      toast("Delete failed (permission / RLS).", "error");
      return;
    }

    toast("Deleted ✅", "success");
    loadAudits();
  } finally {
    setLoading(false);
  }
}

window.deleteAudit = deleteAudit;

// Helper: convert public URL -> storage path inside bucket
function extractStoragePath(publicUrl, bucketName) {
  if (!publicUrl) return null;

  try {
    const u = new URL(publicUrl);
    // pathname example:
    // /storage/v1/object/public/audit-files/audits/123_file.xlsx
    const parts = u.pathname.split(`/object/public/${bucketName}/`);
    if (parts.length < 2) return null;
    return decodeURIComponent(parts[1]); // audits/123_file.xlsx
  } catch {
    return null;
  }
}

async function disapproveAudit(auditId) {
  if (currentRole !== "partner") return toast("Only partner can disapprove.");

  const { data: auditRow, error } = await supabase
    .from("audit")
    .update({ status: "changes_requested" })
    .eq("id", auditId)
    .select("audit_team_id")
    .single();

  if (error) {
    console.error(error);
    return toast("Disapprove failed", "error");
  }

  await createNotification(
    auditRow.audit_team_id,
    auditId,
    "disapprove",
    "Changes requested for your audit file."
  );

  toast("Changes requested ✅", "success");
  await loadAudits();
  await loadNotifications();
}

window.disapproveAudit = disapproveAudit;


let activeFileId = null;

async function openComments(fileId) {
  activeFileId = fileId;

  const panel = document.getElementById("commentsPanel");
  const list = document.getElementById("commentsList");
  const composer = document.getElementById("commentComposer");
  const sendBtn = document.getElementById("sendCommentBtn");
  sendBtn.onclick = addComment;

  if (!panel || !list || !composer || !sendBtn) {
    console.error("Comments panel elements not found in dashboard.html");
    toast("Comments UI not found. Add commentsPanel HTML first.");
    return;
  }

  panel.style.display = "block";
  list.innerHTML = "Loading comments...";

  // Both partner and audit can comment
composer.style.display =
  (currentRole === "partner" || currentRole === "audit")
    ? "block"
    : "none";

 const { data, error } = await supabase
  .from("file_comments")
  .select(`
    id,
    comment,
    created_at,
    user_id,
    profiles(role, email)
  `)
  .eq("file_id", fileId)
  .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    list.innerHTML = "Failed to load comments.";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<em>No comments yet.</em>";
  } else {
    list.innerHTML = data.map(c => {
  const when = new Date(c.created_at).toLocaleString();
  const role = c.profiles?.role || "user";
  const email = c.profiles?.email || "(no email)";
  return `
    <div class="comment">
      <div class="top">
        <span>${email} • ${role}</span>
        <span>${when}</span>
      </div>
      <div>${escapeHtml(c.comment)}</div>
    </div>
  `;
}).join("");
  }

  // bind send button
  sendBtn.onclick = addComment;
}
window.openComments = openComments;

function toast(message, type = "info") {
  const el = document.getElementById("toast");

  // Never call toast() again here (prevents infinite recursion)
  if (!el) {
    console.log(`[toast:${type}]`, message);
    return;
  }

  el.style.display = "block";
  el.className = `toast ${type}`;
  el.textContent = message;

  // show animation
  requestAnimationFrame(() => el.classList.add("show"));

  // clear previous timers so multiple toasts behave nicely
  clearTimeout(window.__toastHideTimer);

  window.__toastHideTimer = setTimeout(() => {
    el.classList.remove("show");
    // hide after animation
    setTimeout(() => (el.style.display = "none"), 350);
  }, 3000);
}

async function addComment() {
  const textArea = document.getElementById("commentComposer");
  const commentText = (textArea?.value || "").trim();

  if (!commentText) return toast("Write a comment first.");

  const { error } = await supabase
    .from("file_comments")
    .insert([{
      file_id: activeFileId,
      user_id: currentUser.id,
      comment: commentText
    }]);

  if (error) {
    console.error("insert comment error:", error);
    toast("Failed to add comment (check RLS).");
    return;
  }

  const { data: auditRow } = await supabase
  .from("audit")
  .select("audit_team_id")
  .eq("id", activeFileId)
  .single();

if (currentRole === "partner") {
  await createNotification(
    auditRow.audit_team_id,
    activeFileId,
    "comment",
    "Partner commented on your audit file."
  );
} else {
  const partners = await getPartners();
  for (const p of partners) {
    await createNotification(
      p.id,
      activeFileId,
      "comment",
      "Audit team commented on a file."
    );
  }
}



  textArea.value = "";
  openComments(activeFileId);
  await loadNotifications();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}

window.logout = logout;


function wireCommentsClose() {
  const closeBtn = document.getElementById("closeCommentsBtn");
  if (!closeBtn) return;

  closeBtn.onclick = () => {
    document.getElementById("commentsPanel").style.display = "none";
    activeFileId = null;
  };
}

window.approveAudit = approveAudit;
window.openComments = openComments;
window.openReview = openReview;

function wireReviewModal() {
  const closeBtn = document.getElementById("closeReviewBtn");
  if (closeBtn) {
    closeBtn.onclick = () => {
      document.getElementById("reviewModal").style.display = "none";
      document.getElementById("pdfPages").innerHTML = "";
      activeReviewFileId = null;
      activePdfDoc = null;
      highlightMode = false;
    };
  }

  const highlightBtn = document.getElementById("highlightModeBtn");
  if (highlightBtn) {
    highlightBtn.onclick = () => {
      highlightMode = !highlightMode;
      document.getElementById("reviewHint").innerText =
        highlightMode ? "Drag on the PDF to highlight" : "";
    };
  }
}

async function openReview(fileId, previewUrl) {
  if (!previewUrl) {
    toast("PDF preview not ready yet.");
    return;
  }

  activeReviewFileId = fileId;

  document.getElementById("reviewModal").style.display = "block";
  document.getElementById("pdfPages").innerHTML = "Loading PDF...";

  // Load PDF
  activePdfDoc = await pdfjsLib.getDocument(previewUrl).promise;

  const pagesDiv = document.getElementById("pdfPages");
  pagesDiv.innerHTML = "";

  for (let pageNum = 1; pageNum <= activePdfDoc.numPages; pageNum++) {
    const page = await activePdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });

    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.marginBottom = "20px";

    // Canvas for PDF page
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    // Overlay for annotations
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = canvas.width + "px";
    overlay.style.height = canvas.height + "px";

    wrapper.appendChild(canvas);
    wrapper.appendChild(overlay);
    pagesDiv.appendChild(wrapper);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Load existing annotations for this page
    await renderAnnotations(fileId, pageNum, overlay, canvas);

    // Enable drawing highlight (partner only)
    enableHighlightDrawing(pageNum, overlay, canvas);
  }
}

async function renderAnnotations(fileId, pageNum, overlay, canvas) {
  const { data, error } = await supabase
    .from("file_annotations")
    .select("*")
    .eq("file_id", fileId)
    .eq("page", pageNum)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  overlay.innerHTML = "";

  data.forEach(a => {
    const box = document.createElement("div");
    box.style.position = "absolute";
    box.style.left = (a.x * canvas.width) + "px";
    box.style.top = (a.y * canvas.height) + "px";
    box.style.width = (a.w * canvas.width) + "px";
    box.style.height = (a.h * canvas.height) + "px";
    box.style.background = "rgba(255, 255, 0, 0.35)";
    box.style.border = "1px solid rgba(200, 200, 0, 0.8)";
    box.title = a.comment || "";
    overlay.appendChild(box);
  });
}

function enableHighlightDrawing(pageNum, overlay, canvas) {
  // Only partner can create highlights
  if (currentRole !== "partner") return;

  let startX = 0, startY = 0;
  let tempBox = null;
  let drawing = false;

  overlay.onmousedown = (e) => {
    if (!highlightMode) return;

    drawing = true;
    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    tempBox = document.createElement("div");
    tempBox.style.position = "absolute";
    tempBox.style.left = startX + "px";
    tempBox.style.top = startY + "px";
    tempBox.style.background = "rgba(255,255,0,0.35)";
    tempBox.style.border = "1px dashed #999";
    overlay.appendChild(tempBox);
  };

  overlay.onmousemove = (e) => {
    if (!drawing || !tempBox) return;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    tempBox.style.left = Math.min(startX, x) + "px";
    tempBox.style.top = Math.min(startY, y) + "px";
    tempBox.style.width = Math.abs(x - startX) + "px";
    tempBox.style.height = Math.abs(y - startY) + "px";
  };

  overlay.onmouseup = async () => {
    if (!drawing || !tempBox) return;
    drawing = false;

    const left = parseFloat(tempBox.style.left);
    const top = parseFloat(tempBox.style.top);
    const width = parseFloat(tempBox.style.width);
    const height = parseFloat(tempBox.style.height);

    overlay.removeChild(tempBox);
    tempBox = null;

    // tiny drag ignored
    if (width < 8 || height < 8) return;

    const comment = prompt("Add comment for this highlight:", "");
    if (comment === null) return; // cancelled

    // Save normalized coords (0..1)
    const payload = {
      file_id: activeReviewFileId,
      user_id: currentUser.id,
      page: pageNum,
      x: left / canvas.width,
      y: top / canvas.height,
      w: width / canvas.width,
      h: height / canvas.height,
      comment: comment,
      type: "highlight"
    };

    const { error } = await supabase.from("file_annotations").insert([payload]);
    if (error) {
      console.error(error);
      toast("Failed to save annotation (check RLS).");
      return;
    }

    // Re-render annotations
    await renderAnnotations(activeReviewFileId, pageNum, overlay, canvas);
  };
}

function wireFilters() {
  const searchEl = document.getElementById("searchInput");
  const statusEl = document.getElementById("statusFilter");

  if (searchEl) {
    searchEl.addEventListener("input", (e) => {
      currentSearch = e.target.value || "";
      renderAudits();
    });
  }

  if (statusEl) {
    statusEl.addEventListener("change", (e) => {
      currentStatus = e.target.value || "all";
      renderAudits();
    });
  }
}

let activeAuditForFiles = null;

function wireFilesModal() {
  const closeBtn = document.getElementById("closeFilesModalBtn");
  if (closeBtn) {
    closeBtn.onclick = () => {
      document.getElementById("filesModal").style.display = "none";
      activeAuditForFiles = null;
    };
  }
}

async function openFiles(auditId, mainFileUrl, mainFileName) {
  activeAuditForFiles = auditId;

  // show modal
  document.getElementById("filesModal").style.display = "flex";

  // main file link
  const mainArea = document.getElementById("mainFileArea");
  mainArea.innerHTML = `<a href="${mainFileUrl}" target="_blank">${escapeHtml(mainFileName)}</a>`;

  // load attachments
  await loadAttachments(auditId);

  // upload handler
  const uploadBtn = document.getElementById("attachUploadBtn");
  uploadBtn.onclick = () => uploadAttachment(auditId);
}

async function loadAttachments(auditId) {
  const list = document.getElementById("attachmentsList");
  list.innerHTML = "Loading...";

  const { data, error } = await supabase
    .from("audit_attachments")
    .select("id, file_name, file_url, created_at")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    list.innerHTML = "<em>Failed to load supporting files.</em>";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<em>No supporting files yet.</em>";
    return;
  }

  list.innerHTML = data.map(a => `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;
                padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;
                margin-bottom:8px;background:rgba(255,255,255,0.03);">
      <div style="min-width:0;">
        <div style="font-weight:600;word-break:break-word;">${escapeHtml(a.file_name)}</div>
        <div style="opacity:0.7;font-size:12px;">${new Date(a.created_at).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn" onclick="downloadFile('${a.file_url}')">Download</button>
        <button class="btn btn-danger" onclick="deleteAttachment('${a.id}', '${a.file_url}')">Delete</button>
      </div>
    </div>
  `).join("");
}

async function uploadAttachment(auditId) {
  const input = document.getElementById("attachInput");
  const file = input?.files?.[0];
  if (!file) return toast("Choose a supporting file first.", "warning");

  setLoading(true, "Uploading supporting file...");
  try {
    const filePath = `audits/${auditId}/attachments/${Date.now()}_${file.name}`;

    const { error: upErr } = await supabase.storage
      .from("audit-files")
      .upload(filePath, file);

    if (upErr) {
      console.error(upErr);
      toast("Attachment upload failed.", "error");
      return;
    }

    const { data: pub } = supabase.storage.from("audit-files").getPublicUrl(filePath);

    const { error: insErr } = await supabase
      .from("audit_attachments")
      .insert([{
        audit_id: auditId,
        file_name: file.name,
        file_url: pub.publicUrl,
        uploaded_by: currentUser.id
      }]);

    if (insErr) {
      console.error(insErr);
      toast("Attachment DB insert failed.", "error");
      return;
    }

    toast("Supporting file uploaded ✅", "success");
    input.value = "";
    await loadAttachments(auditId);
  } finally {
    setLoading(false);
  }
}

async function deleteAttachment(attachmentId, fileUrl) {
  const ok = await confirmModal({
    title: "Delete supporting file?",
    message: "This will remove the supporting file.",
    okText: "Delete"
  });
  if (!ok) return;

  setLoading(true, "Deleting...");
  try {
    // best effort storage delete
    const path = extractStoragePath(fileUrl, "audit-files");
    if (path) {
      await supabase.storage.from("audit-files").remove([path]);
    }

    // delete DB row (RLS enforces permissions)
    const { error } = await supabase
      .from("audit_attachments")
      .delete()
      .eq("id", attachmentId);

    if (error) {
      console.error(error);
      toast("Delete failed (RLS).", "error");
      return;
    }

    toast("Deleted ✅", "success");
    await loadAttachments(activeAuditForFiles);
  } finally {
    setLoading(false);
  }
}

// expose for onclick
window.openFiles = openFiles;
window.deleteAttachment = deleteAttachment;


async function openHistory(auditId) {
  const modal = document.getElementById("historyModal");
  const list = document.getElementById("historyList");

  if (!modal || !list) {
    toast("History UI not found", "error");
    return;
  }

  modal.style.display = "block";
  list.innerHTML = "Loading history...";

  const { data, error } = await supabase
    .from("audit_versions")
    .select(`
      id,
      file_name,
      file_url,
      created_at,
      uploaded_by,
      profiles:uploaded_by ( email, role )
    `)
    .eq("audit_id", auditId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    list.innerHTML = "<em>Failed to load history.</em>";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<em>No history yet.</em>";
    return;
  }

  list.innerHTML = data.map(v => {
    const when = new Date(v.created_at).toLocaleString();
    const email = v.profiles?.email || "(no email)";
    const role = v.profiles?.role || v.uploaded_by_role || "user";

    return `
      <div class="comment">
        <div class="top">
          <span>${escapeHtml(email)} • ${escapeHtml(role)}</span>
          <span>${when}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div style="min-width:0;">
            <div style="font-weight:600;word-break:break-word;">${escapeHtml(v.file_name)}</div>
          </div>
          <div style="flex-shrink:0;">
            <button class="btn" onclick="downloadFile('${v.file_url}')">Download</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function closeHistory() {
  const modal = document.getElementById("historyModal");
  if (modal) modal.style.display = "none";
}

window.openHistory = openHistory;
window.closeHistory = closeHistory;


async function toggleNotifications() {
  const panel = document.getElementById("notificationsPanel");
  if (!panel) return;

  const isOpen = panel.style.display === "block";
  panel.style.display = isOpen ? "none" : "block";

  if (!isOpen) {
    await renderNotifications();
    await markAllNotificationsRead();
    await loadNotifications(); // refresh badge
  }
}

window.toggleNotifications = toggleNotifications;


wireFilesModal();
wireReviewModal();
loadUser(); // ok




uploadFile


