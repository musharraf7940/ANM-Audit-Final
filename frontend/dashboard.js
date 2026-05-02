import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs";

import { createClient } from 
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'


const supabase = createClient(
  'https://tdcusqldrsrogtsafeev.supabase.co',
  'sb_publishable_zq8kXpPwoXhR10VUKWTLMQ_mYiFocTQ'  
);


// ─── Session expiry handler ───────────────────────
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
    window.location.href = "index.html";
  }

  if (event === "TOKEN_REFRESHED") {
    console.log("Session refreshed ✅");
  }
});


let currentUser = null;
let currentRole = null;
let activeReviewFileId = null;
let activePdfDoc = null;
let highlightMode = false;
let _confirmResolve = null;
let allAudits = [];      // store all rows from DB
let currentSearch = "";  // current search text
let currentStatus = "all";
let allArchiveAudits = [];
let archiveSearch = "";
let archiveYearFilter = "all";
let currentPage = "dashboard"; // 'dashboard' or 'archive'


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

function toggleMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobileNavOverlay");
  const isOpen = sidebar.classList.contains("open");

  if (isOpen) {
    sidebar.classList.remove("open");
    overlay.style.display = "none";
    document.getElementById("hamburgerBtn").textContent = "☰";
  } else {
    sidebar.classList.add("open");
    overlay.style.display = "block";
    document.getElementById("hamburgerBtn").textContent = "✕";
  }
}

function closeMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobileNavOverlay");
  sidebar.classList.remove("open");
  overlay.style.display = "none";
  document.getElementById("hamburgerBtn").textContent = "☰";
}

window.toggleMobileNav = toggleMobileNav;
window.closeMobileNav = closeMobileNav;

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

function switchTab(tab) {
  const filesSection = document.getElementById("filesSection");
  const adminSection = document.getElementById("adminSection");
  const tabFiles = document.getElementById("tabFiles");
  const tabUsers = document.getElementById("tabUsers");

  if (tab === "files") {
    filesSection.style.display = "block";
    adminSection.style.display = "none";
    tabFiles.classList.add("active");
    tabUsers.classList.remove("active");
  } else {
    filesSection.style.display = "none";
    adminSection.style.display = "block";
    tabUsers.classList.add("active");
    tabFiles.classList.remove("active");
  }
}

window.switchTab = switchTab;

function showPage(page) {
  currentPage = page;

  const dashboardContent = document.getElementById("filesSection");
  const adminTabs = document.getElementById("adminTabs");
  const adminSection = document.getElementById("adminSection");
  const archivePage = document.getElementById("archivePage");
  const navDashboard = document.getElementById("navDashboard");
  const navArchive = document.getElementById("navArchive");
  const uploadSection = document.getElementById("uploadSection");
  const pageTitle = document.querySelector(".page-title");

  if (page === "dashboard") {
    dashboardContent.style.display = "block";
    archivePage.style.display = "none";
    navDashboard.classList.add("active");
    navArchive.classList.remove("active");
    uploadSection.style.display = "flex";
    pageTitle.textContent = "Dashboard";

    // restore admin tabs if super_admin
    if (currentRole === "super_admin") {
      adminTabs.style.display = "flex";
    }

    // close mobile nav
    closeMobileNav();
  } else {
    dashboardContent.style.display = "none";
    adminSection.style.display = "none";
    adminTabs.style.display = "none";
    archivePage.style.display = "block";
    navDashboard.classList.remove("active");
    navArchive.classList.add("active");
    uploadSection.style.display = "none";
    pageTitle.textContent = "Approved Audit Files";

    closeMobileNav();
    loadArchive();
  }
}

window.showPage = showPage;

