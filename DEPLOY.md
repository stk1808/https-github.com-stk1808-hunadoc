# Deploy HunaDoc to hunadoc.com

This guide takes the HunaDoc alpha live on **hunadoc.com**, hosted on **Render**, with DNS managed at **Name.com**.

Estimated time end-to-end: about 20 minutes.

---

## 0. What you'll end up with

- App running on Render: `https://hunadoc.onrender.com` (auto-issued)
- Custom domain attached: `https://hunadoc.com` and `https://www.hunadoc.com`
- Free TLS cert auto-renewed by Render
- SQLite DB and the XRPL wallet seed both persisted on a 1 GB Render disk
- Auto-redeploy on every push to your GitHub branch

Cost: Render Starter plan, **$7/mo** (required for custom domains and persistent disk). The free tier won't work for hunadoc.com because it has no disk and sleeps after 15 min idle.

---

## 1. Push the repo to GitHub

If you haven't already:

```bash
cd hunadoc
git init
git add .
git commit -m "HunaDoc alpha — Render-ready"
gh repo create hunadoc --private --source=. --push
# or use the GitHub web UI: create empty repo, then:
#   git remote add origin git@github.com:<you>/hunadoc.git
#   git branch -M main && git push -u origin main
```

Make sure these files are at the repo root: `Dockerfile`, `render.yaml`, `.dockerignore`, `.env.example`. They're included in this bundle.

---

## 2. Create the Render service

