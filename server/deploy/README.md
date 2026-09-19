# Automatic updates on the VPS

The server checks GitHub every five minutes. When `main` has a new commit it
copies `server/` over `/opt/genius/api`, installs dependencies if they changed,
applies any new file in `server/sql/` (each file once, recorded in the
`schema_files` table), restarts `genius-api` and checks `/health`. If the new
version is not healthy it goes back to the previous commit.

Secrets are never in the repository. They stay in `/etc/genius/*.env` and
`/etc/genius/licence.*` on the server.

## One-time setup on the server

1. Make a read-only deploy key and add its public half to the GitHub repository
   (Settings → Deploy keys, leave "Allow write access" off):

   ```sh
   ssh-keygen -t ed25519 -N '' -f /root/.ssh/genius_deploy -C genius-vps-deploy
   cat /root/.ssh/genius_deploy.pub
   ```

2. Clone with that key:

   ```sh
   cat >> /root/.ssh/config <<'EOF'
   Host github-genius
     HostName github.com
     User git
     IdentityFile /root/.ssh/genius_deploy
     IdentitiesOnly yes
   EOF
   git clone git@github-genius:OWNER/REPO.git /opt/genius/repo
   ```

3. Mark the SQL files the database already has as applied, so they are not run
   again, then install the timer:

   ```sh
   sudo -u postgres psql -d genius -c "create table if not exists schema_files (name text primary key, applied_at timestamptz not null default now()); alter table schema_files owner to genius;"
   chmod +x /opt/genius/repo/server/deploy/genius-update.sh
   cp /opt/genius/repo/server/deploy/genius-update.{service,timer} /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now genius-update.timer
   ```

4. Deploy once by hand to check it: `/opt/genius/repo/server/deploy/genius-update.sh --force`,
   then `journalctl -t genius-update`.
