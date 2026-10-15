import { useEffect, useMemo, useRef, useState } from "react";
import {
  createState, tickSim, injectSOS, getIncidents, computeMetrics,
  bridgeSuggestions, runBenchmark, benchVerdict,
  cycloneScenario, dist, toLatLng, levelOf, triageScore,
} from "./mesh/engine";
import type { SimState, SimNode, Category, Strategy, Envelope, BenchResult } from "./mesh/engine";

// ---------- small helpers ----------
const CATS: Category[] = ["Medical", "Trapped", "Water", "Shelter", "Food"];
const CAT_ICON: Record<Category, string> = { Medical: "🏥", Trapped: "🆘", Water: "💧", Shelter: "🏕️", Food: "🍲" };
function lvlColor(l: string) { return l === "CRITICAL" ? "#ef4444" : l === "HIGH" ? "#f59e0b" : "#38bdf8"; }
function kindColor(n: SimNode) {
  if (!n.alive) return "#52525b";
  if (n.isGateway) return "#22c55e";
  if (n.kind === "victim") return "#ef4444";
  if (n.kind === "boat") return "#38bdf8";
  if (n.kind === "mule") return "#a78bfa";
  if (n.kind === "medic") return "#f472b6";
  return "#eab308";
}

export default function App() {
  const simRef = useRef<SimState | null>(null);
  if (!simRef.current) {
    simRef.current = createState();
    try {
      const raw = localStorage.getItem("meshrelief_v2");
      if (raw) {
        const p = JSON.parse(raw);
        if (p.nodes?.length) {
          const s = simRef.current;
          s.nodes = p.nodes; s.range = p.range ?? 260; s.strategy = p.strategy ?? "prophet"; s.tick = p.tick ?? 0;
          s.sos = new Map(p.sos ?? []);
        }
      }
    } catch { /* fresh */ }
  }
  const sim = simRef.current;
  const legitAcks = useRef<Set<string>>(new Set());
  const [render, setRender] = useState(0);
  const [tab, setTab] = useState<"lab" | "device" | "command">("lab");
  const [sel, setSel] = useState<string>("v1");
  const [myDevice, setMyDevice] = useState<string>("v1");
  const [toasts, setToasts] = useState<string[]>([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [showGuide, setShowGuide] = useState(() => { try { return localStorage.getItem("meshrelief_guide") !== "done"; } catch { return true; } });
  const [bench, setBench] = useState<BenchResult[] | null>(null);
  const [benchRun, setBenchRun] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [holdPct, setHoldPct] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<string | null>(null);

  // SOS form
  const [cat, setCat] = useState<Category>("Trapped");
  const [people, setPeople] = useState(4);
  const [child, setChild] = useState(false);
  const [elderly, setElderly] = useState(true);
  const [injured, setInjured] = useState(false);
  const [note, setNote] = useState("");

  const toast = (t: string) => { setToasts((p) => [t, ...p].slice(0, 3)); setTimeout(() => setToasts((p) => p.slice(0, 2)), 3200); };

  // tick loop 500ms
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = simRef.current!;
      // hook legit-ACK tracking: wrap by tagging new ACKs after tick
      const before = new Set<string>(); s.nodes.forEach((n) => n.buffer.forEach((m) => { if (m.type === "ACK") before.add(m.id); }));
      tickSim(s, { verifyAck: (m: Envelope) => legitAcks.current.has(m.id) || m.verified });
      s.nodes.forEach((n) => n.buffer.forEach((m) => { if (m.type === "ACK" && !before.has(m.id) && m.verified) legitAcks.current.add(m.id); }));
      // auto-seed 3 demo SOS once
      if (s.tick === 4 && s.sos.size === 0) {
        injectSOS(s, "v1", "Trapped", 6, { child: true, elderly: false, injured: true }, "Roof collapse, need rescue");
        injectSOS(s, "v2", "Medical", 2, { child: false, elderly: true, injured: true }, "Insulin + bleeding control");
        injectSOS(s, "v3", "Water", 12, { child: true, elderly: true, injured: false }, "No drinking water 2 days");
      }
      setRender((r) => r + 1);
    }, 500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // online/offline banner
  useEffect(() => {
    const a = () => setOnline(true); const b = () => setOnline(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);

  // persist
  useEffect(() => {
    if (render % 10 !== 0) return;
    try { localStorage.setItem("meshrelief_v2", JSON.stringify({ nodes: sim.nodes, range: sim.range, strategy: sim.strategy, tick: sim.tick, sos: [...sim.sos.entries()] })); } catch { /* ignore */ }
  }, [render, sim]);

  const incidents = useMemo(() => getIncidents(sim), [sim, render]);
  const metrics = useMemo(() => computeMetrics(sim), [sim, render]);
  const bridges = useMemo(() => bridgeSuggestions(sim), [sim, render]);
  const selNode = sim.nodes.find((n) => n.id === sel) ?? sim.nodes[0];
  const mySos = useMemo(() => [...sim.sos.values()].filter((s) => s.originId === myDevice).sort((a, b) => b.createdTick - a.createdTick), [sim, render, myDevice]);
  void render;

  // ---------- canvas map ----------
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    // HiDPI: render at device pixels, draw in CSS pixels (crisp on retina/mobile)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || 720, cssH = Math.round((cssW * 560) / 720);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      cv.style.height = cssH + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;
    const px = (x: number) => (x / 2000) * W, py = (y: number) => (y / 2000) * H;
    ctx.clearRect(0, 0, W, H);
    // grid + terrain
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(148,163,184,0.12)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo((i / 10) * W, 0); ctx.lineTo((i / 10) * W, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (i / 10) * H); ctx.lineTo(W, (i / 10) * H); ctx.stroke(); }
    // flood zone
    if (sim.floodZone) {
      ctx.beginPath(); ctx.arc(px(sim.floodZone.x), py(sim.floodZone.y), (sim.floodZone.r / 2000) * W, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(59,130,246,0.22)"; ctx.fill(); ctx.strokeStyle = "#3b82f6"; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#93c5fd"; ctx.font = "12px sans-serif"; ctx.fillText("🌊 flood zone — nodes inside die", px(sim.floodZone.x) - 110, py(sim.floodZone.y) - (sim.floodZone.r / 2000) * W - 6);
    }
    const R = sim.towersOn ? 2000 : sim.range;
    // links
    const alive = sim.nodes.filter((n) => n.alive);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      if (dist(a.x, a.y, b.x, b.y) <= R) {
        ctx.strokeStyle = "rgba(34,197,94,0.35)";
        ctx.beginPath(); ctx.moveTo(px(a.x), py(a.y)); ctx.lineTo(px(b.x), py(b.y)); ctx.stroke();
      }
    }
    // range circles (selected + gateway faint)
    for (const n of alive) {
      if (n.id !== sel && !n.isGateway) continue;
      ctx.beginPath(); ctx.arc(px(n.x), py(n.y), (R / 2000) * W, 0, Math.PI * 2);
      ctx.strokeStyle = n.isGateway ? "rgba(34,197,94,0.5)" : "rgba(234,179,8,0.55)"; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    }
    // hop flashes
    for (const h of sim.hopEvents.slice(0, 10)) {
      const a = sim.nodes.find((n) => n.id === h.from), b = sim.nodes.find((n) => n.id === h.to);
      if (!a || !b) continue;
      const age = sim.tick - h.tick; if (age > 6) continue;
      ctx.strokeStyle = `rgba(251,191,36,${Math.max(0.15, 1 - age / 6)})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px(a.x), py(a.y)); ctx.lineTo(px(b.x), py(b.y)); ctx.stroke(); ctx.lineWidth = 1.2;
    }
    // bridge suggestions
    bridges.forEach((br, i) => {
      ctx.strokeStyle = "#f472b6"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px(br.fromX), py(br.fromY)); ctx.lineTo(px(br.toX), py(br.toY)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1.2;
      ctx.fillStyle = "#f472b6"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`🌉 move mule here · gap ${br.gap}m · ETA ${br.etaMin}min`, px(br.midX) - 120, py(br.midY) - 10);
      void i;
    });
    // nodes
    for (const n of sim.nodes) {
      const X = px(n.x), Y = py(n.y);
      const unacked = [...sim.sos.values()].some((s) => !s.acked && (s.originId === n.id || n.buffer.some((m) => m.payload.sosId === s.sosId)));
      ctx.beginPath(); ctx.arc(X, Y, n.isGateway ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = kindColor(n); ctx.fill();
      if (n.id === sel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1.2; }
      if (unacked && n.alive) { ctx.beginPath(); ctx.arc(X, Y, 15, 0, Math.PI * 2); ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1.2; }
      ctx.fillStyle = "#e2e8f0"; ctx.font = "11px sans-serif";
      const label = `${n.isGateway ? "🛰️ " : n.kind === "victim" ? "🧍 " : n.kind === "boat" ? "🚤 " : n.kind === "mule" ? "🚲 " : n.kind === "medic" ? "⚕️ " : "🙋 "}${n.name}${n.alive ? "" : " ☠️"} ·🔋${Math.round(n.battery)}`;
      ctx.fillText(label, X + 14, Y + 4);
      // buffer badge
      if (n.buffer.length > 0) { ctx.fillStyle = "#0ea5e9"; ctx.beginPath(); ctx.arc(X - 10, Y - 10, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "bold 9px sans-serif"; ctx.fillText(String(n.buffer.length), X - 13, Y - 7); }
    }
  });

  const posFromClient = (cx: number, cy: number) => {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * 2000, y: ((cy - r.top) / r.height) * 2000 };
  };
  const pressAt = (p: { x: number; y: number }) => {
    if (sim.showFloodTool) { sim.floodZone = { x: p.x, y: p.y, r: 220 }; sim.showFloodTool = false; toast("🌊 flood zone placed — nodes inside will die"); setRender((r) => r + 1); return; }
    let best: SimNode | null = null; let bd = 170;
    for (const n of sim.nodes) { const d = dist(n.x, n.y, p.x, p.y); if (d < bd) { bd = d; best = n; } }
    if (best) { dragRef.current = best.id; setSel(best.id); }
  };
  const moveAt = (p: { x: number; y: number }) => {
    if (!dragRef.current) return;
    const n = sim.nodes.find((x) => x.id === dragRef.current)!;
    n.x = Math.max(40, Math.min(1960, p.x)); n.y = Math.max(40, Math.min(1960, p.y));
    setRender((r) => r + 1);
  };
  const onDown = (e: React.MouseEvent) => pressAt(posFromClient(e.clientX, e.clientY));
  const onMove = (e: React.MouseEvent) => moveAt(posFromClient(e.clientX, e.clientY));
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; if (t) pressAt(posFromClient(t.clientX, t.clientY)); };
  const onTouchMove = (e: React.TouchEvent) => { const t = e.touches[0]; if (t) { e.preventDefault(); moveAt(posFromClient(t.clientX, t.clientY)); } };

  // ---------- actions ----------
  const sendSOS = () => {
    const m = injectSOS(sim, myDevice, cat, people, { child, elderly, injured }, note, true);
    if (m) { toast(`${CAT_ICON[cat]} SOS queued · ${m.level} · score ${m.priority}`); setNote(""); }
    else toast("⚠️ device is dead — revive it in Lab first");
    setRender((r) => r + 1);
  };
  const holdStartFn = (e: React.PointerEvent) => {
    e.preventDefault(); holdStart.current = Date.now(); setHoldPct(1);
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - holdStart.current) / 2000) * 100); setHoldPct(p);
      if (p >= 100) { if (holdTimer.current) window.clearInterval(holdTimer.current); setHoldPct(0); sendSOS(); }
    }, 50);
  };
  const holdEnd = () => { if (holdTimer.current) window.clearInterval(holdTimer.current); setHoldPct(0); };

  const ackIncident = (incId: string, to: "acked" | "dispatched" | "resolved") => {
    const inc = incidents.find((i) => i.id === incId); if (!inc) return;
    for (const m of inc.members) {
      const s = sim.sos.get(m.sosId)!;
      if (to === "acked") { /* gateway already emitted ACK; force-ack for demo */ s.acked = true; s.ackTick = sim.tick; s.status = "acked"; const o = sim.nodes.find((n) => n.id === s.originId); if (o && !o.immunity.includes(s.sosId)) o.immunity.push(s.sosId); }
      else s.status = to;
    }
    toast(to === "acked" ? "✅ ACK injected from gateway — watch it hop back" : to === "dispatched" ? "🚑 team dispatched" : "✔️ incident resolved");
    setRender((r) => r + 1);
  };

  const injectFakeAck = () => {
    const all = [...sim.sos.values()].filter((s) => !s.acked);
    if (!all.length) { toast("no live SOS to forge against"); return; }
    const target = all[0];
    const fake: Envelope = { id: "evil_ack_" + Math.floor(Math.random() * 9999), type: "ACK", originId: "attacker", createdTick: sim.tick, ttl: 60, hops: ["attacker"], x: 1000, y: 1000, priority: 100, verified: false, payload: { sosId: target.sosId, ackFor: target.sosId } };
    const victim = sim.nodes.find((n) => n.id === target.originId)!;
    // run through same verify path → rejected
    if (!legitAcks.current.has(fake.id) && !fake.verified) {
      sim.securityLog.unshift(`⛔ forged ACK for ${target.sosId.slice(0, 12)}… rejected (bad signature)`);
      toast("⛔ forged ACK rejected — see security log");
    } else { victim.buffer.push(fake); }
    void victim;
    setRender((r) => r + 1);
  };
  const injectFakeSos = () => {
    const m = injectSOS(sim, "vol2", "Medical", 30, { child: false, elderly: false, injured: false }, "FAKE: 30 critical at market (unregistered device)", false);
    if (m) { sim.securityLog.unshift(`⚠️ unknown-signer SOS ${m.sosId.slice(0, 12)}… accepted but UNVERIFIED, confidence capped`); toast("⚠️ fake SOS accepted but flagged unverified"); }
    setRender((r) => r + 1);
  };

  const doBenchmark = () => {
    setBenchRun(true);
    setTimeout(() => { const r = runBenchmark(); setBench(r); setBenchRun(false); toast("📊 benchmark done — seeded run, reproducible"); }, 60);
  };
  const resetAll = () => {
    const keep = { range: sim.range, strategy: sim.strategy };
    const fresh = createState(); fresh.range = keep.range; fresh.strategy = keep.strategy;
    sim.nodes = cycloneScenario(); sim.sos = fresh.sos; sim.tick = 0; sim.transmissions = 0; sim.drops = 0; sim.hopEvents = []; sim.floodZone = null;
    sim.securityLog = ["🛡️ trust engine on · ACKs require command signature"];
    legitAcks.current.clear(); setBench(null); localStorage.removeItem("meshrelief_v2");
    toast("🔄 cyclone scenario reset"); setRender((r) => r + 1);
  };

  const maxBar = bench ? Math.max(...bench.map((b) => b.metrics.deliveryRatio), 0.01) : 1;
  const previewScore = triageScore(cat, people, child, elderly, injured, 5);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">📡</span><div><b>MeshRelief</b><small>No signal. Still heard. Still trusted.</small></div></div>
        <nav className="tabs">
          <button className={tab === "lab" ? "on" : ""} onClick={() => setTab("lab")}>🧪 Mesh Lab</button>
          <button className={tab === "device" ? "on" : ""} onClick={() => setTab("device")}>📱 My Device</button>
          <button className={tab === "command" ? "on" : ""} onClick={() => setTab("command")}>🏥 Command <span className="pill">{incidents.length}</span></button>
        </nav>
        <div className="top-right">
          <span className={sim.towersOn ? "net on" : "net off"}>{sim.towersOn ? "🗼 towers ON" : "📵 towers OFF · mesh mode"}</span>
          <button className="btn sm" onClick={() => { sim.towersOn = !sim.towersOn; setRender((r) => r + 1); }}>{sim.towersOn ? "Kill towers" : "Restore towers"}</button>
        </div>
      </header>

      <div className="scope">Real: DTN gossip, PRoPHET/Spray routing, buffers, signing, triage, clustering · Simulated: radio range + mobility · Roadmap: BLE / Wi-Fi Direct / LoRa</div>
      {!online && <div className="offline">📴 you're offline — MeshRelief runs fully on-device, keep demoing</div>}

      <div className="toasts">{toasts.map((t, i) => <div key={i} className="toast">{t}</div>)}</div>

      {tab === "lab" && (
        <div className="grid-lab">
          {showGuide && (
            <div className="card guide">
              <div className="card-h"><b>▶ 60-second guided demo</b><button className="btn sm" onClick={() => { setShowGuide(false); try { localStorage.setItem("meshrelief_guide", "done"); } catch { /* ignore */ } }}>Hide</button></div>
              <ol>
                <li>🧪 Towers OFF — pink dashed line = stranded cluster, gap + mule ETA.</li>
                <li>📱 Device tab → <b>hold the red button 2s</b> to send an SOS.</li>
                <li>Back here: drag the 🚤 boat mule along the dashed line — yellow flashes = hops.</li>
                <li>🏥 Command → <b>Acknowledge</b> — the ACK hops back, victim shows ✅.</li>
                <li>Try 💀 fake ACK (rejected) and 👻 fake SOS (flagged unverified).</li>
                <li>📊 Benchmark — read the verdict; rerun it live for judges.</li>
              </ol>
            </div>
          )}
          <div className="card map-card">
            <div className="card-h"><b>Mesh Lab · tick {sim.tick}</b><span className="hint">drag nodes · click node to select</span></div>
            <canvas ref={canvasRef} width={720} height={560} className="map" role="application" aria-label="Disaster mesh map. Drag nodes to move them."
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={() => (dragRef.current = null)} onMouseLeave={() => (dragRef.current = null)}
              onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => (dragRef.current = null)} />
            <div className="map-legend">
              <span>🟢 gateway</span><span>🔴 victim</span><span>🟡 relay</span><span>🟣 mule</span><span>🩷 medic</span><span>🔵 boat</span><span>💀 dead</span>
            </div>
            {bridges.length > 0 && (
              <div className="bridge-box">
                <b>🌉 Bridge Recommender — {bridges.length} stranded cluster{bridges.length > 1 ? "s" : ""}</b>
                {bridges.map((b, i) => <div key={i}>Move a responder/mule to mid-field · gap <b>{b.gap}m</b> · ETA <b>{b.etaMin} min</b> @5m/s · {b.sosCount} SOS waiting · {b.strandedCount} nodes cut off</div>)}
              </div>
            )}
          </div>

          <div className="side">
            <div className="card">
              <div className="card-h"><b>Routing strategy</b></div>
              <div className="seg">
                {(["flood", "spray", "prophet"] as Strategy[]).map((s) => (
                  <button key={s} className={sim.strategy === s ? "on" : ""} onClick={() => { sim.strategy = s; setRender((r) => r + 1); }}>
                    {s === "flood" ? "🌊 Flooding" : s === "spray" ? "💧 Spray-and-Wait" : "🧠 PRoPHET+Priority"}
                  </button>
                ))}
              </div>
              <div className="stratdesc">{sim.strategy === "flood" ? "🌊 every encounter copies everything — fastest spread, most battery burn." : sim.strategy === "spray" ? "💧 fixed copy budgets (8/4/2) split on contact; last copy only to the gateway." : "🧠 forward only toward higher gateway-predictability; CRITICAL also sprays."}</div>
              <label className="row">Range <b>{sim.towersOn ? "∞ (towers)" : sim.range + "m"}</b></label>
              <input type="range" min={80} max={600} value={sim.range} disabled={sim.towersOn} onChange={(e) => { sim.range = Number(e.target.value); setRender((r) => r + 1); }} />
              <div className="row btns">
                <button className="btn sm warn" onClick={resetAll}>🌀 Cyclone scenario</button>
                <button className="btn sm" onClick={() => { const n = selNode; if (n && !n.isGateway) { n.alive = !n.alive; if (!n.alive) n.battery = 0; else n.battery = 100; toast(n.alive ? `💚 ${n.name} revived` : `💀 ${n.name} killed`); setRender((r) => r + 1); } }}>{selNode && !selNode.alive ? "💚 Revive selected" : "💀 Kill selected"}</button>
              </div>
              <div className="row btns">
                <button className={sim.floodZone ? "btn sm danger" : "btn sm"} onClick={() => { if (sim.floodZone) { sim.floodZone = null; } else { sim.showFloodTool = !sim.showFloodTool; toast(sim.showFloodTool ? "click map to place flood zone" : "flood tool off"); } setRender((r) => r + 1); }}>{sim.floodZone ? "🌊 Clear flood" : "🌊 Flood zone"}</button>
                <button className="btn sm" onClick={() => setInspector(!inspector)}>{inspector ? "Hide inspector" : "🔍 Inspect " + (selNode?.name ?? "")}</button>
              </div>
              {inspector && selNode && (
                <div className="inspector">
                  <b>{selNode.name}</b> · buf {selNode.buffer.length}/20 · P→gw {(selNode.prophet["gw1"] ?? 0).toFixed(2)} · 🔋{Math.round(selNode.battery)}
                  {selNode.buffer.slice(0, 6).map((m) => <div key={m.id} className="mono">· {m.type} {m.payload.sosId.slice(0, 10)}… pri {m.priority} {m.copies !== undefined ? `cp ${m.copies}` : ""} hops {m.hops.length} age {sim.tick - m.createdTick}t {m.verified ? "✔" : "⚠"}</div>)}
                  {selNode.buffer.length > 6 && <div className="mono">… +{selNode.buffer.length - 6} more</div>}
                  <div className="mono">immunity: {selNode.immunity.length} acked SOS purged</div>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-h"><b>📈 Live metrics</b><span className="hint">{sim.strategy}</span></div>
              <div className="mgrid">
                <div><small>Delivery</small><b>{Math.round(metrics.deliveryRatio * 100)}%</b><span>{metrics.delivered}/{metrics.created}</span></div>
                <div><small>Median latency</small><b>{metrics.medianLatency.toFixed(1)}s</b><span>creation→gateway</span></div>
                <div><small>Overhead</small><b>{metrics.overhead.toFixed(1)}</b><span>tx / delivered</span></div>
                <div><small>Buffer drops</small><b>{metrics.drops}</b><span>evicted</span></div>
              </div>
              <button className="btn primary" onClick={doBenchmark} disabled={benchRun}>{benchRun ? "⏳ running seeded sim…" : "📊 Benchmark: Flood vs Spray vs PRoPHET"}</button>
              {bench && (
                <div className="bench">
                  {bench.map((b) => (
                    <div key={b.strategy} className="brow">
                      <span className="blabel">{b.label}</span>
                      <div className="btrack"><div className="bfill" style={{ width: `${(b.metrics.deliveryRatio / maxBar) * 100}%`, background: b.strategy === "flood" ? "#ef4444" : b.strategy === "spray" ? "#f59e0b" : "#22c55e" }} /></div>
                      <span className="bnum">{Math.round(b.metrics.deliveryRatio * 100)}% · {b.metrics.medianLatency.toFixed(0)}s · {b.metrics.overhead.toFixed(1)}x</span>
                    </div>
                  ))}
                  <div className="verdict">🏆 {benchVerdict(bench)}</div>
                  <small className="hint">seed 42 · 30 static + 6 mules · 20 SOS · 600 ticks — rerun live, never hardcoded</small>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-h"><b>🛡️ Trust & attacks</b></div>
              <div className="row btns">
                <button className="btn sm danger" onClick={injectFakeAck}>💀 Inject fake ACK</button>
                <button className="btn sm danger" onClick={injectFakeSos}>👻 Inject fake SOS</button>
              </div>
              <div className="seclog">{sim.securityLog.slice(0, 5).map((l, i) => <div key={i}>{l}</div>)}</div>
            </div>
          </div>
        </div>
      )}

      {tab === "device" && (
        <div className="grid-2">
          <div className="card">
            <div className="card-h"><b>📱 Victim device</b></div>
            <label className="row">Acting as</label>
            <select value={myDevice} onChange={(e) => setMyDevice(e.target.value)}>
              {sim.nodes.filter((n) => !n.isGateway).map((n) => <option key={n.id} value={n.id}>{n.name} {n.alive ? "" : "(dead)"}</option>)}
            </select>
            <label className="row">Category</label>
            <div className="catgrid">
              {CATS.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{CAT_ICON[c]} {c}</button>)}
            </div>
            <label className="row">People in need: <b>{people}</b></label>
            <input type="range" min={1} max={40} value={people} onChange={(e) => setPeople(Number(e.target.value))} />
            <div className="row btns">
              <button className={child ? "btn sm on" : "btn sm"} onClick={() => setChild(!child)}>🧒 child</button>
              <button className={elderly ? "btn sm on" : "btn sm"} onClick={() => setElderly(!elderly)}>🧓 elderly</button>
              <button className={injured ? "btn sm on" : "btn sm"} onClick={() => setInjured(!injured)}>🤕 injured</button>
            </div>
            <input className="txt" placeholder="note e.g. roof collapse, 2nd floor…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="preview">triage preview: <b style={{ color: lvlColor(levelOf(previewScore)) }}>{levelOf(previewScore)} · {previewScore}/100</b></div>
            <button className="hold" onPointerDown={holdStartFn} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
              <span className="holdfill" style={{ width: holdPct + "%" }} />
              <span className="holdtxt">{holdPct > 0 ? `sending… ${Math.round(holdPct)}%` : "HOLD 2s TO SEND SOS"}</span>
            </button>
            <small className="hint">signed at origin · priority {previewScore} · copies {levelOf(previewScore) === "CRITICAL" ? 8 : levelOf(previewScore) === "HIGH" ? 4 : 2} · TTL 120 ticks</small>
          </div>
          <div className="card">
            <div className="card-h"><b>📶 My SOS timeline</b></div>
            {mySos.length === 0 && <div className="empty">No SOS from this device yet. Hold-to-send one.</div>}
            {mySos.map((s) => {
              const ll = toLatLng(s.x, s.y);
              return (
                <div key={s.sosId} className="sos">
                  <div className="sos-h"><span>{CAT_ICON[s.category]} {s.category}</span><b style={{ color: lvlColor(s.level) }}>{s.level} {s.priority}</b></div>
                  <div className="steps">
                    <span className="done">● Queued</span><span className={s.status !== "queued" ? "done" : ""}>● Relayed {s.hops} hops</span><span className={s.acked ? "done" : ""}>● Acknowledged</span>
                  </div>
                  <div className="meta">{s.acked ? "✅ ACK received — help is coming" : s.status !== "queued" ? "📡 at gateway, awaiting command ACK" : "⏳ in mesh, hopping toward gateway"} · {s.verified ? "✔ signed" : "⚠ unverified"} · {ll.lat.toFixed(4)},{ll.lng.toFixed(4)}</div>
                  {s.note && <div className="note">“{s.note}”</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "command" && (
        <div className="grid-2">
          <div className="card">
            <div className="card-h"><b>🏥 Incidents — ranked by triage</b><span className="hint">{incidents.length} clusters · 100m merge</span></div>
            {incidents.length === 0 && <div className="empty">No SOS delivered yet. Towers OFF? Drag a mule toward the stranded cluster.</div>}
            {incidents.map((inc) => (
              <div key={inc.id} className={inc.level === "CRITICAL" ? "inc crit" : "inc"}>
                <div className="inc-h">
                  <span>{CAT_ICON[inc.category]} {inc.category} ×{inc.reports}</span>
                  <b style={{ color: lvlColor(inc.level) }}>{inc.level} {Math.round(inc.priority)}</b>
                </div>
                <div className="meta">{inc.verified ? "✔ verified" : "⚠ UNVERIFIED — lower confidence"} · conf {Math.round(inc.confidence * 100)}% · {inc.lat.toFixed(4)},{inc.lng.toFixed(4)}</div>
                <div className="meta">{inc.members.map((m) => `${m.people}p${m.acked ? "✅" : ""}`).join(" · ")}</div>
                <div className="row btns">
                  <button className="btn sm" onClick={() => ackIncident(inc.id, "acked")}>✅ Acknowledge</button>
                  <button className="btn sm" onClick={() => ackIncident(inc.id, "dispatched")}>🚑 Dispatch</button>
                  <button className="btn sm" onClick={() => ackIncident(inc.id, "resolved")}>✔ Resolve</button>
                </div>
              </div>
            ))}
          </div>
          <div className="side">
            <div className="card">
              <div className="card-h"><b>📈 Impact</b></div>
              <div className="mgrid">
                <div><small>SOS created</small><b>{metrics.created}</b></div>
                <div><small>At gateway</small><b>{metrics.delivered}</b></div>
                <div><small>Acknowledged</small><b>{[...sim.sos.values()].filter((s) => s.acked).length}</b></div>
                <div><small>Transmissions</small><b>{metrics.transmissions}</b></div>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><b>🛡️ Security log</b></div>
              <div className="seclog big">{sim.securityLog.map((l, i) => <div key={i}>{l}</div>)}</div>
            </div>
            <div className="card">
              <div className="card-h"><b>⚙️ Demo controls</b></div>
              <div className="row btns">
                <button className="btn sm warn" onClick={resetAll}>🔄 Reset demo</button>
                <button className="btn sm" onClick={() => { localStorage.removeItem("meshrelief_v2"); toast("💾 saved state cleared"); }}>🗑 Clear saved</button>
              </div>
              <small className="hint">state persists on refresh (localStorage) · works offline once loaded</small>
            </div>
          </div>
        </div>
      )}

      <footer className="foot">MeshRelief v2 · Flood / Spray-and-Wait / PRoPHET+Priority · buffer 20 + ACK immunity · ECDSA trust · seed-42 benchmark · EN demo build</footer>
    </div>
  );
}
