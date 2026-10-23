import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const root = process.cwd();
const apiPort = 18000;
const relayPort = 18081;
const env = {
  ...process.env,
  XIAONUAN_DATA_DIR: `${root}/server/.localdata-smoke`,
  COMPANION_URL: `http://127.0.0.1:${apiPort}/companion`,
  REALTIME_PORT: String(relayPort),
};
const pythonBin = process.platform === "win32"
  ? `${root}/server/.venv/Scripts/python.exe`
  : `${root}/.venv/bin/python`;
const python = spawn(pythonBin, [
  "-m", "uvicorn", "server.app:app", "--host", "127.0.0.1", "--port", String(apiPort),
], { cwd: root, env, stdio: "inherit" });
const relay = spawn(process.execPath, ["server/realtime.mjs"], { cwd: root, env, stdio: "inherit" });

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  const healthUrl = `http://127.0.0.1:${apiPort}/health`;
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(healthUrl)).ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error("FastAPI did not become ready");

  const post = (body) => fetch(`http://127.0.0.1:${apiPort}/companion`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const registration = await post({ action: "register", username: "smoketest", password: "smoke-test-password" });
  if (!registration.ok) throw new Error(`register returned ${registration.status}`);
  const account = await registration.json();
  const memory = await post({ action: "memory", token: account.token });
  const memoryBody = await memory.json();
  if (!memory.ok || !Array.isArray(memoryBody.medications) || !Array.isArray(memoryBody.cards)) {
    throw new Error("memory endpoint returned an invalid shape");
  }
  const auth = await post({ action: "auth_check", token: account.token });
  if (!(await auth.json()).ok) throw new Error("auth_check did not accept the registered token");

  const frameTypes = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/api/realtime`);
    const frames = [];
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("realtime smoke test timed out")); }, 8000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: "invalid" })));
    socket.on("message", (data) => frames.push(JSON.parse(data.toString()).type));
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("close", (code) => { clearTimeout(timer); resolve({ code, frames }); });
  });
  if (frameTypes.code !== 1008 || !frameTypes.frames.includes("server_ready") || !frameTypes.frames.includes("auth_error")) {
    throw new Error(`unexpected WebSocket result: ${JSON.stringify(frameTypes)}`);
  }
  console.log("PASS: health, registration, memory, session auth, WebSocket ready frame, and invalid-token rejection");
}

try {
  await main();
} finally {
  await Promise.all([stop(relay), stop(python)]);
}
