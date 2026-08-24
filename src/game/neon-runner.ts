/* NEON RUNNER — canvas game engine (framework agnostic) */

export type Phase = "menu" | "playing" | "paused" | "over";

export interface Skin {
  id: string;
  name: string;
  cost: number;
  body: string;
  glow: string;
  trail: string;
}

export const SKINS: Skin[] = [
  { id: "cyan", name: "Vector", cost: 0, body: "#7ff6ff", glow: "#00e5ff", trail: "#00e5ff" },
  { id: "magenta", name: "Pulse", cost: 150, body: "#ff9ae0", glow: "#ff2fb5", trail: "#ff2fb5" },
  { id: "lime", name: "Circuit", cost: 400, body: "#c8ff8a", glow: "#8cff2f", trail: "#8cff2f" },
  { id: "amber", name: "Solar", cost: 900, body: "#ffd79a", glow: "#ffa62f", trail: "#ffa62f" },
  { id: "violet", name: "Phantom", cost: 1800, body: "#c9b6ff", glow: "#8b5cff", trail: "#8b5cff" },
];

export interface Achievement {
  id: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_run", name: "First Steps", desc: "Finish your first run" },
  { id: "coins_100", name: "Coin Rush", desc: "Collect 100 coins in total" },
  { id: "combo_10", name: "Chain Reaction", desc: "Reach a x10 combo" },
  { id: "score_2000", name: "City Sprinter", desc: "Score 2,000 in one run" },
  { id: "speed_max", name: "Overdrive", desc: "Hit maximum speed" },
];

export interface HudState {
  score: number;
  coins: number;
  combo: number;
  speedPct: number;
  best: number;
}

export interface EngineCallbacks {
  onHud: (h: HudState) => void;
  onGameOver: (r: { score: number; coins: number; best: number; newBest: boolean }) => void;
  onAchievement: (id: string) => void;
  onCoin: () => void;
  onJump: () => void;
  onHit: () => void;
}

const W = 960;
const H = 540;
const GROUND = 430;
const MAX_SPEED = 15;

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "block" | "bar" | "spike";
  hue: string;
}
interface Coin {
  x: number;
  y: number;
  t: number;
  dead: boolean;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}
interface Popup {
  x: number;
  y: number;
  life: number;
  text: string;
  color: string;
}
interface Building {
  x: number;
  w: number;
  h: number;
  seed: number;
}

export class NeonRunner {
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private raf = 0;
  private last = 0;
  phase: Phase = "menu";

  private speed = 6;
  private dist = 0;
  private score = 0;
  private coins = 0;
  private combo = 0;
  private comboTimer = 0;
  private spawnTimer = 0;
  private coinTimer = 0;

  private py = GROUND;
  private vy = 0;
  private sliding = false;
  private slideTimer = 0;
  private jumps = 0;
  private runT = 0;

  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private layers: Building[][] = [[], [], []];
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private shake = 0;
  private flash = 0;

