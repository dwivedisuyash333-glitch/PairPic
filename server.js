const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/" || url === "/index.html") {
    try {
      const html = fs.readFileSync(
        path.join(__dirname, "index.html"),
        "utf8"
      );

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });

      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end("Could not load PairPic");
    }

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, sender, data) {
  const players = rooms.get(room);

  if (!players) return;

  for (const player of players) {
    if (player !== sender) {
      send(player, data);
    }
  }
}

wss.on("connection", (ws) => {
  let room = null;
  let role = null;

  send(ws, {
    type: "connected"
  });

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /*
     * JOIN ROOM
     */
    if (msg.type === "join") {
      const requestedRoom = String(msg.room || "")
        .trim()
        .toUpperCase()
        .slice(0, 8);

      if (!requestedRoom) {
        send(ws, {
          type: "error",
          message: "Invalid room"
        });
        return;
      }

      room = requestedRoom;
      role = msg.role === "host" ? "host" : "guest";

      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }

      const players = rooms.get(room);

      if (players.size >= 2) {
        send(ws, {
          type: "full"
        });

        room = null;
        role = null;
        return;
      }

      players.add(ws);

      console.log(
        `[ROOM ${room}] ${role} joined (${players.size}/2)`
      );

      if (players.size === 1) {
        send(ws, {
          type: "waiting",
          room,
          role
        });
      }

      if (players.size === 2) {
        for (const player of players) {
          send(player, {
            type: "ready",
            room
          });
        }

        console.log(`[ROOM ${room}] Ready for WebRTC`);
      }

      return;
    }

    /*
     * WEBRTC SIGNALING
     *
     * offer
     * answer
     * ice
     */
    if (room && rooms.has(room)) {
      if (
        msg.type === "offer" ||
        msg.type === "answer" ||
        msg.type === "ice"
      ) {
        broadcast(room, ws, msg);
        return;
      }

      /*
       * SYNCHRONIZED PHOTO COMMANDS
       */
      if (
        msg.type === "start-single" ||
        msg.type === "start-strip"
      ) {
        broadcast(room, ws, msg);
        return;
      }
    }
  });

  ws.on("close", () => {
    if (!room || !rooms.has(room)) return;

    const players = rooms.get(room);

    players.delete(ws);

    console.log(
      `[ROOM ${room}] ${role || "player"} left (${players.size}/2)`
    );

    for (const player of players) {
      send(player, {
        type: "peer-left"
      });
    }

    if (players.size === 0) {
      rooms.delete(room);
      console.log(`[ROOM ${room}] deleted`);
    }
  });

  ws.on("error", (err) => {
    console.log("WebSocket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PairPic running on port ${PORT}`);
});
