import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createSession } from "../cloud-functions/api/realtime.js";

const port = Number(process.env.REALTIME_PORT || 8081);
const server = createServer((_req, res) => {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/api/realtime") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const request = {
      url: `http://${req.headers.host || "127.0.0.1"}${url.pathname}${url.search}`,
      headers: { get: (name) => req.headers[name.toLowerCase()] || null },
    };
    const session = createSession({ request, env: process.env });
    client.on("message", (data, isBinary) => session.onmessage(client, data, isBinary));
    client.on("close", () => session.onclose(client));
    client.on("error", (error) => session.onerror(client, error));
    session.onopen(client, req);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Xiaonuan realtime listening on 127.0.0.1:${port}`);
});
