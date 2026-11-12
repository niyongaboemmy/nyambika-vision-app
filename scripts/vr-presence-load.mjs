// R4 spike load test: headless simulated participants in one presence room (WebSocket, 10 Hz poses, reactions).
// Mints tickets locally with the API's JWT secret (dev only) so no OTP sign-ins are needed, then measures per
// scenario: server CPU (process.cpuUsage delta from GET /vr/presence/stats), tick p95, bandwidth per client
// (down/up), end-to-end pose latency p50/p95/p99 (sender clock → receiver clock, same machine), drops and
// closes. With several --ws URLs the clients are split round-robin across API instances (Redis bus).
//
// Run (flag vr.multiuser_spike on):
//   node scripts/vr-presence-load.mjs --clients 20,50,100 --duration 20 --label default-cap \
//     --api http://localhost:4102 --ws ws://localhost:4102/vr/presence --host-user <HOST_ADMIN user id>
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const API = arg("api", "http://localhost:4102").split(",");
const WS = arg("ws", "ws://localhost:4102/vr/presence").split(",");
const ROOM = arg("room", "showroom:umurage-wear");
const COUNTS = arg("clients", "20,50,100").split(",").map(Number);
const DURATION = Number(arg("duration", "20"));
const LABEL = arg("label", "default-cap");
const HOST_USER = arg("host-user", process.env.HOST_USER_ID);
const ABUSER = process.argv.includes("--abuser");
const OUT = arg("out", new URL(`../docs/spikes/r4-results/load-${LABEL}.json`, import.meta.url).pathname);
const ENV = readFileSync(new URL("../apps/api/.env", import.meta.url), "utf8");
const SECRET = (ENV.match(/^JWT_SECRET="?([^"\n]+)"?/m) ?? [])[1] ?? "dev-only-change-me";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ iat: Math.floor(Date.now() / 1000), ...payload });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const ticket = (sub, role) => sign({ sub, room: ROOM, role, pageId: null, seated: false, aud: "vr-presence", exp: Math.floor(Date.now() / 1000) + 60 });
const access = HOST_USER ? sign({ sub: HOST_USER, phone: "load", exp: Math.floor(Date.now() / 1000) + 900 }) : null;

