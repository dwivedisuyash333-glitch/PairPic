const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const INDEX = path.join(__dirname, 'index.html');
const rooms = new Map();

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function broadcast(room, message) {
  if (!room) return;
  send(room.host, message);
  send(room.guest, message);
}
function other(room, ws) {
  if (!room) return null;
  return room.host === ws ? room.guest : room.host;
}
function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function removeClient(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  if (room.host === ws) room.host = null;
  if (room.guest === ws) room.guest = null;
  if (room.host) send(room.host, { type: 'peer-left', serverTime: Date.now() });
  if (room.guest) send(room.guest, { type: 'peer-left', serverTime: Date.now() });
  if (!room.host && !room.guest) rooms.delete(code);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;
  send(ws, { type: 'hello', serverTime: Date.now() });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const now = Date.now();

    if (msg.type === 'join') {
      const code = cleanCode(msg.room);
      if (!code) return send(ws, { type: 'error', message: 'Invalid room code.' });
      let room = rooms.get(code);
      if (!room) {
        room = { host: null, guest: null };
        rooms.set(code, room);
      }
      if (room.host && room.guest) return send(ws, { type: 'full', serverTime: now });
      let role = msg.role === 'host' && !room.host ? 'host' : (!room.guest ? 'guest' : 'host');
      if (role === 'host' && room.host) role = 'guest';
      if (role === 'guest' && room.guest) return send(ws, { type: 'full', serverTime: now });
      ws.roomCode = code;
      ws.role = role;
      room[role] = ws;
      send(ws, { type: 'joined', role, room: code, serverTime: now });
      if (room.host && room.guest) {
        broadcast(room, { type: 'ready', serverTime: now });
      } else {
        send(ws, { type: 'waiting', serverTime: now });
      }
      return;
    }

    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;

    if (['offer', 'answer', 'ice'].includes(msg.type)) {
      const peer = other(room, ws);
      if (peer) send(peer, { ...msg, serverTime: now });
      return;
    }

    if (msg.type === 'start-session') {
      if (ws.role !== 'host') return;
      const startAt = now + 2500;
      broadcast(room, {
        type: 'start-session',
        mode: msg.mode === 'strip' ? 'strip' : 'single',
        timer: Number(msg.timer) === 3 ? 3 : 5,
        startAt,
        serverTime: now
      });
      return;
    }

    if (msg.type === 'next-photo') {
      if (ws.role !== 'host') return;
      const timer = Number(msg.timer) === 3 ? 3 : 5;
      const photoNumber = Number(msg.photoNumber) || 2;
      const startAt = now + 2200;
      broadcast(room, {
        type: 'next-photo',
        photoNumber,
        timer,
        startAt,
        serverTime: now
      });
      return;
    }

    if (msg.type === 'background-change') {
      if (ws.role !== 'host') return;
      const allowed = ['classic','love','midnight','dreamy','retro','minimal'];
      const background = allowed.includes(msg.background) ? msg.background : 'classic';
      broadcast(room, { type: 'background-change', background, serverTime: now });
      return;
    }

    if (msg.type === 'timer-change') {
      if (ws.role !== 'host') return;
      const timer = Number(msg.timer) === 3 ? 3 : 5;
      broadcast(room, { type: 'timer-change', timer, serverTime: now });
      return;
    }
  });

  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});

server.listen(PORT, () => console.log(`PairPic running on port ${PORT}`));
