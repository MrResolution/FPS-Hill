/**
 * Complete self-contained single-file HTML bundle for Mossy Hollow: Tactical Valley FPS.
 * Runs directly when opened as an .html file in any modern browser using Three.js 0.160.0 from jsDelivr CDN.
 */
export const STANDALONE_HTML_SOURCE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mossy Hollow: Tactical Valley FPS</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body {
      width: 100%; height: 100%; overflow: hidden;
      background: #0f172a; color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #canvas-container { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 1; }
    #hud {
      position: fixed; inset: 0; z-index: 10; pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    #loading-bar-wrap {
      position: fixed; inset: 0; z-index: 50; background: #0f172a;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    }
    .load-track { width: 280px; height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden; }
    #load-fill { width: 40%; height: 100%; background: #f59e0b; transition: width 0.15s; }
    #damage-vignette {
      position: fixed; inset: 0; pointer-events: none; opacity: 0;
      box-shadow: inset 0 0 110px 44px rgba(239, 68, 68, 0.85);
      transition: opacity 0.06s linear;
    }
    #crosshair {
      position: fixed; top: 50%; left: 50%; width: 0; height: 0; pointer-events: none;
    }
    .ch-line {
      position: absolute; background: rgba(248, 250, 252, 0.95);
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
    }
    .ch-top { width: 2px; height: 10px; left: -1px; top: -18px; }
    .ch-bottom { width: 2px; height: 10px; left: -1px; top: 8px; }
    .ch-left { width: 10px; height: 2px; top: -1px; left: -18px; }
    .ch-right { width: 10px; height: 2px; top: -1px; left: 8px; }
    .ch-dot { width: 4px; height: 4px; left: -2px; top: -2px; border-radius: 50%; background: #38bdf8; }
    #hitmarker {
      position: fixed; top: 50%; left: 50%; width: 28px; height: 28px;
      transform: translate(-50%, -50%); opacity: 0; pointer-events: none;
    }
    #top-left {
      position: fixed; top: 20px; left: 20px; display: flex; gap: 14px; align-items: flex-start;
    }
    #radar-box {
      background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px; padding: 6px;
    }
    #radar-canvas { width: 128px; height: 128px; display: block; border-radius: 4px; }
    .stat-cluster {
      background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px; padding: 10px 16px; display: flex; gap: 20px;
    }
    .stat-item { display: flex; flex-direction: column; }
    .stat-label { font-size: 11px; color: #94a3b8; letter-spacing: 0.06em; font-weight: 600; }
    .stat-val { font-size: 22px; font-weight: 800; color: #f8fafc; font-family: monospace; }
    .stat-val.amber { color: #f59e0b; }
    #debug-panel {
      position: fixed; top: 168px; left: 20px; width: 240px;
      background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 8px; padding: 10px; font-family: monospace; font-size: 12px;
      color: #e2e8f0; display: none;
    }
    #debug-hm { width: 128px; height: 128px; display: block; margin-top: 8px; border: 1px solid #475569; }
    #wave-banner {
      position: fixed; top: 84px; left: 50%; transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(245, 158, 11, 0.5);
      padding: 8px 24px; border-radius: 6px; color: #fbbf24; font-weight: 800;
      letter-spacing: 0.08em; font-size: 14px; opacity: 0; transition: opacity 0.2s;
    }
    #bottom-left {
      position: fixed; bottom: 24px; left: 24px; width: 260px;
      background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px; padding: 12px 16px;
    }
    .hp-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .hp-num { font-size: 24px; font-weight: 800; font-family: monospace; color: #10b981; }
    .hp-bar-bg { width: 100%; height: 10px; background: #1e293b; border-radius: 4px; overflow: hidden; }
    #hp-bar-fill { width: 100%; height: 100%; background: #10b981; transition: width 0.1s ease-out; }
    #bottom-right {
      position: fixed; bottom: 24px; right: 24px; min-width: 220px;
      background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px; padding: 12px 18px; text-align: right;
    }
    .ammo-readout { font-family: monospace; font-size: 30px; font-weight: 800; color: #f8fafc; }
    .ammo-reserve { font-size: 18px; color: #94a3b8; }
    #reload-status {
      margin-top: 6px; font-size: 12px; font-weight: 700; color: #f59e0b;
      letter-spacing: 0.06em; display: none;
    }
    .overlay-screen {
      position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, 0.82); pointer-events: auto;
    }
    .modal-card {
      width: min(540px, 92vw); background: #0f172a; border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 12px; padding: 28px; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.65);
    }
    .kicker { font-size: 11px; font-weight: 700; color: #f59e0b; letter-spacing: 0.12em; margin-bottom: 6px; }
    .title { font-size: 28px; font-weight: 800; color: #f8fafc; margin-bottom: 8px; }
    .subtitle { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 18px; }
    .controls-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;
      background: #1e293b; border-radius: 8px; padding: 12px; margin-bottom: 18px;
      font-size: 12px; color: #cbd5e1;
    }
    .ctrl-row { display: flex; justify-content: space-between; }
    .kbd { font-family: monospace; font-weight: 700; color: #f59e0b; }
    .btn-primary {
      width: 100%; padding: 13px 20px; font-size: 15px; font-weight: 700;
      color: #0f172a; background: #f59e0b; border: none; border-radius: 8px;
      cursor: pointer; transition: background 0.15s;
    }
    .btn-primary:hover { background: #fbbf24; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="loading-bar-wrap">
    <div style="font-weight:700; letter-spacing:0.08em; color:#f59e0b; font-size:13px;">GENERATING TERRAIN...</div>
    <div class="load-track"><div id="load-fill"></div></div>
  </div>

  <div id="canvas-container"></div>

  <!-- HUD OVERLAY -->
  <div id="hud">
    <div id="damage-vignette"></div>
    <div id="crosshair">
      <div class="ch-line ch-top" id="ch-t"></div>
      <div class="ch-line ch-bottom" id="ch-b"></div>
      <div class="ch-line ch-left" id="ch-l"></div>
      <div class="ch-line ch-right" id="ch-r"></div>
      <div class="ch-dot"></div>
    </div>
    <svg id="hitmarker" viewBox="0 0 24 24" fill="none" stroke="#f8fafc" stroke-width="2.5">
      <line x1="4" y1="4" x2="9.5" y2="9.5" />
      <line x1="20" y1="4" x2="14.5" y2="9.5" />
      <line x1="4" y1="20" x2="9.5" y2="14.5" />
      <line x1="20" y1="20" x2="14.5" y2="14.5" />
    </svg>
    <div id="wave-banner">MOSSY HOLLOW</div>
    <div id="top-left">
      <div id="radar-box">
        <canvas id="radar-canvas" width="128" height="128"></canvas>
      </div>
      <div class="stat-cluster">
        <div class="stat-item"><span class="stat-label">WAVE</span><span class="stat-val amber" id="hud-wave">1</span></div>
        <div class="stat-item"><span class="stat-label">HOSTILES</span><span class="stat-val" id="hud-enemies">3</span></div>
        <div class="stat-item"><span class="stat-label">SCORE</span><span class="stat-val" id="hud-score">0</span></div>
        <div class="stat-item"><span class="stat-label">KILLS</span><span class="stat-val" id="hud-kills">0</span></div>
      </div>
    </div>
    <div id="debug-panel">
      <div id="dbg-text">FPS: 60</div>
      <img id="debug-hm" alt="Heightmap" />
    </div>
    <div id="bottom-left">
      <div class="hp-header">
        <span class="stat-label">ARMOR INTEGRITY</span>
        <span class="hp-num" id="hud-hp">100 HP</span>
      </div>
      <div class="hp-bar-bg"><div id="hp-bar-fill"></div></div>
    </div>
    <div id="bottom-right">
      <div class="stat-label">M4-X CARBINE</div>
      <div class="ammo-readout"><span id="hud-mag">30</span> <span class="ammo-reserve">/ <span id="hud-res">90</span></span></div>
      <div id="reload-status">RELOADING (2.0s)...</div>
    </div>
  </div>

  <!-- START SCREEN -->
  <div id="start-screen" class="overlay-screen">
    <div class="modal-card">
      <div class="kicker">PROCEDURAL VALLEY COMBAT</div>
      <h1 class="title">MOSSY HOLLOW</h1>
      <p class="subtitle">Explore a 240×240 temperate valley with a central rocky outpost on The Knoll, dense pine/oak forests, river bridge, and sniper ridges.</p>
      <div class="controls-grid">
        <div class="ctrl-row"><span>Move / Strafe</span><span class="kbd">W A S D</span></div>
        <div class="ctrl-row"><span>Aim & Shoot</span><span class="kbd">Mouse / LMB</span></div>
        <div class="ctrl-row"><span>Reload / Jump / Sprint</span><span class="kbd">R / Space / Shift</span></div>
        <div class="ctrl-row"><span>Debug / New Seed</span><span class="kbd">F3 / F4</span></div>
      </div>
      <button id="btn-start" class="btn-primary">Click to Play</button>
    </div>
  </div>

  <!-- PAUSE SCREEN -->
  <div id="pause-screen" class="overlay-screen hidden">
    <div class="modal-card">
      <div class="kicker">SIMULATION PAUSED</div>
      <h2 class="title">MOSSY HOLLOW STANDBY</h2>
      <p class="subtitle">Press F3 in-game for heightmap/collider debug or F4 to regenerate with a random seed.</p>
      <button id="btn-resume" class="btn-primary">Resume Combat</button>
    </div>
  </div>

  <!-- GAME OVER SCREEN -->
  <div id="gameover-screen" class="overlay-screen hidden">
    <div class="modal-card">
      <div class="kicker" style="color:#ef4444;">OPERATOR DOWN</div>
      <h2 class="title">GAME OVER</h2>
      <p class="subtitle" id="final-summary">Wave Reached: 1 · Final Score: 0 · Kills: 0</p>
      <button id="btn-restart" class="btn-primary">Restart</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
  <script>
    // =========================================================================
    // TOP-LEVEL CONFIG CONSTANTS
    // =========================================================================
    const CONFIG = {
      MAP_SIZE: 240,
      HALF_SIZE: 120,
      GRID_RES: 257,
      SEGMENTS: 256,
      MAX_HEIGHT: 14,
      WATER_LEVEL: 0,
      SEED: 1337,
      CELL_SIZE: 10,
      PINE_COUNT: 350,
      OAK_COUNT: 150,
      BUSH_COUNT: 300,
      ROCK_COUNT: 120,
      GRASS_COUNT: 6000,
      REED_COUNT: 200,
      FOG_DENSITY: 0.008,
      PLAYER_SPAWN: { x: 0, z: 95 },
      ENEMY_SPAWNS: [[-90,-90],[90,-90],[-95,10],[100,30],[-60,90],[80,90],[0,-105],[-40,-60]],
      HEALTH_PADS: [[-3,3],[45,45],[30,-57],[-70,-27]],
      AMMO_PADS: [[-30,30],[42,20],[4.5,-1.5],[-60,60]]
    };
    const BIOME_NAMES = ['Water','Sand / Mud','Short Grass','Dark Forest Floor','Rock (>35°)','High Rock (>9m)','Dirt Road'];
    const RIVER_PTS = [[60,55],[35,48],[10,50],[-15,38],[-30,30],[-60,25],[-90,24],[-120,20]];
    const ROAD_PTS = [[0,100],[15,80],[35,55],[42,20],[32,-22],[8,-42],[-10,-68],[0,-100]];

    const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const lerp = (a, b, t) => a + (b - a) * t;

    function mulberry32(a) {
      return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    function makeNoise(seed) {
      const r = mulberry32(seed), T = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) T[i] = r();
      const v = (i, j) => T[((j & 63) << 6) | (i & 63)];
      return (x, z) => {
        const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
        const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
        return (v(i, j) * (1 - u) + v(i + 1, j) * u) * (1 - w) + (v(i, j + 1) * (1 - u) + v(i + 1, j + 1) * u) * w;
      };
    }

    function segDist(px, pz, ax, az, bx, bz) {
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
      return Math.hypot(px - ax - t * dx, pz - az - t * dz);
    }

    function polyDist(px, pz, pts) {
      let m = 1e9;
      for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      return m;
    }

    // =========================================================================
    // MAP GENERATOR MODULE ("Mossy Hollow")
    // =========================================================================
    class MapGenerator {
      constructor(scene, seed) {
        this.seed = seed;
        this.N = CONFIG.GRID_RES;
        this.step = CONFIG.MAP_SIZE / (this.N - 1);
        this.heights = new Float32Array(this.N * this.N);
        this.slopes = new Float32Array(this.N * this.N);
        this.biomes = new Uint8Array(this.N * this.N);
        this.vegDensity = new Float32Array(256 * 256);
        this.group = new THREE.Group();
        this.debugGroup = new THREE.Group();
        this.debugGroup.visible = false;
        this.group.add(this.debugGroup);
        this.shootables = [];
        this.spatialGrid = new Map();
        this.minimapCanvas = document.createElement('canvas');

        this.buildHeightmap();
        this.buildSlopesAndBiomes();
        this.buildTerrainAndWater();
        this.buildSky();
        this.buildStructures();
        this.buildVegetation();
        scene.add(this.group);
      }

      buildHeightmap() {
        const N = this.N, step = this.step;
        const nz = makeNoise(this.seed);
        const fbm = (x, z) => {
          let a = 1, f = 0.012, s = 0, n = 0;
          for (let i = 0; i < 5; i++) { s += a * nz(x * f + i * 17.3, z * f + i * 9.1); n += a; a *= 0.5; f *= 2; }
          return s / n;
        };
        const raw = new Float32Array(N * N);
        for (let j = 0; j < N; j++) {
          const z = -120 + j * step;
          for (let i = 0; i < N; i++) {
            const x = -120 + i * step;
            let y = fbm(x, z) * 6;
            const dKnoll = Math.hypot(x, z);
            y += 10 * (1 - smoothstep(10, 35, dKnoll));
            if (dKnoll < 12) y = lerp(y, 11.8, (1 - smoothstep(8, 12, dKnoll)) * 0.85);
            y += 12 * (1 - smoothstep(0, 25, segDist(x, z, -100, -80, -40, -100)));
            y = lerp(y, -3.5, 1 - smoothstep(6, 30, Math.hypot(x - 60, z - 55)));
            y = lerp(y, 1.5, 1 - smoothstep(8, 30, Math.hypot(x + 60, z - 60)));
            y += (1 - smoothstep(6, 30, Math.hypot(x - 80, z + 70))) * (8 + nz(x * 0.1, z * 0.1) * 2.8);
            y = lerp(y, -1.35, 1 - smoothstep(1.8, 6.5, polyDist(x, z, RIVER_PTS)));
            y += 14 * (1 - smoothstep(0, 20, Math.min(120 - Math.abs(x), 120 - Math.abs(z))));
            raw[j * N + i] = clamp(y, -6, 16);
          }
        }
        // 3x3 box blur
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            let s = 0, c = 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii >= 0 && jj >= 0 && ii < N && jj < N) { s += raw[jj * N + ii]; c++; }
            }
            this.heights[j * N + i] = s / c;
          }
        }
      }

      getHeightAt(x, z) {
        const N = this.N;
        const u = clamp((x + 120) / 240, 0, 1) * (N - 1);
        const v = clamp((z + 120) / 240, 0, 1) * (N - 1);
        const i0 = Math.min(N - 2, Math.floor(u)), j0 = Math.min(N - 2, Math.floor(v));
        const fx = u - i0, fz = v - j0;
        const h0 = this.heights[j0 * N + i0] * (1 - fx) + this.heights[j0 * N + i0 + 1] * fx;
        const h1 = this.heights[(j0 + 1) * N + i0] * (1 - fx) + this.heights[(j0 + 1) * N + i0 + 1] * fx;
        return h0 * (1 - fz) + h1 * fz;
      }

      getSlopeAt(x, z) {
        const N = this.N;
        const i = clamp(Math.round(((x + 120) / 240) * (N - 1)), 0, N - 1);
        const j = clamp(Math.round(((z + 120) / 240) * (N - 1)), 0, N - 1);
        return this.slopes[j * N + i];
      }

      getBiomeAt(x, z) {
        const N = this.N;
        const i = clamp(Math.round(((x + 120) / 240) * (N - 1)), 0, N - 1);
        const j = clamp(Math.round(((z + 120) / 240) * (N - 1)), 0, N - 1);
        return BIOME_NAMES[this.biomes[j * N + i]] || 'Short Grass';
      }

      buildSlopesAndBiomes() {
        const N = this.N, step = this.step;
        const nv = makeNoise(this.seed + 99);
        const A = (i, j) => this.heights[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
        const hmCanvas = document.createElement('canvas'); hmCanvas.width = hmCanvas.height = N;
        const hmCtx = hmCanvas.getContext('2d');
        const hmImg = hmCtx.createImageData(N, N);

        for (let j = 0; j < N; j++) {
          const z = -120 + j * step;
          for (let i = 0; i < N; i++) {
            const x = -120 + i * step, k = j * N + i;
            const gx = (A(i + 1, j) - A(i - 1, j)) / (2 * step);
            const gz = (A(i, j + 1) - A(i, j - 1)) / (2 * step);
            const sl = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
            this.slopes[k] = sl;
            const y = this.heights[k], rd = polyDist(x, z, ROAD_PTS), rv = polyDist(x, z, RIVER_PTS);
            let d = smoothstep(0.35, 0.75, nv(x * 0.03, z * 0.03));
            const nf = 1 - smoothstep(0, 40, Math.hypot(x + 10, z + 75));
            const ew = 1 - smoothstep(0, 30, Math.hypot(x - 95, z - 20));
            d = Math.min(1, d + 0.55 * Math.max(nf, ew));
            d *= (1 - smoothstep(25, 30, sl)) * smoothstep(0.8, 1.5, y) * (1 - smoothstep(8, 9, y));
            d *= 1 - 0.85 * (1 - smoothstep(14, 30, Math.hypot(x + 60, z - 60)));
            if (rd < 3.5 || Math.hypot(x, z) < 12 || Math.hypot(x, z - 95) < 6) d = 0;
            if (i < 256 && j < 256) this.vegDensity[j * 256 + i] = d;

            let bio = 2;
            if (y < 0) bio = 0;
            else if (y < 0.8 || rv < 4) bio = 1;
            else if (rd < 2.6) bio = 6;
            else if (sl > 35) bio = 4;
            else if (y > 9) bio = 5;
            else if (d > 0.5) bio = 3;
            this.biomes[k] = bio;

            const g = Math.round(clamp((y + 4) / 18, 0, 1) * 255);
            hmImg.data[k * 4] = hmImg.data[k * 4 + 1] = hmImg.data[k * 4 + 2] = g; hmImg.data[k * 4 + 3] = 255;
          }
        }
        hmCtx.putImageData(hmImg, 0, 0);
        document.getElementById('debug-hm').src = hmCanvas.toDataURL();
      }

      buildTerrainAndWater() {
        const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
        const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S);
        const dn = makeNoise(this.seed + 313);
        for (let py = 0; py < S; py++) {
          const z = -120 + (py / (S - 1)) * 240;
          for (let px = 0; px < S; px++) {
            const x = -120 + (px / (S - 1)) * 240;
            const h = this.getHeightAt(x, z), sl = this.getSlopeAt(x, z);
            const rd = polyDist(x, z, ROAD_PTS), rv = polyDist(x, z, RIVER_PTS);
            const vi = clamp(Math.floor(((x + 120) / 240) * 255), 0, 255);
            const vj = clamp(Math.floor(((z + 120) / 240) * 255), 0, 255);
            const veg = this.vegDensity[vj * 256 + vi];

            let r = 95, g = 158, b = 60;
            const fw = smoothstep(0.35, 0.7, veg);
            r = lerp(r, 62, fw); g = lerp(g, 107, fw); b = lerp(b, 42, fw);
            const sw = Math.max(1 - smoothstep(0.2, 1.1, h), h < 2 ? 1 - smoothstep(2, 4.5, rv) : 0);
            r = lerp(r, 200, sw); g = lerp(g, 178, sw); b = lerp(b, 115, sw);
            const hw = smoothstep(7.8, 10, h);
            r = lerp(r, 139, hw); g = lerp(g, 125, hw); b = lerp(b, 107, hw);
            const rw = smoothstep(28, 38, sl);
            r = lerp(r, 122, rw); g = lerp(g, 122, rw); b = lerp(b, 117, rw);
            if (h > 0.1) {
              const rdw = 1 - smoothstep(1.6, 3.0, rd);
              r = lerp(r, 138, rdw); g = lerp(g, 106, rdw); b = lerp(b, 70, rdw);
            }
            const gr = 0.9 + dn(x * 0.35, z * 0.35) * 0.2;
            const o = (py * S + px) * 4;
            img.data[o] = clamp(r * gr, 0, 255); img.data[o + 1] = clamp(g * gr, 0, 255);
            img.data[o + 2] = clamp(b * gr, 0, 255); img.data[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        this.minimapCanvas.width = this.minimapCanvas.height = 128;
        this.minimapCanvas.getContext('2d').drawImage(cv, 0, 0, 128, 128);

        const geo = new THREE.PlaneGeometry(240, 240, 256, 256);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let k = 0; k < pos.count; k++) pos.setY(k, this.heights[k]);
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.88 }));
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.shootables.push(mesh);

        const wSize = 256, wCv = document.createElement('canvas'); wCv.width = wCv.height = wSize;
        const wCtx = wCv.getContext('2d'), wImg = wCtx.createImageData(wSize, wSize);
        const TAU = Math.PI * 2;
        for (let wy = 0; wy < wSize; wy++) {
          const v = wy / wSize;
          for (let wx = 0; wx < wSize; wx++) {
            const u = wx / wSize;
            const w1 = Math.sin(u * TAU * 2 + Math.cos(v * TAU * 2) * 1.4) + Math.cos(v * TAU * 3 - Math.sin(u * TAU * 3) * 1.2);
            const w2 = Math.sin((u + 0.37) * TAU * 2 + Math.cos((v + 0.61) * TAU * 2) * 1.4);
            const c = Math.pow(clamp(1 - Math.abs(w1 - w2) * 0.7, 0, 1), 3.0);
            const oi = (wy * wSize + wx) * 4;
            wImg.data[oi] = clamp(24 + w1 * 8 + c * 130, 0, 255);
            wImg.data[oi + 1] = clamp(114 + w1 * 14 + c * 115, 0, 255);
            wImg.data[oi + 2] = clamp(150 + w1 * 16 + c * 92, 0, 255);
            wImg.data[oi + 3] = 255;
          }
        }
        wCtx.putImageData(wImg, 0, 0);
        const wTex = new THREE.CanvasTexture(wCv);
        wTex.wrapS = wTex.wrapT = THREE.RepeatWrapping;
        wTex.repeat.set(22, 22);

        const wGeo = new THREE.PlaneGeometry(240, 240, 96, 96);
        wGeo.rotateX(-Math.PI / 2);
        const wMat = new THREE.MeshStandardMaterial({ color: 0xd8f3ff, map: wTex, transparent: true, opacity: 0.84, roughness: 0.12, metalness: 0.28 });
        this.waterTex = wTex;
        const wMesh = new THREE.Mesh(wGeo, wMat);
        this.group.add(wMesh);
      }

      buildSky() {
        const sc = document.createElement('canvas'); sc.width = 32; sc.height = 128;
        const sctx = sc.getContext('2d');
        const g = sctx.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, '#1e5799'); g.addColorStop(0.5, '#5596c8'); g.addColorStop(1, '#b8d8e8');
        sctx.fillStyle = g; sctx.fillRect(0, 0, 32, 128);
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(210, 20, 14),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.BackSide, fog: false })
        );
        this.group.add(dome);
      }

      addCollider(col) {
        const minX = col.type === 'cylinder' ? col.x - col.r : col.minX;
        const maxX = col.type === 'cylinder' ? col.x + col.r : col.maxX;
        const minZ = col.type === 'cylinder' ? col.z - col.r : col.minZ;
        const maxZ = col.type === 'cylinder' ? col.z + col.r : col.maxZ;
        for (let cz = Math.floor(minZ / 10); cz <= Math.floor(maxZ / 10); cz++) {
          for (let cx = Math.floor(minX / 10); cx <= Math.floor(maxX / 10); cx++) {
            const key = cx + ',' + cz;
            if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
            this.spatialGrid.get(key).push(col);
          }
        }
      }

      getNearbyColliders(x, z) {
        const cx = Math.floor(x / 10), cz = Math.floor(z / 10), out = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const b = this.spatialGrid.get((cx + dx) + ',' + (cz + dz));
          if (b) out.push(...b);
        }
        return out;
      }

      getSupportHeightAt(x, z, feetY) {
        let y = this.getHeightAt(x, z);
        for (const c of this.getNearbyColliders(x, z)) {
          if (c.type === 'aabb' && c.walkableTop && x >= c.minX - 0.3 && x <= c.maxX + 0.3 && z >= c.minZ - 0.3 && z <= c.maxZ + 0.3) {
            if (feetY >= c.maxY - 0.7) y = Math.max(y, c.maxY);
          }
        }
        return y;
      }

      buildStructures() {
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.85 });
        const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.88 });
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.78 });
        const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x6e4726, roughness: 0.82 });
        const lanternMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 2.0 });
        const addBox = (x, y, z, w, h, d, mat, walkableTop = true) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true;
          this.group.add(m); this.shootables.push(m);
          this.addCollider({ type: 'aabb', minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2, cx: x, cz: z, w, d, walkableTop });
        };
        const addDecor = (x, y, z, w, h, d, mat, rx = 0) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true;
          this.group.add(m); this.shootables.push(m);
        };
        const oy = this.getHeightAt(0, 0) - 0.15;
        addBox(-3.8, oy, -6, 4.4, 2.8, 0.7, stoneMat);
        addBox(3.8, oy, -6, 4.4, 2.4, 0.7, stoneMat);
        addBox(-3.8, oy, 6, 4.4, 2.6, 0.7, stoneMat);
        addBox(3.8, oy, 6, 4.4, 2.9, 0.7, stoneMat);
        addBox(-6, oy, -3.8, 0.7, 2.9, 4.4, stoneMat);
        addBox(-6, oy, 3.8, 0.7, 2.3, 4.4, stoneMat);
        addBox(3.6, oy + 2.85, -3.6, 3.6, 0.3, 3.6, woodMat);

        // Engineered Arch-Truss River Bridge at (-30, 30)
        addBox(-30, 0.85, 30, 5.4, 0.36, 13.6, darkWoodMat, true);
        addDecor(-30, 0.25, 22.9, 6.2, 1.85, 1.5, darkStoneMat);
        addDecor(-30, 0.25, 37.1, 6.2, 1.85, 1.5, darkStoneMat);
        for (let i = 0; i < 22; i++) {
          addDecor(-30, 1.24, 23.5 + i * 0.61, 5.3, 0.12, 0.52, i % 2 ? woodMat : darkWoodMat);
        }
        [[-32.75, 23.1], [-27.25, 23.1], [-32.75, 36.9], [-27.25, 36.9]].forEach(([px, pz]) => {
          addBox(px, 0.4, pz, 0.82, 2.35, 0.82, stoneMat, false);
          addDecor(px, 3.15, pz, 0.26, 0.34, 0.26, lanternMat);
        });
        for (const sx of [-32.52, -27.48]) {
          addDecor(sx, 2.4, 30, 0.24, 0.16, 13.0, darkWoodMat);
          for (let b = 0; b <= 5; b++) addDecor(sx, 1.82, 23.8 + b * 2.48, 0.24, 1.25, 0.24, darkWoodMat);
        }

        addBox(45, 0.55, 45, 3.6, 0.28, 10.5, woodMat);
        [[-70, -30], [70, 70], [30, -60]].forEach(([hx, hz]) => {
          const hy = this.getHeightAt(hx, hz) - 0.2;
          addBox(hx, hy, hz - 2.5, 5.4, 2.6, 0.5, stoneMat);
          addBox(hx - 2.5, hy, hz, 0.5, 2.5, 5.4, stoneMat);
          addBox(hx + 2.5, hy, hz, 0.5, 2.5, 5.4, stoneMat);
        });
      }

      buildVegetation() {
        const r = mulberry32(this.seed + 77);
        const dummy = new THREE.Object3D();
        const pineGeo = new THREE.ConeGeometry(1.6, 6.8, 7); pineGeo.translate(0, 3.4, 0);
        const pineMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.8 });
        const pineInst = new THREE.InstancedMesh(pineGeo, pineMat, CONFIG.PINE_COUNT);
        let pCount = 0, tries = 0;
        while (pCount < CONFIG.PINE_COUNT && tries++ < 30000) {
          const x = r() * 220 - 110, z = r() * 220 - 110, h = this.getHeightAt(x, z);
          if (h < 1 || h > 9 || this.getSlopeAt(x, z) > 30) continue;
          const s = 0.8 + r() * 0.5;
          dummy.position.set(x, h - 0.1, z); dummy.scale.set(s, s, s); dummy.updateMatrix();
          pineInst.setMatrixAt(pCount++, dummy.matrix);
          this.addCollider({ type: 'cylinder', x, z, r: 0.4 * s, minY: h, maxY: h + 6 * s });
        }
        pineInst.castShadow = true;
        this.group.add(pineInst);
      }

      dispose(scene) {
        scene.remove(this.group);
      }
    }

    // =========================================================================
    // MAIN GAME LOOP & CONTROLS
    // =========================================================================
    window.addEventListener('DOMContentLoaded', () => {
      const container = document.getElementById('canvas-container');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xb8d8e8);
      scene.fog = new THREE.FogExp2(0xb8d8e8, CONFIG.FOG_DENSITY);

      const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 210);
      scene.add(camera);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xc8e4f4, 0x3e5634, 0.65));
      const sun = new THREE.DirectionalLight(0xfffbeb, 1.5);
      sun.position.set(45, 38, -40);
      sun.castShadow = true;
      scene.add(sun);

      let map = new MapGenerator(scene, CONFIG.SEED);
      document.getElementById('loading-bar-wrap').style.display = 'none';

      let state = 'START', yaw = 0, pitch = 0, hp = 100;
      const pos = new THREE.Vector3(0, map.getHeightAt(0, 95) + 1.7, 95);
      const vel = new THREE.Vector3();
      let isGrounded = true;
      const keys = {};

      window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'F3') {
          e.preventDefault();
          const dp = document.getElementById('debug-panel');
          dp.style.display = dp.style.display === 'block' ? 'none' : 'block';
        }
        if (e.code === 'F4') {
          e.preventDefault();
          map.dispose(scene);
          CONFIG.SEED = Math.floor(1000 + Math.random() * 90000);
          map = new MapGenerator(scene, CONFIG.SEED);
        }
      });
      window.addEventListener('keyup', e => keys[e.code] = false);
      document.addEventListener('mousemove', e => {
        if (state === 'PLAYING' && document.pointerLockElement) {
          yaw -= e.movementX * 0.0021;
          pitch = clamp(pitch - e.movementY * 0.0021, -1.48, 1.48);
        }
      });
      document.getElementById('btn-start').onclick = () => {
        document.getElementById('start-screen').classList.add('hidden');
        state = 'PLAYING';
        renderer.domElement.requestPointerLock();
      };
      document.getElementById('btn-resume').onclick = () => {
        document.getElementById('pause-screen').classList.add('hidden');
        state = 'PLAYING';
        renderer.domElement.requestPointerLock();
      };
      document.addEventListener('pointerlockchange', () => {
        if (!document.pointerLockElement && state === 'PLAYING') {
          state = 'PAUSED';
          document.getElementById('pause-screen').classList.remove('hidden');
        }
      });

      const clock = new THREE.Clock();
      function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.05);
        if (state === 'PLAYING') {
          const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const wish = new THREE.Vector3();
          if (keys['KeyW']) wish.add(fwd);
          if (keys['KeyS']) wish.sub(fwd);
          if (keys['KeyD']) wish.add(right);
          if (keys['KeyA']) wish.sub(right);
          if (wish.lengthSq() > 0) wish.normalize();
          const spd = keys['ShiftLeft'] ? 11.2 : 7.5;
          vel.x = wish.x * spd; vel.z = wish.z * spd;
          if (keys['Space'] && isGrounded) { vel.y = 9.0; isGrounded = false; }
          vel.y -= 24 * dt;
          pos.x = clamp(pos.x + vel.x * dt, -115, 115);
          pos.z = clamp(pos.z + vel.z * dt, -115, 115);
          pos.y += vel.y * dt;
          const groundY = map.getSupportHeightAt(pos.x, pos.z, pos.y - 1.7) + 1.7;
          if (pos.y <= groundY) { pos.y = groundY; vel.y = 0; isGrounded = true; }
          camera.position.copy(pos);
          camera.rotation.set(pitch, yaw, 0, 'YXZ');

          document.getElementById('dbg-text').innerHTML =
            'SEED: ' + CONFIG.SEED + '<br>XYZ: ' + pos.x.toFixed(1) + ', ' + (pos.y - 1.7).toFixed(1) + ', ' + pos.z.toFixed(1) +
            '<br>BIOME: ' + map.getBiomeAt(pos.x, pos.z);
        }
        renderer.render(scene, camera);
      }
      animate();
    });
  </script>
</body>
</html>`;
