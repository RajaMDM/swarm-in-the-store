/**
 * Canvas renderer for the store simulation.
 *
 * Draws the static store (walls, shelves, counters) once into an offscreen
 * layer, then paints the heatmap, shoppers and queues on top each frame.
 */
import { CELL } from './engine.js';

const COLORS = {
  paper: '#ffffff',
  floor: '#ffffff',
  wall: '#d5dbe3',
  counter: '#8a96a8',
  ink: '#18243a',
  slate: '#6e7a8c',
  promo: '#da5448',
  heat: [218, 84, 72],
  closed: '#b8c0cc',
};

export class StoreRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{categories:{code:string,color:string,name:string}[]}} products
   */
  constructor(canvas, products) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colorByCode = new Map(products.categories.map((c) => [c.code, c.color]));
    this.sim = null;
    this.cs = 12;
    this.staticLayer = null;
  }

  /** Bind a simulation and size the canvas to its container. */
  setSimulation(sim) {
    this.sim = sim;
    this.resize();
  }

  /** Fit the canvas to its parent width, keeping cells square and crisp. */
  resize() {
    if (!this.sim) return;
    const { W, H } = this.sim.grid;
    const width = this.canvas.parentElement.clientWidth;
    this.cs = Math.max(4, Math.floor(width / W));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${W * this.cs}px`;
    this.canvas.style.height = `${H * this.cs}px`;
    this.canvas.width = Math.round(W * this.cs * dpr);
    this.canvas.height = Math.round(H * this.cs * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.buildStaticLayer(dpr);
  }

  buildStaticLayer(dpr) {
    const { W, H, type, shelf } = this.sim.grid;
    const cs = this.cs;
    const layer = document.createElement('canvas');
    layer.width = Math.round(W * cs * dpr);
    layer.height = Math.round(H * cs * dpr);
    const g = layer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.paper;
    g.fillRect(0, 0, W * cs, H * cs);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const t = type[i];
        if (t === CELL.WALL) {
          g.fillStyle = COLORS.wall;
          g.fillRect(x * cs, y * cs, cs, cs);
        } else if (t === CELL.SHELF) {
          g.fillStyle = this.colorByCode.get(shelf[i]) ?? COLORS.slate;
          g.globalAlpha = 0.28 + (((x * 7 + y * 13) % 5) / 5) * 0.4; // SKU-level texture
          g.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
          g.globalAlpha = 1;
        } else if (t === CELL.COUNTER) {
          g.fillStyle = COLORS.counter;
          g.fillRect(x * cs + 1, y * cs + cs * 0.2, cs - 2, cs * 0.6);
        } else if (t === CELL.ENTRANCE) {
          g.fillStyle = '#eef2f6';
          g.fillRect(x * cs, y * cs, cs, cs);
        } else if (t === CELL.PROMO) {
          g.fillStyle = COLORS.promo;
          g.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
        }
      }
    }

    // Any counter that is not actually staffed — including a phantom lane the
    // dirty master data claims is open — is drawn closed.
    const listed = new Set(this.sim.lanes.map((l) => l.counter?.join(',')));
    const phantomDefs = this.sim.layout.phantomCheckouts ?? [];
    for (const def of [...this.sim.layout.checkouts, ...phantomDefs]) {
      if (listed.has(def.counter.join(','))) continue;
      const [x, y] = def.counter;
      g.fillStyle = COLORS.closed;
      g.fillRect(x * cs + 1, y * cs + cs * 0.2, cs - 2, cs * 0.6);
    }

    g.font = `500 ${Math.max(9, cs * 0.8)}px "DM Mono", ui-monospace, monospace`;
    g.fillStyle = COLORS.slate;
    g.textAlign = 'center';
    for (const l of this.sim.lanes) {
      const [x, y] = l.counter;
      g.fillText(l.id, (x + 0.5) * cs, (y + 2.1) * cs);
    }
    for (const l of this.sim.phantomLanes) {
      const [x, y] = l.counter;
      g.fillStyle = COLORS.promo;
      g.fillText(`${l.id}?`, (x + 0.5) * cs, (y + 2.1) * cs);
    }
    const [cx, cy] = this.sim.layout.collect.service;
    g.fillStyle = COLORS.slate;
    g.fillText('COLLECT', (cx + 0.5) * cs, (cy + 3.1) * cs);
    const doors = [];
    type.forEach((t, i) => { if (t === CELL.ENTRANCE) doors.push(i % W); });
    if (doors.length) {
      const mid = (Math.min(...doors) + Math.max(...doors) + 1) / 2;
      g.fillText('ENTRANCE', mid * cs, (H - 1.4) * cs);
    }
    this.staticLayer = layer;
  }

  /**
   * Paint one frame.
   * @param {{showHeat:boolean}} opts
   */
  draw({ showHeat }) {
    const { sim, ctx, cs } = this;
    if (!sim) return;
    const { W, H } = sim.grid;
    ctx.clearRect(0, 0, W * cs, H * cs);
    ctx.drawImage(this.staticLayer, 0, 0, W * cs, H * cs);

    if (showHeat) {
      let max = 0;
      for (let i = 0; i < sim.heat.length; i++) if (sim.heat[i] > max) max = sim.heat[i];
      if (max > 0) {
        const [r, g, b] = COLORS.heat;
        for (let i = 0; i < sim.heat.length; i++) {
          const v = sim.heat[i];
          if (v <= 0) continue;
          const a = Math.min(0.72, Math.sqrt(v / max) * 0.72);
          ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          ctx.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs, cs);
        }
      }
    }

    const r = Math.max(2, cs * 0.3);
    const dot = (px, py, color, ring) => {
      ctx.beginPath();
      ctx.arc(px, py, r + 1.2, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.paper;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (ring) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.promo;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    for (const a of sim.agents) {
      if (a.state === 'done' || a.state === 'queue' || a.state === 'serve') continue;
      const x = a.pos % W;
      const y = (a.pos - x) / W;
      dot((x + 0.5 + a.jx * 0.35) * cs, (y + 0.5 + a.jy * 0.35) * cs, a.seg.color, a.state === 'confused');
    }

    for (const lane of [...sim.lanes, sim.collectLane]) {
      const sx = lane.service % W;
      const sy = (lane.service - sx) / W;
      const [dx, dy] = lane.queueDir;
      if (lane.serving) dot((sx + 0.5) * cs, (sy + 0.5) * cs, lane.serving.seg.color, false);
      lane.queue.forEach((a, k) => {
        const step = k < 6 ? k + 1 : 6 + (k - 5) * 0.45; // compress long queues
        dot((sx + 0.5 + dx * step) * cs, (sy + 0.5 + dy * step) * cs, a.seg.color, false);
      });
    }
  }
}
