const { createServer } = require("node:http");
const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const next = require("next");
const { DeepgramClient } = require("@deepgram/sdk");
const { WebSocketServer, WebSocket } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const fallbackSecret = randomBytes(32).toString("hex");
const secret = () => process.env.SESSION_SECRET || process.env.DEEPGRAM_API_KEY || fallbackSecret;
const verify = (protocols) => {
  const token = [...protocols].find((value) => value.startsWith("access_token."))?.slice(13);
  const [payload, received] = (token || "").split(".");
  const expected = payload && createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!expected || !received || expected.length !== received.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch { return false; }
};

nextApp.prepare().then(() => {
  const handle = nextApp.getRequestHandler();
  const server = createServer((request, response) => handle(request, response));
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url, "http://localhost").pathname !== "/api/flux") return;
    if (!verify((request.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim()))) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
  });
  wss.on("connection", async (client, request) => {
    if (!process.env.DEEPGRAM_API_KEY) { client.close(1011, "DEEPGRAM_API_KEY is required"); return; }
    const url = new URL(request.url, "http://localhost");
    const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
    const connection = await deepgram.listen.v2.createConnection({ model: "flux-general-en", encoding: url.searchParams.get("encoding") || "linear16", sample_rate: url.searchParams.get("sample_rate") || "16000" });
    connection.on("message", (data) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); });
    connection.on("error", () => client.close(1011, "Deepgram connection error"));
    client.on("message", (data, binary) => { if (binary) connection.sendMedia(data); else { try { if (JSON.parse(data.toString()).type === "CloseStream") connection.sendCloseStream({ type: "CloseStream" }); } catch {} } });
    client.on("close", () => connection.close());
    connection.connect();
  });
  server.listen(process.env.PORT || 3000, () => console.log("Next.js Flux running on http://localhost:3000"));
});
