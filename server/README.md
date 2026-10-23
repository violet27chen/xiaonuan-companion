# Standalone server deployment

This installation serves the complete web app and its services on the origin at `http://38.76.215.51`. EdgeOne CDN terminates public HTTPS at `https://xiaonuan.27c.site` and forwards requests to this origin:

- Nginx serves the built React app and proxies `/companion` to FastAPI and `/api/realtime` to Node.js.
- FastAPI runs the existing companion agent with SQLite user sessions, health records, medication entries, cards, recent chats, and LangGraph checkpoints.
- Node.js hosts the Doubao full-duplex WebSocket relay. `COMPANION_URL` points it to the local FastAPI service.
- The production secrets are stored only in `/etc/xiaonuan/xiaonuan.env`.

## First install

1. Install Ubuntu packages: `nginx`, `python3-venv`, `python3-pip`, `nodejs`, and `npm`.
2. Put the repository at `/opt/xiaonuan`, create the `xiaonuan` service account, and set ownership of `/opt/xiaonuan`, `/var/lib/xiaonuan`, and `/var/www/xiaonuan`.
3. Create `/etc/xiaonuan/xiaonuan.env` with `MIMO_API_KEY`, `MIMO_BASE_URL`, `MIMO_LLM_MODEL`, `MIMO_VISION_MODEL`, `DOUBAO_REALTIME_API_KEY`, and `COMPANION_URL=http://127.0.0.1:8000/companion`. Set mode `0600`, owner `root:xiaonuan`.
4. Build and install the web app:

   ```sh
   python3 -m venv /opt/xiaonuan/.venv
   /opt/xiaonuan/.venv/bin/pip install -r /opt/xiaonuan/requirements.txt -r /opt/xiaonuan/server/requirements.txt
   cd /opt/xiaonuan && npm ci --omit=dev
   cd /opt/xiaonuan/voice-call && npm ci && npm run build
   cp -a /opt/xiaonuan/voice-call/dist/. /var/www/xiaonuan/
   ```

5. Open TCP port 80 and configure the CDN origin protocol as HTTP, port 80, origin IP `38.76.215.51`, and Host header `xiaonuan.27c.site`.
6. Install `nginx.conf` as the Nginx site, validate it, and reload Nginx. Install both systemd units from this directory and enable them.

## Important migration note

The previous Makers KV data is not included in the Git repository. User accounts and health records stored there do not automatically appear in this server's SQLite database. Export/import them from the old service before asking existing users to switch. If no export route is available, users will need to register again; do not remove or shut down the old deployment until that is decided.
