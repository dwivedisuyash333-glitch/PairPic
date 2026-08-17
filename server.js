const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(
      fs.readFileSync(path.join(__dirname, "index.html"))
    );

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws) => {
  let room = null;

  ws.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "join") {
      room = String(message.room || "")
        .toUpperCase()
        .slice(0, 8);

      if (!room) return;

      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }

      const players = rooms.get(room);

      if (players.size >= 2) {
        send(ws, { type: "full" });
        return;
      }

      players.add(ws);

      if (players.size === 1) {
        send(ws, { type: "waiting" });
      } else {
        for (const player of players) {
          send(player, { type: "ready" });
        }
      }

      return;
    }

    if (room && rooms.has(room)) {
      for (const player of rooms.get(room)) {
        if (player !== ws) {
          send(player, message);
        }
      }
    }
  });

  ws.on("close", () => {
    if (!room || !rooms.has(room)) return;

    const players = rooms.get(room);
    players.delete(ws);

    for (const player of players) {
      send(player, { type: "peer-left" });
    }

    if (players.size === 0) {
      rooms.delete(room);
    }
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`PairPic running on port ${PORT}`);
});
