import http from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ZooRoom } from "./rooms/ZooRoom";

const port = Number(process.env.PORT) || 2567;

// CORSヘッダーを付与するHTTPサーバー
const httpServer = http.createServer((req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ヘルスチェック用
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
});

const server = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

server.define("zoo_room", ZooRoom).enableRealtimeListing();

server.listen(port).then(() => {
  console.log(`三ツ星動物園 Colyseusサーバー起動: http://localhost:${port}`);
});
