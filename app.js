let currentUser = null;
let filterType = "all";
let allApps = [];
const $ = (s) => document.querySelector(s);
const esc = (v="") => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const res = await fetch(url, { credentials:"same-origin", ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function appCard(a) {
  const type = a.appType === "apk" ? "APK" : "WEB APP";
  const action = a.appType === "apk" ? `/download/${encodeURIComponent(a.id)}` : a.websiteUrl;
  const label = a.appType === "apk" ? "Download ↧" : "Open web app ↗";
  return `<article class="app-card"><div class="app-icon">${esc((a.name||"M").slice(0,1).toUpperCase())}</div><div style="margin-top:13px"><span class="tag">${type}</span> <span class="tag">${esc(a.category)}</span></div><h3>${esc(a.name)}</h3><p>${esc(a.shortDescription)}</p><div class="meta"><span>v${esc(a.version)} · ${esc(a.publisher||"Publisher")}</span><a href="${esc(action)}" ${a.appType==="apk"?'download':''} target="${a.appType==="webview"?'_blank':'_self'}" rel="noopener">${label}</a></div></article>`;
}
async function loadApps() {
  try {
    const data = await api("/api/apps"); allApps = data.apps; renderApps();
  } catch { $("#appGrid").innerHTML = '<p class="muted">Could not load apps right now.</p>'; }
}
function renderApps() {
  const term = ($("#search").value||"").toLowerCase();
  const list = allApps.filter(a => (filterType==="all" || a.appType===filterType) && `${a.name} ${a.category} ${a.shortDescription}`.toLowerCase().includes(term));
  $("#appGrid").innerHTML = list.length ? list.map(appCard).join("") : '<div class="empty">No published apps found yet. Be the first to publish one.</div>';
}
async function refreshUser() {
  const data = await api("/api/me"); currentUser = data.user;
  $("#signedInAs").textContent = currentUser ? `Signed in as ${currentUser.name}` : "Log in to manage your apps";
  await renderDashboard();
}
async function renderDashboard() {
  const target = $("#dashboardContent");
  if (!currentUser) {
    target.innerHTML = '<div class="empty-panel"><h3>Your apps, all in one place.</h3><p>Sign in to view submissions, check review status and publish new releases.</p><button class="btn secondary" id="dashLoginAgain">Login to dashboard ↗</button></div>';
    $("#dashLoginAgain").onclick = openAuth; return;
  }
  try {
    const data = await api(currentUser.role==="admin" ? "/api/admin/apps" : "/api/my/apps");
    const apps = data.apps;
    let stats = "";
    if (currentUser.role==="admin") {
      const s = await api("/api/admin/stats");
      stats = `<div class="admin-stats"><div class="stat"><b>${s.apps}</b>Total apps</div><div class="stat"><b>${s.pending}</b>Pending review</div><div class="stat"><b>${s.users}</b>Publishers</div><div class="stat"><b>${s.downloads}</b>Downloads</div></div>`;
    }
    target.innerHTML = `${stats}<div class="actions" style="margin:0 0 14px"><button class="btn primary" id="newApp">＋ Publish new app</button><button class="btn secondary" id="logout">Logout</button></div><div class="dash-list">${apps.length ? apps.map(a=>`<div class="dash-row"><div><b>${esc(a.name)}</b><div class="muted">${esc(a.appType.toUpperCase())} · ${esc(a.category)} · ${esc(a.publisherEmail||"")}</div>${a.rejectionReason?`<div class="muted">Note: ${esc(a.rejectionReason)}</div>`:""}</div><span class="status ${a.status}">${esc(a.status)}</span><div class="dash-actions">${currentUser.role==="admin" && a.status!=="approved"?`<button data-action="approve" data-id="${esc(a.id)}">Approve</button>`:""}${currentUser.role==="admin" && a.status!=="rejected"?`<button data-action="reject" data-id="${esc(a.id)}">Reject</button>`:""}${currentUser.role==="admin"?`<button data-action="delete" data-id="${esc(a.id)}">Delete</button>`:""}</div></div>`).join(""):'<div class="empty-panel"><p>No submissions yet. Publish your first app.</p></div>'}</div>`;
    $("#newApp").onclick = () => openSubmit();
    $("#logout").onclick = logout;
    target.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>adminAction(b.dataset.action,b.dataset.id));
  } catch(e) { target.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
function openAuth(mode="login") { $("#authDialog").showModal(); setAuthMode(mode); }
function setAuthMode(mode) {
  $("#authTitle").textContent = mode==="login" ? "Welcome back" : "Create your publisher account";
  $("#authSubmit").textContent = mode==="login" ? "Login" : "Create account";
  $("#nameWrap").hidden = mode==="login";
  $("#authForm").dataset.mode = mode;
  $("#authMessage").textContent = "";
}
function openSubmit() {
  if (!currentUser) return openAuth("register");
  $("#submitDialog").showModal();
}
async function logout() {
  await api("/api/logout",{method:"POST"}); currentUser=null; await refreshUser();
}
async function adminAction(action,id) {
  if (action==="delete" && !confirm("Permanently delete this app listing and its uploaded APK?")) return;
  let body={};
  if (action==="reject") body.reason=prompt("Reason for rejection (shown to publisher):","Please review the publishing requirements and resubmit.")||"Please review the publishing requirements and resubmit.";
  try {
    if(action==="delete") await api(`/api/admin/apps/${id}`,{method:"DELETE"});
    else await api(`/api/admin/apps/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:action==="approve"?"approved":"rejected",...body})});
    await renderDashboard(); await loadApps();
  } catch(e) { alert(e.message); }
}
$("#loginOpen").onclick=()=>openAuth("login");
$("#publishOpen").onclick=()=>currentUser?openSubmit():openAuth("register");
$("#dashboardLogin").onclick=openAuth;
$("#authForm").onsubmit=async e=>{
  e.preventDefault(); const f=new FormData(e.target); const mode=e.target.dataset.mode;
  const payload=Object.fromEntries(f.entries());
  try {
    const data=await api(`/api/${mode}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    currentUser=data.user; $("#authDialog").close(); e.target.reset(); await refreshUser();
    if(mode==="register") openSubmit();
  } catch(err) { $("#authMessage").textContent=err.message; $("#authMessage").className="message error"; }
};
$("#appType").onchange=()=>{
  const web=$("#appType").value==="webview";
  $("#apkWrap").hidden=web; $("#urlWrap").hidden=!web;
  $("#apkFile").required=!web;
};
$("#submitForm").onsubmit=async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try {
    const data=await api("/api/apps",{method:"POST",body:f});
    $("#submitMessage").textContent=data.message; $("#submitMessage").className="message success";
    e.target.reset(); $("#appType").dispatchEvent(new Event("change")); await refreshUser();
    setTimeout(()=>$("#submitDialog").close(),1500);
  } catch(err) { $("#submitMessage").textContent=err.message; $("#submitMessage").className="message error"; }
};
$("#search").oninput=renderApps;
document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{
  filterType=b.dataset.filter; document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x===b)); renderApps();
});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
document.querySelectorAll("[data-auth]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-auth]").forEach(x=>x.classList.toggle("selected",x===b));setAuthMode(b.dataset.auth);});
$("#year").textContent=new Date().getFullYear();
(async()=>{await loadApps();await refreshUser();})();
