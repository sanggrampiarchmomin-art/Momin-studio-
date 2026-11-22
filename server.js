const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_DIR = path.join(ROOT, "data");
const PENDING_DIR = path.join(ROOT, "storage", "pending");
const APPROVED_DIR = path.join(ROOT, "storage", "approved");
for (const dir of [DB_DIR, PENDING_DIR, APPROVED_DIR]) fs.mkdirSync(dir, { recursive: true });

if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: Set SESSION_SECRET in your environment before production use.");
}
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DB_DIR }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const db = new Database(path.join(DB_DIR, "momin-studio.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'publisher',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  app_type TEXT NOT NULL CHECK(app_type IN ('apk','webview')),
  version TEXT NOT NULL,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  website_url TEXT,
  file_key TEXT,
  original_filename TEXT,
  icon_color TEXT NOT NULL DEFAULT '#a7f36b',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const findUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  if (!findUserByEmail.get(email)) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
      .run("Momin Studio Admin", email, hash);
    console.log("Initial admin account created for", email);
  }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: "draft-7", legacyHeaders: false });
const uploadLimit = Math.max(1, Math.min(500, Number(process.env.MAX_APK_MB || 150))) * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PENDING_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + ".apk")
});
const upload = multer({
  storage,
  limits: { fileSize: uploadLimit, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".apk") return cb(new Error("Only .apk files are accepted for APK publishing."));
    cb(null, true);
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}
function validWebUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !!u.hostname && !["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  } catch { return false; }
}
function publicApp(row) {
  return {
    id: row.id, name: row.name, category: row.category, appType: row.app_type,
    version: row.version, shortDescription: row.short_description,
    description: row.description, websiteUrl: row.website_url,
    status: row.status, downloads: row.downloads, createdAt: row.created_at,
    publisher: row.publisher_name
  };
}

app.use(express.static(path.join(ROOT, "public")));
app.get("/api/health", (req, res) => res.json({ ok: true, service: "Momin Studio" }));

app.post("/api/register", authLimiter, async (req, res) => {
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    return res.status(400).json({ error: "Enter a name, valid email and password of at least 10 characters." });
  }
  if (findUserByEmail.get(email)) return res.status(409).json({ error: "An account with that email already exists." });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)").run(name, email, hash);
  req.session.user = { id: result.lastInsertRowid, name, email, role: "publisher" };
  res.json({ user: req.session.user });
});
app.post("/api/login", authLimiter, async (req, res) => {
  const email = cleanText(req.body.email, 160).toLowerCase();
  const user = findUserByEmail.get(email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start a session." });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ user: req.session.user });
  });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.get("/api/apps", (req, res) => {
  const rows = db.prepare(`SELECT apps.*, users.name AS publisher_name FROM apps
    JOIN users ON users.id=apps.owner_id WHERE apps.status='approved' ORDER BY apps.created_at DESC`).all();
  res.json({ apps: rows.map(publicApp) });
});
app.get("/api/my/apps", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM apps WHERE owner_id=? ORDER BY created_at DESC").all(req.session.user.id);
  res.json({ apps: rows.map(row => ({ ...publicApp({ ...row, publisher_name: req.session.user.name }), rejectionReason: row.rejection_reason })) });
});

app.post("/api/apps", requireAuth, (req, res, next) => {
  upload.single("apk")(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    next();
  });
}, (req, res) => {
  const name = cleanText(req.body.name, 80);
  const category = cleanText(req.body.category, 40);
  const type = req.body.appType === "webview" ? "webview" : "apk";
  const version = cleanText(req.body.version, 30);
  const shortDescription = cleanText(req.body.shortDescription, 180);
  const description = cleanText(req.body.description, 3000);
  const websiteUrl = cleanText(req.body.websiteUrl, 1000);
  if (name.length < 2 || !category || !version || shortDescription.length < 8 || description.length < 15) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Complete all required app details. Descriptions must be meaningful." });
  }
  if (type === "apk" && !req.file) return res.status(400).json({ error: "Choose an APK file." });
  if (type === "webview" && !validWebUrl(websiteUrl)) return res.status(400).json({ error: "Enter a valid public website URL (HTTP or HTTPS)." });
  if (type === "webview" && req.file) fs.unlinkSync(req.file.path);
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO apps
    (id,owner_id,name,category,app_type,version,short_description,description,website_url,file_key,original_filename)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, req.session.user.id, name, category, type, version, shortDescription, description,
      type === "webview" ? websiteUrl : null,
      type === "apk" ? path.basename(req.file.filename) : null,
      type === "apk" ? cleanText(req.file.originalname, 180) : null
    );
  res.status(201).json({ ok: true, id, message: "Submitted for admin review. It will appear publicly after approval." });
});

app.get("/api/admin/apps", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT apps.*, users.name AS publisher_name, users.email AS publisher_email FROM apps
    JOIN users ON users.id=apps.owner_id ORDER BY apps.created_at DESC`).all();
  res.json({ apps: rows.map(row => ({ ...publicApp(row), publisherEmail: row.publisher_email, rejectionReason: row.rejection_reason, originalFilename: row.original_filename })) });
});
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) n FROM users WHERE role='publisher'").get().n;
  const apps = db.prepare("SELECT COUNT(*) n FROM apps").get().n;
  const pending = db.prepare("SELECT COUNT(*) n FROM apps WHERE status='pending'").get().n;
  const downloads = db.prepare("SELECT COALESCE(SUM(downloads),0) n FROM apps").get().n;
  res.json({ users, apps, pending, downloads });
});
app.patch("/api/admin/apps/:id", requireAdmin, (req, res) => {
  const status = req.body.status;
  if (!["approved", "rejected", "pending"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const row = db.prepare("SELECT * FROM apps WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  if (row.app_type === "apk" && row.file_key) {
    const from = path.join(status === "approved" ? PENDING_DIR : APPROVED_DIR, path.basename(row.file_key));
    const to = path.join(status === "approved" ? APPROVED_DIR : PENDING_DIR, path.basename(row.file_key));
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  db.prepare("UPDATE apps SET status=?, rejection_reason=? WHERE id=?")
    .run(status, status === "rejected" ? cleanText(req.body.reason || "Please review the publishing requirements and resubmit.", 500) : null, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/admin/apps/:id", requireAdmin, (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  if (row.file_key) {
    for (const dir of [PENDING_DIR, APPROVED_DIR]) {
      const file = path.join(dir, path.basename(row.file_key));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  db.prepare("DELETE FROM apps WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/download/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id=? AND status='approved'").get(req.params.id);
  if (!row) return res.status(404).send("App not found.");
  if (row.app_type === "webview") return res.redirect(row.website_url);
  const file = path.join(APPROVED_DIR, path.basename(row.file_key || ""));
  if (!row.file_key || !fs.existsSync(file)) return res.status(404).send("APK file unavailable.");
  db.prepare("UPDATE apps SET downloads=downloads+1 WHERE id=?").run(row.id);
  res.download(file, row.original_filename || `${row.name}.apk`);
});

app.get("*", (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});
app.listen(PORT, () => console.log(`Momin Studio running on http://localhost:${PORT}`));
