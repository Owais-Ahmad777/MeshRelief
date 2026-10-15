// MeshRelief v2 engine — DTN simulation, routing, triage, benchmark, trust.
// Dependency-free, seeded & reproducible.

export type MsgType = "SOS" | "ACK" | "PIN";
export type Strategy = "flood" | "spray" | "prophet";
export type Category = "Medical" | "Trapped" | "Water" | "Shelter" | "Food";

export interface Envelope {
  id: string;
  type: MsgType;
  originId: string;
  createdTick: number;
  ttl: number;
  hops: string[];
  x: number; y: number;
  priority: number;
  copies?: number;
  verified: boolean;
  payload: {
    sosId: string;
    category?: Category;
    people?: number;
    child?: boolean; elderly?: boolean; injured?: boolean;
    note?: string;
    ackFor?: string;
    lat?: number; lng?: number;
  };
}

export interface SimNode {
  id: string; name: string;
  x: number; y: number;
  kind: "victim" | "volunteer" | "mule" | "gateway" | "medic" | "boat";
  alive: boolean; battery: number;
  buffer: Envelope[];
  immunity: string[];
  prophet: Record<string, number>;
  vx: number; vy: number;
  isGateway: boolean;
  capability?: string;
}

export interface SosMeta {
  sosId: string; originId: string;
  category: Category; people: number;
  child: boolean; elderly: boolean; injured: boolean;
  x: number; y: number; lat: number; lng: number;
  createdTick: number; priority: number; level: string;
  verified: boolean; acked: boolean; ackTick?: number;
  hops: number; status: "queued" | "relayed" | "acked" | "dispatched" | "resolved";
  note?: string;
}

export interface Incident {
  id: string; category: Category;
  x: number; y: number; lat: number; lng: number;
  members: SosMeta[]; reports: number;
  confidence: number; priority: number; level: string;
  verified: boolean; oldestTick: number;
}

export interface BridgeSuggestion {
  fromX: number; fromY: number; toX: number; toY: number;
  midX: number; midY: number;
  gap: number; etaMin: number;
  strandedCount: number; sosCount: number;
}

export interface Metrics { deliveryRatio: number; medianLatency: number; overhead: number; drops: number; delivered: number; created: number; transmissions: number; }
export interface BenchResult { strategy: Strategy; label: string; color: string; metrics: Metrics; }

// ---------- utils ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let uidC = 0;
export function uid(p = "m"): string { uidC++; return `${p}_${Date.now().toString(36)}_${uidC}_${Math.floor(Math.random() * 9999)}`; }
export function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
// field is 2000x2000m mapped around Bhubaneswar-ish lat/lng for display
export function toLatLng(x: number, y: number) { return { lat: 20.2961 + (1000 - y) / 111320, lng: 85.8245 + (x - 1000) / 104000 }; }

export const CAT_W: Record<Category, number> = { Medical: 1, Trapped: 1, Water: 0.7, Shelter: 0.6, Food: 0.5 };
export function triageScore(cat: Category, people: number, child: boolean, elderly: boolean, injured: boolean, minsUnacked: number): number {
  const cw = CAT_W[cat] ?? 0.5;
  const vuln = Math.min(1, (child ? 0.4 : 0) + (elderly ? 0.4 : 0) + (injured ? 0.6 : 0));
  const pScale = Math.min(1, people / 20);
  const aging = Math.min(1, minsUnacked / 30);
  return Math.round(40 * cw + 25 * vuln + 20 * pScale + 15 * aging);
}
export function levelOf(score: number) { return score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : "MODERATE"; }
export function copiesFor(level: string) { return level === "CRITICAL" ? 8 : level === "HIGH" ? 4 : 2; }

export interface SimState {
  tick: number; range: number; towersOn: boolean;
  strategy: Strategy;
  nodes: SimNode[];
  sos: Map<string, SosMeta>;
  transmissions: number; drops: number;
  hopEvents: { from: string; to: string; msgId: string; tick: number }[];
  securityLog: string[];
  floodZone: { x: number; y: number; r: number } | null;
  showFloodTool: boolean;
  muleSpeed: number;
}

