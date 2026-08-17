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
        "Cache-Control": "no-store"
      });

      res.end(html);
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end("PairPic could not load.");
    }

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  const players = rooms.get(room);

  if (!players) return;

  for (const player of players) {
    send(player, message);
  }
}

function sendOthers(room, sender, message) {
  const players = rooms.get(room);

  if (!players) return;

  for (const player of players) {
    if (player !== sender) {
      send(player, message);
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
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /* JOIN */

    if (message.type === "join") {
      const requestedRoom = String(message.room || "")
        .trim()
        .toUpperCase()
        .slice(0, 8);

      if (!requestedRoom) {
        send(ws, {
          type: "error",
          message: "Invalid room."
        });
        return;
      }

      room = requestedRoom;
      role = message.role === "host" ? "host" : "guest";

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
        `[PairPic] ${role} joined ${room} (${players.size}/2)`
      );

      if (players.size === 1) {
        send(ws, {
          type: "waiting",
          room
        });
      }

      if (players.size === 2) {
        broadcast(room, {
          type: "ready",
          room
        });

        console.log(
          `[PairPic] Room ${room} ready`
        );
      }

      return;
    }

    if (!room || !rooms.has(room)) {
      return;
    }

    /*
      WEBRTC SIGNALING
      These messages only go to the other phone.
    */

    if (
      message.type === "offer" ||
      message.type === "answer" ||
      message.type === "ice"
    ) {
      sendOthers(
        room,
        ws,
        message
      );

      return;
    }

    /*
      PHOTO COMMANDS
      These must go to BOTH phones.
    */

    if (
      message.type === "start-single" ||
      message.type === "start-strip" ||
      message.type === "retake" ||
      message.type === "background" ||
      message.type === "scene"
    ) {
      broadcast(
        room,
        message
      );

      return;
    }
  });

  ws.on("close", () => {
    if (!room || !rooms.has(room)) {
      return;
    }

    const players = rooms.get(room);

    players.delete(ws);

    console.log(
      `[PairPic] ${role || "player"} left ${room}`
    );

    for (const player of players) {
      send(player, {
        type: "peer-left"
      });
    }

    if (players.size === 0) {
      rooms.delete(room);

      console.log(
        `[PairPic] Room ${room} deleted`
      );
    }
  });

  ws.on("error", (error) => {
    console.log(
      "[PairPic] WebSocket error:",
      error.message
    );
  });
});

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `PairPic running on port ${PORT}`
    );
  }
);