async function stats() {
  if (!access) return null;
  return Promise.all(API.map((a) => fetch(`${a}/vr/presence/stats`, { headers: { authorization: `Bearer ${access}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
}
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(i, run, abuser = false) {
  const c = { i, seat: null, down: 0, up: 0, msgs: 0, lat: [], closed: null, reactionsSeen: 0, open: false, sids: new Set() };
  const role = i === 0 ? "host" : "guest";
  const ws = new WebSocket(`${WS[i % WS.length]}?t=${ticket(`load-${run}-${i}`, role)}`);
  // Smooth random walk inside the showroom (r ≤ 6 m), eye height 1.6 m.
  let x = (Math.random() - 0.5) * 8;
  let z = (Math.random() - 0.5) * 8;
  let yaw = Math.random() * 6.28;
  let timer;
  ws.onopen = () => (c.open = true);
  ws.onmessage = (ev) => {
    const data = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString();
    c.down += Buffer.byteLength(data);
    c.msgs++;
    const m = JSON.parse(data);
    if (m.t === "w") {
      c.seat = m.you.seat;
      const send = () => {
        yaw += (Math.random() - 0.5) * 0.3;
        x = Math.max(-6, Math.min(6, x + Math.sin(yaw) * 0.12));
        z = Math.max(-6, Math.min(6, z + Math.cos(yaw) * 0.12));
        const f = JSON.stringify({ t: "p", x: Math.round(x * 100), y: 160, z: Math.round(z * 100), yw: Math.round(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 1000), ts: Date.now() % 1_000_000 });
        if (ws.readyState === 1) {
          ws.send(f);
          c.up += f.length;
        }
        if (Math.random() < 0.012 && ws.readyState === 1) {
          const r = JSON.stringify({ t: "r", e: ["🔥", "👏", "✨"][i % 3] });
          ws.send(r);
          c.up += Buffer.byteLength(r);
        }
      };
      // Real clients are not phase-locked to the server tick: 100 ms ± 10 ms jitter. (A fixed setInterval on one
      // macOS host gets coalesced onto the same wake-ups as the server timer and reads a constant ~100 ms.)
      const period = Number(process.env.SEND_MS ?? 100);
      const loop = () => {
        send();
        timer = setTimeout(loop, abuser ? 15 : period - 10 + Math.random() * 20);
      };
      timer = setTimeout(loop, Math.random() * period);
    } else if (m.t === "s") {
      const now = Date.now() % 1_000_000;
      for (const e of m.p) {
        c.lat.push((now - e[5] + 1_000_000) % 1_000_000);
        c.sids.add(e[0]);
      }
    } else if (m.t === "r") c.reactionsSeen++;
  };
  ws.onclose = (ev) => {
    c.closed = ev.code;
    clearTimeout(timer);
  };
  c.stop = () => {
    clearTimeout(timer);
    try {
      ws.close(1000);
    } catch {}
  };
  return c;
}

const results = [];
for (const n of COUNTS) {
  const run = `${LABEL}-${n}-${Date.now().toString(36)}`;
  console.log(`\n▶ ${n} clients in ${ROOM} (${WS.length} instance${WS.length > 1 ? "s" : ""}), ${DURATION}s`);
  const clients = [];
  for (let i = 0; i < n; i++) {
    clients.push(client(i, run, ABUSER && i === n - 1));
    if (i % 10 === 9) await sleep(50); // ramp: 10 joins / 50 ms
  }
  await sleep(2000); // settle
  for (const c of clients) {
    c.down = c.up = c.msgs = 0;
    c.lat = [];
  }
  const s0 = await stats();
  const t0 = Date.now();
  await sleep(DURATION * 1000);
  const wall = (Date.now() - t0) / 1000;
  const s1 = await stats();
  for (const c of clients) c.stop();
  await sleep(800);

  const by = (seat) => clients.filter((c) => c.seat === seat && !(ABUSER && c.i === n - 1));
  const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((s, c) => s + f(c), 0) / arr.length) : null);
  const avatars = by("avatar");
  const spectators = by("spectator");
  const lat = avatars.flatMap((c) => c.lat);
  const server = s0 && s1
    ? s1.map((b, k) => {
        const a = s0[k];
        if (!a || !b) return null;
        const cpuUs = b.cpu.user - a.cpu.user + (b.cpu.system - a.cpu.system);
        return { instance: b.instance, cpuPctOfOneCore: Math.round((cpuUs / 1e6 / wall) * 1000) / 10, tickMsP50: b.tickMsP50, tickMsP95: b.tickMsP95, tickMsMax: b.tickMsMax, publishMsP95: b.publishMsP95, timerLagMsP95: b.timerLagMsP95, rssMB: b.rssMB, outKBps: Math.round((b.bytesOut - a.bytesOut) / wall / 1024), inKBps: Math.round((b.bytesIn - a.bytesIn) / wall / 1024), msgsOutPerSec: Math.round((b.msgsOut - a.msgsOut) / wall), drops: b.drops - a.drops, backpressureSkips: b.backpressureSkips - a.backpressureSkips, closedFlood: b.closedFlood - a.closedFlood };
      })
    : null;
  const abuser = ABUSER ? clients[n - 1] : null;
  const r = {
    clients: n,
    instances: WS.length,
    durationSec: Math.round(wall),
    connected: clients.filter((c) => c.seat).length,
    refused: clients.filter((c) => !c.seat).length,
    avatars: avatars.length,
    spectators: spectators.length,
    downBytesPerSecPerAvatar: avg(avatars, (c) => c.down / wall),
    downBytesPerSecPerSpectator: avg(spectators, (c) => c.down / wall),
    upBytesPerSecPerAvatar: avg(avatars, (c) => c.up / wall),
    avatarsVisiblePerViewer: avg(avatars, (c) => c.sids.size),
    latencyMs: { p50: q(lat, 0.5), p95: q(lat, 0.95), p99: q(lat, 0.99), samples: lat.length },
    spectatorLatencyMsP95: q(spectators.flatMap((c) => c.lat), 0.95),
    closes: Object.fromEntries(Object.entries(clients.reduce((m, c) => ((m[c.closed ?? "open"] = (m[c.closed ?? "open"] ?? 0) + 1), m), {}))),
    abuser: abuser ? { closedWith: abuser.closed, upBytes: abuser.up } : undefined,
    server,
  };
  results.push(r);
  console.log(JSON.stringify(r, null, 1));
  await sleep(1500);
}

mkdirSync(new URL("../docs/spikes/r4-results/", import.meta.url).pathname, { recursive: true });
writeFileSync(OUT, JSON.stringify({ kind: "R4_SPIKE_LOAD", label: LABEL, room: ROOM, at: new Date().toISOString(), node: process.version, machine: `${process.platform}-${process.arch}`, protocol: { hz: 10, encoding: "JSON, cm + mrad integers" }, results }, null, 2) + "\n");
console.log(`\n✅ wrote ${OUT}`);