export function makeNode(id: string, name: string, x: number, y: number, kind: SimNode["kind"], isGateway = false): SimNode {
  return { id, name, x, y, kind, alive: true, battery: 100, buffer: [], immunity: [], prophet: {}, vx: 0, vy: 0, isGateway, capability: kind === "boat" ? "boat" : kind === "medic" ? "medic" : kind === "mule" ? "mule" : undefined };
}

// Cyclone scenario: gateway east, stranded west cluster, mules in middle
export function cycloneScenario(): SimNode[] {
  const N: SimNode[] = [];
  N.push(makeNode("gw1", "Command Gateway", 1720, 1000, "gateway", true));
  // stranded west cluster (victims, no gateway path at range 150-260)
  N.push(makeNode("v1", "Victim · Penthakata", 220, 700, "victim"));
  N.push(makeNode("v2", "Victim ·-bauli", 300, 820, "victim"));
  N.push(makeNode("v3", "Victim · School shelter", 180, 950, "victim"));
  N.push(makeNode("vol1", "Volunteer ·Relay", 420, 800, "volunteer"));
  // middle relay + mules
  const m1 = makeNode("mule1", "Boat Mule · Chilika", 800, 900, "boat"); m1.vx = 3; m1.vy = -1; N.push(m1);
  const m2 = makeNode("mule2", "Bike Mule", 950, 700, "mule"); m2.vx = -2; m2.vy = 2; N.push(m2);
  N.push(makeNode("vol2", "Volunteer · Market", 1100, 1050, "volunteer"));
  N.push(makeNode("med1", "Medic Team", 1400, 900, "medic"));
  N.push(makeNode("vol3", "Volunteer · Temple", 1250, 1250, "volunteer"));
  return N;
}

export function defaultNodes(): SimNode[] { return cycloneScenario(); }

// ---- core receive / send ----
function hasMsg(n: SimNode, id: string) { return n.buffer.some((m) => m.id === id); }

function bufferInsert(state: SimState, n: SimNode, msg: Envelope): boolean {
  if (hasMsg(n, msg.id)) return false;
  if (msg.type === "SOS" && n.immunity.includes(msg.payload.sosId)) return false;
  if (n.buffer.length >= 20) {
    // eviction: lowest priority then oldest; never own unacked SOS or ACK
    const evictable = n.buffer
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        if (m.type === "ACK") return false;
        if (m.type === "SOS" && m.originId === n.id) {
          const s = state.sos.get(m.payload.sosId);
          if (s && !s.acked) return false;
        }
        return true;
      })
      .sort((a, b) => a.m.priority - b.m.priority || a.m.createdTick - b.m.createdTick);
    if (evictable.length === 0) { state.drops++; return false; }
    n.buffer.splice(evictable[0].i, 1);
    state.drops++;
  }
  n.buffer.push(msg);
  return true;
}

function deliverToGateway(state: SimState, gw: SimNode, msg: Envelope) {
  if (msg.type !== "SOS") return;
  const s = state.sos.get(msg.payload.sosId);
  if (!s || s.acked && gw.immunity.includes(s.sosId)) return;
  // mark delivered (gateway receipt) — record hops
  if (!s.hops || msg.hops.length > 0) s.hops = Math.max(s.hops, msg.hops.length);
  if (s.status === "queued") s.status = "relayed";
  // gateway injects ACK (once per SOS)
  if (gw.buffer.some((m) => m.type === "ACK" && m.payload.ackFor === s.sosId)) return;
  const ack: Envelope = {
    id: uid("ack"), type: "ACK", originId: gw.id, createdTick: state.tick, ttl: 60,
    hops: [gw.id], x: gw.x, y: gw.y, priority: 100, verified: true,
    payload: { sosId: s.sosId, ackFor: s.sosId },
  };
  bufferInsert(state, gw, ack);
}

