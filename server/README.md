# Standalone server deployment

This installation serves the complete web app and its services on the origin at `http://43.165.130.174`. EdgeOne CDN terminates public HTTPS at `https://ai.27c.site` and forwards requests to this origin:

- Nginx serves the built React app and proxies `/companion` to FastAPI and `/api/realtime` to Node.js.
- FastAPI runs the existing companion agent with PostgreSQL user sessions, health records, medication entries, cards, recent chats, and LangGraph checkpoints.
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

5. Open TCP port 80 and configure the CDN origin protocol as HTTP, port 80, origin IP `43.165.130.174`, and Host header `ai.27c.site`.
6. Install `nginx.conf` as the Nginx site, validate it, and reload Nginx. Install both systemd units from this directory and enable them.

## Important migration note

User accounts, health records, medication entries, cards, and recent chats are stored in the server's PostgreSQL database (see `server/app.py` `PostgresKV`). There is no separate KV store. A fresh deployment (including the Docker setup below) starts with an **empty database** — early users simply register again; no data migration is required.

## Docker 一键部署（推荐用于迁移 / 本地启动）

整套服务（PostgreSQL + 后端 API + 语音中继 + Web 前端）可用 Docker Compose 一条命令拉起，便于以后换机器迁移或本地演示：

```sh
cp .env.example .env        # 填入 MIMO_API_KEY / DOUBAO_REALTIME_API_KEY
docker compose up -d --build
# 浏览器打开 http://localhost:8080
```

相关文件：`docker-compose.yml`、`server/Dockerfile.api`、`server/Dockerfile.relay`、`server/Dockerfile.web`、`server/nginx.docker.conf`、`.dockerignore`。后端依赖版本锁定在 `server/requirements.txt`（与线上 43.165.130.174 环境一致）。
