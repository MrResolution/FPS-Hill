import React, { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Download,
  Copy,
  Check,
  Volume2,
  VolumeX,
  RotateCcw,
  Play,
  Skull,
  Award,
  Zap,
  Map as MapIcon,
  Bug,
  RefreshCw,
  X,
  Gamepad2,
  Settings,
} from 'lucide-react';
import { FpsGameEngine, HudSnapshot } from './game/FpsEngine';
import { QualityPreset } from './game/MapGenerator';
import { STANDALONE_HTML_SOURCE } from './standaloneHtml';

const INITIAL_HUD: HudSnapshot = {
  state: 'START',
  isGenerating: true,
  generationProgress: 25,
  seed: 1337,
  quality: 'HIGH',
  debugMode: false,
  fps: 60,
  playerX: 0,
  playerY: 11.7,
  playerZ: 0,
  playerYaw: 0,
  playerSlope: 0,
  currentBiome: 'Dirt / Cobble',
  inWater: false,
  heightmapDataUrl: '',
  minimapSplatCanvas: null,
  hp: 100,
  maxHp: 100,
  magAmmo: 30,
  maxMagAmmo: 30,
  reserveAmmo: 90,
  isReloading: false,
  reloadProgress: 0,
  adsBlend: 0,
  scopeZoom: 2.0,
  reticleOffsetX: 0,
  reticleOffsetY: 0,
  wave: 1,
  enemiesRemaining: 3,
  waveBannerText: null,
  score: 0,
  kills: 0,
  headshots: 0,
  crosshairSpread: 8,
  hitMarkerTimer: 0,
  hitMarkerHeadshot: false,
  damageFlash: 0,
  damageAngle: null,
  isMuted: false,
  gamepadConnected: false,
  gamepadName: null,
  floatingDamages: [],
  radarBlips: [],
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FpsGameEngine | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [showAtlasModal, setShowAtlasModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMinimalReadouts, setShowMinimalReadouts] = useState(true);

  // Initialize Three.js FPS Engine once inside isolated container
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new FpsGameEngine(mount, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Draw Dynamic Player-Centered Rotating Tactical Minimap (No Box, Circular Clip)
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const half = size / 2;
    const radius = half - 10; // Leave outer margin for rotating N/E/S/W compass letters
    const radarWorldRange = 54; // 54m local tactical radius around the player
    const scale = radius / radarWorldRange;

    // Clear entire canvas so outside the circular radar is 100% transparent (no box)
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, radius, 0, Math.PI * 2);
    ctx.clip();

    // Subtle dark terrain backing inside circle
    ctx.fillStyle = 'rgba(7, 11, 19, 0.72)';
    ctx.fillRect(0, 0, size, size);

    // Dynamically translate & rotate world splat map around player's real-time position & heading
    if (hud.minimapSplatCanvas) {
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(hud.playerYaw);
      ctx.scale(scale, scale);
      ctx.translate(-hud.playerX, -hud.playerZ);

      ctx.globalAlpha = 0.88;
      ctx.drawImage(hud.minimapSplatCanvas, -120, -120, 240, 240);

      // Subtle world boundary line
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.25)';
      ctx.lineWidth = 1.2 / scale;
      ctx.strokeRect(-120, -120, 240, 240);
      ctx.restore();
    }

    // Subtle concentric range ring & cross-axis ticks inside radar
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(half, half, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Forward FOV Cone (Always points UP since radar rotates with player heading)
    const fovGrad = ctx.createRadialGradient(half, half, 2, half, half, radius * 0.85);
    fovGrad.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
    fovGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = fovGrad;
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.arc(half, half, radius * 0.85, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52);
    ctx.closePath();
    ctx.fill();

    // Draw Pickups (Emerald = Health, Amber = Ammo) and Enemies (Red) relative to player
    const cosYaw = Math.cos(hud.playerYaw);
    const sinYaw = Math.sin(hud.playerYaw);

    for (const blip of hud.radarBlips) {
      const dx = blip.x - hud.playerX;
      const dz = blip.z - hud.playerZ;
      const rx = (dx * cosYaw - dz * sinYaw) * scale;
      const ry = (dx * sinYaw + dz * cosYaw) * scale;
      const dist = Math.hypot(rx, ry);

      if (blip.type === 'enemy') {
        const maxDist = radius - 5;
        const clampedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(ry, rx);
        const bx = half + Math.cos(angle) * clampedDist;
        const bz = half + Math.sin(angle) * clampedDist;

        ctx.fillStyle = dist > maxDist ? '#fb7185' : '#ef4444';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, bz, dist > maxDist ? 3.0 : 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (dist < radius - 3) {
        const bx = half + rx;
        const bz = half + ry;
        ctx.fillStyle = blip.type === 'health' ? '#10b981' : '#f59e0b';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1;
        ctx.fillRect(bx - 2.5, bz - 2.5, 5, 5);
        ctx.strokeRect(bx - 2.5, bz - 2.5, 5, 5);
      }
    }

    // Center Player Tactical Chevron (Fixed at center, pointing UP in look direction)
    ctx.save();
    ctx.translate(half, half);
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // End circular clip

    // Sleek circular rim ring (no rectangular border)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(half, half, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating Cardinal Compass Markers (N / E / S / W) around perimeter
    const cardinals = [
      { label: 'N', angle: -Math.PI / 2, color: '#fbbf24' },
      { label: 'E', angle: 0, color: 'rgba(226, 232, 240, 0.75)' },
      { label: 'S', angle: Math.PI / 2, color: 'rgba(226, 232, 240, 0.75)' },
      { label: 'W', angle: Math.PI, color: 'rgba(226, 232, 240, 0.75)' },
    ];
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of cardinals) {
      const a = c.angle + hud.playerYaw;
      const cx = half + Math.cos(a) * (radius + 5.5);
      const cy = half + Math.sin(a) * (radius + 5.5);
      ctx.fillStyle = c.color;
      ctx.fillText(c.label, cx, cy);
    }
  }, [
    hud.playerX,
    hud.playerZ,
    hud.playerYaw,
    hud.radarBlips,
    hud.minimapSplatCanvas,
  ]);

  const handleDownloadStandaloneHtml = () => {
    const blob = new Blob([STANDALONE_HTML_SOURCE], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mossy-hollow-fps.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyStandaloneHtml = () => {
    navigator.clipboard.writeText(STANDALONE_HTML_SOURCE).then(() => {
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2200);
    });
  };

  const handleToggleMute = () => {
    if (!engineRef.current) return;
    const muted = engineRef.current.audio.toggleMute();
    setHud((prev) => ({ ...prev, isMuted: muted }));
  };

  const handleSelectQuality = (preset: QualityPreset) => {
    engineRef.current?.setQuality(preset);
  };

  const handleOpenSettings = () => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    setShowSettingsModal(true);
  };

  const hpPercent = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const hpColorClass =
    hpPercent > 55 ? 'bg-emerald-400' : hpPercent > 25 ? 'bg-amber-400' : 'bg-red-500';
  const hpTextClass =
    hpPercent > 55 ? 'text-emerald-400' : hpPercent > 25 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* ISOLATED 3D WEBGL CANVAS CONTAINER */}
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full z-0" />

      {/* TERRAIN GENERATION LOADING BAR OVERLAY */}
      {hud.isGenerating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl p-6 shadow-2xl text-center">
            <div className="text-xs font-mono-tabular font-semibold tracking-widest text-amber-400 mb-1">
              SEED #{hud.seed} · 240×240m VALLEY
            </div>
            <h2 className="font-display text-xl font-bold text-slate-100 mb-3">
              Generating terrain...
            </h2>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-amber-400 transition-all duration-150"
                style={{ width: `${hud.generationProgress}%` }}
              />
            </div>
            <p className="text-xs font-mono-tabular text-slate-400">
              Building 257×257 heightmap, biome splat texture, instanced forest & outpost...
            </p>
          </div>
        </div>
      )}

      {/* RED SCREEN-EDGE DAMAGE FLASH VIGNETTE */}
      <div
        className="fixed inset-0 pointer-events-none z-10 transition-opacity duration-75"
        style={{
          opacity: hud.damageFlash,
          boxShadow: 'inset 0 0 110px 44px rgba(239, 68, 68, 0.85)',
        }}
      />

      {/* FLOATING 3D-PROJECTED DAMAGE NUMBERS & HEADSHOT CALLOUTS */}
      <div className="fixed inset-0 pointer-events-none z-10 overflow-hidden">
        {hud.floatingDamages.map((fd) => (
          <div
            key={fd.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 font-mono-tabular font-extrabold tracking-tight"
            style={{
              left: `${fd.x}px`,
              top: `${fd.y}px`,
              opacity: fd.opacity,
            }}
          >
            {fd.isHeadshot ? (
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-bold tracking-widest text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                  2X HEADSHOT
                </span>
                <span className="text-xl text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                  -{fd.amount}
                </span>
              </div>
            ) : (
              <span className="text-base text-slate-100 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                -{fd.amount}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* =====================================================================
          F3 DEBUG OVERLAY (Toggled via F3 or from inside Settings Modal)
      ===================================================================== */}
      {hud.debugMode && (
        <div className="fixed top-16 right-6 z-30 w-64 bg-slate-950/92 border border-amber-500/50 rounded-lg p-3.5 shadow-xl font-mono-tabular text-xs text-slate-200 pointer-events-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
            <span className="font-bold text-amber-400 flex items-center gap-1.5">
              <Bug className="w-3.5 h-3.5" />
              F3 TELEMETRY & HEIGHTMAP
            </span>
            <span className="text-emerald-400 font-bold">{hud.fps} FPS</span>
          </div>

          <div className="space-y-1 text-[11px] mb-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Seed / Quality:</span>
              <span className="text-slate-100 font-semibold">
                #{hud.seed} ({hud.quality})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Player XYZ:</span>
              <span className="text-sky-300">
                {hud.playerX.toFixed(1)}, {hud.playerY.toFixed(1)}, {hud.playerZ.toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Ground Slope:</span>
              <span
                className={
                  hud.playerSlope > 45
                    ? 'text-red-400 font-bold'
                    : hud.playerSlope > 30
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }
              >
                {hud.playerSlope.toFixed(1)}°
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Biome:</span>
              <span className="text-amber-300 font-semibold">{hud.currentBiome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Water / Colliders:</span>
              <span className="text-slate-300">
                {hud.inWater ? 'Wading (0.6x)' : 'Dry'} · Wireframes ON
              </span>
            </div>
          </div>

          {hud.heightmapDataUrl && (
            <div>
              <div className="text-[10px] text-slate-400 mb-1 flex justify-between">
                <span>HEIGHTMAP (257×257)</span>
                <span>0m – 14m</span>
              </div>
              <div className="relative w-full aspect-square bg-slate-900 border border-slate-700 rounded overflow-hidden">
                <img
                  src={hud.heightmapDataUrl}
                  alt="Mossy Hollow Grayscale Heightmap"
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-red-500 border border-white"
                  style={{
                    left: `${((hud.playerX + 120) / 240) * 100}%`,
                    top: `${((hud.playerZ + 120) / 240) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          CLEAN BOX-FREE VIDEO GAME UI OVERLAY
      ===================================================================== */}
      {hud.state !== 'START' && (
        <div className="fixed inset-0 pointer-events-none z-20">
          {/* DIRECTIONAL DAMAGE INDICATOR ARC */}
          {hud.damageAngle !== null && (
            <div
              className="fixed top-1/2 left-1/2 w-44 h-44 -ml-22 -mt-22 pointer-events-none"
              style={{
                transform: `rotate(${hud.damageAngle}rad)`,
              }}
            >
              <div className="w-full h-full rounded-full border-4 border-transparent border-t-red-500/90" />
            </div>
          )}

          {/* TACTICAL OPTICAL SCOPE VIGNETTE (Box-free magnification readout) */}
          {hud.adsBlend > 0.02 && (
            <div
              className="fixed inset-0 pointer-events-none"
              style={{
                opacity: hud.adsBlend,
                background:
                  'radial-gradient(circle at 50% 50%, transparent 28%, rgba(2, 6, 23, 0.28) 54%, rgba(2, 6, 23, 0.78) 100%)',
              }}
            >
              <div className="fixed bottom-1/2 left-1/2 translate-x-20 translate-y-16 font-mono-tabular text-xs font-bold tracking-widest text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                {hud.scopeZoom.toFixed(1)}× OPTIC
              </div>
            </div>
          )}

          {/* DYNAMIC CENTER CROSSHAIR */}
          <div
            className="fixed top-1/2 left-1/2 w-0 h-0 pointer-events-none"
            style={{ opacity: Math.max(0, 1 - hud.adsBlend * 2.6) }}
          >
            <div
              className="absolute w-0.5 h-2.5 -left-[1px] bg-slate-100 shadow-[0_0_3px_rgba(0,0,0,0.9)]"
              style={{ top: `${-hud.crosshairSpread - 10}px` }}
            />
            <div
              className="absolute w-0.5 h-2.5 -left-[1px] bg-slate-100 shadow-[0_0_3px_rgba(0,0,0,0.9)]"
              style={{ top: `${hud.crosshairSpread}px` }}
            />
            <div
              className="absolute h-0.5 w-2.5 -top-[1px] bg-slate-100 shadow-[0_0_3px_rgba(0,0,0,0.9)]"
              style={{ left: `${-hud.crosshairSpread - 10}px` }}
            />
            <div
              className="absolute h-0.5 w-2.5 -top-[1px] bg-slate-100 shadow-[0_0_3px_rgba(0,0,0,0.9)]"
              style={{ left: `${hud.crosshairSpread}px` }}
            />
            <div className="absolute w-1 h-1 -left-0.5 -top-0.5 bg-sky-400 rounded-full" />
          </div>

          {/* HIT MARKER X */}
          {hud.hitMarkerTimer > 0 && (
            <svg
              className="fixed top-1/2 left-1/2 w-7 h-7 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke={hud.hitMarkerHeadshot ? '#ef4444' : '#f8fafc'}
              strokeWidth={hud.hitMarkerHeadshot ? '3' : '2.2'}
            >
              <line x1="4" y1="4" x2="9.5" y2="9.5" />
              <line x1="20" y1="4" x2="14.5" y2="9.5" />
              <line x1="4" y1="20" x2="9.5" y2="14.5" />
              <line x1="20" y1="20" x2="14.5" y2="14.5" />
            </svg>
          )}

          {/* UNBOXED WAVE BANNER CALLOUT */}
          {hud.waveBannerText && (
            <div className="fixed top-16 left-1/2 -translate-x-1/2 text-center">
              <p className="font-display text-lg md:text-2xl font-extrabold tracking-[0.2em] text-amber-400 uppercase drop-shadow-[0_3px_8px_rgba(0,0,0,0.95)] whitespace-nowrap">
                {hud.waveBannerText}
              </p>
            </div>
          )}

          {/* TOP-RIGHT: SINGLE UNBOXED SETTINGS TRIGGER BUTTON */}
          <div className="fixed top-5 right-6 flex items-center gap-4 pointer-events-auto">
            <button
              onClick={handleOpenSettings}
              title="Open Game Settings"
              className="group flex items-center gap-2 text-slate-200/85 hover:text-amber-400 transition-colors cursor-pointer drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]"
            >
              <Settings className="w-5 h-5 transition-transform duration-200 group-hover:rotate-45" />
              <span className="font-display text-xs font-bold tracking-[0.18em] uppercase">
                Settings
              </span>
            </button>
          </div>

          {/* BOTTOM-LEFT: DYNAMIC PLAYER-CENTERED CIRCULAR MINIMAP (NO BOX) + DIEGETIC HEALTH BAR */}
          <div className="fixed bottom-6 left-6 flex items-end gap-5">
            <div className="relative flex flex-col items-center">
              <canvas
                ref={radarCanvasRef}
                width={156}
                height={156}
                className="block rounded-full drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)]"
              />
            </div>

            {showMinimalReadouts && (
              <div className="pb-2 flex flex-col gap-1.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                {/* Unboxed Wave & Hostiles Status Line */}
                <div className="flex items-center gap-3 font-mono-tabular text-[11px] font-bold tracking-widest uppercase">
                  <span className="text-amber-400">WAVE {hud.wave}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-red-400">{hud.enemiesRemaining} HOSTILES</span>
                  {hud.inWater && (
                    <>
                      <span className="text-slate-500">/</span>
                      <span className="text-sky-400">WADING</span>
                    </>
                  )}
                </div>

                {/* Unboxed Sleek Health Readout + Minimal Bar */}
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono-tabular text-4xl font-black leading-none tracking-tight ${hpTextClass}`}
                  >
                    {hud.hp}
                  </span>
                  <span className="font-display text-[11px] font-bold tracking-[0.2em] text-slate-300/90 uppercase">
                    HP
                  </span>
                </div>

                <div className="w-44 h-1.5 bg-slate-950/60 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${hpColorClass}`}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM-RIGHT: UNBOXED DIEGETIC WEAPON & AMMO READOUT */}
          {showMinimalReadouts && (
            <div className="fixed bottom-7 right-7 text-right drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
              <div className="font-mono-tabular flex items-baseline justify-end gap-2 leading-none">
                <span
                  className={`text-5xl font-black tracking-tight ${
                    hud.magAmmo <= 6 ? 'text-red-400' : 'text-slate-100'
                  }`}
                >
                  {hud.magAmmo}
                </span>
                <span className="text-xl text-slate-400/80 font-bold">/</span>
                <span className="text-2xl font-bold text-slate-300/90">{hud.reserveAmmo}</span>
              </div>

              {/* Minimal Weapon & Optic Line */}
              <div className="mt-1 flex items-center justify-end gap-2.5 text-[11px] font-mono-tabular font-bold tracking-[0.16em] text-slate-300/85 uppercase">
                <span>ACR SUPPRESSED</span>
                <span className="text-slate-500">·</span>
                <span className="text-amber-400">{hud.scopeZoom.toFixed(1)}× OPTIC</span>
              </div>

              {/* Sleek Unboxed Reload Progress Line */}
              {hud.isReloading && (
                <div className="mt-2 w-44 ml-auto">
                  <div className="flex justify-between text-[10px] font-mono-tabular font-bold tracking-widest text-amber-400 mb-1">
                    <span>RELOADING</span>
                    <span>{Math.round(hud.reloadProgress * 100)}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-950/60 overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-75"
                      style={{ width: `${hud.reloadProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          START SCREEN OVERLAY ("Click to Play" + Settings Access)
      ===================================================================== */}
      {hud.state === 'START' && !hud.isGenerating && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-slate-900/95 border border-slate-700/80 rounded-xl p-6 md:p-8 shadow-2xl my-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="text-xs font-mono-tabular font-semibold tracking-widest text-amber-400">
                  PROCEDURAL OUTDOOR VALLEY · SEED #{hud.seed}
                </div>
                <h1 className="font-display text-3xl md:text-4xl font-bold text-slate-100 tracking-tight">
                  MOSSY HOLLOW
                </h1>
              </div>

              <button
                onClick={() => setShowSettingsModal(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Settings className="w-4 h-4 text-amber-400" />
                Settings
              </button>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed mb-6">
              Deploy onto <span className="text-amber-400 font-semibold">The Knoll</span> ruined
              outpost at the heart of a 240×240m temperate valley. Defend the central watchtower,
              twin river bridges, southeast lake dock, and stone huts against waves of A*
              pathfinding combat bots.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => engineRef.current?.startGame()}
                className="w-full py-3.5 px-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-base rounded-lg shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                {hud.gamepadConnected
                  ? 'Press A / Start or Click to Play'
                  : 'Click to Play in Mossy Hollow'}
              </button>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-amber-400" />
                  Game Settings & Controls
                </button>
                <button
                  onClick={() => setShowAtlasModal(true)}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MapIcon className="w-4 h-4" />
                  2D Map Atlas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PAUSE MODAL (Shown when Pointer Lock is released)
      ===================================================================== */}
      {hud.state === 'PAUSED' && !hud.isGenerating && !showSettingsModal && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl p-7 shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold tracking-widest text-amber-400">
                MOSSY HOLLOW · SEED #{hud.seed}
              </span>
              <span className="text-xs font-mono-tabular text-slate-400">{hud.fps} FPS</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-100 mb-2">
              GAME PAUSED
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Resume combat or open Settings to configure graphics, audio, world seed, and controls.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => engineRef.current?.resumeGame()}
                className="w-full py-3 px-5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                {hud.gamepadConnected ? 'Resume Combat (A / Start)' : 'Resume Combat'}
              </button>

              <button
                onClick={() => setShowSettingsModal(true)}
                className="w-full py-2.5 px-5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                Settings & Controls
              </button>

              <button
                onClick={() => engineRef.current?.restartGame()}
                className="w-full py-2.5 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                {hud.gamepadConnected ? 'Restart Mission (X)' : 'Restart Mission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          CONSOLIDATED SETTINGS MODAL (Graphics, Audio, HUD, Telemetry, Controls, World Tools)
      ===================================================================== */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl p-6 md:p-7 shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
              <div className="flex items-center gap-2.5">
                <Settings className="w-5 h-5 text-amber-400" />
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-100 leading-none">
                    GAME SETTINGS & TELEMETRY
                  </h2>
                  <p className="text-xs font-mono-tabular text-slate-400 mt-1">
                    Seed #{hud.seed} · Biome: {hud.currentBiome} · Alt {hud.playerY.toFixed(1)}m ·{' '}
                    {hud.fps} FPS
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
                Close
              </button>
            </div>

            {/* Session Combat Stats Summary (Moved from HUD into Settings) */}
            <div className="grid grid-cols-4 gap-2.5 bg-slate-950 border border-slate-800 rounded-lg p-3.5 mb-5 text-center font-mono-tabular">
              <div>
                <div className="text-[10px] text-slate-400">WAVE</div>
                <div className="text-lg font-extrabold text-amber-400">{hud.wave}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">SCORE</div>
                <div className="text-lg font-extrabold text-slate-100">{hud.score}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">KILLS</div>
                <div className="text-lg font-extrabold text-slate-100">{hud.kills}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">HEADSHOTS</div>
                <div className="text-lg font-extrabold text-emerald-400">{hud.headshots}</div>
              </div>
            </div>

            {/* Graphics, Audio & HUD Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4">
                <div className="text-xs font-semibold text-slate-300 tracking-wider uppercase mb-2.5">
                  Graphics Quality Preset
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['LOW', 'MEDIUM', 'HIGH'] as QualityPreset[]).map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSelectQuality(q)}
                      className={`py-2 rounded text-xs font-mono-tabular font-bold border transition-colors cursor-pointer ${
                        hud.quality === q
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 flex flex-col justify-between gap-2">
                <div className="text-xs font-semibold text-slate-300 tracking-wider uppercase">
                  Audio & HUD Readouts
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleToggleMute}
                    className="py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {hud.isMuted ? (
                      <>
                        <VolumeX className="w-4 h-4 text-red-400" />
                        Audio Muted
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4 text-sky-400" />
                        Audio Active
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowMinimalReadouts((prev) => !prev)}
                    className={`py-2 px-3 border rounded text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                      showMinimalReadouts
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    {showMinimalReadouts ? 'HUD Text: ON' : 'HUD Text: OFF'}
                  </button>
                </div>
              </div>
            </div>

            {/* Controls & Controller Bindings Reference */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-4 mb-5">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-slate-300 tracking-wider uppercase">
                  Controls & Gamepad Bindings
                </span>
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-mono-tabular px-2 py-0.5 rounded border ${
                    hud.gamepadConnected
                      ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  {hud.gamepadConnected ? hud.gamepadName || 'Controller Connected' : 'Controller Ready'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Move / Sprint / Jump</span>
                  <span className="font-mono-tabular font-semibold text-amber-400">
                    WASD · Shift · Space / LS · L3 · A
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Fire / Scope / Zoom</span>
                  <span className="font-mono-tabular font-semibold text-amber-400">
                    LMB · RMB · V / RT · LT · LB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Reload / Inspect</span>
                  <span className="font-mono-tabular font-semibold text-sky-400">
                    R · F / X · Y
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Debug / New Seed</span>
                  <span className="font-mono-tabular font-semibold text-emerald-400">
                    F3 · F4 / Select · D-Right
                  </span>
                </div>
              </div>
            </div>

            {/* World Tools & Export Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              <button
                onClick={() => {
                  setShowSettingsModal(false);
                  setShowAtlasModal(true);
                }}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MapIcon className="w-4 h-4" />
                2D Map Atlas
              </button>

              <button
                onClick={() => engineRef.current?.toggleDebug()}
                className={`py-2.5 px-3 border rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  hud.debugMode
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
              >
                <Bug className="w-4 h-4" />
                F3 Debug {hud.debugMode ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => {
                  setShowSettingsModal(false);
                  engineRef.current?.regenerateNewSeed();
                }}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                New Seed (F4)
              </button>

              <button
                onClick={handleCopyStandaloneHtml}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedHtml ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    Copied HTML
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-sky-400" />
                    Copy HTML
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <button
                onClick={handleDownloadStandaloneHtml}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4 text-sky-400" />
                Download Single-File HTML
              </button>

              <button
                onClick={() => {
                  setShowSettingsModal(false);
                  if (hud.state === 'PAUSED' || hud.state === 'PLAYING') {
                    engineRef.current?.resumeGame();
                  }
                }}
                className="py-2.5 px-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                {hud.state === 'START' ? 'Done' : 'Resume Game'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          GAME OVER MODAL (Final Score, Wave Reached, Kills, Restart Button)
      ===================================================================== */}
      {hud.state === 'GAMEOVER' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/85 p-4">
          <div className="w-full max-w-md bg-slate-900 border border-red-500/40 rounded-xl p-7 shadow-2xl">
            <div className="text-xs font-semibold tracking-widest text-red-400 mb-1">
              OPERATOR DOWN · MOSSY HOLLOW
            </div>
            <h2 className="font-display text-3xl font-bold text-slate-100 mb-2">
              GAME OVER
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Your armor integrity dropped to zero during Wave {hud.wave} in {hud.currentBiome}.
            </p>

            <div className="grid grid-cols-2 gap-3 bg-slate-950 border border-slate-800 rounded-lg p-4 mb-6 font-mono-tabular">
              <div className="flex items-center gap-3">
                <Award className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400">FINAL SCORE</div>
                  <div className="text-xl font-extrabold text-amber-400">{hud.score}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-sky-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400">WAVE REACHED</div>
                  <div className="text-xl font-extrabold text-slate-100">{hud.wave}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skull className="w-5 h-5 text-red-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400">HOSTILES KILLED</div>
                  <div className="text-xl font-extrabold text-slate-100">{hud.kills}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Crosshair className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400">HEADSHOTS (2X)</div>
                  <div className="text-xl font-extrabold text-emerald-400">{hud.headshots}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => engineRef.current?.restartGame()}
                className="w-full py-3.5 px-5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                {hud.gamepadConnected ? 'Restart (A / Start)' : 'Restart'}
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="w-full py-2.5 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Settings className="w-4 h-4 text-amber-400" />
                Open Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          INTERACTIVE 2D MAP ATLAS MODAL (Renders Attached Mossy Hollow Atlas)
      ===================================================================== */}
      {showAtlasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 md:p-6">
          <div className="w-full max-w-6xl h-[90vh] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <MapIcon className="w-4 h-4 text-amber-400" />
                <span className="font-display font-bold text-sm text-slate-100">
                  MOSSY HOLLOW — INTERACTIVE 2D SURVEY ATLAS (240×240m · SEED 1337)
                </span>
              </div>
              <button
                onClick={() => setShowAtlasModal(false)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Close Atlas
              </button>
            </div>
            <iframe
              src="/assets/aistudio/Mossy_Hollow__Map_Atlas_27c5f75b.html"
              title="Mossy Hollow 2D Map Atlas"
              className="w-full flex-1 border-0 bg-[#1a1814]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