function receiveMsg(state: SimState, to: SimNode, msg: Envelope, fromId: string, verifyAck: (m: Envelope) => boolean) {
  if (!to.alive) return;
  if (state.tick - msg.createdTick > msg.ttl) return;
  // ACK immunity purge
  if (msg.type === "ACK" && msg.payload.ackFor) {
    // strict verify for ACKs
    if (!verifyAck(msg)) {
      state.securityLog.unshift(`⛔ forged ACK ${msg.id.slice(0, 10)} rejected (bad signature)`);
      if (state.securityLog.length > 30) state.securityLog.pop();
      return;
    }
    const sosId = msg.payload.ackFor;
    if (!to.immunity.includes(sosId)) to.immunity.push(sosId);
    to.buffer = to.buffer.filter((m) => !(m.type === "SOS" && m.payload.sosId === sosId));
    const s = state.sos.get(sosId);
    if (s && to.id === s.originId && !s.acked) { s.acked = true; s.ackTick = state.tick; s.status = "acked"; }
    bufferInsert(state, to, { ...msg, hops: [...msg.hops, to.id] });
    if (to.isGateway) return;
    return;
  }
  if (msg.type === "SOS") {
    if (to.immunity.includes(msg.payload.sosId)) return;
    const cp: Envelope = { ...msg, hops: [...msg.hops, to.id] };
    const ok = bufferInsert(state, to, cp);
    if (ok && to.isGateway) deliverToGateway(state, to, cp);
    void fromId;
  }
}

function prophetTo(node: SimNode, gwId: string): number {
  if (node.isGateway) return 1;
  return node.prophet[gwId] ?? 0;
}

function shouldForward(strategy: Strategy, self: SimNode, other: SimNode, msg: Envelope, gwId: string): { send: boolean; giveCopies?: number } {
  if (!other.alive || hasMsg(other, msg.id)) return { send: false };
  if (msg.type === "ACK") return { send: true }; // ACKs always flood back
  if (strategy === "flood") return { send: true };
  if (strategy === "spray") {
    const c = msg.copies ?? 2;
    if (other.isGateway) return { send: true, giveCopies: 1 };
    if (c > 1) return { send: true, giveCopies: Math.floor(c / 2) };
    return { send: false };
  }
  // prophet+priority
  if (other.isGateway) return { send: true };
  const lvl = msg.priority >= 75 ? "CRITICAL" : msg.priority >= 50 ? "HIGH" : "MODERATE";
  if (lvl === "CRITICAL") {
    // critical also gets spray budget of 4 so not stranded
    const c = msg.copies ?? 4;
    if (c > 1 && prophetTo(other, gwId) >= prophetTo(self, gwId)) return { send: true, giveCopies: Math.floor(c / 2) };
    if (prophetTo(other, gwId) > prophetTo(self, gwId)) return { send: true };
    return { send: false };
  }
  return prophetTo(other, gwId) > prophetTo(self, gwId) ? { send: true } : { send: false };
}

export function createState(): SimState {
  return { tick: 0, range: 260, towersOn: false, strategy: "prophet", nodes: defaultNodes(), sos: new Map(), transmissions: 0, drops: 0, hopEvents: [], securityLog: ["🛡️ trust engine on · ACKs require command signature"], floodZone: null, showFloodTool: false, muleSpeed: 5 };
}

