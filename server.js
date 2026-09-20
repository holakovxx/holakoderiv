// Deriv WebSocket proxy
// Setup:  npm init -y && npm i ws express   (add "type": "module" to package.json, Node 18+)
// Env:    DERIV_TOKEN, DERIV_APP_ID, DERIV_ACCOUNT_ID, ALLOWED_ORIGIN=https://holakovxx.github.io
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const { DERIV_TOKEN, DERIV_APP_ID, DERIV_ACCOUNT_ID, ALLOWED_ORIGIN = '*', PORT = 3000 } = process.env;

// Ask Deriv for a one-time authenticated WebSocket URL (token stays on the server)
async function getUpstreamUrl() {
  const r = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${DERIV_ACCOUNT_ID}/otp`,
    { method: 'POST', headers: { Authorization: `Bearer ${DERIV_TOKEN}`, 'Deriv-App-ID': DERIV_APP_ID } }
  );
  if (!r.ok) throw new Error(`OTP failed: ${r.status} ${await r.text()}`);
  return (await r.json()).data.url;
}

const app = express();
app.get('/', (_, res) => res.send('ok'));
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }) => ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN,
});

wss.on('connection', async (client) => {
  const queue = [];
  let upstream;
  client.on('message', (m) => {
    const msg = m.toString();
    upstream?.readyState === WebSocket.OPEN ? upstream.send(msg) : queue.push(msg);
  });

  try {
    upstream = new WebSocket(await getUpstreamUrl());
  } catch (e) {
    client.send(JSON.stringify({ error: { message: e.message } }));
    return client.close();
  }

  const keepAlive = setInterval(() => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ ping: 1 }));
  }, 30000);

  upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
  upstream.on('message', (m) => client.readyState === WebSocket.OPEN && client.send(m.toString()));
  upstream.on('error', (e) => client.send(JSON.stringify({ error: { message: e.message } })));
  upstream.on('close', () => client.close());
  client.on('close', () => { clearInterval(keepAlive); upstream.close(); });
});

server.listen(PORT, () => console.log(`Proxy on :${PORT}`));