  skin: Skin = SKINS[0]!;
  best = 0;
  totalCoins = 0;
  unlocked: string[] = ["cyan"];
  achieved: string[] = [];

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    canvas.width = W;
    canvas.height = H;
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random() * W,
        y: Math.random() * GROUND * 0.85,
        r: Math.random() * 1.6 + 0.4,
        a: Math.random(),
      });
    }
    this.layers = [this.makeLayer(3), this.makeLayer(2), this.makeLayer(1)];
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private makeLayer(depth: number) {
    const arr: Building[] = [];
    let x = 0;
    while (x < W + 400) {
      const w = 60 + Math.random() * 90 / depth;
      const h = (80 + Math.random() * 200) / (depth * 0.6);
      arr.push({ x, w, h, seed: Math.random() });
      x += w + 12;
    }
    return arr;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  start() {
    this.speed = 6;
    this.dist = 0;
    this.score = 0;
    this.coins = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.obstacles = [];
    this.coinList = [];
    this.particles = [];
    this.popups = [];
    this.py = GROUND;
    this.vy = 0;
    this.jumps = 0;
    this.sliding = false;
    this.spawnTimer = 150;
    this.coinTimer = 40;
    this.shake = 0;
    this.phase = "playing";
    this.emitHud();
  }

  pause() {
    if (this.phase === "playing") this.phase = "paused";
    else if (this.phase === "paused") this.phase = "playing";
  }

  jump() {
    if (this.phase !== "playing") return;
    if (this.jumps < 2) {
      this.vy = this.jumps === 0 ? -15.5 : -13;
      this.jumps++;
      this.sliding = false;
      this.cb.onJump();
      this.burst(90, this.py, this.skin.trail, 10, 1.4);
    }
  }

  slide() {
    if (this.phase !== "playing") return;
    this.sliding = true;
    this.slideTimer = 34;
    if (this.py < GROUND) this.vy = 16;
  }

  private emitHud() {
    this.cb.onHud({
      score: Math.floor(this.score),
      coins: this.coins,
      combo: this.combo,
      speedPct: Math.min(1, (this.speed - 6) / (MAX_SPEED - 6)),
      best: this.best,
    });
  }

  private unlockAch(id: string) {
    if (this.achieved.includes(id)) return;
    this.achieved.push(id);
    this.cb.onAchievement(id);
  }

  private burst(x: number, y: number, color: string, n: number, spread = 2) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4 * spread,
        vy: (Math.random() - 0.5) * 4 * spread - 1,
        life: 1,
        max: 0.02 + Math.random() * 0.03,
        color,
        size: 1 + Math.random() * 3,
      });
    }
  }

  private spawnObstacle() {
    const r = Math.random();
    const palette = ["#ff2fb5", "#00e5ff", "#8cff2f"];
    const hue = palette[Math.floor(Math.random() * palette.length)]!;
    if (r < 0.42) {
      const h = 40 + Math.random() * 45;
      this.obstacles.push({ x: W + 40, y: GROUND - h, w: 34 + Math.random() * 26, h, kind: "block", hue });
    } else if (r < 0.75) {
      this.obstacles.push({ x: W + 40, y: GROUND - 120, w: 60, h: 46, kind: "bar", hue });
    } else {
      this.obstacles.push({ x: W + 40, y: GROUND - 26, w: 26, h: 26, kind: "spike", hue });
      if (Math.random() < 0.5)
        this.obstacles.push({ x: W + 40 + 36, y: GROUND - 26, w: 26, h: 26, kind: "spike", hue });
    }
  }

  private spawnCoins() {
    const n = 3 + Math.floor(Math.random() * 4);
    const baseY = Math.random() < 0.5 ? GROUND - 60 : GROUND - 170;
    for (let i = 0; i < n; i++) {
      this.coinList.push({ x: W + 40 + i * 42, y: baseY - Math.sin(i / 2) * 22, t: Math.random() * 6, dead: false });
    }
  }

  private playerBox() {
    const h = this.sliding ? 30 : 56;
    const w = this.sliding ? 60 : 34;
    return { x: 78, y: this.py - h, w, h };
  }

  private die() {
    this.phase = "over";
    this.shake = 18;
    this.flash = 1;
    this.cb.onHit();
    this.burst(96, this.py - 26, "#ff2f5e", 46, 3);
    this.totalCoins += this.coins;
    const s = Math.floor(this.score);
    const newBest = s > this.best;
    if (newBest) this.best = s;
    this.unlockAch("first_run");
    if (this.totalCoins >= 100) this.unlockAch("coins_100");
    if (s >= 2000) this.unlockAch("score_2000");
    this.cb.onGameOver({ score: s, coins: this.coins, best: this.best, newBest });
  }

  private update(dt: number) {
    // parallax always moves (menu too)
    const base = this.phase === "playing" ? this.speed : 2.2;
    this.layers.forEach((layer, i) => {
      const sp = base * (0.12 + i * 0.16);
      for (const b of layer) {
        b.x -= sp * dt;
        if (b.x + b.w < -20) {
          const maxX = Math.max(...layer.map((o) => o.x + o.w));
          b.x = maxX + 12;
          b.h = (80 + Math.random() * 200) / ((3 - i) * 0.6);
          b.w = 60 + Math.random() * 90 / (3 - i);
        }
      }
    });
    for (const s of this.stars) s.a += (Math.random() - 0.5) * 0.08;

    this.runT += dt * (this.phase === "playing" ? this.speed * 0.06 : 0.14);
    if (this.shake > 0) this.shake -= dt * 0.6;
    if (this.flash > 0) this.flash -= dt * 0.04;

    // particles
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.12 * dt;
      p.life -= p.max * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.y -= 0.9 * dt;
      p.life -= 0.016 * dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);

    if (this.phase !== "playing") return;

    // speed / difficulty
    this.speed = Math.min(MAX_SPEED, this.speed + 0.0016 * dt);
    if (this.speed >= MAX_SPEED - 0.01) this.unlockAch("speed_max");
    this.dist += this.speed * dt;
    this.score += this.speed * 0.06 * dt * (1 + this.combo * 0.05);

    // physics
    this.vy += 0.78 * dt;
    this.py += this.vy * dt;
    if (this.py >= GROUND) {
      if (this.vy > 6) this.burst(90, GROUND, this.skin.trail, 6, 1);
      this.py = GROUND;
      this.vy = 0;
      this.jumps = 0;
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.sliding = false;
    }
    if (Math.random() < 0.35) this.burst(74, this.py - 8, this.skin.trail, 1, 0.6);

    // combo decay
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // spawning — density scales with speed
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnObstacle();
      const gap = Math.max(46, 110 - (this.speed - 6) * 5) + Math.random() * 55;
      this.spawnTimer = gap;
    }
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      this.spawnCoins();
      this.coinTimer = 130 + Math.random() * 140;
    }

    const pb = this.playerBox();

    for (const o of this.obstacles) o.x -= this.speed * dt;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -60);
    for (const o of this.obstacles) {
      if (pb.x < o.x + o.w && pb.x + pb.w > o.x && pb.y < o.y + o.h && pb.y + pb.h > o.y) {
        this.die();
        return;
      }
    }

    for (const c of this.coinList) {
      c.x -= this.speed * dt;
      c.t += dt * 0.12;
      if (c.dead) continue;
      const dx = c.x - (pb.x + pb.w / 2);
      const dy = c.y - (pb.y + pb.h / 2);
      if (dx * dx + dy * dy < 34 * 34) {
        c.dead = true;
        this.coins++;
        this.combo++;
        this.comboTimer = 110;
        this.score += 10 * (1 + this.combo * 0.1);
        this.burst(c.x, c.y, "#ffd166", 14, 1.6);
        this.popups.push({
          x: c.x,
          y: c.y,
          life: 1,
          text: this.combo > 1 ? `+${Math.round(10 * (1 + this.combo * 0.1))} x${this.combo}` : "+10",
          color: "#ffd166",
        });
        if (this.combo >= 10) this.unlockAch("combo_10");
        this.cb.onCoin();
      }
    }
    this.coinList = this.coinList.filter((c) => !c.dead && c.x > -40);

    this.emitHud();
  }

  /* ------------ rendering ------------- */
  private draw() {
    const c = this.ctx;
    c.save();
    if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#05010f");
    g.addColorStop(0.55, "#0d0524");
    g.addColorStop(1, "#170833");
    c.fillStyle = g;
    c.fillRect(-30, -30, W + 60, H + 60);

    // sun
    c.save();
    const sg = c.createRadialGradient(W * 0.72, 200, 10, W * 0.72, 200, 190);
    sg.addColorStop(0, "rgba(255,47,181,0.55)");
    sg.addColorStop(1, "rgba(255,47,181,0)");
    c.fillStyle = sg;
    c.fillRect(W * 0.72 - 200, 0, 400, 400);
    c.restore();

    for (const s of this.stars) {
      c.globalAlpha = 0.25 + Math.abs(Math.sin(s.a)) * 0.6;
      c.fillStyle = "#bfe9ff";
      c.fillRect(s.x, s.y, s.r, s.r);
    }
    c.globalAlpha = 1;

    // city layers
    const colors = ["rgba(50,20,90,0.85)", "rgba(70,25,120,0.9)", "rgba(28,10,55,0.95)"];
    const neon = ["#5b2bd6", "#a02fff", "#00e5ff"];
    this.layers.forEach((layer, i) => {
      c.fillStyle = colors[i]!;
      for (const b of layer) {
        const top = GROUND - b.h;
        c.fillRect(b.x, top, b.w, b.h);
        c.strokeStyle = neon[i]!;
        c.globalAlpha = 0.5;
        c.lineWidth = 1.5;
        c.strokeRect(b.x + 0.5, top + 0.5, b.w - 1, b.h - 1);
        c.globalAlpha = 1;
        // windows
        c.fillStyle = i === 2 ? "rgba(0,229,255,0.35)" : "rgba(255,120,220,0.25)";
        for (let wy = top + 10; wy < GROUND - 8; wy += 16) {
          for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 14) {
            if ((Math.sin(wx * 12.9898 + wy * 78.233 + b.seed * 100) * 43758.5453) % 1 > 0.35)
              c.fillRect(wx, wy, 5, 7);
          }
        }
        c.fillStyle = colors[i]!;
      }
    });

    // ground
    c.fillStyle = "#0a0418";
    c.fillRect(0, GROUND, W, H - GROUND);
    c.strokeStyle = "#00e5ff";
    c.shadowColor = "#00e5ff";
    c.shadowBlur = 18;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, GROUND);
    c.lineTo(W, GROUND);
    c.stroke();
    c.shadowBlur = 0;

    // ground grid
    c.strokeStyle = "rgba(255,47,181,0.35)";
    c.lineWidth = 1;
    const off = (this.dist * 0.5) % 60;
    for (let x = -off; x < W + 60; x += 60) {
      c.beginPath();
      c.moveTo(x, GROUND);
      c.lineTo(x - 120, H);
      c.stroke();
    }
    for (let i = 1; i < 6; i++) {
      const y = GROUND + (i * i) * 4;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }

    // coins
    for (const co of this.coinList) {
      const s = Math.abs(Math.cos(co.t)) * 9 + 3;
      c.save();
      c.shadowColor = "#ffd166";
      c.shadowBlur = 20;
      c.fillStyle = "#ffd166";
      c.beginPath();
      c.ellipse(co.x, co.y, s, 12, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#7a4b00";
      c.font = "bold 12px monospace";
      c.textAlign = "center";
      if (s > 6) c.fillText("¢", co.x, co.y + 4);
      c.restore();
    }

    // obstacles
    for (const o of this.obstacles) {
      c.save();
      c.shadowColor = o.hue;
      c.shadowBlur = 22;
      c.fillStyle = "rgba(10,4,24,0.9)";
      c.strokeStyle = o.hue;
      c.lineWidth = 3;
      if (o.kind === "spike") {
        c.beginPath();
        c.moveTo(o.x, o.y + o.h);
        c.lineTo(o.x + o.w / 2, o.y);
        c.lineTo(o.x + o.w, o.y + o.h);
        c.closePath();
        c.fill();
        c.stroke();
      } else {
        c.fillRect(o.x, o.y, o.w, o.h);
        c.strokeRect(o.x, o.y, o.w, o.h);
        c.globalAlpha = 0.6;
        c.fillStyle = o.hue;
        c.fillRect(o.x + 6, o.y + o.h / 2 - 2, o.w - 12, 3);
      }
      c.restore();
    }

    // particles
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.color;
      c.shadowColor = p.color;
      c.shadowBlur = 10;
      c.fillRect(p.x, p.y, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.shadowBlur = 0;

    this.drawPlayer();

    // popups
    for (const p of this.popups) {
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.color;
      c.font = "bold 20px 'Orbitron', monospace";
      c.textAlign = "center";
      c.shadowColor = p.color;
      c.shadowBlur = 12;
      c.fillText(p.text, p.x, p.y);
    }
    c.globalAlpha = 1;
    c.shadowBlur = 0;

    if (this.flash > 0) {
      c.fillStyle = `rgba(255,47,94,${this.flash * 0.5})`;
      c.fillRect(-30, -30, W + 60, H + 60);
    }
    c.restore();
  }

  private drawPlayer() {
    const c = this.ctx;
    const b = this.playerBox();
    const bob = this.py >= GROUND && !this.sliding ? Math.sin(this.runT) * 2 : 0;
    c.save();
    c.translate(0, bob);
    c.shadowColor = this.skin.glow;
    c.shadowBlur = 26;
    c.fillStyle = this.skin.body;

    if (this.sliding) {
      c.beginPath();
      c.roundRect(b.x, b.y, b.w, b.h, 12);
      c.fill();
      c.fillStyle = this.skin.glow;
      c.fillRect(b.x + 8, b.y + 8, b.w - 20, 4);
    } else {
      // head
      c.beginPath();
      c.arc(b.x + 17, b.y + 10, 10, 0, Math.PI * 2);
      c.fill();
      // body
      c.beginPath();
      c.roundRect(b.x + 8, b.y + 20, 18, 22, 6);
      c.fill();
      // legs
      const swing = this.py < GROUND ? 0.7 : Math.sin(this.runT) * 0.9;
      c.strokeStyle = this.skin.body;
      c.lineWidth = 5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(b.x + 17, b.y + 40);
      c.lineTo(b.x + 17 + swing * 12, b.y + 56);
      c.moveTo(b.x + 17, b.y + 40);
      c.lineTo(b.x + 17 - swing * 12, b.y + 56);
      c.stroke();
      // arms
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(b.x + 16, b.y + 24);
      c.lineTo(b.x + 16 - swing * 14, b.y + 34);
      c.moveTo(b.x + 16, b.y + 24);
      c.lineTo(b.x + 16 + swing * 14, b.y + 34);
      c.stroke();
      // visor
      c.shadowBlur = 12;
      c.fillStyle = "#05010f";
      c.fillRect(b.x + 14, b.y + 6, 12, 5);
    }
    c.restore();

    // shadow on ground
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = "#00e5ff";
    const k = Math.max(0.2, 1 - (GROUND - this.py) / 200);
    c.beginPath();
    c.ellipse(b.x + b.w / 2, GROUND + 4, 26 * k, 5 * k, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private loop(t: number) {
    const dtMs = this.last ? Math.min(48, t - this.last) : 16;
    this.last = t;
    const dt = dtMs / 16.6667;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }
}