export function tickSim(state: SimState, opts?: { verifyAck?: (m: Envelope) => boolean; moveMules?: boolean; rng?: () => number }) {
  const verifyAck = opts?.verifyAck ?? (() => true);
  state.tick++;
  const gw = state.nodes.find((n) => n.isGateway);
  const gwId = gw?.id ?? "gw1";
  // aging prophet every 10 ticks
  if (state.tick % 10 === 0) for (const n of state.nodes) for (const k of Object.keys(n.prophet)) n.prophet[k] *= 0.98;
  // mobility + battery + flood
  for (const n of state.nodes) {
    if (!n.alive) continue;
    if ((n.kind === "mule" || n.kind === "boat") && (opts?.moveMules ?? true)) {
      const r = opts?.rng ?? Math.random;
      if (r() < 0.06) { const a = r() * Math.PI * 2; const sp = 8 + r() * 14; n.vx = Math.cos(a) * sp; n.vy = Math.sin(a) * sp; }
      n.x += n.vx; n.y += n.vy;
      if (n.x < 60) { n.x = 60; n.vx = Math.abs(n.vx); } if (n.x > 1940) { n.x = 1940; n.vx = -Math.abs(n.vx); }
      if (n.y < 60) { n.y = 60; n.vy = Math.abs(n.vy); } if (n.y > 1940) { n.y = 1940; n.vy = -Math.abs(n.vy); }
    }
    if (state.floodZone && dist(n.x, n.y, state.floodZone.x, state.floodZone.y) < state.floodZone.r && !n.isGateway) { n.alive = false; n.battery = 0; }
    n.battery = Math.max(0, n.battery - 0.02);
    if (n.battery <= 0) n.alive = false;
  }
  const R = state.towersOn ? 2000 : state.range;
  const alive = state.nodes.filter((n) => n.alive);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    if (dist(a.x, a.y, b.x, b.y) > R) continue;
    // PRoPHET encounter update
    a.prophet[b.id] = (a.prophet[b.id] ?? 0) + (1 - (a.prophet[b.id] ?? 0)) * 0.75;
    b.prophet[a.id] = (b.prophet[a.id] ?? 0) + (1 - (b.prophet[a.id] ?? 0)) * 0.75;
    // transitivity via gateway knowledge
    for (const n of [a, b]) { const o = n === a ? b : a; const pg = o.prophet[gwId] ?? 0; n.prophet[gwId] = (n.prophet[gwId] ?? 0) + (1 - (n.prophet[gwId] ?? 0)) * (n.prophet[o.id] ?? 0) * pg * 0.25; }
    // summary-vector exchange, up to 3 msgs each direction, highest priority first
    const pairs: [SimNode, SimNode][] = [[a, b], [b, a]];
    for (const [self, other] of pairs) {
      const missing = self.buffer
        .filter((m) => !hasMsg(other, m.id) && !(m.type === "SOS" && other.immunity.includes(m.payload.sosId)) && state.tick - m.createdTick <= m.ttl)
        .sort((x, y) => y.priority - x.priority)
        .slice(0, 3);
      for (const m of missing) {
        const f = shouldForward(state.strategy, self, other, m, gwId);
        if (!f.send) continue;
        let sendCopy: Envelope = { ...m };
        if (f.giveCopies !== undefined && m.copies !== undefined && m.copies > 1) {
          sendCopy = { ...m, copies: f.giveCopies, hops: [...m.hops] };
          m.copies = m.copies - f.giveCopies;
        }
        if (self.battery <= 0) continue;
        self.battery = Math.max(0, self.battery - 0.4);
        state.transmissions++;
        state.hopEvents.unshift({ from: self.id, to: other.id, msgId: m.id, tick: state.tick });
        if (state.hopEvents.length > 24) state.hopEvents.pop();
        receiveMsg(state, other, sendCopy, self.id, verifyAck);
      }
    }
  }
}

// ---- SOS creation ----
export function injectSOS(state: SimState, originId: string, cat: Category, people: number, v: { child: boolean; elderly: boolean; injured: boolean }, note = "", verified = true): SosMeta | null {
  const o = state.nodes.find((n) => n.id === originId);
  if (!o || !o.alive) return null;
  const mins = 0;
  const score = triageScore(cat, people, v.child, v.elderly, v.injured, mins);
  const level = levelOf(score);
  const sosId = uid("sos");
  const { lat, lng } = toLatLng(o.x, o.y);
  const meta: SosMeta = { sosId, originId, category: cat, people, ...v, x: o.x, y: o.y, lat, lng, createdTick: state.tick, priority: score, level, verified, acked: false, hops: 0, status: "queued", note };
  state.sos.set(sosId, meta);
  const env: Envelope = { id: uid("env"), type: "SOS", originId, createdTick: state.tick, ttl: 120, hops: [originId], x: o.x, y: o.y, priority: score, copies: copiesFor(level), verified, payload: { sosId, category: cat, people, ...v, note, lat, lng } };
  bufferInsert(state, o, env);
  const gw = state.nodes.find((n) => n.isGateway);
  if (gw && o.isGateway) deliverToGateway(state, gw, env);
  return meta;
}

