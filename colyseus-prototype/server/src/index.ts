import { defineServer, defineRoom, createEndpoint, createRouter, LobbyRoom } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ZooRoom } from "./rooms/ZooRoom";

const port = Number(process.env.PORT) || 2567;

const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 15000,
    pingMaxRetries: 3,
  }),

  rooms: {
    lobby: defineRoom(LobbyRoom),
    zoo_room: defineRoom(ZooRoom).enableRealtimeListing(),
  },

  routes: createRouter({
    health: createEndpoint("/health", { method: "GET" }, async () => {
      return { status: "ok" };
    }),
  }),
});

server.listen(port).then(() => {
  console.log(`三ツ星動物園 Colyseusサーバー起動: http://localhost:${port}`);
});