async function loadUser() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return console.error("getUser error:", userErr);

  if (!user) {
    window.location.href = "index.html";
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

if (currentRole === "super_admin") {
  
  document.getElementById("adminTabs").style.display = "flex";
  // Start on Files tab by default
  switchTab("files");
  wireAdminPanel();
  await loadAdminUsers();
}

  document.getElementById("welcome").innerText = `Welcome (${currentRole})`;

  // Role badge
  const badge = document.getElementById("roleBadge");
  const dot = document.getElementById("roleDot");
  const text = document.getElementById("roleText");

  if (badge && dot && text) {
    badge.style.display = "inline-flex";
    dot.className = `role-dot ${currentRole}`;
    text.textContent =
  currentRole === "super_admin"
    ? "Super Admin"
    : currentRole === "partner"
    ? "Partner"
    : "Audit Team";
  }

  
// Show archive nav for partner and super_admin
if (currentRole === "partner" || currentRole === "super_admin") {
  const navArchive = document.getElementById("navArchive");
  if (navArchive) navArchive.style.display = "flex";
}

wireCommentsClose();
wireFilters();
wireArchiveFilters();
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

  
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

const filtered = allAudits.filter(a => {
  // Hide approved files older than 3 days — they live in Archive now
  if (a.status === "approved") {
    const approvedOld = new Date(a.updated_at || a.created_at) < threeDaysAgo;
    if (approvedOld) return false;
  }

  const statusOk = (currentStatus === "all") || (a.status === currentStatus);
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
  <span>Uploaded: ${new Date(audit.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</span>
  ${audit.status === 'approved' && audit.updated_at
    ? `<span style="color:var(--good);">✓ Approved: ${new Date(audit.updated_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</span>`
    : audit.status === 'changes_requested' && audit.updated_at
    ? `<span style="color:var(--danger);">✗ Changes requested: ${new Date(audit.updated_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</span>`
    : audit.status === 'resubmitted' && audit.updated_at
    ? `<span style="color:var(--warn);">↺ Resubmitted: ${new Date(audit.updated_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</span>`
    : ``
  }
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
          // ✅ NEW
        ((currentRole === "audit" || currentRole === "partner" || currentRole === "super_admin") && audit.status !== "approved")
            ? `
              <div class="file-inline">
                <input type="file" id="reupload-${audit.id}" />
                <button class="btn btn-primary" onclick="reuploadFile('${audit.id}')">Re-upload</button>
              </div>
            `
            : ``
        }

        ${
          (currentRole === "partner" || currentRole === "super_admin") && audit.status !== "approved"
  ? `<button class="btn btn-primary" onclick="approveAudit('${audit.id}')">Approve</button>`
            : ``
        }

        ${
          (currentRole === "partner" || currentRole === "super_admin") && audit.status === "approved"
  ? `<button class="btn btn-danger" onclick="disapproveAudit('${audit.id}')">Disapprove</button>`
  : (currentRole === "partner" || currentRole === "super_admin") && audit.status !== "approved" && audit.status !== "changes_requested"
  ? `<button class="btn btn-danger" onclick="requestChanges('${audit.id}')">Request Changes</button>`
  : ``
        }

        ${
          (currentRole === "partner" || currentRole === "super_admin") ||
(currentRole === "audit" && audit.status === "under_review")
  ? `<button class="btn btn-danger" onclick="deleteAudit('${audit.id}','${audit.file_url || ''}','${audit.preview_url || ''}')">Delete</button>`
            : ``
        }
      </div>
    `;

    container.appendChild(row);
  });
}


async function requestChanges(auditId) {
  if (currentRole !== "partner" && currentRole !== "super_admin") {
    return toast("Only partner or admin can request changes.", "error");
  }

  const ok = await confirmModal({
    title: "Request changes?",
    message: "This will notify the audit team to revise this file.",
    okText: "Request Changes"
  });
  if (!ok) return;

  await supabase
    .from("audit")
    .update({ partner_id: currentUser.id })
    .eq("id", auditId)
    .is("partner_id", null);

  const { data: auditRow, error } = await supabase
    .from("audit")
    .update({ status: "changes_requested" })
    .eq("id", auditId)
    .select("audit_team_id")
    .single();

  if (error) {
    console.error(error);
    return toast("Failed to request changes.", "error");
  }

  await createNotification(
    auditRow.audit_team_id,
    auditId,
    "disapprove",
    "Changes have been requested on your audit file."
  );

  toast("Changes requested ✅", "success");
  await loadAudits();
  await loadNotifications();
}

window.requestChanges = requestChanges;

function downloadFile(url) {
  window.open(url, '_blank')
}
window.downloadFile = downloadFile;


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

    // ✅ NEW — no partner notification on upload since no partner is assigned yet
// Partner gets assigned only when they first interact with the file
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
  const raw = await renameModal("");
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
    // ✅ NEW — notify only the assigned partner
const { data: auditRow } = await supabase
  .from("audit")
  .select("partner_id")
  .eq("id", auditId)
  .single();

if (auditRow?.partner_id) {
  await createNotification(
    auditRow.partner_id,
    auditId,
    "reupload",
    "The audit team has re-submitted a file assigned to you."
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
  if (currentRole !== "partner" && currentRole !== "super_admin") return toast("Only partner or admin can approve.");

  // Auto-assign partner_id if not set
  await supabase
    .from("audit")
    .update({ partner_id: currentUser.id })
    .eq("id", auditId)
    .is("partner_id", null);

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
    "Your audit file has been approved by the partner."
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
  if (currentRole !== "partner" && currentRole !== "super_admin") return toast("Only partner or admin can disapprove.");

  // Auto-assign partner_id if not set
  await supabase
    .from("audit")
    .update({ partner_id: currentUser.id })
    .eq("id", auditId)
    .is("partner_id", null);

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
    "Changes have been requested on your audit file."
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
  (currentRole === "partner" || currentRole === "audit" || currentRole === "super_admin")
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
  const when = new Date(c.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });
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

  // Fetch audit row including partner_id
  const { data: auditRow } = await supabase
    .from("audit")
    .select("audit_team_id, partner_id")
    .eq("id", activeFileId)
    .single();

  if (currentRole === "partner" || currentRole === "super_admin") {
  if (!auditRow.partner_id) {
    await supabase
      .from("audit")
      .update({ partner_id: currentUser.id })
      .eq("id", activeFileId);
  }
  await createNotification(
    auditRow.audit_team_id,
    activeFileId,
    "comment",
    "A partner commented on your audit file."
  );
} else if (currentRole === "audit") {
  if (auditRow.partner_id) {
    await createNotification(
      auditRow.partner_id,
      activeFileId,
      "comment",
      "The audit team commented on a file assigned to you."
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
  window.location.href = "index.html";
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
  if (currentRole !== "partner" && currentRole !== "super_admin") return;

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


// ─── Archive ───────────────────────────────────────

async function loadArchive() {
  const container = document.getElementById("archiveList");
  if (!container) return;

  container.innerHTML = "<em style='color:var(--muted);padding:20px;display:block;'>Loading...</em>";

  const { data, error } = await supabase
    .from("audit")
    .select("*")
    .eq("status", "approved")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("loadArchive error:", error);
    container.innerHTML = "<em style='color:var(--danger);'>Failed to load archive.</em>";
    return;
  }

  allArchiveAudits = data || [];
  populateArchiveYearFilter();
  renderArchive();
}

function populateArchiveYearFilter() {
  const select = document.getElementById("archiveYearFilter");
  if (!select) return;

  const years = [...new Set(allArchiveAudits.map(a => {
    return new Date(a.updated_at || a.created_at).getFullYear();
  }))].sort((a, b) => b - a);

  select.innerHTML = `<option value="all">All years</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("");
}

function renderArchive() {
  const container = document.getElementById("archiveList");
  if (!container) return;

  const q = archiveSearch.trim().toLowerCase();

  const filtered = allArchiveAudits.filter(a => {
    const yearOk = archiveYearFilter === "all" ||
      new Date(a.updated_at || a.created_at).getFullYear().toString() === archiveYearFilter;
    const searchOk = !q || (a.file_name || "").toLowerCase().includes(q);
    return yearOk && searchOk;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div style="font-size:32px;">🗄️</div>
        <div>No archived files found.</div>
      </div>`;
    return;
  }

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  // Group by year → month
  const grouped = {};
  filtered.forEach(a => {
    const date = new Date(a.updated_at || a.created_at);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11

    if (!grouped[year]) grouped[year] = {};
    if (!grouped[year][month]) grouped[year][month] = [];
    grouped[year][month].push(a);
  });

  const years = Object.keys(grouped).sort((a, b) => b - a);

  const foldersHtml = years.map(year => {
    const months = Object.keys(grouped[year]).sort((a, b) => b - a);

    const monthFoldersHtml = months.map(month => {
      const files = grouped[year][month];
      const monthLabel = monthNames[parseInt(month)];
      const monthKey = year + "-" + month;

      const fileCards = files.map(a => {
        const approvedDate = new Date(a.updated_at || a.created_at)
          .toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });

        const deleteBtn = currentRole === "super_admin"
          ? '<button class="btn btn-danger" onclick="archiveDelete(\'' + a.id + '\', \'' + (a.file_url || "") + '\', \'' + (a.preview_url || "") + '\')">Delete</button>'
          : "";

        return [
          '<div class="archive-card">',
            '<div class="archive-card-left">',
              '<p class="archive-file-name">' + escapeHtml(a.file_name) + '</p>',
              '<div class="archive-meta">',
                '<span style="color:var(--good);">✓ Approved: ' + approvedDate + '</span>',
              '</div>',
            '</div>',
            '<div class="archive-card-actions">',
              '<button class="btn" onclick="downloadFile(\'' + a.file_url + '\')">Download</button>',
              '<button class="btn" onclick="openHistory(\'' + a.id + '\')">History</button>',
              '<button class="btn" onclick="openComments(\'' + a.id + '\')">Comments</button>',
              '<button class="btn" onclick="openFiles(\'' + a.id + '\', \'' + a.file_url + '\', \'' + escapeHtml(a.file_name || "") + '\')">Supporting Files</button>',
              deleteBtn,
              '<button class="btn btn-danger" onclick="archiveDisapprove(\'' + a.id + '\')">Disapprove</button>',
            '</div>',
          '</div>'
        ].join("");
      }).join("");

      return [
        '<div class="year-folder" id="folder-' + monthKey + '" style="margin-left:16px;margin-top:8px;">',
          '<div class="year-folder-header" onclick="toggleFolder(\'' + monthKey + '\')">',
            '<div class="year-folder-left">',
              '<span class="year-folder-icon">📅</span>',
              '<span class="year-folder-name" style="font-size:14px;">' + monthLabel + '</span>',
              '<span class="year-folder-count">' + files.length + ' file' + (files.length !== 1 ? 's' : '') + '</span>',
            '</div>',
            '<span class="year-folder-chevron">▶</span>',
          '</div>',
          '<div class="year-folder-body">',
            fileCards,
          '</div>',
        '</div>'
      ].join("");
    }).join("");

    return [
      '<div class="year-folder" id="folder-' + year + '">',
        '<div class="year-folder-header" onclick="toggleFolder(\'' + year + '\')">',
          '<div class="year-folder-left">',
            '<span class="year-folder-icon">📁</span>',
            '<span class="year-folder-name">' + year + '</span>',
            '<span class="year-folder-count">' + filtered.filter(a => new Date(a.updated_at || a.created_at).getFullYear().toString() === year).length + ' file' + (filtered.filter(a => new Date(a.updated_at || a.created_at).getFullYear().toString() === year).length !== 1 ? 's' : '') + '</span>',
          '</div>',
          '<span class="year-folder-chevron">▶</span>',
        '</div>',
        '<div class="year-folder-body">',
          monthFoldersHtml,
        '</div>',
      '</div>'
    ].join("");
  }).join("");

  container.innerHTML = foldersHtml;
}

function toggleFolder(year) {
  const folder = document.getElementById(`folder-${year}`);
  if (folder) folder.classList.toggle("open");
}

async function archiveDisapprove(auditId) {
  const ok = await confirmModal({
    title: "Disapprove this file?",
    message: "This will move the file back to the dashboard for the audit team to revise.",
    okText: "Disapprove"
  });
  if (!ok) return;

  setLoading(true, "Disapproving...");
  try {
    const { data: auditRow, error } = await supabase
      .from("audit")
      .update({ status: "changes_requested" })
      .eq("id", auditId)
      .select("audit_team_id")
      .single();

    if (error) {
      console.error(error);
      toast("Disapprove failed.", "error");
      return;
    }

    await createNotification(
      auditRow.audit_team_id,
      auditId,
      "disapprove",
      "Changes have been requested on your approved audit file."
    );

    toast("File moved back to dashboard ✅", "success");
    await loadArchive();
  } finally {
    setLoading(false);
  }
}

async function archiveDelete(auditId, fileUrl, previewUrl) {
  if (currentRole !== "super_admin") {
    return toast("Only super admin can delete archived files.", "error");
  }

  const ok = await confirmModal({
    title: "Delete archived file?",
    message: "This will permanently delete the file and all its data. This cannot be undone.",
    okText: "Delete"
  });
  if (!ok) return;

  setLoading(true, "Deleting...");
  try {
    try {
      const filePath = extractStoragePath(fileUrl, "audit-files");
      if (filePath) await supabase.storage.from("audit-files").remove([filePath]);

      const previewPath = extractStoragePath(previewUrl, "audit-previews");
      if (previewPath) await supabase.storage.from("audit-previews").remove([previewPath]);
    } catch (e) {
      console.warn("Storage delete warning:", e);
    }

    const { error } = await supabase.from("audit").delete().eq("id", auditId);

    if (error) {
      console.error(error);
      toast("Delete failed.", "error");
      return;
    }

    toast("Deleted permanently ✅", "success");
    await loadArchive();
  } finally {
    setLoading(false);
  }
}

function wireArchiveFilters() {
  const searchEl = document.getElementById("archiveSearch");
  const yearEl = document.getElementById("archiveYearFilter");

  if (searchEl) {
    searchEl.addEventListener("input", (e) => {
      archiveSearch = e.target.value || "";
      renderArchive();
    });
  }

  if (yearEl) {
    yearEl.addEventListener("change", (e) => {
      archiveYearFilter = e.target.value || "all";
      renderArchive();
    });
  }
}

window.toggleFolder = toggleFolder;
window.archiveDisapprove = archiveDisapprove;
window.archiveDelete = archiveDelete;


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
        <div style="opacity:0.7;font-size:12px;">${new Date(a.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</div>
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
    const when = new Date(v.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });
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


function wireAdminPanel() {
  const createBtn = document.getElementById("createUserBtn");
  const refreshBtn = document.getElementById("refreshUsersBtn");

console.log("wireAdminPanel loaded", { createBtn, refreshBtn });

  if (createBtn) {
    createBtn.onclick = createAdminUser;
  }

  if (refreshBtn) {
    refreshBtn.onclick = loadAdminUsers;
  }
}



async function loadAdminUsers() {
  if (currentRole !== "super_admin") return;

  const list = document.getElementById("adminUsersList");
  if (!list) return;

  list.innerHTML = "Loading users...";

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadAdminUsers error:", error);
    list.innerHTML = "<em>Failed to load users.</em>";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<em>No users found.</em>";
    return;
  }

  list.innerHTML = data.map(user => {
    const created = user.created_at ? new Date(user.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' }) : "";
    const isMe = currentUser && user.id === currentUser.id;

    return `
      <div class="admin-user-row">
        <div class="admin-user-left">
          <div class="admin-user-email">${escapeHtml(user.email || "(no email)")}</div>
          <div class="admin-user-meta">
            <span class="role-pill">${escapeHtml(user.role || "audit")}</span>
            ${created ? ` • ${created}` : ""}
            ${isMe ? ` • This is you` : ""}
          </div>
        </div>

        <div class="admin-user-actions">
          ${
            user.role !== "audit"
              ? `<button class="btn" onclick="changeUserRole('${user.id}', 'audit')">Make Audit</button>`
              : ``
          }

          ${
            user.role !== "partner"
              ? `<button class="btn" onclick="changeUserRole('${user.id}', 'partner')">Make Partner</button>`
              : ``
          }

          ${
            user.role !== "super_admin"
              ? `<button class="btn" onclick="changeUserRole('${user.id}', 'super_admin')">Make Admin</button>`
              : ``
          }

          ${
            !isMe
              ? `<button class="btn btn-danger" onclick="deleteManagedUser('${user.id}', '${escapeHtml(user.email || "")}')">Delete</button>`
              : ``
          }
        </div>
      </div>
    `;
  }).join("");
}

async function createAdminUser() {
  if (currentRole !== "super_admin") {
    return toast("Only super admin can create users.", "error");
  }

  const emailEl = document.getElementById("adminNewEmail");
  const passwordEl = document.getElementById("adminNewPassword");
  const roleEl = document.getElementById("adminNewRole");

  const email = (emailEl?.value || "").trim().toLowerCase();
  const password = passwordEl?.value || "";
  const role = roleEl?.value || "audit";

  if (!email || !password || !role) {
    return toast("Email, password, and role are required.", "warning");
  }

  if (!email.includes("@")) {
    return toast("Enter a valid email address.", "warning");
  }

  console.log("Create button clicked", { email, role });

  setLoading(true, "Creating user...");

  try {
    const { data, error } = await supabase.functions.invoke("create-user", {
  body: { email, password, role }
});

    console.log("create-user response:", { data, error });

    if (error) {
      console.error("create-user invoke error:", error);
      toast("Failed to create user.", "error");
      return;
    }

    if (data?.error) {
      console.error("create-user returned error:", data.error);
      toast(data.error, "error");
      return;
    }

    toast("User created successfully ✅", "success");

    emailEl.value = "";
    passwordEl.value = "";
    roleEl.value = "audit";

    await loadAdminUsers();
  } catch (err) {
    console.error("createAdminUser crashed:", err);
    toast(err.message || "Something went wrong while creating user.", "error");
  } finally {
    setLoading(false);
  }
}


async function changeUserRole(userId, newRole) {
  if (currentRole !== "super_admin") {
    return toast("Only super admin can change roles.", "error");
  }

  const ok = await confirmModal({
    title: "Change user role?",
    message: `Set this user role to ${newRole}?`,
    okText: "Change"
  });

  if (!ok) return;

  setLoading(true, "Updating role...");
  try {
   
    const { data, error } = await supabase.functions.invoke("update-user-role", {
  body: { userId, newRole }
});
    console.log("update-user-role:", { data, error });

    if (error) {
      console.error("update-user-role invoke error:", error);
      toast("Failed to update role.", "error");
      return;
    }

    if (data?.error) {
      toast(data.error, "error");
      return;
    }

    toast("Role updated successfully ✅", "success");
    await loadAdminUsers();
  } finally {
    setLoading(false);
  }
}



async function deleteManagedUser(userId, email) {
  if (currentRole !== "super_admin") {
    return toast("Only super admin can delete users.", "error");
  }

  const ok = await confirmModal({
    title: "Delete account?",
    message: `Delete ${email}? This cannot be undone.`,
    okText: "Delete"
  });

  if (!ok) return;

  setLoading(true, "Deleting user...");
  try {
    const { data, error } = await supabase.functions.invoke("delete-user", {
  body: { userId }
});

    console.log("delete-user:", { data, error });

    if (error) {
      console.error("delete-user invoke error:", error);
      toast("Failed to delete user.", "error");
      return;
    }

    if (data?.error) {
      toast(data.error, "error");
      return;
    }

    toast("User deleted successfully ✅", "success");
    await loadAdminUsers();
  } finally {
    setLoading(false);
  }
}
window.changeUserRole = changeUserRole;
window.deleteManagedUser = deleteManagedUser;




wireFilesModal();
wireReviewModal();
loadUser(); // ok


 