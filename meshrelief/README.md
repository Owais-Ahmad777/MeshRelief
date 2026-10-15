# MeshRelief v2 — No signal. Still heard. Still trusted.

Delay-tolerant disaster mesh: PRoPHET + Spray-and-Wait routing, 20-msg buffers with
ACK immunity, signed ACKs, bridge recommender, seeded benchmark. Zero backend.

## Run
```
cd meshrelief
npm install
npm run dev
```
Open the URL, towers start OFF in cyclone scenario with 3 live SOS.

## 2-min demo script
1. **Hook**: "Towers go down for days. Even meshes flood themselves to death."
2. **Lab**: towers OFF, cyclone scenario. Point at the pink dashed **bridge line**
   → gap + ETA to the stranded cluster.
3. **Device tab** → hold 2s to send SOS as Penthakata victim. Back to Lab:
   drag the 🚤 boat mule along the dashed line — SOS hops (yellow flashes) to 🛰️ gateway.
4. **Command**: CRITICAL incident (duplicates merged, confidence ↑). Click
   Acknowledge → watch ACK hop back; victim timeline shows ✅.
5. **Trust**: "Inject fake ACK" → ⛔ rejected in security log. "Inject fake SOS"
   → accepted but ⚠ UNVERIFIED, confidence capped at 60%.
6. **Benchmark**: switch Flood → PRoPHET, hit Benchmark, read the verdict
   (real numbers, seed 42, rerunnable live).
7. Close: "Gossip + routing + trust engine is transport-agnostic — BLE / Wi-Fi
   Direct / LoRa next."

## Architecture
- `src/mesh/engine.ts` — Envelope, MeshNode tick loop (500ms), summary-vector
  exchange (≤3 msgs/neighbor/tick, priority-first), Flood / Spray (L=8/4/2) /
  PRoPHET (P+0.75 encounter, ×0.98 aging, transitivity) + priority, 20-msg buffer
  (evict lowest-priority/oldest, never own unacked SOS or ACK), immunity purge,
  triage score + 100m clustering, bridge recommender (components → stranded →
  closest-pair gap + ETA@5m/s), seeded benchmark (30+6 nodes, 20 SOS, 600 ticks).
- `src/App.tsx` — Canvas mesh map (draggable, hop flashes, flood overlay),
  hold-to-send SOS, command triage board, live metrics, inspector, toasts.
- Persistence: localStorage snapshot (works on refresh / offline once loaded).

## Acceptance mapping
- Tower OFF + isolated SOS → delivered via mules in ~2s of dragging ✔
- Strategy switch changes overhead live ✔ · benchmark seeded/reproducible ✔
- ACK returns to victim; forged ACK rejected visibly ✔
- Fake SOS accepted, flagged unverified ✔ · buffer cap + immunity purge ✔
- Bridge dashed suggestion in cyclone scenario, live-updating ✔
