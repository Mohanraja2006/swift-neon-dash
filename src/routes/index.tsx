import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACHIEVEMENTS,
  NeonRunner,
  SKINS,
  type HudState,
  type Skin,
} from "@/game/neon-runner";
import { sfx } from "@/game/audio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEON RUNNER — Endless Neon City Runner Game" },
      {
        name: "description",
        content:
          "Play NEON RUNNER: dodge obstacles, grab coins and chase combos in a glowing cyberpunk city. Free browser game with skins, achievements and high scores.",
      },
      { property: "og:title", content: "NEON RUNNER — Endless Neon City Runner Game" },
      {
        property: "og:description",
        content:
          "Dodge, jump and slide through a neon skyline. Unlock skins, build combos and beat your high score.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});

const LS = "neon-runner-save-v1";

interface Save {
  best: number;
  totalCoins: number;
  unlocked: string[];
  achieved: string[];
  skin: string;
  sound: boolean;
}

const DEFAULT_SAVE: Save = {
  best: 0,
  totalCoins: 0,
  unlocked: ["cyan"],
  achieved: [],
  skin: "cyan",
  sound: true,
};

function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeonRunner | null>(null);
  const soundRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<"menu" | "playing" | "paused" | "over">("menu");
  const [hud, setHud] = useState<HudState>({ score: 0, coins: 0, combo: 0, speedPct: 0, best: 0 });
  const [save, setSave] = useState<Save>(DEFAULT_SAVE);
  const [result, setResult] = useState({ score: 0, coins: 0, newBest: false });
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"skins" | "achievements">("skins");

  const persist = useCallback((s: Save) => {
    setSave(s);
    try {
      localStorage.setItem(LS, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    let loaded = DEFAULT_SAVE;
    try {
      const raw = localStorage.getItem(LS);
      if (raw) loaded = { ...DEFAULT_SAVE, ...(JSON.parse(raw) as Save) };
    } catch {
      /* ignore */
    }
    setSave(loaded);
    soundRef.current = loaded.sound;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new NeonRunner(canvas, {
      onHud: setHud,
      onGameOver: (r) => {
        setPhase("over");
        setResult({ score: r.score, coins: r.coins, newBest: r.newBest });
      },
      onAchievement: (id) => {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) {
          setToast(`Achievement unlocked — ${a.name}`);
          if (soundRef.current) sfx.unlock();
          setTimeout(() => setToast(null), 3200);
        }
      },
      onCoin: () => soundRef.current && sfx.coin(),
      onJump: () => soundRef.current && sfx.jump(),
      onHit: () => soundRef.current && sfx.hit(),
    });
    engine.best = loaded.best;
    engine.totalCoins = loaded.totalCoins;
    engine.unlocked = loaded.unlocked;
    engine.achieved = [...loaded.achieved];
    engine.skin = SKINS.find((s) => s.id === loaded.skin) ?? SKINS[0]!;
    engineRef.current = engine;
    setHud((h) => ({ ...h, best: loaded.best }));
    setReady(true);
    return () => engine.destroy();
  }, []);

  // sync engine progress back into storage when a run ends
  useEffect(() => {
    if (phase !== "over") return;
    const e = engineRef.current;
    if (!e) return;
    persist({
      ...save,
      best: e.best,
      totalCoins: e.totalCoins,
      achieved: [...e.achieved],
      unlocked: [...e.unlocked],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startGame = useCallback(() => {
    if (soundRef.current) sfx.ui();
    engineRef.current?.start();
    setPhase("playing");
  }, []);

  const togglePause = useCallback(() => {
    const e = engineRef.current;
    if (!e || (e.phase !== "playing" && e.phase !== "paused")) return;
    if (soundRef.current) sfx.ui();
    e.pause();
    setPhase(e.phase as "playing" | "paused");
  }, []);

  const toMenu = useCallback(() => {
    if (soundRef.current) sfx.ui();
    const e = engineRef.current;
    if (e) e.phase = "menu";
    setPhase("menu");
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    soundRef.current = next;
    if (next) sfx.ui();
    persist({ ...save, sound: next });
  }, [persist, save]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "w", "s"].includes(k)) e.preventDefault();
      const eng = engineRef.current;
      if (!eng) return;
      if (k === " " || k === "arrowup" || k === "w") {
        if (eng.phase === "playing") eng.jump();
        else if (eng.phase === "menu") startGame();
        else if (eng.phase === "over") startGame();
      } else if (k === "arrowdown" || k === "s") eng.slide();
      else if (k === "p" || k === "escape") togglePause();
      else if (k === "m") toggleSound();
      else if (k === "r" && eng.phase === "over") startGame();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startGame, togglePause, toggleSound]);

  // touch: swipe up = jump, swipe down = slide, tap = jump
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    let sx = 0,
      sy = 0,
      st = 0;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX;
      sy = t.clientY;
      st = Date.now();
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const eng = engineRef.current;
      if (!t || !eng) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (dy > 45 && Math.abs(dy) > Math.abs(dx)) eng.slide();
      else if (Date.now() - st < 600) eng.jump();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
    };
  }, []);

  const selectSkin = (s: Skin) => {
    const e = engineRef.current;
    if (!e) return;
    if (save.unlocked.includes(s.id)) {
      e.skin = s;
      if (soundRef.current) sfx.ui();
      persist({ ...save, skin: s.id });
    } else if (save.totalCoins >= s.cost) {
      const next = {
        ...save,
        totalCoins: save.totalCoins - s.cost,
        unlocked: [...save.unlocked, s.id],
        skin: s.id,
      };
      e.totalCoins = next.totalCoins;
      e.unlocked = next.unlocked;
      e.skin = s;
      if (soundRef.current) sfx.unlock();
      persist(next);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-3 py-4 select-none">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      <div className="relative w-full max-w-5xl">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl leading-none font-black tracking-[0.2em] text-neon sm:text-4xl">
            NEON<span className="text-accent"> RUNNER</span>
          </h1>
          <div className="flex shrink-0 gap-2">
            <button className="btn-glass" onClick={toggleSound} aria-label="Toggle sound">
              {soundRef.current ? "SOUND ON" : "SOUND OFF"}
            </button>
            <button
              className="btn-glass"
              onClick={togglePause}
              disabled={phase !== "playing" && phase !== "paused"}
            >
              {phase === "paused" ? "RESUME" : "PAUSE"}
            </button>
          </div>
        </header>

        <div className="glass relative aspect-[16/9] w-full overflow-hidden rounded-2xl">
          <canvas ref={canvasRef} className="block h-full w-full touch-none" />

          {/* HUD */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="glass-soft min-w-0 rounded-xl px-3 py-2">
              <p className="font-display text-xl leading-none font-black text-neon tabular-nums sm:text-3xl">
                {hud.score.toLocaleString()}
              </p>
              <p className="text-[10px] tracking-widest text-muted-foreground">
                BEST {Math.max(hud.best, save.best).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="glass-soft rounded-xl px-3 py-2 text-right">
                <p className="font-display text-base leading-none font-bold text-coin tabular-nums sm:text-xl">
                  ¢ {hud.coins}
                </p>
                {hud.combo > 1 && (
                  <p className="animate-scale-in text-[11px] font-bold tracking-widest text-accent">
                    COMBO x{hud.combo}
                  </p>
                )}
              </div>
              <div className="glass-soft w-28 rounded-xl px-3 py-2 sm:w-36">
                <p className="text-[10px] tracking-widest text-muted-foreground">SPEED</p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-speed transition-[width] duration-200"
                    style={{ width: `${Math.round(hud.speedPct * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Overlays */}
          {ready && phase === "menu" && (
            <Overlay>
              <h2 className="font-display text-3xl font-black tracking-widest text-neon sm:text-5xl">
                NEON RUNNER
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Jump, double-jump and slide through the grid. Chain coins for combos, survive the
                speed-up.
              </p>
              <button className="btn-neon mt-6" onClick={startGame}>
                START GAME
              </button>
              <p className="mt-4 text-[11px] tracking-widest text-muted-foreground">
                SPACE / ↑ JUMP · ↓ SLIDE · P PAUSE · M MUTE · SWIPE ON MOBILE
              </p>
            </Overlay>
          )}

          {phase === "paused" && (
            <Overlay>
              <h2 className="font-display text-3xl font-black tracking-widest text-neon">PAUSED</h2>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button className="btn-neon" onClick={togglePause}>
                  RESUME
                </button>
                <button className="btn-glass" onClick={startGame}>
                  RESTART
                </button>
                <button className="btn-glass" onClick={toMenu}>
                  MENU
                </button>
              </div>
            </Overlay>
          )}

          {phase === "over" && (
            <Overlay>
              <h2 className="font-display text-3xl font-black tracking-widest text-danger sm:text-4xl">
                GAME OVER
              </h2>
              {result.newBest && (
                <p className="mt-2 animate-scale-in font-display text-sm font-bold tracking-widest text-coin">
                  ★ NEW HIGH SCORE ★
                </p>
              )}
              <div className="mt-5 flex gap-8">
                <Stat label="SCORE" value={result.score.toLocaleString()} />
                <Stat label="COINS" value={`¢ ${result.coins}`} />
                <Stat label="BEST" value={save.best.toLocaleString()} />
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button className="btn-neon" onClick={startGame}>
                  RESTART
                </button>
                <button className="btn-glass" onClick={toMenu}>
                  MENU
                </button>
              </div>
            </Overlay>
          )}
        </div>

        {/* Mobile controls */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:hidden">
          <button
            className="btn-neon py-5"
            onPointerDown={() => engineRef.current?.jump()}
            aria-label="Jump"
          >
            JUMP
          </button>
          <button
            className="btn-glass py-5"
            onPointerDown={() => engineRef.current?.slide()}
            aria-label="Slide"
          >
            SLIDE
          </button>
        </div>

        {/* Panels */}
        <section className="glass mt-4 rounded-2xl p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                className={tab === "skins" ? "tab-active" : "tab"}
                onClick={() => setTab("skins")}
              >
                SKINS
              </button>
              <button
                className={tab === "achievements" ? "tab-active" : "tab"}
                onClick={() => setTab("achievements")}
              >
                ACHIEVEMENTS
              </button>
            </div>
            <p className="font-display text-sm font-bold text-coin">
              ¢ {save.totalCoins.toLocaleString()}
            </p>
          </div>

          {tab === "skins" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {SKINS.map((s) => {
                const owned = save.unlocked.includes(s.id);
                const active = save.skin === s.id;
                const affordable = save.totalCoins >= s.cost;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectSkin(s)}
                    disabled={!owned && !affordable}
                    className={`glass-soft rounded-xl p-3 text-left transition-transform hover:scale-[1.03] disabled:opacity-40 ${
                      active ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <span
                      className="block h-8 w-8 rounded-full"
                      style={{ background: s.body, boxShadow: `0 0 16px ${s.glow}` }}
                    />
                    <p className="mt-2 font-display text-xs font-bold tracking-widest">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {active ? "EQUIPPED" : owned ? "OWNED" : `¢ ${s.cost}`}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {ACHIEVEMENTS.map((a) => {
                const done = save.achieved.includes(a.id);
                return (
                  <div
                    key={a.id}
                    className={`glass-soft flex items-center gap-3 rounded-xl p-3 ${done ? "" : "opacity-50"}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg font-bold ${
                        done ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      ★
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-display text-xs font-bold tracking-widest">
                        {a.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">{a.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className="glass fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-xl px-5 py-3 font-display text-xs font-bold tracking-widest text-neon">
          {toast}
        </div>
      )}
    </main>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex animate-fade-in flex-col items-center justify-center bg-overlay px-6 text-center backdrop-blur-md">
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}