// ---- clustering / incidents ----
export function getIncidents(state: SimState): Incident[] {
  const list = [...state.sos.values()];
  const used = new Set<string>(); const out: Incident[] = [];
  for (const s of list) {
    if (used.has(s.sosId)) continue;
    const group = [s]; used.add(s.sosId);
    for (const t of list) {
      if (used.has(t.sosId) || t.category !== s.category) continue;
      if (dist(s.x, s.y, t.x, t.y) <= 100) { group.push(t); used.add(t.sosId); }
    }
    const mins = (state.tick - Math.min(...group.map((g) => g.createdTick))) / 2; // 2 ticks ≈ 1s → /120 min approx; inflate for demo aging
    const aged = group.map((g) => ({ g, sc: triageScore(g.category, g.people, g.child, g.elderly, g.injured, Math.min(30, (state.tick - g.createdTick) / 4)) }));
    const maxScore = Math.max(...aged.map((a) => a.sc));
    const priority = Math.min(100, maxScore + 5 * (group.length - 1));
    const verified = group.some((g) => g.verified);
    let conf = Math.min(1, 0.4 + 0.2 * (group.length - 1) + (group.length > 1 ? 0.2 : 0));
    if (!verified) conf = Math.min(conf, 0.6);
    const cx = group.reduce((a, g) => a + g.x, 0) / group.length, cy = group.reduce((a, g) => a + g.y, 0) / group.length;
    const { lat, lng } = toLatLng(cx, cy);
    void mins;
    out.push({ id: "inc_" + group[0].sosId, category: s.category, x: cx, y: cy, lat, lng, members: group, reports: group.length, confidence: conf, priority, level: levelOf(priority), verified, oldestTick: Math.min(...group.map((g) => g.createdTick)) });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export function computeMetrics(state: SimState): Metrics {
  const all = [...state.sos.values()];
  const created = all.length;
  const gwGot = all.filter((s) => s.status !== "queued").length;
  const acked = all.filter((s) => s.acked);
  const lat = acked.map((s) => ((s.ackTick ?? s.createdTick) - s.createdTick) / 2).sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  return { deliveryRatio: created ? gwGot / created : 0, medianLatency: median, overhead: gwGot ? state.transmissions / gwGot : 0, drops: state.drops, delivered: gwGot, created, transmissions: state.transmissions };
}

// ---- bridge recommender ----
export function connectedComponents(nodes: SimNode[], range: number): SimNode[][] {
  const alive = nodes.filter((n) => n.alive); const seen = new Set<string>(); const comps: SimNode[][] = [];
  for (const n of alive) {
    if (seen.has(n.id)) continue;
    const comp: SimNode[] = []; const q = [n]; seen.add(n.id);
    while (q.length) { const c = q.pop()!; comp.push(c); for (const m of alive) { if (!seen.has(m.id) && dist(c.x, c.y, m.x, m.y) <= range) { seen.add(m.id); q.push(m); } } }
    comps.push(comp);
  }
  return comps;
}
export function bridgeSuggestions(state: SimState): BridgeSuggestion[] {
  const R = state.towersOn ? 2000 : state.range;
  const comps = connectedComponents(state.nodes, R);
  if (comps.length <= 1) return [];
  const gwComp = comps.find((c) => c.some((n) => n.isGateway));
  const unacked = [...state.sos.values()].filter((s) => !s.acked);
  const out: BridgeSuggestion[] = [];
  for (const c of comps) {
    if (gwComp && c === gwComp) continue;
    const sosHere = unacked.filter((s) => c.some((n) => n.id === s.originId || n.buffer.some((m) => m.payload.sosId === s.sosId)));
    if (sosHere.length === 0) continue;
    // closest pair to gateway component (or any other)
    const target = gwComp ?? comps.find((x) => x !== c)!;
    let best = { d: Infinity, a: c[0], b: target[0] };
    for (const a of c) for (const b of target) { const d = dist(a.x, a.y, b.x, b.y); if (d < best.d) best = { d, a, b }; }
    const gap = Math.max(0, best.d - R);
    out.push({ fromX: best.a.x, fromY: best.a.y, toX: best.b.x, toY: best.b.y, midX: (best.a.x + best.b.x) / 2, midY: (best.a.y + best.b.y) / 2, gap: Math.round(gap), etaMin: Math.round((gap / state.muleSpeed / 60) * 10) / 10, strandedCount: c.length, sosCount: sosHere.length });
  }
  return out.sort((a, b) => b.sosCount - a.sosCount);
}

// ---- benchmark (seeded, headless) ----
export function runBenchmark(): BenchResult[] {
  const strategies: Strategy[] = ["flood", "spray", "prophet"];
  const labels: Record<Strategy, string> = { flood: "Flooding", spray: "Spray-and-Wait", prophet: "PRoPHET+Priority" };
  const colors: Record<Strategy, string> = { flood: "#ef4444", spray: "#f59e0b", prophet: "#22c55e" };
  return strategies.map((st) => {
    const rng = mulberry32(42);
    const st8: SimState = { tick: 0, range: 150, towersOn: false, strategy: st, nodes: [], sos: new Map(), transmissions: 0, drops: 0, hopEvents: [], securityLog: [], floodZone: null, showFloodTool: false, muleSpeed: 5 };
    for (let i = 0; i < 30; i++) st8.nodes.push(makeNode("s" + i, "Node " + i, 100 + rng() * 1800, 100 + rng() * 1800, "volunteer"));
    st8.nodes.push(makeNode("gw1", "Gateway", 1700, 1000, "gateway", true));
    for (let i = 0; i < 6; i++) { const m = makeNode("m" + i, "Mule " + i, 200 + rng() * 1600, 200 + rng() * 1600, "mule"); m.vx = (rng() - 0.5) * 20; m.vy = (rng() - 0.5) * 20; st8.nodes.push(m); }
    const cats: Category[] = ["Medical", "Trapped", "Water", "Shelter", "Food"];
    const plan: { tick: number; node: number; cat: Category; people: number }[] = [];
    for (let i = 0; i < 20; i++) plan.push({ tick: Math.floor(rng() * 240), node: Math.floor(rng() * 30), cat: cats[Math.floor(rng() * cats.length)], people: 1 + Math.floor(rng() * 25) });
    plan.sort((a, b) => a.tick - b.tick);
    let pi = 0;
    const noop = () => true;
    for (let t = 0; t < 600; t++) {
      while (pi < plan.length && plan[pi].tick <= st8.tick) {
        const p = plan[pi++];
        const o = st8.nodes[p.node];
        const score = triageScore(p.cat, p.people, rng() < 0.2, rng() < 0.2, rng() < 0.15, 0);
        const sosId = `bsos_${st}_${pi}`;
        st8.sos.set(sosId, { sosId, originId: o.id, category: p.cat, people: p.people, child: false, elderly: false, injured: false, x: o.x, y: o.y, lat: 0, lng: 0, createdTick: st8.tick, priority: score, level: levelOf(score), verified: true, acked: false, hops: 0, status: "queued" });
        const env: Envelope = { id: `benv_${st}_${pi}`, type: "SOS", originId: o.id, createdTick: st8.tick, ttl: 600, hops: [o.id], x: o.x, y: o.y, priority: score, copies: copiesFor(levelOf(score)), verified: true, payload: { sosId, category: p.cat, people: p.people } };
        // buffer insert inline (no import issues)
        if (o.buffer.length < 20) o.buffer.push(env);
      }
      tickSim(st8, { verifyAck: noop, rng });
    }
    return { strategy: st, label: labels[st], color: colors[st], metrics: computeMetrics(st8) };
  });
}

export function benchVerdict(r: BenchResult[]): string {
  const f = r.find((x) => x.strategy === "flood")!; const p = r.find((x) => x.strategy === "prophet")!;
  const less = f.metrics.overhead ? Math.max(0, Math.round((1 - p.metrics.overhead / f.metrics.overhead) * 100)) : 0;
  return `PRoPHET+Priority delivered ${Math.round(p.metrics.deliveryRatio * 100)}% vs Flooding ${Math.round(f.metrics.deliveryRatio * 100)}% — with ${less}% less overhead per delivery.`;
}

// ---- trust (WebCrypto ECDSA, graceful fallback) ----
export async function genCommandKey(): Promise<{ pubB64: string; privJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const pubB64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { pubB64, privJwk };
}
export async function signAck(privJwk: JsonWebKey, sosId: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode("ACK:" + sosId));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
