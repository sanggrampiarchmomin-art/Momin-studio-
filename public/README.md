# Momin Studio — Multi-user publishing platform

This is a full-stack starter for a self-hosted app publishing site with:
- Public app catalog and search/filter
- Publisher registration and login
- APK file submissions
- WebView listing submissions (a public HTTPS website URL)
- Publisher dashboard and submission status
- Admin dashboard, review/approve/reject/delete actions
- Direct APK download endpoint hosted by your server
- SQLite database and server-side sessions

## Important distinction: WebView submissions
The WebView option publishes a listing that links visitors to the publisher's website. It does **not** compile that URL into an Android APK. Creating, signing and distributing a WebView APK is a separate Android build process.

## Requirements
- Node.js 20+
- A Linux VPS or other server that can run Node.js
- A domain is not required for local testing; it is recommended for public launch
- HTTPS is required before handling real user accounts and uploads

## Run locally
1. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
2. Install dependencies: `npm install`
3. Start: `npm start`
4. Open `http://localhost:3000`

The app creates the first admin account on startup if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set and that email does not already exist.

## Deploy on your own server
1. Install Node.js 20+ on your VPS.
2. Upload the project folder and run `npm install`.
3. Set environment variables in your server's process manager (do not commit secrets to source control).
4. Run behind Nginx or Caddy with HTTPS enabled.
5. Configure the reverse proxy to forward requests to the Node app's local port.
6. Persist the `data/` and `storage/` directories and back them up.
7. Set an upload limit appropriate for your storage and server bandwidth.
8. Test registration, login, APK upload, admin approval, direct download and WebView links.

## Security and moderation before public launch
This is a starter project, not a fully audited production service. Before accepting public submissions:
- Add CSRF protection and stronger abuse controls for state-changing requests.
- Add email verification, password reset and account recovery.
- Add APK malware scanning, file hash reporting, package-name/version validation and duplicate detection.
- Add a review queue and clear acceptable-use rules; never auto-publish user uploads.
- Consider quarantine storage and object storage for large uploads.
- Add upload quotas, storage monitoring, audit logs, backups and a takedown/report process.
- Restrict WebView URLs to HTTPS in production and review submissions for phishing or abusive content.
- Complete the privacy policy and terms with accurate details.
- Configure a secure reverse proxy, HTTPS, firewall and regular dependency updates.

## Current limitations
- Admin can approve/reject/delete; publisher can view their own submission status.
- WebView listings open the submitted website URL.
- APK files are stored on this server in `storage/` and served only after approval.
- No automatic Android WebView APK builder, payment system, email verification, analytics dashboard charts or password reset is included yet.
