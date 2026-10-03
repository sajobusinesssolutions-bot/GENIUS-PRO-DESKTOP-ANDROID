# If the server dies — getting Genius back

The shops' books are never only on the server: every phone holds its own full
copy and keeps working offline. What lives only on the server is accounts and
sign-in, licences, the businesses list and the cloud copies of the books.
Losing those is what this guide prevents.

The app talks to `https://api.saljoetech.tech`. It finds the server **by that
name, not by its IP**, so moving servers never needs a new version of the app
— only the domain pointed at the new machine.

---

## Keep these safe — off the server

| What | Where it lives | Why it matters |
|---|---|---|
| Database dumps | `/var/backups/genius/*.dump` (made nightly by the API) | every account, business, licence and synced record |
| Secrets | `/etc/genius/*.env` | `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_PEPPER`, Google sign-in, SMTP |
| Licence signing key | `/etc/genius/licence.*` | without it no new licence matches the app; **cannot be recreated** |
| Backup passphrase | `/root/.genius-backup-pass` | decrypts the secrets copy; keep it in a password manager too |

Lose `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_PEPPER` and everyone is signed out
(they sign in again — no data is lost). Lose the licence key and existing
licences cannot be re-issued under it. So the secrets matter as much as the
database.

---

## Set up off-site backups (once, on the current server)

1. Install the tools:

   ```sh
   apt install -y rclone gnupg
   ```

2. Connect a place to keep the copies — Google Drive here, but any rclone
   remote works (Dropbox, OneDrive, another server over SFTP…):

   ```sh
   rclone config        # n) new remote, name it: gdrive, type: drive, follow the prompts
   rclone mkdir gdrive:genius-backups
   ```

   On a server with no browser, choose "no" for auto config and finish the
   sign-in on your PC with the `rclone authorize "drive"` command it prints.

3. Choose a passphrase for the secrets, and **write it down somewhere safe**
   (password manager) — without it the secrets copy cannot be opened:

   ```sh
   umask 077; read -rsp 'Backup passphrase: ' P; echo "$P" > /root/.genius-backup-pass; unset P
   ```

4. Install and start the nightly job (it runs at 03:30 UTC, after the API's
   own 02:00 dump):

   ```sh
   chmod +x /opt/genius/repo/server/deploy/genius-offsite.sh /opt/genius/repo/server/deploy/genius-restore.sh
   cp /opt/genius/repo/server/deploy/genius-offsite.{service,timer} /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now genius-offsite.timer
   ```

   A different remote? `systemctl edit genius-offsite.service` and add
   `Environment=GENIUS_OFFSITE=yourremote:folder`.

5. Run it once now and check:

   ```sh
   systemctl start genius-offsite.service
   journalctl -t genius-offsite -n 20      # ends with "off-site copy done"
   rclone ls gdrive:genius-backups
   ```

6. Save the table structure into the repository once (see
   `server/sql/base/README.md`).

**Test a restore every few months** on a spare, cheap VPS using the steps
below. A backup that has never been restored is a guess.

---

## Moving to a new server (or after a crash)

Ubuntu 24.04 shown; adjust for others.

1. **New server.** Install the essentials:

   ```sh
   apt update && apt install -y postgresql postgresql-contrib rclone gnupg curl rsync git
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
   useradd --system --create-home --shell /usr/sbin/nologin genius
   ```

2. **Reconnect the backups.** Set up rclone with the **same** remote name as
   before (`rclone config`, as in setup step 2), and put the passphrase back:

   ```sh
   umask 077; read -rsp 'Backup passphrase: ' P; echo "$P" > /root/.genius-backup-pass; unset P
   ```

3. **Get the code:**

   ```sh
   mkdir -p /opt/genius && git clone https://github.com/OWNER/REPO.git /opt/genius/repo
   ```

   (or the deploy-key clone in `deploy/README.md`).

4. **Restore secrets and database** in one go:

   ```sh
   bash /opt/genius/repo/server/deploy/genius-restore.sh            # newest copies
   bash /opt/genius/repo/server/deploy/genius-restore.sh 2026-10-03 # or a given day
   ```

   It puts `/etc/genius` back, creates the database user and the `genius`
   database from `DATABASE_URL`, loads the dump and prints the number of
   accounts and businesses.

5. **Install and start the API:**

   ```sh
   mkdir -p /opt/genius/api
   rsync -a --exclude node_modules --exclude test /opt/genius/repo/server/ /opt/genius/api/
   chown -R genius:genius /opt/genius/api
   sudo -u genius -H bash -c 'cd /opt/genius/api && npm ci --omit=dev'
   cp /opt/genius/repo/server/deploy/genius-api.service /etc/systemd/system/
   ls /etc/genius            # make EnvironmentFile= in the service name the right .env
   systemctl daemon-reload && systemctl enable --now genius-api
   curl -s http://127.0.0.1:8080/health
   ```

6. **Point the domain here.** In your DNS, set the `A` record of
   `api.saljoetech.tech` to the new server's IP. Then give it HTTPS — Caddy is
   the simplest:

   ```sh
   apt install -y caddy
   cat > /etc/caddy/Caddyfile <<'EOF'
   api.saljoetech.tech {
     reverse_proxy 127.0.0.1:8080
   }
   EOF
   systemctl reload caddy
   ```

   Caddy fetches the certificate itself once the DNS points here (allow a few
   minutes for DNS to spread).

7. **Turn the routines back on:** automatic updates (`deploy/README.md`) and
   off-site backups (setup steps 4–5 above).

8. **Check from a phone:** open `https://api.saljoetech.tech/health`, sign in
   in the app, and run a sync (Menu → Cloud sync → Back up now).

### If there is no backup at all

The phones still hold every business's books. Build the server from step 1
with an empty database (`server/sql/base/README.md`, "Use it"), set fresh
secrets, then each owner registers again, re-adds their business and licence,
and turns sync on — each phone uploads its books afresh. It works, but it is
slow for everyone, which is why the off-site copy is worth setting up today.
