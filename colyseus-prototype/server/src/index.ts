import { Server } from "colyseus";
import { ZooRoom } from "./rooms/ZooRoom";

const server = new Server();

server.define("zoo_room", ZooRoom);

const port = Number(process.env.PORT) || 2567;
server.listen(port).then(() => {
  console.log(`三ツ星動物園 Colyseusサーバー起動: http://localhost:${port}`);
});