1. Sign in at [render.com](https://render.com).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account if you haven't, then pick the `hunadoc` repo.
4. Render reads `render.yaml`, shows you a service called `hunadoc`, and asks you to confirm.
5. Confirm. Render will:
   - Build the Docker image
   - Provision a 1 GB persistent disk at `/var/data`
   - Auto-generate `SESSION_SECRET`
   - Leave `XRPL_WALLET_SEED` empty (you'll fill it in step 3)
6. First build takes ~5 minutes (native `better-sqlite3` compile).
7. When it's green, you'll have a temporary URL like `https://hunadoc.onrender.com`.

---

## 3. Set the XRPL wallet seed

You have two options:

### Option A — keep using the alpha test wallet
The alpha session funded this wallet on the XRPL Testnet:

```
Address: rQhn39zw3vzXWqFJzt8nvdFvixgLEMogCY
Seed:    sEd7PC1VsBWynYDtBdP5fRzyTWrdBxX
```

In Render → your service → **Environment** tab → edit `XRPL_WALLET_SEED` → paste the seed above → **Save changes**. The service redeploys automatically.

### Option B — let the server generate a fresh wallet
Leave `XRPL_WALLET_SEED` blank. On first request, the server will hit the XRPL Testnet faucet, fund a new wallet, and **print the seed in the Render logs**. Copy it from the logs into the env var so you don't lose it across redeploys.

Either way: this is a **Testnet** wallet. No real money. Don't reuse this pattern on Mainnet without moving the seed to Render's secret manager or a KMS.

---

## 4. Verify the service is healthy

Visit `https://hunadoc.onrender.com/api/health` — should return:

```json
{ "ok": true, "service": "hunadoc", "time": "2026-..." }
```

Then visit the root URL. You should see the HunaDoc login page with the five quick-demo accounts. Sign in as any of them and confirm the XRPL flows still broadcast (manager → Ledger feed should show new entries with `testnet.xrpl.org` links).

---

## 5. Attach hunadoc.com (Render side)

In Render → your `hunadoc` service → **Settings** → **Custom Domains** → **Add Custom Domain**.

Add **two** entries, one at a time:

1. `hunadoc.com`
2. `www.hunadoc.com`

For each, Render shows you the DNS records you need to add at Name.com. **Keep this tab open** — you'll copy the values into Name.com next.

What Render typically asks for:

| Domain | Record Type | Value |
|---|---|---|
| `hunadoc.com` (apex) | `A` | `216.24.57.1` (Render shows the current IP) |
| `www.hunadoc.com` | `CNAME` | `hunadoc.onrender.com` |

> Render occasionally rotates the apex IP — **always copy from the live Render dashboard**, not from this guide.

---

## 6. Add the DNS records at Name.com

1. Sign in at [name.com](https://www.name.com), go to **My Domains** → **hunadoc.com** → **DNS Records**.
2. Delete any default A/CNAME records on `@` and `www` that point to Name.com's parking page (otherwise they'll conflict).
3. Add the two records Render gave you:

   **Record 1 — apex**
   - Type: `A`
   - Host: leave blank (or `@`)
   - Answer: the IP from Render (e.g. `216.24.57.1`)
   - TTL: `300`

   **Record 2 — www**
   - Type: `CNAME`
   - Host: `www`
   - Answer: `hunadoc.onrender.com`
   - TTL: `300`

4. Save.

DNS usually propagates in 1–5 minutes on Name.com. You can check progress with:

```bash
dig hunadoc.com +short
dig www.hunadoc.com +short
```

---

## 7. Wait for Render to issue the cert

Back in Render → Custom Domains, both entries will move from **Pending** → **Verified** → **Issued** as DNS propagates. Render uses Let's Encrypt; the cert auto-renews every 60 days.

When both show **Verified**, visit:

- https://hunadoc.com
- https://www.hunadoc.com

Both should serve the alpha over HTTPS. Render automatically redirects `www` → apex (or vice versa, depending on which you set as primary in Settings).

---

## 8. Post-deploy checklist

- [ ] `https://hunadoc.com/api/health` returns 200
- [ ] Login as `manager@demo.huna` / `demo1234` works
- [ ] Manager → Ledger feed shows your existing 5 broadcasts with `testnet.xrpl.org` explorer links
- [ ] Create a fresh prescription as `prescriber@demo.huna`, sign it, and confirm a new XRPL tx appears in the feed (~5 sec broadcast time)
- [ ] Restart the Render service from the dashboard, then re-check the ledger feed — entries should still be there (proves the disk is mounted correctly)

---

## Troubleshooting

**Build fails on `better-sqlite3`**
The Dockerfile installs `python3 make g++` for the native compile. If it still fails, bump the Render plan to Standard temporarily for more build memory, then drop back.

**`/api/health` returns 502**
Check Render logs. Most common cause is the server not binding to `0.0.0.0` — the template's `server/index.ts` already does this, so verify `PORT=5000` is set in the Environment tab.

**XRPL broadcast hangs or 500s**
The Testnet faucet is sometimes slow. Watch the logs for `[XRPL] Funded testnet wallet …`. If you see `temREDUNDANT`, the AccountSet fix in `server/xrpl.ts` was reverted — re-pull the alpha branch.

**Sessions log users out on every redeploy**
Sessions are in-memory by design for the alpha. To persist them, swap `MemoryStore` in `server/routes.ts` for `connect-sqlite3` pointed at `DATA_DIR`. Not required for the alpha.

**DNS hasn't propagated after 30 min**
Use [dnschecker.org](https://dnschecker.org/#A/hunadoc.com) to see global propagation. If Name.com still shows the old records, hard-refresh their DNS panel — sometimes the UI caches.

---

## Going to Mainnet later

When you're ready to leave Testnet:

1. Generate a Mainnet wallet, fund it with real XRP (~10 XRP minimum reserve)
2. Change `TESTNET_WS` in `server/xrpl.ts` to `wss://xrplcluster.com` (or `s1.ripple.com`)
3. Change `EXPLORER_BASE` to `https://livenet.xrpl.org`
4. Move `XRPL_WALLET_SEED` to a secret manager (1Password, AWS KMS, Render's encrypted env vars)
5. Remove the "ALPHA · TEST DATA ONLY" banner in `client/src/components/AppShell.tsx`
6. Add proper auth (passwordless email or OAuth), real audit logging, and a real PHI policy

That's a separate project — don't do it on the alpha branch.
