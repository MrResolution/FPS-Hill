import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  CONFIG,
  MossyHollowMap,
  QualityPreset,
  MapCollider,
} from './MapGenerator';

export type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAMEOVER';

export interface FloatingDamage {
  id: number;
  amount: number;
  isHeadshot: boolean;
  x: number;
  y: number;
  opacity: number;
}

export interface RadarBlip {
  x: number;
  z: number;
  type: 'enemy' | 'health' | 'ammo';
}

export interface HudSnapshot {
  state: GameState;
  isGenerating: boolean;
  generationProgress: number;
  seed: number;
  quality: QualityPreset;
  debugMode: boolean;
  fps: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  playerYaw: number;
  playerSlope: number;
  currentBiome: string;
  inWater: boolean;
  heightmapDataUrl: string;
  minimapSplatCanvas: HTMLCanvasElement | null;
  hp: number;
  maxHp: number;
  magAmmo: number;
  maxMagAmmo: number;
  reserveAmmo: number;
  isReloading: boolean;
  reloadProgress: number;
  adsBlend: number;
  scopeZoom: number;
  reticleOffsetX: number;
  reticleOffsetY: number;
  wave: number;
  enemiesRemaining: number;
  waveBannerText: string | null;
  score: number;
  kills: number;
  headshots: number;
  crosshairSpread: number;
  hitMarkerTimer: number;
  hitMarkerHeadshot: boolean;
  damageFlash: number;
  damageAngle: number | null;
  isMuted: boolean;
  gamepadConnected: boolean;
  gamepadName: string | null;
  floatingDamages: FloatingDamage[];
  radarBlips: RadarBlip[];
}

// Pre-allocated math helpers to avoid GC in the render loop
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wishDir = new THREE.Vector3();
const _slopeNormal = new THREE.Vector3();
const _rayOrigin = new THREE.Vector2(0, 0);
const _reticleRayOrigin = new THREE.Vector2(0, 0);
const _projVec = new THREE.Vector3();

// ============================================================================
// 1. REALISTIC ACOUSTIC AUDIO ENGINE (Real Uploaded Gunshot, Reload, Forest &
//    Flowing Water Samples + Valley Convolution Reverb & Biome Foley)
// ============================================================================
const SOUND_URLS = {
  shoot: '/assets/aistudio/dragon-studio-machine-gun-sfx-631486_353e9571.mp3',
  reload: '/assets/aistudio/dragon-studio-gun-reload-2-511308_c1acdf30.mp3',
  forest: '/assets/aistudio/soundreality-forest-sound-576537_ee33c47b.mp3',
  water: '/assets/aistudio/freesound_community-flowing-water-100525_504ef895.mp3',
} as const;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private saturator: WaveShaperNode | null = null;

  // Decoded AudioBuffers from uploaded MP3 files
  private rawBuffers: Partial<Record<keyof typeof SOUND_URLS, ArrayBuffer>> = {};
  private shootBuffer: AudioBuffer | null = null;
  private reloadBuffer: AudioBuffer | null = null;
  private forestBuffer: AudioBuffer | null = null;
  private waterBuffer: AudioBuffer | null = null;

  // Looping ambience nodes (real Forest & Flowing Water recordings + fallback)
  private forestSource: AudioBufferSourceNode | null = null;
  private forestGain: GainNode | null = null;
  private waterSampleSource: AudioBufferSourceNode | null = null;
  private waterSampleGain: GainNode | null = null;
  private waterPanner: StereoPannerNode | null = null;

  // Procedural fallback wind/water nodes while MP3s decode
  private windGain: GainNode | null = null;
  private waterAmbGain: GainNode | null = null;

  public isMuted = false;

  constructor() {
    this.preloadRawAssets();
  }

  private preloadRawAssets(): void {
    (Object.keys(SOUND_URLS) as (keyof typeof SOUND_URLS)[]).forEach((key) => {
      fetch(SOUND_URLS[key])
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((buf) => {
          this.rawBuffers[key] = buf;
          if (this.ctx) {
            this.decodeSingleAsset(key, buf);
          }
        })
        .catch(() => {});
    });
  }

  private decodeSingleAsset(key: keyof typeof SOUND_URLS, raw: ArrayBuffer): void {
    if (!this.ctx) return;
    this.ctx
      .decodeAudioData(raw.slice(0))
      .then((audioBuf) => {
        if (key === 'shoot') {
          this.shootBuffer = audioBuf;
        } else if (key === 'reload') {
          this.reloadBuffer = audioBuf;
        } else if (key === 'forest') {
          this.forestBuffer = audioBuf;
          this.startForestSampleLoop();
        } else if (key === 'water') {
          this.waterBuffer = this.applySeamlessLoopCrossfade(audioBuf);
          this.startWaterSampleLoop();
        }
      })
      .catch(() => {});
  }

  private applySeamlessLoopCrossfade(buf: AudioBuffer): AudioBuffer {
    if (!this.ctx || buf.length < 4096) return buf;
    const fadeSamples = Math.min(Math.floor(buf.sampleRate * 0.08), Math.floor(buf.length * 0.1));
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const s = Math.sin(t * Math.PI * 0.5);
        const c = Math.cos(t * Math.PI * 0.5);
        const endIdx = data.length - fadeSamples + i;
        const blended = data[i] * s + data[endIdx] * c;
        data[i] = blended;
        data[endIdx] = blended;
      }
    }
    return buf;
  }

  public init(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : 0.65;
      this.masterGain.connect(this.ctx.destination);

      this.dryBus = this.ctx.createGain();
      this.dryBus.gain.value = 0.94;
      this.dryBus.connect(this.masterGain);

      // Soft-clipping analog saturation curve for punchy transients
      this.saturator = this.ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i * 2) / 1024 - 1;
        curve[i] = Math.tanh(x * 2.2);
      }
      this.saturator.curve = curve;
      this.saturator.oversample = '2x';
      this.saturator.connect(this.dryBus);

      // Outdoor Valley Stereo Convolution Reverb + Canyon Slapback Delay
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.28;

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.buildValleyImpulseResponse(1.55);

      const slapDelay = this.ctx.createDelay(0.5);
      slapDelay.delayTime.value = 0.165;
      const slapFeedback = this.ctx.createGain();
      slapFeedback.gain.value = 0.22;
      const slapFilter = this.ctx.createBiquadFilter();
      slapFilter.type = 'lowpass';
      slapFilter.frequency.value = 1450;

      this.reverbSend.connect(this.convolver);
      this.convolver.connect(this.masterGain);

      this.reverbSend.connect(slapDelay);
      slapDelay.connect(slapFilter);
      slapFilter.connect(this.masterGain);
      slapFilter.connect(slapFeedback);
      slapFeedback.connect(slapDelay);

      this.forestGain = this.ctx.createGain();
      this.forestGain.gain.value = 0.0;
      this.forestGain.connect(this.masterGain);

      this.waterSampleGain = this.ctx.createGain();
      this.waterSampleGain.gain.value = 0.0;
      if (this.ctx.createStereoPanner) {
        this.waterPanner = this.ctx.createStereoPanner();
        this.waterSampleGain.connect(this.waterPanner);
        this.waterPanner.connect(this.masterGain);
      } else {
        this.waterSampleGain.connect(this.masterGain);
      }

      this.initFallbackValleyAmbience();

      // Decode any raw buffers that already finished fetching
      (Object.keys(SOUND_URLS) as (keyof typeof SOUND_URLS)[]).forEach((key) => {
        const raw = this.rawBuffers[key];
        if (raw) {
          this.decodeSingleAsset(key, raw);
        }
      });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private startForestSampleLoop(): void {
    if (!this.ctx || !this.forestBuffer || !this.forestGain || this.forestSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.forestBuffer;
    src.loop = true;
    src.connect(this.forestGain);
    src.start(0);
    this.forestSource = src;
  }

  private startWaterSampleLoop(): void {
    if (!this.ctx || !this.waterBuffer || !this.waterSampleGain || this.waterSampleSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.waterBuffer;
    src.loop = true;
    src.connect(this.waterSampleGain);
    src.start(0);
    this.waterSampleSource = src;
  }

  private buildValleyImpulseResponse(durationSec: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx!.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const env =
          Math.exp(-t * 3.4) * 0.65 +
          Math.exp(-Math.pow((t - 0.09) * 35, 2)) * 0.35 +
          Math.exp(-Math.pow((t - 0.21) * 28, 2)) * 0.22;
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return impulse;
  }

  private initFallbackValleyAmbience(): void {
    if (!this.ctx || !this.masterGain) return;
    const rate = this.ctx.sampleRate;
    const len = rate * 4;
    const pinkBuf = this.ctx.createBuffer(1, len, rate);
    const out = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;
    }

    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = pinkBuf;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 1.8;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0;
    windSrc.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSrc.start();

    const waterSrc = this.ctx.createBufferSource();
    waterSrc.buffer = pinkBuf;
    waterSrc.loop = true;
    const waterFilter = this.ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 980;
    waterFilter.Q.value = 1.1;

    this.waterAmbGain = this.ctx.createGain();
    this.waterAmbGain.gain.value = 0.0;
    waterSrc.connect(waterFilter);
    waterFilter.connect(this.waterAmbGain);
    this.waterAmbGain.connect(this.masterGain);
    waterSrc.start();
  }

  public updateAmbience(
    _dt: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    playerYaw: number,
    map: MossyHollowMap | null,
    isActive: boolean
  ): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (!isActive) {
      this.forestGain?.gain.setTargetAtTime(0, now, 0.25);
      this.waterSampleGain?.gain.setTargetAtTime(0, now, 0.25);
      this.windGain?.gain.setTargetAtTime(0, now, 0.25);
      this.waterAmbGain?.gain.setTargetAtTime(0, now, 0.25);
      return;
    }

    // 1. Forest Ambience Loop (soundreality-forest-sound-576537_ee33c47b.mp3)
    if (this.forestSource && this.forestGain) {
      this.forestGain.gain.setTargetAtTime(0.45, now, 0.3);
      this.windGain?.gain.setTargetAtTime(0.03, now, 0.3);
    } else if (this.windGain) {
      const altFactor = Math.max(0.08, Math.min(0.24, 0.09 + (playerY / 14) * 0.14));
      this.windGain.gain.setTargetAtTime(altFactor, now, 0.25);
    }

    // 2. Spatial Flowing Water Loop (freesound_community-flowing-water-100525_504ef895.mp3)
    let waterDist3D = Math.max(0, playerY) * 2.5;
    let panVal = 0;

    if (map) {
      const wInfo = map.getWaterFlowAndDist(playerX, playerZ);
      waterDist3D = Math.hypot(wInfo.dist, Math.max(0, playerY));

      // Stereo pan toward nearest river/lake point relative to camera look direction
      const rightX = Math.cos(playerYaw);
      const rightZ = -Math.sin(playerYaw);
      const dotRight = wInfo.dirX * rightX + wInfo.dirZ * rightZ;
      panVal = Math.max(-0.6, Math.min(0.6, dotRight * 0.65));
    }

    if (this.waterPanner) {
      this.waterPanner.pan.setTargetAtTime(panVal, now, 0.15);
    }

    // Smooth proximity attenuation (audible up to 80m, loud & immersive by the river/bridge/lake)
    const proximity = Math.pow(Math.max(0, 1 - waterDist3D / 80), 1.45);
    const targetWaterVol = Math.min(0.78, 0.1 + proximity * 0.68);

    if (this.waterSampleSource && this.waterSampleGain) {
      this.waterSampleGain.gain.setTargetAtTime(targetWaterVol, now, 0.2);
      this.waterAmbGain?.gain.setTargetAtTime(0, now, 0.2);
    } else if (this.waterAmbGain) {
      this.waterAmbGain.gain.setTargetAtTime(targetWaterVol * 0.35, now, 0.25);
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.65, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  public playShoot(): void {
    if (this.isMuted || !this.ctx || !this.saturator || !this.reverbSend || !this.dryBus) return;
    const now = this.ctx.currentTime;

    // Play uploaded Machine Gun / Carbine SFX (dragon-studio-machine-gun-sfx-631486_353e9571.mp3)
    if (this.shootBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.shootBuffer;
      // Slight pitch jitter so rapid fire sounds organic and weighty
      src.playbackRate.value = 0.96 + Math.random() * 0.08;

      const shotGain = this.ctx.createGain();
      // Slice the crisp first shot transient + outdoor echo tail (0.0s .. 0.44s)
      shotGain.gain.setValueAtTime(0.95, now);
      shotGain.gain.setValueAtTime(0.92, now + 0.14);
      shotGain.gain.exponentialRampToValueAtTime(0.002, now + 0.44);

      const revSendGain = this.ctx.createGain();
      revSendGain.gain.value = 0.35;

      src.connect(shotGain);
      shotGain.connect(this.dryBus);
      shotGain.connect(revSendGain);
      revSendGain.connect(this.reverbSend);

      src.start(now, 0, 0.45);
    } else {
      // Procedural fallback if fired before MP3 finishes decoding
      const rate = this.ctx.sampleRate;
      const bufLen = Math.floor(rate * 0.18);
      const noiseBuffer = this.ctx.createBuffer(1, bufLen, rate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        const t = i / bufLen;
        output[i] = (Math.random() * 2 - 1) * Math.exp(-t * 4.8);
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.95, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.008, now + 0.17);
      noise.connect(noiseGain);
      noiseGain.connect(this.saturator);
      noise.start(now);
    }

    // Subtle Ejected Brass Shell Casing Ground Bounce Ping (+380ms & +490ms)
    [0.38, 0.49].forEach((delay, bIdx) => {
      if (!this.ctx || !this.dryBus) return;
      const t = now + delay + (Math.random() - 0.5) * 0.03;
      const pingOsc = this.ctx.createOscillator();
      const pingGain = this.ctx.createGain();
      pingOsc.type = 'sine';
      const f = (bIdx === 0 ? 6400 : 7100) + (Math.random() - 0.5) * 400;
      pingOsc.frequency.setValueAtTime(f, t);
      pingOsc.frequency.exponentialRampToValueAtTime(f * 0.88, t + 0.035);
      pingGain.gain.setValueAtTime(bIdx === 0 ? 0.055 : 0.03, t);
      pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
      pingOsc.connect(pingGain);
      pingGain.connect(this.dryBus);
      pingOsc.start(t);
      pingOsc.stop(t + 0.04);
    });
  }

  public playFootstep(surface: 'wood' | 'stone' | 'grass' | 'dirt'): void {
    if (this.isMuted || !this.ctx || !this.dryBus) return;
    const now = this.ctx.currentTime;
    const rate = this.ctx.sampleRate;

    if (surface === 'wood') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const pitch = 115 + (Math.random() - 0.5) * 18;
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.exponentialRampToValueAtTime(46, now + 0.085);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.004, now + 0.09);
      osc.connect(gain);
      gain.connect(this.dryBus);
      osc.start(now);
      osc.stop(now + 0.095);
      return;
    }

    const dur = surface === 'stone' ? 0.045 : 0.075;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value =
      surface === 'stone' ? 1650 : surface === 'dirt' ? 1150 : 760;
    filter.Q.value = surface === 'stone' ? 2.4 : 1.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(surface === 'stone' ? 0.22 : 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.dryBus);
    src.start(now);
  }

  public playSurfaceImpact(isWater: boolean, isHardSurface: boolean): void {
    if (this.isMuted || !this.ctx || !this.dryBus || !this.reverbSend) return;
    if (isWater) {
      this.playWaterSplash();
      return;
    }
    const now = this.ctx.currentTime;
    if (isHardSurface && Math.random() < 0.45) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const startF = 1900 + Math.random() * 700;
      osc.frequency.setValueAtTime(startF, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.002, now + 0.15);
      osc.connect(gain);
      gain.connect(this.reverbSend);
      osc.start(now);
      osc.stop(now + 0.155);
    }
  }

  public playEmptyClick(): void {
    if (this.isMuted || !this.ctx || !this.dryBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1050, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.03);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.035);
    osc.connect(gain);
    gain.connect(this.dryBus);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playReload(): void {
    if (this.isMuted || !this.ctx || !this.dryBus) return;
    const now = this.ctx.currentTime;

    // Play uploaded Gun Reload SFX (dragon-studio-gun-reload-2-511308_c1acdf30.mp3)
    if (this.reloadBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.reloadBuffer;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.92;
      src.connect(gain);
      gain.connect(this.dryBus);
      if (this.reverbSend) {
        const revSend = this.ctx.createGain();
        revSend.gain.value = 0.16;
        gain.connect(revSend);
        revSend.connect(this.reverbSend);
      }
      src.start(now);
      return;
    }

    // Procedural fallback if reload is triggered before MP3 finishes decoding
    const events = [
      { t: 0.04, f1: 680, f2: 310, dur: 0.06, type: 'triangle' as OscillatorType, vol: 0.25 },
      { t: 0.18, f1: 290, f2: 180, dur: 0.08, type: 'sine' as OscillatorType, vol: 0.2 },
      { t: 0.98, f1: 190, f2: 480, dur: 0.07, type: 'sawtooth' as OscillatorType, vol: 0.28 },
      { t: 1.56, f1: 540, f2: 1120, dur: 0.065, type: 'sawtooth' as OscillatorType, vol: 0.26 },
    ];
    for (const ev of events) {
      const t = now + ev.t;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = ev.type;
      osc.frequency.setValueAtTime(ev.f1, t);
      osc.frequency.exponentialRampToValueAtTime(ev.f2, t + ev.dur);
      gain.gain.setValueAtTime(ev.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.004, t + ev.dur + 0.01);
      osc.connect(gain);
      gain.connect(this.dryBus);
      osc.start(t);
      osc.stop(t + ev.dur + 0.015);
    }
  }

  public playHit(isHeadshot: boolean): void {
    if (this.isMuted || !this.ctx || !this.dryBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isHeadshot ? 'sine' : 'triangle';
    const baseFreq = isHeadshot ? 1720 : 940;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.38, now + 0.065);
    gain.gain.setValueAtTime(isHeadshot ? 0.58 : 0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.075);
    osc.connect(gain);
    gain.connect(this.dryBus);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playHurt(): void {
    if (this.isMuted || !this.ctx || !this.saturator) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.19);
    gain.gain.setValueAtTime(0.75, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.21);
    osc.connect(gain);
    gain.connect(this.saturator);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playWaterSplash(): void {
    if (this.isMuted || !this.ctx || !this.dryBus || !this.reverbSend) return;
    const now = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.18);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI) * 0.65;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(480, now);
    filter.frequency.exponentialRampToValueAtTime(1180, now + 0.16);
    filter.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.34, now);
    gain.gain.exponentialRampToValueAtTime(0.008, now + 0.18);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.dryBus);
    gain.connect(this.reverbSend);
    noise.start(now);
  }

  public playLandingThud(): void {
    if (this.isMuted || !this.ctx || !this.saturator) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.21);
    gain.gain.setValueAtTime(0.82, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.22);
    osc.connect(gain);
    gain.connect(this.saturator);
    osc.start(now);
    osc.stop(now + 0.23);
  }

  public playPickup(isHealth: boolean): void {
    if (this.isMuted || !this.ctx || !this.dryBus) return;
    const now = this.ctx.currentTime;
    const notes = isHealth ? [523.25, 659.25, 783.99] : [440, 587.33];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.dryBus) return;
      const t = now + i * 0.065;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.32, t);
      gain.gain.exponentialRampToValueAtTime(0.005, t + 0.12);
      osc.connect(gain);
      gain.connect(this.dryBus);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }

  public playWaveStart(): void {
    if (this.isMuted || !this.ctx || !this.reverbSend || !this.dryBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(196, now);
    osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.42);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.48);
    osc.connect(gain);
    gain.connect(this.dryBus);
    gain.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

// ============================================================================
// 2. PLAYER CLASS (Terrain Snap, Slopes, Shallow/Deep Water, Spatial Colliders)
// ============================================================================
export class Player {
  public position = new THREE.Vector3(0, 3.0, 95);
  public velocity = new THREE.Vector3();
  public yaw = 0; // Facing North (-Z) along the winding road
  public pitch = 0;
  public readonly eyeHeight = 1.7;
  public readonly radius = 0.46;
  public hp = 100;
  public readonly maxHp = 100;
  public isGrounded = true;
  public isSprinting = false;
  public isMoving = false;
  public inShallowWater = false;
  public currentSlope = 0;
  public recoilPitch = 0;

  private peakAirFeetY = 0;
  private splashTimer = 0;
  private footstepTimer = 0;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  public reset(map: MossyHollowMap): void {
    const sx = CONFIG.PLAYER_SPAWN.x;
    const sz = CONFIG.PLAYER_SPAWN.z;
    const groundY = map.getSupportHeightAt(sx, sz, 5);
    this.position.set(sx, groundY + this.eyeHeight, sz);
    this.velocity.set(0, 0, 0);
    this.yaw = 0; // Facing North (-Z)
    this.pitch = 0;
    this.recoilPitch = 0;
    this.hp = this.maxHp;
    this.isGrounded = true;
    this.isSprinting = false;
    this.isMoving = false;
    this.inShallowWater = false;
    this.peakAirFeetY = groundY;
  }

  public onMouseMove(movementX: number, movementY: number, adsBlend = 0, worldFov = 75): void {
    const fovRatio =
      Math.tan(THREE.MathUtils.degToRad(worldFov * 0.5)) /
      Math.tan(THREE.MathUtils.degToRad(75 * 0.5));
    const scopedMult = THREE.MathUtils.lerp(1.0, Math.max(0.24, fovRatio * 1.08), adsBlend);
    const sensitivity = 0.0021 * scopedMult;
    this.yaw -= movementX * sensitivity;
    this.pitch -= movementY * sensitivity;
    const maxPitch = Math.PI / 2 - 0.08;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);
  }

  public addRecoil(amount: number): void {
    this.recoilPitch = Math.min(this.recoilPitch + amount, 0.14);
    this.yaw += (Math.random() - 0.5) * amount * 0.45;
  }

  public update(
    dt: number,
    keys: Record<string, boolean>,
    map: MossyHollowMap,
    camera: THREE.PerspectiveCamera,
    audio: AudioManager,
    onWaterStepRipple?: (x: number, z: number) => void,
    adsBlend = 0,
    gamepadMove?: { x: number; z: number; sprint: boolean; jump: boolean },
    onHardLanding?: () => void
  ): void {
    const fovRatio =
      Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) /
      Math.tan(THREE.MathUtils.degToRad(75 * 0.5));
    const lookSpeed = 1.85 * THREE.MathUtils.lerp(1.0, Math.max(0.25, fovRatio * 1.1), adsBlend);
    if (keys['ArrowLeft']) this.yaw += lookSpeed * dt;
    if (keys['ArrowRight']) this.yaw -= lookSpeed * dt;
    if (keys['ArrowUp'])
      this.pitch = Math.min(Math.PI / 2 - 0.08, this.pitch + lookSpeed * 0.7 * dt);
    if (keys['ArrowDown'])
      this.pitch = Math.max(-Math.PI / 2 + 0.08, this.pitch - lookSpeed * 0.7 * dt);

    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 12, dt);

    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    _wishDir.set(0, 0, 0);
    if (keys['KeyW']) _wishDir.add(_forward);
    if (keys['KeyS']) _wishDir.sub(_forward);
    if (keys['KeyD']) _wishDir.add(_right);
    if (keys['KeyA']) _wishDir.sub(_right);

    if (gamepadMove && (Math.abs(gamepadMove.x) > 0.001 || Math.abs(gamepadMove.z) > 0.001)) {
      _wishDir.addScaledVector(_right, gamepadMove.x);
      _wishDir.addScaledVector(_forward, -gamepadMove.z);
    }

    const wishLen = _wishDir.length();
    this.isMoving = wishLen > 0.03;
    const analogThrottle = this.isMoving ? Math.min(1.0, wishLen) : 0;
    if (this.isMoving) _wishDir.divideScalar(wishLen);

    const sprintInput = Boolean(
      keys['ShiftLeft'] || keys['ShiftRight'] || (gamepadMove && gamepadMove.sprint)
    );
    this.isSprinting = this.isMoving && analogThrottle > 0.55 && sprintInput && adsBlend < 0.25;
    let moveSpeed =
      (this.isSprinting ? 11.4 : 7.5 * analogThrottle) *
      THREE.MathUtils.lerp(1.0, 0.72, adsBlend);

    // Sample terrain slope & water depth (ignore underlying bank slope while standing on a bridge/deck)
    const feetY = this.position.y - this.eyeHeight;
    const terrainY = map.getHeightAt(this.position.x, this.position.z);
    const supportY = map.getSupportHeightAt(this.position.x, this.position.z, feetY);
    const onElevatedStructure = supportY > terrainY + 0.12;
    this.currentSlope = onElevatedStructure ? 0 : map.getSlopeAt(this.position.x, this.position.z);

    // Section 9: Slopes between 30° and 45° reduce speed; > 45° slides player back
    if (this.currentSlope > 30 && this.currentSlope <= 45) {
      const slowFactor = 1.0 - ((this.currentSlope - 30) / 15) * 0.48;
      moveSpeed *= slowFactor;
    }

    // Section 6: Shallow water (depth < 1.2) slows speed x0.6 with splash sounds & water ripples
    const waterDepth = CONFIG.WATER_LEVEL - supportY;
    this.inShallowWater = waterDepth > 0.05 && waterDepth <= 1.25;
    if (this.inShallowWater) {
      moveSpeed *= 0.6;
      // Physical downstream water current drift when wading in the river
      const flowInfo = map.getWaterFlowAndDist(this.position.x, this.position.z);
      if (flowInfo.isRiver && waterDepth > 0.18) {
        this.velocity.x += flowInfo.flowX * flowInfo.speed * 4.5 * dt;
        this.velocity.z += flowInfo.flowZ * flowInfo.speed * 4.5 * dt;
      }
      if (this.isMoving && this.isGrounded) {
        this.splashTimer -= dt;
        if (this.splashTimer <= 0) {
          this.splashTimer = this.isSprinting ? 0.34 : 0.48;
          audio.playWaterSplash();
          if (onWaterStepRipple) {
            onWaterStepRipple(this.position.x, this.position.z);
          }
        }
      }
    } else if (this.isMoving && this.isGrounded) {
      // Biome-aware dry footsteps (Wooden Bridge/Dock, Stone, Dirt Road, or Grass)
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = this.isSprinting ? 0.29 : 0.44;
        const onStructure = supportY > terrainY + 0.18;
        const bioId = map.getBiomeAt(this.position.x, this.position.z).id;
        const surface: 'wood' | 'stone' | 'grass' | 'dirt' = onStructure
          ? 'wood'
          : bioId === 4 || bioId === 5
          ? 'stone'
          : bioId === 1 || bioId === 6
          ? 'dirt'
          : 'grass';
        audio.playFootstep(surface);
      }
    }

    const targetVx = _wishDir.x * moveSpeed;
    const targetVz = _wishDir.z * moveSpeed;
    const accel = this.isGrounded ? 15 : 6;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVx, accel, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVz, accel, dt);

    // Steep slope (> 45°) slide-back force
    if (this.isGrounded && this.currentSlope > 45) {
      map.getNormalAt(this.position.x, this.position.z, _slopeNormal);
      this.velocity.x += _slopeNormal.x * 18.0 * dt;
      this.velocity.z += _slopeNormal.z * 18.0 * dt;
    }

    // Jump & Gravity
    const jumpPressed = Boolean(keys['Space'] || (gamepadMove && gamepadMove.jump));
    if (jumpPressed && this.isGrounded && this.currentSlope <= 45) {
      this.velocity.y = 9.2;
      this.isGrounded = false;
      this.peakAirFeetY = feetY;
    }

    this.velocity.y -= 24.0 * dt;

    // Save previous XZ in case deep water or steep cliff pushes back
    const prevX = this.position.x;
    const prevZ = this.position.z;

    // Move X & resolve spatial grid colliders
    this.position.x += this.velocity.x * dt;
    this.resolveSpatialCollisions(map, 'x');

    // Move Z & resolve spatial grid colliders
    this.position.z += this.velocity.z * dt;
    this.resolveSpatialCollisions(map, 'z');

    // Check new support height for deep water (depth > 1.2) or extreme cliff block
    const nextSupportY = map.getSupportHeightAt(this.position.x, this.position.z, feetY);
    const nextDepth = CONFIG.WATER_LEVEL - nextSupportY;
    if (nextDepth > 1.22) {
      // Deep water pushback
      this.position.x = prevX;
      this.position.z = prevZ;
      this.velocity.x *= -0.25;
      this.velocity.z *= -0.25;
    }

    // Vertical movement & smooth terrain snap
    this.position.y += this.velocity.y * dt;
    const currentFeet = this.position.y - this.eyeHeight;
    if (!this.isGrounded && currentFeet > this.peakAirFeetY) {
      this.peakAirFeetY = currentFeet;
    }

    const finalSupportY = map.getSupportHeightAt(this.position.x, this.position.z, currentFeet);
    const targetEyeY = finalSupportY + this.eyeHeight;

    if (this.position.y <= targetEyeY + (this.isGrounded && this.velocity.y <= 0 ? 0.32 : 0.02)) {
      if (!this.isGrounded) {
        const fallHeight = this.peakAirFeetY - finalSupportY;
        if (fallHeight > 3.0) {
          audio.playLandingThud();
          if (onHardLanding) onHardLanding();
        }
      }
      // Smooth interpolation on slopes while grounded
      if (this.isGrounded) {
        this.position.y = THREE.MathUtils.damp(this.position.y, targetEyeY, 24, dt);
      } else {
        this.position.y = targetEyeY;
      }
      this.velocity.y = 0;
      this.isGrounded = true;
      this.peakAirFeetY = finalSupportY;
    } else {
      this.isGrounded = false;
    }

    // Soft map boundary clamp (-115 to +115 inside mountain rim)
    const limit = CONFIG.HALF_SIZE - 5.0;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -limit, limit);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -limit, limit);

    // Sync camera
    camera.position.copy(this.position);
    this.euler.set(
      THREE.MathUtils.clamp(
        this.pitch + this.recoilPitch,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05
      ),
      this.yaw,
      0,
      'YXZ'
    );
    camera.quaternion.setFromEuler(this.euler);
  }

  private resolveSpatialCollisions(map: MossyHollowMap, axis: 'x' | 'z'): void {
    const feetY = this.position.y - this.eyeHeight + 0.25;
    const headY = this.position.y + 0.1;
    const nearby = map.getNearbyColliders(this.position.x, this.position.z);

    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      if (headY < c.minY || feetY > c.maxY - 0.15) continue;

      if (c.type === 'cylinder') {
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const distSq = dx * dx + dz * dz;
        const minR = this.radius + c.r;
        if (distSq < minR * minR && distSq > 0.00001) {
          const dist = Math.sqrt(distSq);
          const overlap = minR - dist;
          this.position.x += (dx / dist) * overlap;
          this.position.z += (dz / dist) * overlap;
        }
      } else {
        if (c.isRamp) continue; // Ramps are walked onto smoothly via getSupportHeightAt
        if (c.yaw) {
          const dx = this.position.x - c.cx;
          const dz = this.position.z - c.cz;
          const cosY = Math.cos(c.yaw);
          const sinY = Math.sin(c.yaw);
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;
          const hw = c.w * 0.5;
          const hd = c.d * 0.5;
          const clampedX = THREE.MathUtils.clamp(lx, -hw, hw);
          const clampedZ = THREE.MathUtils.clamp(lz, -hd, hd);
          const diffX = lx - clampedX;
          const diffZ = lz - clampedZ;
          const distSq = diffX * diffX + diffZ * diffZ;
          if (distSq < this.radius * this.radius) {
            let pushLx = 0;
            let pushLz = 0;
            if (distSq > 0.00001) {
              const dist = Math.sqrt(distSq);
              const overlap = this.radius - dist;
              pushLx = (diffX / dist) * overlap;
              pushLz = (diffZ / dist) * overlap;
            } else {
              const penX = hw - Math.abs(lx);
              const penZ = hd - Math.abs(lz);
              if (penX < penZ) {
                pushLx = (lx >= 0 ? 1 : -1) * (penX + this.radius);
              } else {
                pushLz = (lz >= 0 ? 1 : -1) * (penZ + this.radius);
              }
            }
            this.position.x += pushLx * cosY + pushLz * sinY;
            this.position.z += -pushLx * sinY + pushLz * cosY;
          }
        } else if (
          this.position.x + this.radius > c.minX &&
          this.position.x - this.radius < c.maxX &&
          this.position.z + this.radius > c.minZ &&
          this.position.z - this.radius < c.maxZ
        ) {
          if (axis === 'x') {
            this.position.x =
              this.position.x < c.cx ? c.minX - this.radius : c.maxX + this.radius;
            this.velocity.x = 0;
          } else {
            this.position.z =
              this.position.z < c.cz ? c.minZ - this.radius : c.maxZ + this.radius;
            this.velocity.z = 0;
          }
        }
      }
    }
  }
}

// ============================================================================
// 3. WEAPON CLASS (Uploaded Arm3.fbx First-Person Arms & Suppressed ACR Rifle,
//    20-Texture PBR Material Pipeline, 8-Clip Skeletal Animation State Machine,
//    Adaptive Shoot/OneShot Firing, F-Key Inspect & Right-Click EOTech ADS)
// ============================================================================
type WeaponAnimState = 'DRAW' | 'IDLE' | 'WALK' | 'RUN' | 'SHOOT' | 'RELOAD' | 'INSPECT';
type ClipKey = 'Idle' | 'Walk' | 'Run' | 'Shoot' | 'OneShot' | 'Reload' | 'Draw' | 'Inspect';

const NEUTRAL_NORMAL_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

export class Weapon {
  public readonly group = new THREE.Group();
  public magAmmo = 30;
  public readonly maxMagAmmo = 30;
  public reserveAmmo = 90;
  public isReloading = false;
  public reloadTimer = 0;
  // Matches Armature|Arms_FPS_Anim_Reload_Fast exact duration (1.652s)
  public readonly reloadDuration = 1.65;

  public static readonly SCOPE_ZOOM_LEVELS = [2.0, 3.0, 4.0] as const;

  public isAds = false;
  public adsBlend = 0;
  private scopeZoomIndex = 0;

  private fireCooldown = 0;
  private readonly fireInterval = 0.115; // ~8.7 RPS ACR cyclic rate
  private timeSinceLastShot = 1.0;

  private recoilZ = 0;
  private recoilRotX = 0;
  private gunShakeX = 0;
  private gunShakeY = 0;
  private gunShakeRoll = 0;
  private adsBobTime = 0;
  private swayX = 0;
  private swayY = 0;
  private muzzleFlashTimer = 0;

  private muzzleLight: THREE.PointLight;
  private muzzleSprite: THREE.Sprite;
  private muzzleSideFlash: THREE.Mesh;

  // Skeletal FBX Rig & AnimationMixer State Machine
  private fbxModel: THREE.Group | null = null;
  private customReticleMesh: THREE.Mesh | null = null;
  private customReticleMat: THREE.MeshBasicMaterial | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<ClipKey, THREE.AnimationAction>> = {};
  private activeAction: THREE.AnimationAction | null = null;
  private currentAnimState: WeaponAnimState = 'IDLE';
  private scopeGlassMatRef: THREE.MeshStandardMaterial | null = null;

  private drawTimer = 0;
  private shootAnimTimer = 0;
  private inspectTimer = 0;

  // Hip-fire viewmodel pose (pulled back cleanly for the 54° viewmodel pass so open shoulder cuffs stay off-screen)
  private readonly hipPos = new THREE.Vector3(-0.008, -0.208, 0.065);
  private readonly hipRot = new THREE.Euler(0.0, 0.0, 0.0);

  // Exact ADS pose aligning our custom EOTech holographic reticle & barrel dead-center on camera (0, 0, -Z)
  private readonly adsPos = new THREE.Vector3(-0.05655, -0.23246, 0.07429);
  private readonly adsRot = new THREE.Euler(0.00984, 0.00963, -0.02796);

  // Muzzle flash coordinates at the ACR suppressor tip in group local space
  private readonly hipMuzzlePos = new THREE.Vector3(0.0554, 0.1303, -1.10);
  private readonly adsMuzzlePos = new THREE.Vector3(0.0554, 0.1303, -1.10);

  public get scopeZoom(): number {
    return Weapon.SCOPE_ZOOM_LEVELS[this.scopeZoomIndex];
  }

  public cycleScopeZoom(): void {
    this.scopeZoomIndex = (this.scopeZoomIndex + 1) % Weapon.SCOPE_ZOOM_LEVELS.length;
  }

  public stepScopeZoom(direction: 1 | -1): void {
    this.scopeZoomIndex = THREE.MathUtils.clamp(
      this.scopeZoomIndex + direction,
      0,
      Weapon.SCOPE_ZOOM_LEVELS.length - 1
    );
  }

  constructor(camera: THREE.Camera) {
    // Dedicated soft local weapon fill lights so the PBR arms & ACR receiver gleam in shadowed valleys
    const weaponTopFill = new THREE.PointLight(0xfff7ed, 0.85, 2.2);
    weaponTopFill.position.set(-0.12, 0.28, -0.22);
    this.group.add(weaponTopFill);

    const weaponRimFill = new THREE.PointLight(0xbae6fd, 0.45, 1.8);
    weaponRimFill.position.set(0.24, -0.05, -0.45);
    this.group.add(weaponRimFill);

    // Multi-Lobe Starburst Muzzle Flash (Sprite + 3D Side Suppressor Gas Jet)
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 128;
    flashCanvas.height = 128;
    const fCtx = flashCanvas.getContext('2d')!;
    const grad = fCtx.createRadialGradient(64, 64, 3, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255, 255, 245, 1)');
    grad.addColorStop(0.3, 'rgba(253, 224, 71, 0.95)');
    grad.addColorStop(0.65, 'rgba(249, 115, 22, 0.55)');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    fCtx.fillStyle = grad;
    fCtx.fillRect(0, 0, 128, 128);
    fCtx.fillStyle = 'rgba(255, 251, 235, 0.85)';
    for (let a = 0; a < 6; a++) {
      fCtx.save();
      fCtx.translate(64, 64);
      fCtx.rotate((a * Math.PI) / 3);
      fCtx.beginPath();
      fCtx.moveTo(-6, 0);
      fCtx.lineTo(0, -62);
      fCtx.lineTo(6, 0);
      fCtx.lineTo(0, 62);
      fCtx.closePath();
      fCtx.fill();
      fCtx.restore();
    }

    const flashTex = new THREE.CanvasTexture(flashCanvas);
    flashTex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: flashTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.muzzleSprite = new THREE.Sprite(spriteMat);
    this.muzzleSprite.scale.set(0.34, 0.34, 1);
    this.muzzleSprite.position.copy(this.hipMuzzlePos);
    this.muzzleSprite.visible = false;
    this.group.add(this.muzzleSprite);

    const sideJetGeo = new THREE.PlaneGeometry(0.32, 0.12);
    sideJetGeo.rotateX(Math.PI / 2);
    const sideJetMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.muzzleSideFlash = new THREE.Mesh(sideJetGeo, sideJetMat);
    this.muzzleSideFlash.position.copy(this.hipMuzzlePos);
    this.muzzleSideFlash.visible = false;
    this.group.add(this.muzzleSideFlash);

    this.muzzleLight = new THREE.PointLight(0xffb703, 0, 6.5, 2);
    this.muzzleLight.position.copy(this.hipMuzzlePos);
    this.group.add(this.muzzleLight);

    this.group.position.copy(this.hipPos);
    this.group.rotation.copy(this.hipRot);
    camera.add(this.group);

    this.loadFbxArmsAndRifle();
  }

  private loadFbxArmsAndRifle(): void {
    const texLoader = new THREE.TextureLoader();
    const loadTex = (url: string, isSRGB: boolean): THREE.Texture => {
      const t = texLoader.load(url);
      t.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    };

    // 1. Load PBR Texture Set from /textures/*
    const armMat = new THREE.MeshStandardMaterial({
      name: 'arms',
      map: loadTex('/textures/armColor.png', true),
      normalMap: loadTex('/textures/armNormal.png', false),
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: loadTex('/textures/armRoughness.png', false),
      roughness: 0.82,
      metalness: 0.04,
      aoMap: loadTex('/textures/armAO.png', false),
      aoMapIntensity: 0.7,
      emissive: new THREE.Color(0x22140e),
      emissiveIntensity: 0.07,
      side: THREE.DoubleSide,
    });

    const rifleMat = new THREE.MeshStandardMaterial({
      name: 'Rifle',
      map: loadTex('/textures/Rifle_albedo.jpeg', true),
      normalMap: loadTex('/textures/Rifle_normal.jpeg', false),
      roughnessMap: loadTex('/textures/Rifle_roughness.jpeg', false),
      roughness: 0.85,
      metalnessMap: loadTex('/textures/Rifle_metallic.jpeg', false),
      metalness: 0.85,
      aoMap: loadTex('/textures/Rifle_AO.jpeg', false),
      aoMapIntensity: 0.8,
      emissive: new THREE.Color(0x0f172a),
      emissiveIntensity: 0.08,
    });

    const silencerMat = new THREE.MeshStandardMaterial({
      name: 'Silencer',
      map: loadTex('/textures/Silencer_albedo.jpeg', true),
      normalMap: loadTex('/textures/Silencer_normal.jpeg', false),
      roughnessMap: loadTex('/textures/Silencer_roughness.jpeg', false),
      roughness: 0.85,
      metalnessMap: loadTex('/textures/Silencer_metallic.jpeg', false),
      metalness: 0.85,
      emissive: new THREE.Color(0x0f172a),
      emissiveIntensity: 0.08,
    });

    // Opaque EOTech Housing (clean PBR finish without lossy JPEG emissive block bleed)
    const scopeMat = new THREE.MeshStandardMaterial({
      name: 'Scope',
      map: loadTex('/textures/Scope_albedo.jpeg', true),
      normalMap: loadTex('/textures/ACRSketchfab_Scope_Normal.tga.png', false),
      roughnessMap: loadTex('/textures/Scope_roughness.jpeg', false),
      roughness: 0.82,
      metalnessMap: loadTex('/textures/Scope_metallic.jpeg', false),
      metalness: 0.85,
      emissive: new THREE.Color(0x0f172a),
      emissiveIntensity: 0.08,
      transparent: false,
      depthWrite: true,
    });

    // Crystal-Clear Anti-Reflective EOTech Optical Glass Lens (materialIndex 5)
    const scopeGlassMat = new THREE.MeshStandardMaterial({
      name: 'ScopeGlass',
      color: new THREE.Color(0x7dd3fc),
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.scopeGlassMatRef = scopeGlassMat;

    const pmagMat = new THREE.MeshStandardMaterial({
      name: 'Pmag',
      map: loadTex('/textures/Pmag_albedo.jpeg', true),
      normalMap: loadTex('/textures/Pmag_normal.jpeg', false),
      roughnessMap: loadTex('/textures/Pmag_roughness.jpeg', false),
      roughness: 0.85,
      metalnessMap: loadTex('/textures/Pmag_metallic.jpeg', false),
      metalness: 0.85,
      emissive: new THREE.Color(0x0f172a),
      emissiveIntensity: 0.08,
    });

    // 2. Intercept legacy embedded FBX paths (e.g. foregrip_normal.tga) so FBXLoader is warning-free
    const fbxManager = new THREE.LoadingManager();
    fbxManager.setURLModifier((url) => {
      if (url.endsWith('.fbx')) return url;
      return NEUTRAL_NORMAL_DATA_URI;
    });

    const loader = new FBXLoader(fbxManager);
    const clipsPromise: Promise<THREE.AnimationClip[] | null> = fetch('/source/Arm3_clips.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((rawClips) =>
        Array.isArray(rawClips) ? rawClips.map((c) => THREE.AnimationClip.parse(c)) : null
      )
      .catch(() => null);

    loader.load(
      '/source/Arm3.fbx',
      (fbx) => {
        // Convert cm -> meters (0.01) and rotate 180° around Y so +Z rifle barrel faces -Z camera forward
        fbx.scale.setScalar(0.01);
        fbx.rotation.set(0, Math.PI, 0);

        let rifleBone: THREE.Object3D | null = null;
        fbx.traverse((child) => {
          if ((child as THREE.Bone).isBone && child.name === 'ACRRifle') {
            rifleBone = child;
          }
          const mesh = child as THREE.SkinnedMesh;
          if (!mesh.isMesh) return;

          // Prevent skinned meshes from disappearing when skeletal bones animate outside bind-pose bounds
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.receiveShadow = false;

          const geom = mesh.geometry as THREE.BufferGeometry;
          if (geom && geom.attributes.uv && !geom.attributes.uv2) {
            geom.setAttribute('uv2', geom.attributes.uv);
          }

          if (mesh.name === 'arms') {
            mesh.material = armMat;
            // Rename SkinnedMesh so THREE.PropertyBinding never confuses a mesh with a skeletal Bone
            mesh.name = 'arms_Mesh';
          } else if (mesh.name === 'ACRRifle') {
            // Strip the pre-existing FBX reticle ring completely and keep only solid housing (2) + optical glass (5)
            this.partitionScopeGlassGeometry(geom);
            mesh.material = [
              rifleMat,     // 0: Rifle
              silencerMat,  // 1: Silencer
              scopeMat,     // 2: Scope Opaque Housing
              pmagMat,      // 3: Foregrip
              pmagMat,      // 4: Pmag
              scopeGlassMat // 5: Scope Optical Glass Panes (6 triangles)
            ];
            // CRITICAL: Rename the SkinnedMesh from 'ACRRifle' to 'ACRRifle_Mesh' before creating
            // THREE.AnimationMixer(fbx) so PropertyBinding.findNode(fbx, 'ACRRifle') binds
            // 'ACRRifle.position' and 'ACRRifle.quaternion' to the skeletal Bone 'ACRRifle' inside Armature!
            mesh.name = 'ACRRifle_Mesh';
          }
        });

        // Mount our crisp custom holographic crosshair inside the EOTech glass on the ACRRifle skeletal bone
        // so it moves, shakes, breathes, sways, and recoils 1:1 with the rifle on every animation frame
        if (rifleBone) {
          this.customReticleMesh = this.createCustomReticleMesh();
          (rifleBone as THREE.Object3D).add(this.customReticleMesh);
        }

        this.fbxModel = fbx;
        this.group.add(fbx);

        // 3. Initialize Skeletal AnimationMixer & Bind All 8 Synchronized Clips
        this.mixer = new THREE.AnimationMixer(fbx);
        const clipMap: Record<ClipKey, string> = {
          Idle: 'Arms_FPS_Anim_Idle',
          Walk: 'Arms_FPS_Anim_Walk',
          Run: 'Arms_FPS_Anim_Run',
          Shoot: 'Arms_FPS_Anim_Shoot',
          OneShot: 'Arms_FPS_Anim_OneShot',
          Reload: 'Arms_FPS_Anim_Reload_Fast',
          Draw: 'Arms_FPS_Anim_Draw',
          Inspect: 'Arms_FPS_Anim_rifle_inspect',
        };

        clipsPromise.then((syncedClips) => {
          const sourceClips = syncedClips && syncedClips.length > 0 ? syncedClips : fbx.animations;
          (Object.keys(clipMap) as ClipKey[]).forEach((key) => {
            const targetSuffix = clipMap[key];
            const clip = sourceClips.find((a) => a.name.includes(targetSuffix));
            if (clip && this.mixer) {
              const action = this.mixer.clipAction(clip);
              if (key === 'Idle' || key === 'Walk' || key === 'Run') {
                action.setLoop(THREE.LoopRepeat, Infinity);
              } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              this.actions[key] = action;
            }
          });

          // Start with Draw animation automatically on spawn
          this.playDraw();
        });
      },
      undefined,
      (err) => {
        console.error('Failed to load Arm3.fbx:', err);
      }
    );
  }

  /**
   * Builds a high-resolution custom holographic reticle mesh aligned to the EOTech glass plane
   * inside the ACRRifle bone so it shakes, breathes, sways, and recoils directly with the rifle.
   */
  private createCustomReticleMesh(): THREE.Mesh {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const cy = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Subtle soft crimson-amber holographic glow behind crisp foreground reticle lines
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 52, 24, 0.92)';
    ctx.shadowBlur = 12;

    // 1. Segmented 65-MOA outer tactical ring (4 crisp arcs)
    const ringRadius = 126;
    ctx.strokeStyle = 'rgba(255, 62, 30, 0.95)';
    ctx.lineWidth = 7;
    const arcGap = 0.24;
    for (let q = 0; q < 4; q++) {
      const startAngle = q * (Math.PI / 2) + arcGap;
      const endAngle = (q + 1) * (Math.PI / 2) - arcGap;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, startAngle, endAngle);
      ctx.stroke();
    }

    // 2. Crisp cardinal stadia ticks pointing toward center dot
    ctx.lineWidth = 6.5;
    const outerTick = 166;
    const innerTick = 78;
    const cardinals: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dx, dy] of cardinals) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * outerTick, cy + dy * outerTick);
      ctx.lineTo(cx + dx * innerTick, cy + dy * innerTick);
      ctx.stroke();
    }

    // 3. Fine BDC elevation drop ticks along lower vertical stadia
    ctx.lineWidth = 4.5;
    for (const dropY of [42, 62]) {
      const halfW = dropY === 42 ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cy + dropY);
      ctx.lineTo(cx + halfW, cy + dropY);
      ctx.stroke();
    }

    // 4. Precision 1-MOA center aiming dot with hot core
    ctx.fillStyle = '#ff3b1f';
    ctx.beginPath();
    ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff5f2';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      name: 'CustomScopeReticle',
      map: tex,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.customReticleMat = mat;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.023, 0.023), mat);
    mesh.name = 'CustomScopeReticle';
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    // Exact local transform inside ACRRifle bone placing the custom reticle inside the EOTech glass
    mesh.position.set(-0.00096, 0.32247, 0.00652);
    mesh.quaternion.set(0.00108, -0.9766, 0.215, -0.00469);
    return mesh;
  }

  /**
   * Completely removes the pre-existing 192-triangle FBX reticle ring from rendered groups and
   * cleanly separates only the 6 flat EOTech optical glass pane triangles (materialIndex 5)
   * from the opaque EOTech housing (materialIndex 2).
   */
  private partitionScopeGlassGeometry(geom: THREE.BufferGeometry): void {
    const scopeGroupIdx = geom.groups.findIndex((g) => g.materialIndex === 2);
    if (scopeGroupIdx === -1) return;

    const scopeGrp = geom.groups[scopeGroupIdx];
    const uvAttr = geom.attributes.uv;
    const posAttr = geom.attributes.position;
    if (!uvAttr || !posAttr) return;

    const startVert = scopeGrp.start;
    const countVert = scopeGrp.count;
    const numTris = Math.floor(countVert / 3);

    const opaqueTris: number[] = [];
    const reticleTris: number[] = [];
    const glassTris: number[] = [];

    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const tri = new THREE.Triangle();

    for (let t = 0; t < numTris; t++) {
      const base = startVert + t * 3;
      const uxc = (uvAttr.getX(base) + uvAttr.getX(base + 1) + uvAttr.getX(base + 2)) / 3;
      const uyc = (uvAttr.getY(base) + uvAttr.getY(base + 1) + uvAttr.getY(base + 2)) / 3;

      p0.fromBufferAttribute(posAttr, base);
      p1.fromBufferAttribute(posAttr, base + 1);
      p2.fromBufferAttribute(posAttr, base + 2);
      const area = tri.set(p0, p1, p2).getArea();

      const inGlassUV =
        (uxc > 0.44 && uxc < 0.56 && uyc > 0.34 && uyc < 0.42) ||
        (uxc > 0.90 && uyc > 0.53 && uyc < 0.62);

      if (inGlassUV && area > 1.0) {
        glassTris.push(t);
      } else if (uxc > 0.86 && uyc > 0.24 && uyc < 0.40) {
        reticleTris.push(t);
      } else {
        opaqueTris.push(t);
      }
    }

    if (glassTris.length === 0 && reticleTris.length === 0) return;

    // Pack opaque housing + optical glass first; omit pre-existing reticleTris from drawn groups
    const orderedTris = [...opaqueTris, ...glassTris, ...reticleTris];
    const attrNames = Object.keys(geom.attributes);

    for (const name of attrNames) {
      const attr = geom.attributes[name] as THREE.BufferAttribute;
      const itemSize = attr.itemSize;
      const arr = attr.array as Float32Array | Uint16Array | Int32Array;
      const sliceCopy = arr.slice(startVert * itemSize, (startVert + countVert) * itemSize);

      for (let dstTri = 0; dstTri < numTris; dstTri++) {
        const srcTri = orderedTris[dstTri];
        const srcOffset = srcTri * 3 * itemSize;
        const dstOffset = (startVert + dstTri * 3) * itemSize;
        for (let k = 0; k < 3 * itemSize; k++) {
          arr[dstOffset + k] = sliceCopy[srcOffset + k];
        }
      }
      attr.needsUpdate = true;
    }

    const opaqueCount = opaqueTris.length * 3;
    const glassCount = glassTris.length * 3;

    const newGroups: { start: number; count: number; materialIndex: number }[] = [
      { start: startVert, count: opaqueCount, materialIndex: 2 },
    ];
    if (glassCount > 0) {
      newGroups.push({
        start: startVert + opaqueCount,
        count: glassCount,
        materialIndex: 5,
      });
    }

    geom.groups.splice(scopeGroupIdx, 1, ...newGroups);
  }

  public getReticleWorldPosition(out: THREE.Vector3): boolean {
    if (!this.customReticleMesh) return false;
    this.group.updateMatrixWorld(true);
    this.customReticleMesh.getWorldPosition(out);
    return true;
  }

  private crossfadeTo(
    nextState: WeaponAnimState,
    clipKey: ClipKey,
    fadeDuration: number,
    timeScale = 1.0,
    forceRestart = false
  ): void {
    const nextAction = this.actions[clipKey];
    if (!nextAction) return;

    if (!forceRestart && this.currentAnimState === nextState && this.activeAction === nextAction) {
      nextAction.setEffectiveTimeScale(timeScale);
      return;
    }

    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1.0);

    if (forceRestart || this.activeAction !== nextAction) {
      nextAction.reset();
    }

    if (this.activeAction && this.activeAction !== nextAction) {
      this.activeAction.crossFadeTo(nextAction, fadeDuration, false);
    }

    nextAction.play();
    this.activeAction = nextAction;
    this.currentAnimState = nextState;
  }

  public playDraw(): void {
    this.drawTimer = 0.567;
    this.shootAnimTimer = 0;
    this.inspectTimer = 0;
    this.crossfadeTo('DRAW', 'Draw', 0.06, 1.0, true);
  }

  public startInspect(): boolean {
    if (
      this.isReloading ||
      this.drawTimer > 0 ||
      this.shootAnimTimer > 0 ||
      this.isAds ||
      this.adsBlend > 0.2
    ) {
      return false;
    }
    this.inspectTimer = 2.65;
    this.crossfadeTo('INSPECT', 'Inspect', 0.16, 1.0, true);
    return true;
  }

  public setAds(active: boolean): void {
    this.isAds = active;
    if (active && this.inspectTimer > 0) {
      // Immediately cancel weapon inspect when entering ADS
      this.inspectTimer = 0;
    }
  }

  public onMouseMove(movementX: number, movementY: number): void {
    const swayScale = THREE.MathUtils.lerp(0.00018, 0.000055, this.adsBlend);
    this.swayX = THREE.MathUtils.clamp(this.swayX - movementX * swayScale, -0.018, 0.018);
    this.swayY = THREE.MathUtils.clamp(this.swayY + movementY * swayScale, -0.018, 0.018);
  }

  public reset(): void {
    this.magAmmo = this.maxMagAmmo;
    this.reserveAmmo = 90;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.timeSinceLastShot = 1.0;
    this.recoilZ = 0;
    this.recoilRotX = 0;
    this.gunShakeX = 0;
    this.gunShakeY = 0;
    this.gunShakeRoll = 0;
    this.adsBobTime = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.isAds = false;
    this.adsBlend = 0;
    this.scopeZoomIndex = 0;
    this.muzzleFlashTimer = 0;
    this.muzzleSprite.visible = false;
    this.muzzleSideFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.playDraw();
  }

  public startReload(audio: AudioManager): boolean {
    if (this.isReloading || this.magAmmo >= this.maxMagAmmo || this.reserveAmmo <= 0) {
      return false;
    }
    this.isReloading = true;
    this.reloadTimer = 0;
    this.inspectTimer = 0;
    this.shootAnimTimer = 0;
    this.drawTimer = 0;
    this.crossfadeTo('RELOAD', 'Reload', 0.14, 1.0, true);
    audio.playReload();
    return true;
  }

  public tryFire(audio: AudioManager): boolean {
    if (this.isReloading || this.drawTimer > 0.12) return false;
    if (this.fireCooldown > 0) return false;

    if (this.magAmmo <= 0) {
      this.fireCooldown = 0.25;
      audio.playEmptyClick();
      this.startReload(audio);
      return false;
    }

    this.magAmmo--;
    this.fireCooldown = this.fireInterval;

    // Cancel inspect or draw tail immediately on shot
    this.inspectTimer = 0;
    this.drawTimer = 0;

    // Adaptive Firing Animation:
    // Single tap / first shot of a burst uses OneShot (0.234s); sustained full-auto uses Shoot (0.150s)
    const isRapidAuto = this.timeSinceLastShot < 0.22;
    this.timeSinceLastShot = 0;

    if (isRapidAuto && this.actions.Shoot) {
      this.shootAnimTimer = 0.145;
      this.crossfadeTo('SHOOT', 'Shoot', 0.03, 1.15, true);
    } else if (this.actions.OneShot) {
      this.shootAnimTimer = 0.21;
      this.crossfadeTo('SHOOT', 'OneShot', 0.04, 1.08, true);
    }

    // Physical recoil & directional gun shake impulse mapped directly to custom scope reticle
    const adsRecoilZFactor = THREE.MathUtils.lerp(1.0, 0.45, this.adsBlend);
    const adsRecoilPitchFactor = THREE.MathUtils.lerp(1.0, 0.24, this.adsBlend);
    this.recoilZ = 0.022 * adsRecoilZFactor;
    this.recoilRotX = 0.032 * adsRecoilPitchFactor;

    const shakeScale = THREE.MathUtils.lerp(1.0, 0.42, this.adsBlend);
    this.gunShakeX = THREE.MathUtils.clamp(
      this.gunShakeX + (Math.random() - 0.5) * 0.0028 * shakeScale,
      -0.0045,
      0.0045
    );
    this.gunShakeY = THREE.MathUtils.clamp(
      this.gunShakeY + (0.0009 + Math.random() * 0.0014) * shakeScale,
      -0.004,
      0.0045
    );
    this.gunShakeRoll = THREE.MathUtils.clamp(
      this.gunShakeRoll + (Math.random() - 0.5) * 0.024 * shakeScale,
      -0.035,
      0.035
    );

    // Muzzle flash aligned with the ACR suppressor tip
    this.muzzleFlashTimer = 0.042;
    this.muzzleSprite.visible = true;
    this.muzzleSideFlash.visible = true;
    this.muzzleSprite.material.rotation = Math.random() * Math.PI * 2;
    this.muzzleSideFlash.rotation.z = (Math.random() - 0.5) * 0.4;
    const scale = (0.28 + Math.random() * 0.12) * THREE.MathUtils.lerp(1.0, 0.65, this.adsBlend);
    this.muzzleSprite.scale.set(scale, scale, 1);
    this.muzzleLight.intensity = 4.8;

    audio.playShoot();

    if (this.magAmmo === 0 && this.reserveAmmo > 0) {
      setTimeout(() => {
        if (this.magAmmo === 0 && !this.isReloading) {
          this.startReload(audio);
        }
      }, 150);
    }

    return true;
  }

  public update(dt: number, isMoving: boolean, isSprinting: boolean, isGrounded: boolean): void {
    this.timeSinceLastShot += dt;

    if (this.fireCooldown > 0) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }

    if (this.drawTimer > 0) {
      this.drawTimer = Math.max(0, this.drawTimer - dt);
    }

    if (this.shootAnimTimer > 0) {
      this.shootAnimTimer = Math.max(0, this.shootAnimTimer - dt);
    }

    if (this.inspectTimer > 0) {
      if (isSprinting || this.isAds) {
        this.inspectTimer = 0;
      } else {
        this.inspectTimer = Math.max(0, this.inspectTimer - dt);
      }
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleSprite.visible = false;
        this.muzzleSideFlash.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    // Handle Reload Progression (1.65s fast reload)
    if (this.isReloading) {
      this.reloadTimer += dt;
      if (this.reloadTimer >= this.reloadDuration) {
        const needed = this.maxMagAmmo - this.magAmmo;
        const transfer = Math.min(needed, this.reserveAmmo);
        this.magAmmo += transfer;
        this.reserveAmmo -= transfer;
        this.isReloading = false;
        this.reloadTimer = 0;
      }
    }

    // Smooth Scope ADS blend (disabled during reload, draw, or sprint)
    const canAds = this.isAds && !this.isReloading && this.drawTimer <= 0 && !isSprinting;
    this.adsBlend = THREE.MathUtils.damp(this.adsBlend, canAds ? 1.0 : 0.0, 14, dt);

    // Subtle sapphire glass clarity & luminous custom holographic reticle response when scoped
    if (this.scopeGlassMatRef) {
      this.scopeGlassMatRef.opacity = THREE.MathUtils.lerp(0.085, 0.04, this.adsBlend);
    }
    if (this.customReticleMat) {
      this.customReticleMat.opacity = THREE.MathUtils.lerp(0.84, 0.98, this.adsBlend);
    }

    // Update Muzzle Flash position between Hip-Fire and ADS suppressor tip
    this.muzzleSprite.position.lerpVectors(this.hipMuzzlePos, this.adsMuzzlePos, this.adsBlend);
    this.muzzleSideFlash.position.copy(this.muzzleSprite.position);
    this.muzzleLight.position.copy(this.muzzleSprite.position);

    // Select Skeletal Animation State when no high-priority one-shot clip is active
    if (
      this.drawTimer <= 0 &&
      !this.isReloading &&
      this.shootAnimTimer <= 0 &&
      this.inspectTimer <= 0
    ) {
      if (this.adsBlend > 0.45) {
        // Natural gentle breathing & movement sway while scoped so custom reticle rides the gun motion
        this.crossfadeTo('IDLE', 'Idle', 0.16, isMoving ? 0.65 : 0.38);
      } else if (isMoving && isGrounded) {
        if (isSprinting) {
          this.crossfadeTo('RUN', 'Run', 0.18, 1.0);
        } else {
          this.crossfadeTo('WALK', 'Walk', 0.18, 1.0);
        }
      } else {
        this.crossfadeTo('IDLE', 'Idle', 0.2, 1.0);
      }
    }

    if (this.mixer) {
      this.mixer.update(dt);
    }

    // Procedural ADS walk/idle micro-bob + damped recoil, gun shake & mouse look sway
    if (isMoving && isGrounded) {
      this.adsBobTime += dt * (isSprinting ? 11.5 : 8.2);
    } else {
      this.adsBobTime += dt * 1.9;
    }
    const bobAmp = (isMoving && isGrounded ? 0.0014 : 0.00035) * this.adsBlend;
    const bobX = Math.cos(this.adsBobTime * 0.5) * bobAmp;
    const bobY = Math.abs(Math.sin(this.adsBobTime)) * bobAmp * 0.75;

    this.recoilZ = THREE.MathUtils.damp(this.recoilZ, 0, 18, dt);
    this.recoilRotX = THREE.MathUtils.damp(this.recoilRotX, 0, 16, dt);
    this.gunShakeX = THREE.MathUtils.damp(this.gunShakeX, 0, 18, dt);
    this.gunShakeY = THREE.MathUtils.damp(this.gunShakeY, 0, 18, dt);
    this.gunShakeRoll = THREE.MathUtils.damp(this.gunShakeRoll, 0, 16, dt);
    this.swayX = THREE.MathUtils.damp(this.swayX, 0, 11, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, 0, 11, dt);

    // Interpolate base viewmodel transform between Hip-Fire and EOTech ADS
    const baseX = THREE.MathUtils.lerp(this.hipPos.x, this.adsPos.x, this.adsBlend);
    const baseY = THREE.MathUtils.lerp(this.hipPos.y, this.adsPos.y, this.adsBlend);
    const baseZ = THREE.MathUtils.lerp(this.hipPos.z, this.adsPos.z, this.adsBlend);

    const rotX = THREE.MathUtils.lerp(this.hipRot.x, this.adsRot.x, this.adsBlend);
    const rotY = THREE.MathUtils.lerp(this.hipRot.y, this.adsRot.y, this.adsBlend);
    const rotZ = THREE.MathUtils.lerp(this.hipRot.z, this.adsRot.z, this.adsBlend);

    this.group.position.set(
      baseX + this.swayX + this.gunShakeX + bobX,
      baseY + this.swayY + this.gunShakeY + bobY,
      baseZ + this.recoilZ
    );
    this.group.rotation.set(
      rotX + this.recoilRotX + this.swayY * 0.8 + this.gunShakeY * 2.2,
      rotY + this.swayX * 0.8 - this.gunShakeX * 2.4,
      rotZ - this.swayX * 1.1 + this.gunShakeRoll
    );
  }
}


// ============================================================================
// 4. REALISTIC MULTIPLAYER OPPONENT OPERATOR CHARACTER
//    (Articulated Tactical Soldier with Multi-Cam Ripstop BDU, Cordura Plate
//     Carrier, Ballistic FAST Helmet + Quad NVG, Suppressed Tactical Carbine,
//     Multi-Joint Locomotion, Aiming & Muzzle-Flash Firing, 2x Headshot)
// ============================================================================
interface OperatorSharedAssets {
  camoTex: THREE.CanvasTexture;
  corduraTex: THREE.CanvasTexture;
  helmetTex: THREE.CanvasTexture;
  bduMat: THREE.MeshStandardMaterial;
  vestMat: THREE.MeshStandardMaterial;
  pouchMat: THREE.MeshStandardMaterial;
  helmetMat: THREE.MeshStandardMaterial;
  balaclavaMat: THREE.MeshStandardMaterial;
  skinMat: THREE.MeshStandardMaterial;
  gloveMat: THREE.MeshStandardMaterial;
  bootMat: THREE.MeshStandardMaterial;
  padMat: THREE.MeshStandardMaterial;
  goggleLensMat: THREE.MeshStandardMaterial;
  nvgLensMat: THREE.MeshStandardMaterial;
  gunMetalMat: THREE.MeshStandardMaterial;
  gunPolymerMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  patchEmissiveMat: THREE.MeshStandardMaterial;
}

let _sharedOperatorAssets: OperatorSharedAssets | null = null;

function getSharedOperatorAssets(): OperatorSharedAssets {
  if (_sharedOperatorAssets) return _sharedOperatorAssets;

  // 1. Procedural Woodland Multi-Cam Ripstop Fabric Texture (256x256)
  const camoCanvas = document.createElement('canvas');
  camoCanvas.width = 256;
  camoCanvas.height = 256;
  const cCtx = camoCanvas.getContext('2d')!;
  cCtx.fillStyle = '#4c5344';
  cCtx.fillRect(0, 0, 256, 256);

  // Layered organic multi-cam blotches (coyote tan, dark olive, charcoal bark, sage)
  const palette = ['#383f32', '#615946', '#2b2e27', '#736c56', '#3f4a38'];
  let seed = 918273;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 140; i++) {
    cCtx.fillStyle = palette[i % palette.length];
    const cx = nextRand() * 256;
    const cy = nextRand() * 256;
    const rx = 10 + nextRand() * 26;
    const ry = 6 + nextRand() * 16;
    const rot = nextRand() * Math.PI;
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        cCtx.save();
        cCtx.translate(cx + ox, cy + oy);
        cCtx.rotate(rot);
        cCtx.beginPath();
        cCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        cCtx.fill();
        cCtx.restore();
      }
    }
  }
  // Fine ripstop crosshatch micro-grid
  cCtx.strokeStyle = 'rgba(15, 18, 14, 0.16)';
  cCtx.lineWidth = 1;
  for (let g = 0; g < 256; g += 4) {
    cCtx.beginPath();
    cCtx.moveTo(g, 0);
    cCtx.lineTo(g, 256);
    cCtx.moveTo(0, g);
    cCtx.lineTo(256, g);
    cCtx.stroke();
  }
  const camoTex = new THREE.CanvasTexture(camoCanvas);
  camoTex.colorSpace = THREE.SRGBColorSpace;
  camoTex.wrapS = THREE.RepeatWrapping;
  camoTex.wrapT = THREE.RepeatWrapping;
  camoTex.repeat.set(2, 2);

  // 2. Procedural 1000D Cordura Nylon & MOLLE Webbing Texture (256x256)
  const corduraCanvas = document.createElement('canvas');
  corduraCanvas.width = 256;
  corduraCanvas.height = 256;
  const vCtx = corduraCanvas.getContext('2d')!;
  vCtx.fillStyle = '#36332c';
  vCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    for (let x = 0; x < 256; x += 2) {
      const n = Math.floor((nextRand() - 0.5) * 18);
      vCtx.fillStyle = `rgb(${54 + n}, ${51 + n}, ${44 + n})`;
      vCtx.fillRect(x, y, 2, 2);
    }
  }
  // Horizontal PALS/MOLLE webbing straps & bar-tack stitching
  for (let row = 16; row < 256; row += 32) {
    vCtx.fillStyle = 'rgba(28, 26, 22, 0.55)';
    vCtx.fillRect(0, row, 256, 12);
    vCtx.fillStyle = 'rgba(85, 79, 66, 0.35)';
    vCtx.fillRect(0, row + 1, 256, 2);
    vCtx.fillStyle = 'rgba(18, 16, 13, 0.7)';
    for (let col = 12; col < 256; col += 24) {
      vCtx.fillRect(col, row - 1, 3, 14);
    }
  }
  const corduraTex = new THREE.CanvasTexture(corduraCanvas);
  corduraTex.colorSpace = THREE.SRGBColorSpace;
  corduraTex.wrapS = THREE.RepeatWrapping;
  corduraTex.wrapT = THREE.RepeatWrapping;

  // 3. Ballistic Matte Kevlar / Carbon-Weave Helmet Texture (128x128)
  const helmCanvas = document.createElement('canvas');
  helmCanvas.width = 128;
  helmCanvas.height = 128;
  const hCtx = helmCanvas.getContext('2d')!;
  hCtx.fillStyle = '#2d322b';
  hCtx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    for (let x = 0; x < 128; x += 2) {
      const diag = ((x + y) >> 1) & 1;
      const v = diag ? 49 : 41;
      hCtx.fillStyle = `rgb(${v}, ${v + 4}, ${v - 2})`;
      hCtx.fillRect(x, y, 2, 2);
    }
  }
  const helmetTex = new THREE.CanvasTexture(helmCanvas);
  helmetTex.colorSpace = THREE.SRGBColorSpace;
  helmetTex.wrapS = THREE.RepeatWrapping;
  helmetTex.wrapT = THREE.RepeatWrapping;
  helmetTex.repeat.set(3, 3);

  _sharedOperatorAssets = {
    camoTex,
    corduraTex,
    helmetTex,
    bduMat: new THREE.MeshStandardMaterial({
      color: 0xd8dfd0,
      map: camoTex,
      roughness: 0.86,
      metalness: 0.04,
    }),
    vestMat: new THREE.MeshStandardMaterial({
      color: 0xc8bfa8,
      map: corduraTex,
      roughness: 0.78,
      metalness: 0.08,
    }),
    pouchMat: new THREE.MeshStandardMaterial({
      color: 0x9b927e,
      map: corduraTex,
      roughness: 0.82,
      metalness: 0.05,
    }),
    helmetMat: new THREE.MeshStandardMaterial({
      color: 0xbac2b4,
      map: helmetTex,
      roughness: 0.52,
      metalness: 0.22,
    }),
    balaclavaMat: new THREE.MeshStandardMaterial({
      color: 0x1c1e1b,
      roughness: 0.92,
      metalness: 0.02,
    }),
    skinMat: new THREE.MeshStandardMaterial({
      color: 0xc6987a,
      roughness: 0.64,
      metalness: 0.02,
    }),
    gloveMat: new THREE.MeshStandardMaterial({
      color: 0x3b352c,
      roughness: 0.72,
      metalness: 0.08,
    }),
    bootMat: new THREE.MeshStandardMaterial({
      color: 0x26211b,
      roughness: 0.68,
      metalness: 0.12,
    }),
    padMat: new THREE.MeshStandardMaterial({
      color: 0x1b1e1b,
      roughness: 0.45,
      metalness: 0.28,
    }),
    goggleLensMat: new THREE.MeshStandardMaterial({
      color: 0x11161d,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.35,
      roughness: 0.14,
      metalness: 0.88,
    }),
    nvgLensMat: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0xdc2626,
      emissiveIntensity: 0.95,
      roughness: 0.12,
      metalness: 0.85,
    }),
    gunMetalMat: new THREE.MeshStandardMaterial({
      color: 0x22272e,
      roughness: 0.34,
      metalness: 0.86,
    }),
    gunPolymerMat: new THREE.MeshStandardMaterial({
      color: 0x16181b,
      roughness: 0.62,
      metalness: 0.22,
    }),
    brassMat: new THREE.MeshStandardMaterial({
      color: 0xb59449,
      roughness: 0.38,
      metalness: 0.78,
    }),
    patchEmissiveMat: new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
      roughness: 0.3,
      metalness: 0.1,
    }),
  };

  return _sharedOperatorAssets;
}

export class Enemy {
  public readonly group = new THREE.Group();
  public hp = 100;
  public readonly maxHp = 100;
  public speed = 4.6;
  public state: 'CHASING' | 'DYING' | 'DEAD' = 'CHASING';
  public hitFlashTimer = 0;
  public deathTimer = 0;
  public attackCooldown = 0;
  public readonly radius = 0.52;

  // Articulated upper/lower body & limb hierarchy for realistic tactical operator movement
  private pelvisGroup = new THREE.Group();
  private upperBodyPivot = new THREE.Group();
  private headPivot = new THREE.Group();
  private leftArmPivot = new THREE.Group();
  private leftForearmPivot = new THREE.Group();
  private rightArmPivot = new THREE.Group();
  private rightForearmPivot = new THREE.Group();
  private leftLegPivot = new THREE.Group();
  private leftShinPivot = new THREE.Group();
  private rightLegPivot = new THREE.Group();
  private rightShinPivot = new THREE.Group();
  private rifleGroup = new THREE.Group();
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashTimer = 0;
  private recoilKick = 0;

  private walkCycle = Math.random() * Math.PI * 2;
  private idleTime = Math.random() * 10.0;
  private pathTimer = Math.random() * 0.4;
  private waypointX = 0;
  private waypointZ = 0;

  private bodyMeshes: THREE.Mesh[] = [];
  private originalColors: number[] = [];
  private originalEmissives: number[] = [];
  private originalEmissiveIntensities: number[] = [];

  constructor(
    scene: THREE.Scene,
    spawnPos: THREE.Vector3,
    speed: number,
    isSoftwareGl: boolean
  ) {
    this.speed = speed;
    this.group.position.copy(spawnPos);
    this.waypointX = spawnPos.x;
    this.waypointZ = spawnPos.z;

    const assets = getSharedOperatorAssets();

    // Per-instance material clones so damage flash only highlights this specific operator
    const matCache = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
    const getInstanceMat = (shared: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      let cloned = matCache.get(shared);
      if (!cloned) {
        cloned = shared.clone();
        matCache.set(shared, cloned);
      }
      return cloned;
    };

    const registerMesh = (mesh: THREE.Mesh, isHead: boolean) => {
      mesh.castShadow = !isSoftwareGl;
      mesh.receiveShadow = !isSoftwareGl;
      mesh.userData = { enemy: this, isHead };
      const mat = getInstanceMat(mesh.material as THREE.MeshStandardMaterial);
      mesh.material = mat;
      if (!this.bodyMeshes.some((m) => m.material === mat)) {
        this.originalColors.push(mat.color.getHex());
        this.originalEmissives.push(mat.emissive.getHex());
        this.originalEmissiveIntensities.push(mat.emissiveIntensity);
      } else {
        const idx = this.bodyMeshes.findIndex((m) => m.material === mat);
        this.originalColors.push(this.originalColors[idx]);
        this.originalEmissives.push(this.originalEmissives[idx]);
        this.originalEmissiveIntensities.push(this.originalEmissiveIntensities[idx]);
      }
      this.bodyMeshes.push(mesh);
    };

    // ------------------------------------------------------------------------
    // 1. PELVIS, TACTICAL BATTLE BELT, DROP-LEG HOLSTER & DUMP POUCH
    // ------------------------------------------------------------------------
    this.pelvisGroup.position.set(0, 0.92, 0);
    this.group.add(this.pelvisGroup);

    const pelvisMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.185, 0.165, 0.2, 14),
      assets.bduMat
    );
    pelvisMesh.scale.set(1.12, 1.0, 0.82);
    registerMesh(pelvisMesh, false);
    this.pelvisGroup.add(pelvisMesh);

    const battleBelt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.205, 0.205, 0.085, 16),
      assets.vestMat
    );
    battleBelt.position.y = 0.05;
    battleBelt.scale.set(1.14, 1.0, 0.86);
    registerMesh(battleBelt, false);
    this.pelvisGroup.add(battleBelt);

    const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.06, 0.03), assets.brassMat);
    beltBuckle.position.set(0, 0.05, 0.178);
    registerMesh(beltBuckle, false);
    this.pelvisGroup.add(beltBuckle);

    // Rear utility dump pouch & IFAK medkit on belt
    const dumpPouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.15, 0.085),
      assets.pouchMat
    );
    dumpPouch.position.set(-0.08, 0.01, -0.185);
    registerMesh(dumpPouch, false);
    this.pelvisGroup.add(dumpPouch);

    const ifakPouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.11, 0.08),
      assets.vestMat
    );
    ifakPouch.position.set(0.09, 0.03, -0.185);
    registerMesh(ifakPouch, false);
    this.pelvisGroup.add(ifakPouch);

    // ------------------------------------------------------------------------
    // 2. ARTICULATED LEGS (Thighs, Molded Knee Pads, Calves, Combat Boots)
    // ------------------------------------------------------------------------
    const buildLeg = (isLeft: boolean) => {
      const s = isLeft ? -1 : 1;
      const hipPivot = isLeft ? this.leftLegPivot : this.rightLegPivot;
      const shinPivot = isLeft ? this.leftShinPivot : this.rightShinPivot;

      hipPivot.position.set(s * 0.115, -0.04, 0);
      this.pelvisGroup.add(hipPivot);

      // Sculpted BDU thigh with cargo pocket
      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.098, 0.078, 0.42, 12),
        assets.bduMat
      );
      thigh.position.set(0, -0.21, 0);
      thigh.scale.set(1.04, 1.0, 1.08);
      registerMesh(thigh, false);
      hipPivot.add(thigh);

      const cargoPocket = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.16, 0.12),
        assets.bduMat
      );
      cargoPocket.position.set(s * 0.095, -0.22, 0.01);
      registerMesh(cargoPocket, false);
      hipPivot.add(cargoPocket);

      // Right thigh Kydex drop-leg sidearm holster + retention straps
      if (!isLeft) {
        const holsterMount = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.17, 0.105),
          assets.padMat
        );
        holsterMount.position.set(0.108, -0.19, 0.02);
        registerMesh(holsterMount, false);
        hipPivot.add(holsterMount);

        const pistolGrip = new THREE.Mesh(
          new THREE.BoxGeometry(0.032, 0.08, 0.045),
          assets.gunPolymerMat
        );
        pistolGrip.position.set(0.115, -0.1, -0.01);
        pistolGrip.rotation.x = 0.28;
        registerMesh(pistolGrip, false);
        hipPivot.add(pistolGrip);
      }

      // Knee joint & lower shin hierarchy
      shinPivot.position.set(0, -0.42, 0);
      hipPivot.add(shinPivot);

      // Hard-shell tactical knee pad + cap
      const kneePad = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 0.125, 0.055),
        assets.padMat
      );
      kneePad.position.set(0, -0.01, 0.072);
      registerMesh(kneePad, false);
      shinPivot.add(kneePad);

      // Lower BDU calf/shin
      const shin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.076, 0.058, 0.38, 12),
        assets.bduMat
      );
      shin.position.set(0, -0.19, -0.005);
      registerMesh(shin, false);
      shinPivot.add(shin);

      // Combat boot ankle collar, heel & lugged Vibram sole
      const bootAnkle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.064, 0.068, 0.15, 12),
        assets.bootMat
      );
      bootAnkle.position.set(0, -0.37, -0.008);
      registerMesh(bootAnkle, false);
      shinPivot.add(bootAnkle);

      const bootFoot = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 0.085, 0.245),
        assets.bootMat
      );
      bootFoot.position.set(0, -0.425, 0.038);
      registerMesh(bootFoot, false);
      shinPivot.add(bootFoot);

      const bootSole = new THREE.Mesh(
        new THREE.BoxGeometry(0.122, 0.028, 0.256),
        assets.padMat
      );
      bootSole.position.set(0, -0.458, 0.038);
      registerMesh(bootSole, false);
      shinPivot.add(bootSole);
    };

    buildLeg(true);
    buildLeg(false);

    // ------------------------------------------------------------------------
    // 3. UPPER TORSO, PLATE CARRIER VEST, MAG POUCHES, RADIO & BACKPACK
    // ------------------------------------------------------------------------
    this.upperBodyPivot.position.set(0, 0.08, 0);
    this.pelvisGroup.add(this.upperBodyPivot);

    // Combat shirt torso core
    const torsoCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.215, 0.18, 0.52, 16),
      assets.bduMat
    );
    torsoCore.position.set(0, 0.26, 0);
    torsoCore.scale.set(1.16, 1.0, 0.82);
    registerMesh(torsoCore, false);
    this.upperBodyPivot.add(torsoCore);

    // Tactical JPC Plate Carrier chassis (front & rear SAPI ballistic plates + cummerbund)
    const frontPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.38, 0.065),
      assets.vestMat
    );
    frontPlate.position.set(0, 0.28, 0.155);
    frontPlate.rotation.x = -0.05;
    registerMesh(frontPlate, false);
    this.upperBodyPivot.add(frontPlate);

    const rearPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.33, 0.39, 0.06),
      assets.vestMat
    );
    rearPlate.position.set(0, 0.29, -0.155);
    rearPlate.rotation.x = 0.04;
    registerMesh(rearPlate, false);
    this.upperBodyPivot.add(rearPlate);

    const cummerbund = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.215, 0.17, 16),
      assets.vestMat
    );
    cummerbund.position.set(0, 0.18, 0);
    cummerbund.scale.set(1.18, 1.0, 0.88);
    registerMesh(cummerbund, false);
    this.upperBodyPivot.add(cummerbund);

    // Padded plate carrier shoulder straps
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.045, 0.32),
        assets.vestMat
      );
      strap.position.set(s * 0.135, 0.5, 0.0);
      registerMesh(strap, false);
      this.upperBodyPivot.add(strap);
    }

    // 3 Front STANAG 5.56 Rifle Magazine Pouches + protruding mag baseplates
    for (let m = -1; m <= 1; m++) {
      const magPouch = new THREE.Mesh(
        new THREE.BoxGeometry(0.088, 0.165, 0.058),
        assets.pouchMat
      );
      magPouch.position.set(m * 0.1, 0.195, 0.205);
      registerMesh(magPouch, false);
      this.upperBodyPivot.add(magPouch);

      const magPull = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, 0.045, 0.036),
        assets.gunPolymerMat
      );
      magPull.position.set(m * 0.1, 0.29, 0.205);
      registerMesh(magPull, false);
      this.upperBodyPivot.add(magPull);
    }

    // Upper chest Admin Patch + Hostile Red IFF IR Beacon
    const adminPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.085, 0.025),
      assets.pouchMat
    );
    adminPanel.position.set(0, 0.37, 0.192);
    registerMesh(adminPanel, false);
    this.upperBodyPivot.add(adminPanel);

    const iffPatch = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.032, 0.03),
      assets.patchEmissiveMat
    );
    iffPatch.position.set(0.035, 0.375, 0.198);
    registerMesh(iffPatch, false);
    this.upperBodyPivot.add(iffPatch);

    // Left-chest PRC-152 Tactical Radio + Whip Antenna
    const radioBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.14, 0.045),
      assets.gunPolymerMat
    );
    radioBody.position.set(-0.145, 0.37, 0.185);
    registerMesh(radioBody, false);
    this.upperBodyPivot.add(radioBody);

    const radioAntenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.007, 0.32, 6),
      assets.gunPolymerMat
    );
    radioAntenna.position.set(-0.165, 0.56, 0.175);
    radioAntenna.rotation.z = 0.08;
    registerMesh(radioAntenna, false);
    this.upperBodyPivot.add(radioAntenna);

    // Rear Tactical Assault Pack / Hydration Carrier
    const assaultPack = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.35, 0.145),
      assets.pouchMat
    );
    assaultPack.position.set(0, 0.29, -0.235);
    registerMesh(assaultPack, false);
    this.upperBodyPivot.add(assaultPack);

    const lowerPackPocket = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.15, 0.06),
      assets.vestMat
    );
    lowerPackPocket.position.set(0, 0.21, -0.32);
    registerMesh(lowerPackPocket, false);
    this.upperBodyPivot.add(lowerPackPocket);

    // ------------------------------------------------------------------------
    // 4. HEAD, BALACLAVA, BALLISTIC GOGGLES, FAST HELMET, PELTOR COMTACS & NVG
    //    (All registered with isHead = true for accurate 2x Headshot hitbox!)
    // ------------------------------------------------------------------------
    this.headPivot.position.set(0, 0.54, 0.01);
    this.upperBodyPivot.add(this.headPivot);

    // Neck & Balaclava collar
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.072, 0.084, 0.11, 12),
      assets.balaclavaMat
    );
    neck.position.set(0, 0.04, 0);
    registerMesh(neck, true);
    this.headPivot.add(neck);

    // Sculpted human head wrapped in tactical balaclava
    const headCranium = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 16, 14),
      assets.balaclavaMat
    );
    headCranium.position.set(0, 0.155, 0.01);
    headCranium.scale.set(0.94, 1.12, 1.02);
    registerMesh(headCranium, true);
    this.headPivot.add(headCranium);

    // Exposed upper cheek / eye bridge skin cutout
    const eyeBridgeSkin = new THREE.Mesh(
      new THREE.BoxGeometry(0.155, 0.048, 0.08),
      assets.skinMat
    );
    eyeBridgeSkin.position.set(0, 0.168, 0.092);
    registerMesh(eyeBridgeSkin, true);
    this.headPivot.add(eyeBridgeSkin);

    // Wrap-around Ballistic Goggles (matte polymer frame + tinted Crimson-IR anti-fog lens)
    const goggleFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.195, 0.072, 0.095),
      assets.padMat
    );
    goggleFrame.position.set(0, 0.17, 0.094);
    registerMesh(goggleFrame, true);
    this.headPivot.add(goggleFrame);

    const goggleLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.178, 0.052, 0.03),
      assets.goggleLensMat
    );
    goggleLens.position.set(0, 0.17, 0.132);
    registerMesh(goggleLens, true);
    this.headPivot.add(goggleLens);

    // High-Cut Ops-Core FAST Ballistic Helmet dome + ARC side rails
    const helmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.144, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
      assets.helmetMat
    );
    helmetShell.position.set(0, 0.172, 0.0);
    helmetShell.rotation.x = -0.12;
    helmetShell.scale.set(0.98, 1.04, 1.08);
    registerMesh(helmetShell, true);
    this.headPivot.add(helmetShell);

    // Peltor ComTac Tactical Headset Ear Cups + Boom Mic
    for (const s of [-1, 1]) {
      const earCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.036, 12),
        assets.padMat
      );
      earCup.rotation.z = Math.PI * 0.5;
      earCup.position.set(s * 0.132, 0.155, -0.005);
      registerMesh(earCup, true);
      this.headPivot.add(earCup);

      const arcRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.028, 0.12),
        assets.gunPolymerMat
      );
      arcRail.position.set(s * 0.138, 0.205, 0.01);
      registerMesh(arcRail, true);
      this.headPivot.add(arcRail);
    }

    // Front NVG Aluminum Wilcox Mount + GPNVG-18 Quad-Tube Night Vision Array (stowed tilted up)
    const nvgMount = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.055, 0.04),
      assets.brassMat
    );
    nvgMount.position.set(0, 0.245, 0.14);
    registerMesh(nvgMount, true);
    this.headPivot.add(nvgMount);

    const nvgBridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.185, 0.026, 0.036),
      assets.gunPolymerMat
    );
    nvgBridge.position.set(0, 0.258, 0.175);
    registerMesh(nvgBridge, true);
    this.headPivot.add(nvgBridge);

    for (const tx of [-0.072, -0.026, 0.026, 0.072]) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.019, 0.078, 10),
        assets.gunPolymerMat
      );
      tube.rotation.x = Math.PI * 0.42;
      tube.position.set(tx, 0.242, 0.195);
      registerMesh(tube, true);
      this.headPivot.add(tube);

      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.01, 10),
        assets.nvgLensMat
      );
      lens.rotation.x = Math.PI * 0.42;
      lens.position.set(tx, 0.233, 0.232);
      registerMesh(lens, true);
      this.headPivot.add(lens);
    }

    // ------------------------------------------------------------------------
    // 5. ARTICULATED ARMS, ELBOW PADS, TACTICAL GLOVES & SUPPRESSED CARBINE
    // ------------------------------------------------------------------------
    const buildArm = (isLeft: boolean) => {
      const s = isLeft ? -1 : 1;
      const shoulderPivot = isLeft ? this.leftArmPivot : this.rightArmPivot;
      const forearmPivot = isLeft ? this.leftForearmPivot : this.rightForearmPivot;

      shoulderPivot.position.set(s * 0.245, 0.46, 0.02);
      this.upperBodyPivot.add(shoulderPivot);

      // Deltoid BDU sleeve + Velcro unit patch pocket
      const upperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.074, 0.062, 0.29, 12),
        assets.bduMat
      );
      upperArm.position.set(0, -0.13, 0);
      registerMesh(upperArm, false);
      shoulderPivot.add(upperArm);

      const shoulderPatch = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.095, 0.075),
        assets.pouchMat
      );
      shoulderPatch.position.set(s * 0.072, -0.1, 0);
      registerMesh(shoulderPatch, false);
      shoulderPivot.add(shoulderPatch);

      // Elbow joint + forearm
      forearmPivot.position.set(0, -0.27, 0);
      shoulderPivot.add(forearmPivot);

      const elbowPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.085, 0.045),
        assets.padMat
      );
      elbowPad.position.set(0, -0.01, -0.055);
      registerMesh(elbowPad, false);
      forearmPivot.add(elbowPad);

      const forearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.046, 0.26, 12),
        assets.bduMat
      );
      forearm.position.set(0, -0.13, 0);
      registerMesh(forearm, false);
      forearmPivot.add(forearm);

      // Armored knuckle tactical glove
      const glove = new THREE.Mesh(
        new THREE.BoxGeometry(0.072, 0.095, 0.082),
        assets.gloveMat
      );
      glove.position.set(0, -0.275, 0.01);
      registerMesh(glove, false);
      forearmPivot.add(glove);
    };

    buildArm(true);
    buildArm(false);

    // ------------------------------------------------------------------------
    // 6. DETAILED SUPPRESSED MK18 / M4 TACTICAL CARBINE HELD IN READY STANCE
    // ------------------------------------------------------------------------
    this.rifleGroup.position.set(0.05, -0.27, 0.08);
    this.rightForearmPivot.add(this.rifleGroup);

    // Upper & Lower Forged Receiver
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.088, 0.26),
      assets.gunMetalMat
    );
    receiver.position.set(0, 0.03, 0.04);
    registerMesh(receiver, false);
    this.rifleGroup.add(receiver);

    // Collapsible SOPMOD Buttstock & Buffer Tube
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.046, 0.105, 0.21),
      assets.gunPolymerMat
    );
    stock.position.set(0, 0.015, -0.17);
    registerMesh(stock, false);
    this.rifleGroup.add(stock);

    // Ergonomic Pistol Grip
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.11, 0.052),
      assets.gunPolymerMat
    );
    grip.position.set(0, -0.045, -0.03);
    grip.rotation.x = -0.28;
    registerMesh(grip, false);
    this.rifleGroup.add(grip);

    // Curved 30-Round STANAG / PMAG Magazine
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.175, 0.068),
      assets.gunPolymerMat
    );
    magazine.position.set(0, -0.08, 0.11);
    magazine.rotation.x = 0.22;
    registerMesh(magazine, false);
    this.rifleGroup.add(magazine);

    // Free-Float M-LOK Quad Rail Handguard
    const handguard = new THREE.Mesh(
      new THREE.BoxGeometry(0.056, 0.068, 0.27),
      assets.gunMetalMat
    );
    handguard.position.set(0, 0.038, 0.29);
    registerMesh(handguard, false);
    this.rifleGroup.add(handguard);

    // Foregrip vertical tactical grip
    const foregrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.018, 0.095, 8),
      assets.gunPolymerMat
    );
    foregrip.position.set(0, -0.03, 0.31);
    registerMesh(foregrip, false);
    this.rifleGroup.add(foregrip);

    // Holographic EOTech Sight + AN/PEQ-15 Laser Module
    const holoSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.058, 0.085),
      assets.gunPolymerMat
    );
    holoSight.position.set(0, 0.098, 0.07);
    registerMesh(holoSight, false);
    this.rifleGroup.add(holoSight);

    const peqLaser = new THREE.Mesh(
      new THREE.BoxGeometry(0.046, 0.028, 0.075),
      assets.pouchMat
    );
    peqLaser.position.set(0, 0.085, 0.34);
    registerMesh(peqLaser, false);
    this.rifleGroup.add(peqLaser);

    // Barrel + SOCOM QD Tactical Suppressor
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.14, 10),
      assets.gunMetalMat
    );
    barrel.rotation.x = Math.PI * 0.5;
    barrel.position.set(0, 0.042, 0.47);
    registerMesh(barrel, false);
    this.rifleGroup.add(barrel);

    const suppressor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.021, 0.18, 12),
      assets.gunPolymerMat
    );
    suppressor.rotation.x = Math.PI * 0.5;
    suppressor.position.set(0, 0.042, 0.61);
    registerMesh(suppressor, false);
    this.rifleGroup.add(suppressor);

    // Dynamic 3D Muzzle Flash Star at suppressor tip
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      transparent: true,
      opacity: 0.92,
    });
    this.muzzleFlashMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), flashMat);
    this.muzzleFlashMesh.scale.set(0.85, 0.85, 2.2);
    this.muzzleFlashMesh.position.set(0, 0.042, 0.74);
    this.muzzleFlashMesh.visible = false;
    this.rifleGroup.add(this.muzzleFlashMesh);

    this.applyTacticalRiflePose(0, 0);
    scene.add(this.group);
  }

  /**
   * Poses both articulated arms, elbows, torso twist, and rifle into a realistic
   * two-handed tactical high-ready / ADS firing stance.
   */
  private applyTacticalRiflePose(strideSwing: number, aimBlend: number): void {
    const kick = this.recoilKick;

    // Right arm (trigger hand tucked into shoulder pocket)
    this.rightArmPivot.rotation.set(
      -0.78 - aimBlend * 0.36 + strideSwing * 0.12 + kick * 0.28,
      -0.18,
      -0.08
    );
    this.rightForearmPivot.rotation.set(-0.68 - aimBlend * 0.16 + kick * 0.22, -0.14, 0);

    // Left arm (support hand reaching across chest to grip the M-LOK handguard / vertical foregrip)
    this.leftArmPivot.rotation.set(
      -1.02 - aimBlend * 0.28 - strideSwing * 0.1 + kick * 0.24,
      0.52,
      0.16
    );
    this.leftForearmPivot.rotation.set(-0.52 - aimBlend * 0.14, 0.24, -0.12);

    // Rifle orientation aligned toward target
    this.rifleGroup.rotation.set(0.58 - aimBlend * 0.42 - kick * 0.32, 0.12, 0.05);
  }

  public takeDamage(amount: number): boolean {
    if (this.state !== 'CHASING') return false;
    this.hp -= amount;
    this.hitFlashTimer = 0.12;
    this.setFlashColor(true);

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'DYING';
      this.deathTimer = 0;
      this.muzzleFlashMesh.visible = false;
      return true;
    }
    return false;
  }

  private setFlashColor(flashing: boolean): void {
    for (let i = 0; i < this.bodyMeshes.length; i++) {
      const mat = this.bodyMeshes[i].material as THREE.MeshStandardMaterial;
      if (flashing) {
        mat.color.setHex(0xff2222);
        mat.emissive.setHex(0x990000);
        mat.emissiveIntensity = 0.85;
      } else {
        mat.color.setHex(this.originalColors[i]);
        mat.emissive.setHex(this.originalEmissives[i]);
        mat.emissiveIntensity = this.originalEmissiveIntensities[i];
      }
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    map: MossyHollowMap,
    otherEnemies: Enemy[],
    onAttackPlayer: (damage: number, enemyPos: THREE.Vector3) => void
  ): void {
    this.idleTime += dt;

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      if (this.hitFlashTimer <= 0) {
        this.setFlashColor(false);
      }
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      this.muzzleFlashMesh.rotation.z += dt * 28;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
      }
    }

    if (this.recoilKick > 0) {
      this.recoilKick = Math.max(0, this.recoilKick - dt * 5.5);
    }

    if (this.state === 'DYING') {
      this.deathTimer += dt;
      const progress = Math.min(1, this.deathTimer / 0.55);
      const ease = 1 - Math.pow(1 - progress, 2);
      // Realistic tactical collapse: knees buckle first while torso folds backward
      this.group.rotation.x = -ease * (Math.PI * 0.48);
      this.pelvisGroup.position.y = THREE.MathUtils.lerp(0.92, 0.32, ease);
      this.leftShinPivot.rotation.x = ease * 1.15;
      this.rightShinPivot.rotation.x = ease * 0.95;
      this.headPivot.rotation.x = ease * 0.45;
      if (this.deathTimer >= 0.75) {
        this.state = 'DEAD';
      }
      return;
    }

    if (this.state === 'DEAD') return;

    if (this.attackCooldown > 0) {
      this.attackCooldown -= dt;
    }

    const dxToPlayer = playerPos.x - this.group.position.x;
    const dzToPlayer = playerPos.z - this.group.position.z;
    const distToPlayer = Math.hypot(dxToPlayer, dzToPlayer);

    // Refresh A* waypoint every 0.45s when far or obstructed by water/slope
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 0.45;
      if (distToPlayer > 14) {
        const wp = map.findNextWaypoint(
          this.group.position.x,
          this.group.position.z,
          playerPos.x,
          playerPos.z
        );
        this.waypointX = wp.x;
        this.waypointZ = wp.z;
      } else {
        this.waypointX = playerPos.x;
        this.waypointZ = playerPos.z;
      }
    }

    _vec3A.set(
      this.waypointX - this.group.position.x,
      0,
      this.waypointZ - this.group.position.z
    );
    const wpLen = _vec3A.length();
    if (wpLen > 0.001) _vec3A.divideScalar(wpLen);

    // Face movement direction or player smoothly
    const lookAngle = Math.atan2(dxToPlayer, dzToPlayer);
    this.group.rotation.y = lookAngle;

    // Subtle vertical head tracking toward player elevation
    const dyToPlayer = playerPos.y - (this.group.position.y + 1.6);
    const pitchToPlayer = THREE.MathUtils.clamp(
      Math.atan2(dyToPlayer, Math.max(1.0, distToPlayer)),
      -0.45,
      0.45
    );
    this.headPivot.rotation.x = THREE.MathUtils.damp(
      this.headPivot.rotation.x,
      -pitchToPlayer * 0.65,
      10,
      dt
    );

    const stopRange = 2.25;
    if (distToPlayer > stopRange) {
      _vec3B.copy(_vec3A);

      // Repel from nearby trees, rocks, and structure walls via spatial grid
      const nearby = map.getNearbyColliders(this.group.position.x, this.group.position.z);
      for (let i = 0; i < nearby.length; i++) {
        const c = nearby[i];
        if (c.type === 'cylinder') {
          const rx = this.group.position.x - c.x;
          const rz = this.group.position.z - c.z;
          const d = Math.hypot(rx, rz);
          const avoidR = c.r + 1.4;
          if (d < avoidR && d > 0.001) {
            _vec3B.x += (rx / d) * 1.5;
            _vec3B.z += (rz / d) * 1.5;
          }
        } else if (!c.isRamp) {
          const rx = this.group.position.x - c.cx;
          const rz = this.group.position.z - c.cz;
          const reachX = c.w * 0.5 + 1.2;
          const reachZ = c.d * 0.5 + 1.2;
          if (Math.abs(rx) < reachX && Math.abs(rz) < reachZ) {
            _vec3B.x += (rx / reachX) * 1.3;
            _vec3B.z += (rz / reachZ) * 1.3;
          }
        }
      }

      // Separation from sibling enemies
      for (let i = 0; i < otherEnemies.length; i++) {
        const other = otherEnemies[i];
        if (other === this || other.state !== 'CHASING') continue;
        const sx = this.group.position.x - other.group.position.x;
        const sz = this.group.position.z - other.group.position.z;
        const dSq = sx * sx + sz * sz;
        if (dSq < 1.8 && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          _vec3B.x += (sx / d) * 1.2;
          _vec3B.z += (sz / d) * 1.2;
        }
      }

      _vec3B.normalize();

      // Sprint boost when closing long outdoor valley distances (> 28u)
      const isSprinting = distToPlayer > 28;
      const effectiveSpeed = isSprinting ? this.speed * 1.35 : this.speed;

      const prevX = this.group.position.x;
      const prevZ = this.group.position.z;

      this.group.position.x += _vec3B.x * effectiveSpeed * dt;
      this.resolveEnemyCollision(nearby, 'x');

      this.group.position.z += _vec3B.z * effectiveSpeed * dt;
      this.resolveEnemyCollision(nearby, 'z');

      // Avoid deep water (depth > 1.2) and steep slopes > 40° (unless walking on a bridge/deck)
      const nextTerrainY = map.getHeightAt(this.group.position.x, this.group.position.z);
      const nextH = map.getSupportHeightAt(
        this.group.position.x,
        this.group.position.z,
        this.group.position.y
      );
      const onStructure = nextH > nextTerrainY + 0.12;
      const nextSlope = onStructure
        ? 0
        : map.getSlopeAt(this.group.position.x, this.group.position.z);
      if (nextH < -1.15 || nextSlope > 42) {
        this.group.position.x = prevX;
        this.group.position.z = prevZ;
      } else {
        this.group.position.y = THREE.MathUtils.damp(this.group.position.y, nextH, 16, dt);
      }

      const limit = CONFIG.HALF_SIZE - 5.0;
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -limit, limit);
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -limit, limit);

      // Articulated multi-joint combat stride (hip swing + natural knee flexion + pelvis bob)
      this.walkCycle += dt * effectiveSpeed * 2.15;
      const phase = this.walkCycle;
      const strideAmp = isSprinting ? 0.68 : 0.54;
      const leftHip = Math.sin(phase) * strideAmp;
      const rightHip = -leftHip;

      // Knees bend backward (positive rotation.x) during forward recovery & push-off
      const leftKnee = Math.max(0, -Math.cos(phase + 0.35)) * (isSprinting ? 1.05 : 0.82) + 0.08;
      const rightKnee = Math.max(0, Math.cos(phase + 0.35)) * (isSprinting ? 1.05 : 0.82) + 0.08;

      this.leftLegPivot.rotation.x = leftHip;
      this.rightLegPivot.rotation.x = rightHip;
      this.leftShinPivot.rotation.x = leftKnee;
      this.rightShinPivot.rotation.x = rightKnee;

      // Pelvis vertical stride bounce & counter-twist
      this.pelvisGroup.position.y = 0.91 - Math.abs(Math.cos(phase)) * 0.045;
      this.pelvisGroup.rotation.y = Math.sin(phase) * 0.08;

      // Forward combat lean & counter-rotating shoulders
      const aimFactor = distToPlayer < 16 ? 1.0 - THREE.MathUtils.clamp((distToPlayer - 3) / 13, 0, 1) : 0;
      this.upperBodyPivot.rotation.x = isSprinting ? 0.22 : 0.12;
      this.upperBodyPivot.rotation.y = -Math.sin(phase) * 0.09;

      this.applyTacticalRiflePose(Math.sin(phase), aimFactor);
    } else {
      // Tactical firing stance when engaged at close range
      this.leftLegPivot.rotation.x = THREE.MathUtils.damp(this.leftLegPivot.rotation.x, -0.18, 10, dt);
      this.rightLegPivot.rotation.x = THREE.MathUtils.damp(this.rightLegPivot.rotation.x, 0.22, 10, dt);
      this.leftShinPivot.rotation.x = THREE.MathUtils.damp(this.leftShinPivot.rotation.x, 0.24, 10, dt);
      this.rightShinPivot.rotation.x = THREE.MathUtils.damp(this.rightShinPivot.rotation.x, 0.28, 10, dt);
      this.pelvisGroup.position.y = THREE.MathUtils.damp(
        this.pelvisGroup.position.y,
        0.87 + Math.sin(this.idleTime * 2.6) * 0.012,
        10,
        dt
      );
      this.pelvisGroup.rotation.y = THREE.MathUtils.damp(this.pelvisGroup.rotation.y, -0.22, 10, dt);
      this.upperBodyPivot.rotation.x = THREE.MathUtils.damp(this.upperBodyPivot.rotation.x, 0.08, 10, dt);
      this.upperBodyPivot.rotation.y = THREE.MathUtils.damp(this.upperBodyPivot.rotation.y, 0.22, 10, dt);

      if (this.attackCooldown <= 0) {
        this.attackCooldown = 1.15;
        this.recoilKick = 1.0;
        this.muzzleFlashTimer = 0.075;
        this.muzzleFlashMesh.visible = true;
        onAttackPlayer(12, this.group.position);
      }

      this.applyTacticalRiflePose(0, 1.0);
    }
  }

  private resolveEnemyCollision(nearby: MapCollider[], axis: 'x' | 'z'): void {
    const feetY = this.group.position.y + 0.2;
    const headY = this.group.position.y + 1.8;

    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      if (headY < c.minY || feetY > c.maxY - 0.1) continue;

      if (c.type === 'cylinder') {
        const dx = this.group.position.x - c.x;
        const dz = this.group.position.z - c.z;
        const dSq = dx * dx + dz * dz;
        const minR = this.radius + c.r;
        if (dSq < minR * minR && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          this.group.position.x += (dx / d) * (minR - d);
          this.group.position.z += (dz / d) * (minR - d);
        }
      } else if (!c.isRamp) {
        if (c.yaw) {
          const dx = this.group.position.x - c.cx;
          const dz = this.group.position.z - c.cz;
          const cosY = Math.cos(c.yaw);
          const sinY = Math.sin(c.yaw);
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;
          const hw = c.w * 0.5;
          const hd = c.d * 0.5;
          const clampedX = THREE.MathUtils.clamp(lx, -hw, hw);
          const clampedZ = THREE.MathUtils.clamp(lz, -hd, hd);
          const diffX = lx - clampedX;
          const diffZ = lz - clampedZ;
          const distSq = diffX * diffX + diffZ * diffZ;
          if (distSq < this.radius * this.radius && distSq > 0.00001) {
            const dist = Math.sqrt(distSq);
            const overlap = this.radius - dist;
            const pushLx = (diffX / dist) * overlap;
            const pushLz = (diffZ / dist) * overlap;
            this.group.position.x += pushLx * cosY + pushLz * sinY;
            this.group.position.z += -pushLx * sinY + pushLz * cosY;
          }
        } else if (
          this.group.position.x + this.radius > c.minX &&
          this.group.position.x - this.radius < c.maxX &&
          this.group.position.z + this.radius > c.minZ &&
          this.group.position.z - this.radius < c.maxZ
        ) {
          if (axis === 'x') {
            this.group.position.x =
              this.group.position.x < c.cx ? c.minX - this.radius : c.maxX + this.radius;
          } else {
            this.group.position.z =
              this.group.position.z < c.cz ? c.minZ - this.radius : c.maxZ + this.radius;
          }
        }
      }
    }
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    const disposedMats = new Set<THREE.Material>();
    this.bodyMeshes.forEach((m) => {
      m.geometry.dispose();
      const mat = m.material as THREE.Material;
      if (!disposedMats.has(mat)) {
        disposedMats.add(mat);
        mat.dispose();
      }
    });
    this.muzzleFlashMesh.geometry.dispose();
    (this.muzzleFlashMesh.material as THREE.Material).dispose();
    this.bodyMeshes = [];
  }
}

// ============================================================================
// 5. PICKUP MANAGER (8 Landmark Pads with 60s Respawn + Combat Drops)
// ============================================================================
export interface PickupItem {
  group: THREE.Group;
  type: 'health' | 'ammo';
  position: THREE.Vector3;
  baseY: number;
  phase: number;
  active: boolean;
  isFixedPad: boolean;
  respawnTimer: number;
}

export class PickupManager {
  public pickups: PickupItem[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public reset(map: MossyHollowMap): void {
    for (const p of this.pickups) {
      this.scene.remove(p.group);
    }
    this.pickups = [];

    // 4 Fixed Health Packs (Outpost, Lake Dock, North Forest Hut, West Stone Hut)
    for (const pad of CONFIG.HEALTH_PADS) {
      const y = map.getSupportHeightAt(pad.x, pad.z, 15);
      this.createPickup('health', new THREE.Vector3(pad.x, y, pad.z), true);
    }

    // 4 Fixed Ammo Boxes (River Bridge, Road Midpoint, Watchtower Base, SW Meadow)
    for (const pad of CONFIG.AMMO_PADS) {
      const y = map.getSupportHeightAt(pad.x, pad.z, 15);
      this.createPickup('ammo', new THREE.Vector3(pad.x, y, pad.z), true);
    }
  }

  public createPickup(
    type: 'health' | 'ammo',
    groundPos: THREE.Vector3,
    isFixedPad = false
  ): void {
    const group = new THREE.Group();
    const baseY = groundPos.y + 0.48;
    group.position.set(groundPos.x, baseY, groundPos.z);

    if (type === 'health') {
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.3,
        metalness: 0.2,
      });
      const crossMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.6,
        roughness: 0.25,
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.48, 0.48), boxMat);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.52), crossMat);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.52), crossMat);
      group.add(base, crossH, crossV);
    } else {
      const caseMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.45,
        metalness: 0.65,
      });
      const strapMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.45,
        roughness: 0.3,
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.44, 0.44), caseMat);
      const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.48), strapMat);
      strap1.position.x = -0.18;
      const strap2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.48), strapMat);
      strap2.position.x = 0.18;
      group.add(base, strap1, strap2);
    }

    this.scene.add(group);
    this.pickups.push({
      group,
      type,
      position: new THREE.Vector3(groundPos.x, baseY, groundPos.z),
      baseY,
      phase: Math.random() * Math.PI * 2,
      active: true,
      isFixedPad,
      respawnTimer: 0,
    });
  }

  public update(dt: number, player: Player, weapon: Weapon, audio: AudioManager): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];

      if (!p.active) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.active = true;
          p.group.visible = true;
        }
        continue;
      }

      p.phase += dt * 3.0;
      p.group.rotation.y += dt * 1.8;
      p.group.position.y = p.baseY + Math.sin(p.phase) * 0.12;

      const dx = player.position.x - p.position.x;
      const dy = player.position.y - p.baseY;
      const dz = player.position.z - p.position.z;
      const distSq = dx * dx + dy * dy * 0.3 + dz * dz;

      if (distSq < 2.6) {
        if (p.type === 'health' && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + 30);
          audio.playPickup(true);
          this.consumePickup(i);
        } else if (p.type === 'ammo' && weapon.reserveAmmo < 210) {
          weapon.reserveAmmo = Math.min(210, weapon.reserveAmmo + 30);
          audio.playPickup(false);
          this.consumePickup(i);
        }
      }
    }
  }

  private consumePickup(index: number): void {
    const p = this.pickups[index];
    if (p.isFixedPad) {
      // Respawn after 60 seconds
      p.active = false;
      p.group.visible = false;
      p.respawnTimer = CONFIG.PICKUP_RESPAWN_TIME;
    } else {
      this.scene.remove(p.group);
      this.pickups.splice(index, 1);
    }
  }
}

// ============================================================================
// 6. OBJECT POOLS (Sparks, Decals, Shell Casings, Tracers, Smoke Plumes, Water Ripples)
// ============================================================================
interface SparkParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

interface ImpactDecal {
  mesh: THREE.Mesh;
  life: number;
  active: boolean;
}

interface ShellCasing {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
  bounced: boolean;
  active: boolean;
}

interface BulletTracer {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  active: boolean;
}

interface SmokePuff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  active: boolean;
}

interface WaterRipple {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
  active: boolean;
}

// ============================================================================
// 7. MAIN GAME ENGINE
// ============================================================================
export class FpsGameEngine {
  private container: HTMLElement;
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private dirLight!: THREE.DirectionalLight;
  private vmDirLight!: THREE.DirectionalLight;
  private isSoftwareGl: boolean;
  private clock = new THREE.Clock();

  public audio = new AudioManager();
  public player = new Player();
  public weapon: Weapon;
  public pickupManager: PickupManager;
  public map!: MossyHollowMap;
  public enemies: Enemy[] = [];

  public state: GameState = 'START';
  public isGenerating = true;
  public generationProgress = 0;
  public seed = CONFIG.SEED;
  public quality: QualityPreset = 'HIGH';
  public debugMode = false;

  public wave = 1;
  public score = 0;
  public kills = 0;
  public headshots = 0;

  private fps = 60;
  private frameCounter = 0;
  private fpsAccum = 0;

  private waveIntermissionTimer = 0;
  private waveBannerTimer = 0;
  private waveBannerText: string | null = null;

  private keys: Record<string, boolean> = {};
  private isMouseDown = false;

  private sparkPool: SparkParticle[] = [];
  private decalPool: ImpactDecal[] = [];
  private decalIndex = 0;
  private shellPool: ShellCasing[] = [];
  private shellIndex = 0;
  private tracerPool: BulletTracer[] = [];
  private tracerIndex = 0;
  private smokePool: SmokePuff[] = [];
  private smokeIndex = 0;
  private ripplePool: WaterRipple[] = [];
  private rippleIndex = 0;

  private floatingDamages: {
    id: number;
    worldPos: THREE.Vector3;
    amount: number;
    isHeadshot: boolean;
    age: number;
  }[] = [];
  private nextDamageId = 1;

  private hitMarkerTimer = 0;
  private hitMarkerHeadshot = false;
  private damageFlash = 0;
  private lastAttackerPos: THREE.Vector3 | null = null;
  private damageAngleTimer = 0;

  private raycaster = new THREE.Raycaster();
  private frameId = 0;
  private isDisposed = false;
  private titleOrbitAngle = 0;

  constructor(container: HTMLElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;

    // 1. Software WebGL detection
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    // 3. Scene & Warm Golden-Hour Valley Mist FogExp2
    this.scene = new THREE.Scene();
    const horizonColor = new THREE.Color(0xdcc2a8);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0xdcc2a8, CONFIG.FOG_DENSITY);

    // Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Dedicated depth-cleared Viewmodel Scene (null background avoids wiping world pass)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelScene.background = null;
    this.viewmodelScene.environment = this.scene.environment;

    // 4. First-Person Perspective Camera (world 75°) & Dedicated Viewmodel Camera (54° -> 42° ADS)
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.08, 650);
    this.scene.add(this.camera);

    this.viewmodelCamera = new THREE.PerspectiveCamera(54, w / h, 0.02, 10);
    this.viewmodelScene.add(this.viewmodelCamera);

    this.setupLighting();
    this.initPools();

    this.weapon = new Weapon(this.viewmodelCamera);
    this.pickupManager = new PickupManager(this.scene);

    // Build initial Mossy Hollow map with progress indicator
    this.generateMapWithLoadingBar(this.seed);

    this.bindEvents();
    this.startLoop();
  }

  private setupLighting(): void {
    // 1. Sky-to-Meadow Golden-Hour Hemisphere Fill (Cool twilight-azure zenith + warm mossy-amber earth bounce)
    const hemi = new THREE.HemisphereLight(0x8ec5ea, 0x5c4732, 1.05);
    hemi.position.set(0, 75, 0);
    this.scene.add(hemi);

    // 2. Primary Golden-Hour Directional Key Sun (aligned with physical sky shader sunDir: 0.60, 0.36, -0.71)
    this.dirLight = new THREE.DirectionalLight(0xffe0ad, 2.85);
    this.dirLight.position.set(60, 36, -71);
    this.dirLight.castShadow = !this.isSoftwareGl;
    const mapSize = CONFIG.QUALITY[this.quality].shadowMapSize;
    this.dirLight.shadow.mapSize.width = mapSize;
    this.dirLight.shadow.mapSize.height = mapSize;

    // 96x96 high-detail shadow frustum that follows the player
    const d = 48;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 165;
    this.dirLight.shadow.bias = -0.00025;
    this.dirLight.shadow.normalBias = 0.018;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // 3. Secondary Atmospheric Rim / Sky-Bounce Fill Light (opposite sun azimuth for 3D silhouette separation)
    const rimFillLight = new THREE.DirectionalLight(0x93c5fd, 0.62);
    rimFillLight.position.set(-55, 28, 60);
    this.scene.add(rimFillLight);

    // Mirror primary world lighting in the dedicated Viewmodel Scene so arms & ACR match valley lighting
    const vmHemi = new THREE.HemisphereLight(0x8ec5ea, 0x5c4732, 1.05);
    vmHemi.position.set(0, 75, 0);
    this.viewmodelScene.add(vmHemi);

    this.vmDirLight = new THREE.DirectionalLight(0xffe0ad, 2.85);
    this.vmDirLight.position.set(60, 36, -71);
    this.viewmodelScene.add(this.vmDirLight);
    this.viewmodelScene.add(this.vmDirLight.target);

    const vmRimLight = new THREE.DirectionalLight(0x93c5fd, 0.62);
    vmRimLight.position.set(-55, 28, 60);
    this.viewmodelScene.add(vmRimLight);

    // 4. Warm Amber Lantern Point Lights at both River Bridges & The Knoll Outpost
    const bridgeLanternLight = new THREE.PointLight(0xfbbf24, 2.4, 24, 1.5);
    bridgeLanternLight.position.set(-30, 4.8, 30);
    this.scene.add(bridgeLanternLight);

    const eastBridgeLanternLight = new THREE.PointLight(0xfbbf24, 2.2, 24, 1.5);
    eastBridgeLanternLight.position.set(37.43, 4.4, 49.03);
    this.scene.add(eastBridgeLanternLight);

    const outpostLanternLight = new THREE.PointLight(0xf59e0b, 2.6, 26, 1.5);
    outpostLanternLight.position.set(2.5, 12.2, -2.5);
    this.scene.add(outpostLanternLight);
  }

  public setQuality(preset: QualityPreset): void {
    this.quality = preset;
    this.camera.far = 650;
    this.camera.updateProjectionMatrix();
    if (this.map) {
      this.map.setQuality(preset);
    }
    this.emitHud();
  }

  public toggleDebug(): void {
    this.debugMode = !this.debugMode;
    if (this.map) {
      this.map.colliderDebugGroup.visible = this.debugMode;
    }
    this.emitHud();
  }

  public regenerateNewSeed(customSeed?: number): void {
    const nextSeed =
      customSeed !== undefined ? customSeed : Math.floor(1000 + Math.random() * 90000);
    this.generateMapWithLoadingBar(nextSeed);
  }

  private generateMapWithLoadingBar(targetSeed: number): void {
    this.seed = targetSeed;
    CONFIG.SEED = targetSeed;
    this.isGenerating = true;
    this.generationProgress = 25;
    this.emitHud();

    window.setTimeout(() => {
      if (this.isDisposed) return;
      try {
        if (this.map) {
          this.map.dispose(this.scene);
        }
        this.generationProgress = 65;
        this.emitHud();

        this.map = new MossyHollowMap(this.scene, this.seed, this.quality, this.isSoftwareGl);
        this.map.colliderDebugGroup.visible = this.debugMode;

        this.player.reset(this.map);
        this.pickupManager.reset(this.map);

        if (this.state === 'PLAYING') {
          this.resetMatch();
        }

        if (!this.isSoftwareGl) {
          try {
            this.renderer.compile(this.scene, this.camera);
            this.renderer.compile(this.viewmodelScene, this.viewmodelCamera);
          } catch {
            // Ignore shader pre-warm failure if async textures are still uploading
          }
        }
      } catch (err) {
        console.error('Map generation error:', err);
      } finally {
        this.generationProgress = 100;
        this.isGenerating = false;
        this.waveBannerText = `MOSSY HOLLOW GENERATED (SEED ${this.seed})`;
        this.waveBannerTimer = 2.5;
        this.emitHud();
      }
    }, 40);
  }

  private initPools(): void {
    // 1. Ricochet & Blood/Armor Sparks
    const sparkGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    for (let i = 0; i < 60; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparkPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
        active: false,
      });
    }

    // 2. Bullet Impact Scorch Decals
    const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(decalGeo, decalMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.decalPool.push({
        mesh,
        life: 0,
        active: false,
      });
    }

    // 3. Ejected 3D Brass Shell Casings
    const shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.048, 6);
    shellGeo.rotateZ(Math.PI / 2);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.25,
      metalness: 0.88,
    });
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shellPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        life: 0,
        maxLife: 1.4,
        bounced: false,
        active: false,
      });
    }

    // 4. High-Velocity Ballistic Bullet Tracers
    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1.0);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracerPool.push({
        mesh,
        life: 0,
        maxLife: 0.085,
        active: false,
      });
    }

    // 5. Volumetric Smoke / Dust / Water-Spray Plume Sprites
    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = 64;
    smokeCanvas.height = 64;
    const sCtx = smokeCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
    sGrad.addColorStop(0, 'rgba(226, 232, 240, 0.65)');
    sGrad.addColorStop(0.5, 'rgba(148, 163, 184, 0.32)');
    sGrad.addColorStop(1, 'rgba(148, 163, 184, 0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(smokeCanvas);

    for (let i = 0; i < 36; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.smokePool.push({
        sprite,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.65,
        startScale: 0.2,
        endScale: 0.9,
        active: false,
      });
    }

    // 6. Expanding Water Surface Ripple Rings (for bullet water hits & wading footsteps)
    const rippleCanvas = document.createElement('canvas');
    rippleCanvas.width = 64;
    rippleCanvas.height = 64;
    const rCtx = rippleCanvas.getContext('2d')!;
    rCtx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
    rCtx.lineWidth = 4;
    rCtx.beginPath();
    rCtx.arc(32, 32, 24, 0, Math.PI * 2);
    rCtx.stroke();
    rCtx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
    rCtx.lineWidth = 2;
    rCtx.beginPath();
    rCtx.arc(32, 32, 16, 0, Math.PI * 2);
    rCtx.stroke();
    const rippleTex = new THREE.CanvasTexture(rippleCanvas);
    const rippleGeo = new THREE.PlaneGeometry(1, 1);
    rippleGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: rippleTex,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(rippleGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.ripplePool.push({
        mesh,
        life: 0,
        maxLife: 0.85,
        maxScale: 2.2,
        active: false,
      });
    }
  }

  private spawnSmokePuff(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    colorHex: number,
    startScale: number,
    endScale: number,
    maxLife: number
  ): void {
    const s = this.smokePool[this.smokeIndex];
    this.smokeIndex = (this.smokeIndex + 1) % this.smokePool.length;
    s.active = true;
    s.life = 0;
    s.maxLife = maxLife;
    s.startScale = startScale;
    s.endScale = endScale;
    s.sprite.position.copy(pos);
    s.velocity.copy(vel);
    s.sprite.material.color.setHex(colorHex);
    s.sprite.material.opacity = 0.55;
    s.sprite.scale.setScalar(startScale);
    s.sprite.visible = true;
  }

  private spawnWaterRipple(x: number, z: number, maxScale = 2.4): void {
    const r = this.ripplePool[this.rippleIndex];
    this.rippleIndex = (this.rippleIndex + 1) % this.ripplePool.length;
    r.active = true;
    r.life = 0;
    r.maxLife = 0.85;
    r.maxScale = maxScale;
    r.mesh.position.set(x, CONFIG.WATER_LEVEL + 0.04, z);
    r.mesh.scale.setScalar(0.25);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    r.mesh.visible = true;
  }

  private spawnShotBallistics(targetPoint: THREE.Vector3): void {
    // Compute world-space ACR suppressor tip & ejection port positions from camera (blended for ADS)
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const up = _vec3A.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

    const ads = this.weapon.adsBlend;
    const muzzleRight = THREE.MathUtils.lerp(0.062, 0.0, ads);
    const muzzleUp = THREE.MathUtils.lerp(-0.15, -0.095, ads);
    const muzzleFwd = THREE.MathUtils.lerp(1.0, 0.96, ads);

    const muzzlePos = _vec3B
      .copy(this.camera.position)
      .addScaledVector(_right, muzzleRight)
      .addScaledVector(up, muzzleUp)
      .addScaledVector(_forward, muzzleFwd);

    // 1. Spawn Ballistic Tracer Beam from ACR suppressor tip to targetPoint
    const dist = muzzlePos.distanceTo(targetPoint);
    if (dist > 1.2) {
      const tr = this.tracerPool[this.tracerIndex];
      this.tracerIndex = (this.tracerIndex + 1) % this.tracerPool.length;
      tr.active = true;
      tr.life = 0;
      tr.maxLife = 0.075;
      tr.mesh.position.copy(muzzlePos);
      tr.mesh.lookAt(targetPoint);
      tr.mesh.scale.set(1, 1, Math.min(dist, 95));
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
      tr.mesh.visible = true;
    }

    // 2. Spawn Suppressor Gun-Smoke Wisp
    this.spawnSmokePuff(
      muzzlePos,
      new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.55 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4),
      0xe2e8f0,
      0.14,
      0.52,
      0.36
    );

    // 3. Eject Spinning 3D Brass Shell Casing from ACR right-side ejection port
    const sh = this.shellPool[this.shellIndex];
    this.shellIndex = (this.shellIndex + 1) % this.shellPool.length;
    sh.active = true;
    sh.life = 0;
    sh.maxLife = 1.35;
    sh.bounced = false;
    sh.mesh.position
      .copy(this.camera.position)
      .addScaledVector(_right, THREE.MathUtils.lerp(0.12, 0.05, ads))
      .addScaledVector(up, THREE.MathUtils.lerp(-0.12, -0.08, ads))
      .addScaledVector(_forward, 0.36);
    sh.velocity
      .copy(_right)
      .multiplyScalar(2.2 + Math.random() * 1.1)
      .addScaledVector(up, 1.8 + Math.random() * 0.8)
      .addScaledVector(_forward, -0.6 + (Math.random() - 0.5) * 0.6);
    sh.angVel.set(
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28
    );
    sh.mesh.visible = true;
  }

  private spawnImpactEffects(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    isEnemyHit: boolean
  ): void {
    const isWaterHit = !isEnemyHit && point.y <= CONFIG.WATER_LEVEL + 0.14;
    if (isWaterHit) {
      // Water bullet plunge: expanding surface ripple + white spray plumes + splash audio
      this.spawnWaterRipple(point.x, point.z, 2.8);
      this.audio.playSurfaceImpact(true, false);
      for (let i = 0; i < 3; i++) {
        this.spawnSmokePuff(
          new THREE.Vector3(point.x, CONFIG.WATER_LEVEL + 0.12, point.z),
          new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4),
          0xf0f9ff,
          0.25,
          1.05,
          0.52
        );
      }
      return;
    }

    let spawned = 0;
    for (let i = 0; i < this.sparkPool.length && spawned < 8; i++) {
      const s = this.sparkPool[i];
      if (!s.active) {
        s.active = true;
        s.life = 0;
        s.maxLife = 0.24 + Math.random() * 0.2;
        s.mesh.position.copy(point);
        (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(
          isEnemyHit ? 0xef4444 : 0xfbbf24
        );
        s.velocity
          .copy(normal)
          .multiplyScalar(2.8 + Math.random() * 3.4)
          .add(
            _vec3C.set(
              (Math.random() - 0.5) * 4.8,
              Math.random() * 3.8,
              (Math.random() - 0.5) * 4.8
            )
          );
        s.mesh.visible = true;
        spawned++;
      }
    }

    if (!isEnemyHit) {
      // Impact dust/debris smoke puff + ricochet sound
      const slope = this.map ? this.map.getSlopeAt(point.x, point.z) : 0;
      const isHard = slope > 28 || point.y > 8.5;
      this.audio.playSurfaceImpact(false, isHard);

      this.spawnSmokePuff(
        point.clone().addScaledVector(normal, 0.08),
        normal.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, 0.75, 0)),
        isHard ? 0xcbd5e1 : 0xd6c7b2,
        0.22,
        0.95,
        0.55
      );

      const decal = this.decalPool[this.decalIndex];
      this.decalIndex = (this.decalIndex + 1) % this.decalPool.length;
      decal.active = true;
      decal.life = 8.0;
      decal.mesh.position.copy(point).addScaledVector(normal, 0.015);
      _vec3C.copy(point).add(normal);
      decal.mesh.lookAt(_vec3C);
      (decal.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
      decal.mesh.visible = true;
    }
  }

  private updatePools(dt: number): void {
    // 1. Sparks
    for (let i = 0; i < this.sparkPool.length; i++) {
      const s = this.sparkPool[i];
      if (!s.active) continue;
      s.life += dt;
      if (s.life >= s.maxLife) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.velocity.y -= 14.0 * dt;
        s.mesh.position.addScaledVector(s.velocity, dt);
        const scale = 1 - s.life / s.maxLife;
        s.mesh.scale.setScalar(Math.max(0.1, scale));
      }
    }

    // 2. Scorch Decals
    for (let i = 0; i < this.decalPool.length; i++) {
      const d = this.decalPool[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
      } else if (d.life < 1.5) {
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = (d.life / 1.5) * 0.85;
      }
    }

    // 3. Ejected 3D Brass Shell Casings
    for (let i = 0; i < this.shellPool.length; i++) {
      const sh = this.shellPool[i];
      if (!sh.active) continue;
      sh.life += dt;
      if (sh.life >= sh.maxLife) {
        sh.active = false;
        sh.mesh.visible = false;
      } else {
        sh.velocity.y -= 16.0 * dt;
        sh.mesh.position.addScaledVector(sh.velocity, dt);
        sh.mesh.rotation.x += sh.angVel.x * dt;
        sh.mesh.rotation.y += sh.angVel.y * dt;
        sh.mesh.rotation.z += sh.angVel.z * dt;

        if (!sh.bounced && this.map) {
          const groundY = this.map.getSupportHeightAt(
            sh.mesh.position.x,
            sh.mesh.position.z,
            sh.mesh.position.y + 0.5
          );
          if (sh.mesh.position.y <= groundY + 0.03) {
            sh.mesh.position.y = groundY + 0.03;
            sh.velocity.y = Math.abs(sh.velocity.y) * 0.42;
            sh.velocity.x *= 0.6;
            sh.velocity.z *= 0.6;
            sh.bounced = true;
          }
        }
      }
    }

    // 4. Ballistic Bullet Tracers
    for (let i = 0; i < this.tracerPool.length; i++) {
      const tr = this.tracerPool[i];
      if (!tr.active) continue;
      tr.life += dt;
      if (tr.life >= tr.maxLife) {
        tr.active = false;
        tr.mesh.visible = false;
      } else {
        (tr.mesh.material as THREE.MeshBasicMaterial).opacity =
          (1 - tr.life / tr.maxLife) * 0.85;
      }
    }

    // 5. Volumetric Smoke & Water Plume Sprites
    for (let i = 0; i < this.smokePool.length; i++) {
      const sm = this.smokePool[i];
      if (!sm.active) continue;
      sm.life += dt;
      if (sm.life >= sm.maxLife) {
        sm.active = false;
        sm.sprite.visible = false;
      } else {
        const t = sm.life / sm.maxLife;
        sm.sprite.position.addScaledVector(sm.velocity, dt);
        sm.sprite.scale.setScalar(THREE.MathUtils.lerp(sm.startScale, sm.endScale, t));
        sm.sprite.material.opacity = (1 - t) * 0.48;
      }
    }

    // 6. Water Surface Ripple Rings
    for (let i = 0; i < this.ripplePool.length; i++) {
      const rp = this.ripplePool[i];
      if (!rp.active) continue;
      rp.life += dt;
      if (rp.life >= rp.maxLife) {
        rp.active = false;
        rp.mesh.visible = false;
      } else {
        const t = rp.life / rp.maxLife;
        rp.mesh.scale.setScalar(THREE.MathUtils.lerp(0.25, rp.maxScale, t));
        (rp.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      }
    }

    // 7. Floating 3D Damage Numbers
    for (let i = this.floatingDamages.length - 1; i >= 0; i--) {
      const fd = this.floatingDamages[i];
      fd.age += dt;
      fd.worldPos.y += dt * 1.15;
      if (fd.age >= 0.75) {
        this.floatingDamages.splice(i, 1);
      }
    }
  }

  // Section 8: Spawn enemies at the 8 edge points, >= 60u from player & outside player view
  private spawnWave(waveNum: number): void {
    this.wave = waveNum;
    const count = 3 + (waveNum - 1) * 2;
    const speed = Math.min(8.2, 4.6 + (waveNum - 1) * 0.4);

    const playerForwardX = -Math.sin(this.player.yaw);
    const playerForwardZ = -Math.cos(this.player.yaw);

    // Filter eligible spawn points: >= 60u from player and outside player FOV cone (dot < 0.45)
    const eligible = CONFIG.ENEMY_SPAWNS.filter((sp) => {
      const dx = sp.x - this.player.position.x;
      const dz = sp.z - this.player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 60) return false;
      const dot = (dx / dist) * playerForwardX + (dz / dist) * playerForwardZ;
      return dot < 0.45;
    });

    const pool = eligible.length > 0 ? eligible : CONFIG.ENEMY_SPAWNS;

    for (let i = 0; i < count; i++) {
      const baseSpot = pool[i % pool.length];
      const jitterX = (Math.random() - 0.5) * 6.0;
      const jitterZ = (Math.random() - 0.5) * 6.0;
      const sx = THREE.MathUtils.clamp(baseSpot.x + jitterX, -110, 110);
      const sz = THREE.MathUtils.clamp(baseSpot.z + jitterZ, -110, 110);
      const sy = this.map.getSupportHeightAt(sx, sz, 10);

      const enemy = new Enemy(this.scene, new THREE.Vector3(sx, sy, sz), speed, this.isSoftwareGl);
      this.enemies.push(enemy);
    }

    this.waveBannerText = `WAVE ${waveNum} — ${count} HOSTILES INBOUND`;
    this.waveBannerTimer = 2.6;
    this.audio.playWaveStart();
  }

  private handleShooting(): void {
    if (!this.weapon.tryFire(this.audio)) return;

    this.triggerGamepadRumble(45, 0.42, 0.68);

    const scopedRecoilScale = 0.45 / (this.weapon.scopeZoom * 0.5);
    const recoilAmount = 0.022 * THREE.MathUtils.lerp(1.0, scopedRecoilScale, this.weapon.adsBlend);
    this.player.addRecoil(recoilAmount);

    if (this.weapon.adsBlend > 0.35 && this.weapon.getReticleWorldPosition(_projVec)) {
      _projVec.project(this.viewmodelCamera);
      _reticleRayOrigin.set(
        THREE.MathUtils.clamp(_projVec.x, -0.35, 0.35),
        THREE.MathUtils.clamp(_projVec.y, -0.35, 0.35)
      );
      this.raycaster.setFromCamera(_reticleRayOrigin, this.camera);
    } else {
      this.raycaster.setFromCamera(_rayOrigin, this.camera);
    }

    const targets: THREE.Object3D[] = [
      this.map.waterMesh,
      ...this.map.shootables,
    ];
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].state === 'CHASING') {
        targets.push(this.enemies[i].group);
      }
    }

    const intersects = this.raycaster.intersectObjects(targets, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      this.spawnShotBallistics(hit.point);

      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);

      const userData = hit.object.userData as { enemy?: Enemy; isHead?: boolean };
      if (userData && userData.enemy) {
        const enemy = userData.enemy;
        const isHeadshot = Boolean(userData.isHead);
        const damage = isHeadshot ? 70 : 35;

        this.spawnImpactEffects(hit.point, normal, true);
        this.audio.playHit(isHeadshot);
        if (isHeadshot) {
          this.triggerGamepadRumble(75, 0.65, 0.9);
        }

        this.hitMarkerTimer = 0.16;
        this.hitMarkerHeadshot = isHeadshot;

        this.floatingDamages.push({
          id: this.nextDamageId++,
          worldPos: hit.point.clone().add(new THREE.Vector3(0, 0.25, 0)),
          amount: damage,
          isHeadshot,
          age: 0,
        });

        const killed = enemy.takeDamage(damage);
        if (killed) {
          this.kills++;
          if (isHeadshot) this.headshots++;
          this.score += isHeadshot ? 150 : 100;

          if (Math.random() < 0.45) {
            const dropType =
              this.player.hp < 60 ? 'health' : Math.random() < 0.55 ? 'ammo' : 'health';
            this.pickupManager.createPickup(dropType, enemy.group.position, false);
          }
        }
      } else {
        this.spawnImpactEffects(hit.point, normal, false);
      }
    } else {
      // Sky shot tracer
      const farPoint = _vec3C
        .copy(this.camera.position)
        .addScaledVector(this.raycaster.ray.direction, 90);
      this.spawnShotBallistics(farPoint);
    }
  }

  public startGame(): void {
    this.audio.init();
    if (this.state === 'START' || this.state === 'GAMEOVER') {
      this.resetMatch();
    }
    this.state = 'PLAYING';
    this.clock.getDelta();
    this.requestPointerLock();
    this.emitHud();
  }

  public resumeGame(): void {
    this.audio.init();
    this.state = 'PLAYING';
    this.clock.getDelta();
    this.requestPointerLock();
    this.emitHud();
  }

  public restartGame(): void {
    this.audio.init();
    this.resetMatch();
    this.state = 'PLAYING';
    this.clock.getDelta();
    this.requestPointerLock();
    this.emitHud();
  }

  private resetMatch(): void {
    for (const e of this.enemies) {
      e.dispose(this.scene);
    }
    this.enemies = [];
    this.floatingDamages = [];

    this.player.reset(this.map);
    this.weapon.reset();
    this.isRmbDown = false;
    this.isScopeToggled = false;
    this.pickupManager.reset(this.map);

    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.waveIntermissionTimer = 0;
    this.damageFlash = 0;
    this.hitMarkerTimer = 0;
    this.lastAttackerPos = null;

    this.spawnWave(1);
  }

  private isRmbDown = false;
  private isScopeToggled = false;
  private isGamepadAdsDown = false;
  private isGamepadFireDown = false;
  private gamepadSprintToggled = false;
  public gamepadConnected = false;
  public gamepadName: string | null = null;
  private activeGamepadIndex: number | null = null;
  private prevGamepadButtons: boolean[] = [];
  private gamepadMove = { x: 0, z: 0, sprint: false, jump: false };

  private syncScopeState(): void {
    this.weapon.setAds(this.isRmbDown || this.isGamepadAdsDown || this.isScopeToggled);
  }

  private clearScopeInput(): void {
    this.isRmbDown = false;
    this.isGamepadAdsDown = false;
    this.isGamepadFireDown = false;
    this.isScopeToggled = false;
    this.gamepadSprintToggled = false;
    this.gamepadMove.x = 0;
    this.gamepadMove.z = 0;
    this.gamepadMove.sprint = false;
    this.gamepadMove.jump = false;
    this.weapon.setAds(false);
  }

  private formatGamepadName(rawId: string): string {
    const lower = rawId.toLowerCase();
    if (lower.includes('dualsense') || lower.includes('dualshock') || lower.includes('playstation') || lower.includes('054c')) {
      return 'PlayStation Controller';
    }
    if (lower.includes('xbox') || lower.includes('xinput') || lower.includes('045e')) {
      return 'Xbox Controller';
    }
    if (lower.includes('nintendo') || lower.includes('pro controller') || lower.includes('057e')) {
      return 'Pro Controller';
    }
    const clean = rawId.replace(/\s*\(.*?\)\s*/g, '').trim();
    return clean.length > 0 && clean.length <= 26 ? clean : 'Gamepad Controller';
  }

  private onGamepadConnected = (e: GamepadEvent): void => {
    this.activeGamepadIndex = e.gamepad.index;
    this.gamepadConnected = true;
    this.gamepadName = this.formatGamepadName(e.gamepad.id);
    this.emitHud();
  };

  private onGamepadDisconnected = (e: GamepadEvent): void => {
    if (this.activeGamepadIndex === e.gamepad.index) {
      this.activeGamepadIndex = null;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const remaining = Array.from(pads).find((p): p is Gamepad => Boolean(p && p.connected));
    if (remaining) {
      this.activeGamepadIndex = remaining.index;
      this.gamepadConnected = true;
      this.gamepadName = this.formatGamepadName(remaining.id);
    } else {
      this.gamepadConnected = false;
      this.gamepadName = null;
      this.isGamepadFireDown = false;
      this.isGamepadAdsDown = false;
      this.gamepadSprintToggled = false;
      this.gamepadMove.x = 0;
      this.gamepadMove.z = 0;
      this.gamepadMove.sprint = false;
      this.gamepadMove.jump = false;
      this.syncScopeState();
    }
    this.emitHud();
  };

  private triggerGamepadRumble(durationMs: number, strongMagnitude: number, weakMagnitude: number): void {
    if (!this.gamepadConnected || !navigator.getGamepads) return;
    try {
      const pads = navigator.getGamepads();
      const pad =
        (this.activeGamepadIndex !== null ? pads[this.activeGamepadIndex] : null) ||
        Array.from(pads).find((p): p is Gamepad => Boolean(p && p.connected));
      const actuator = (pad as unknown as {
        vibrationActuator?: {
          playEffect?: (
            type: string,
            params: {
              startDelay: number;
              duration: number;
              weakMagnitude: number;
              strongMagnitude: number;
            }
          ) => Promise<unknown>;
        };
      })?.vibrationActuator;
      if (actuator && typeof actuator.playEffect === 'function') {
        void actuator
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude: THREE.MathUtils.clamp(weakMagnitude, 0, 1),
            strongMagnitude: THREE.MathUtils.clamp(strongMagnitude, 0, 1),
          })
          .catch(() => {});
      }
    } catch {
      // Ignore rumble on unsupported hardware
    }
  }

  private pollGamepad(dt: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;

    if (this.activeGamepadIndex !== null && pads[this.activeGamepadIndex]?.connected) {
      pad = pads[this.activeGamepadIndex];
    } else {
      for (let i = 0; i < pads.length; i++) {
        const candidate = pads[i];
        if (candidate && candidate.connected) {
          pad = candidate;
          this.activeGamepadIndex = candidate.index;
          break;
        }
      }
    }

    if (!pad) {
      if (this.gamepadConnected) {
        this.gamepadConnected = false;
        this.gamepadName = null;
        this.emitHud();
      }
      this.gamepadMove.x = 0;
      this.gamepadMove.z = 0;
      this.gamepadMove.sprint = false;
      this.gamepadMove.jump = false;
      return;
    }

    if (!this.gamepadConnected) {
      this.gamepadConnected = true;
      this.gamepadName = this.formatGamepadName(pad.id);
      this.emitHud();
    }

    const isPressed = (idx: number, threshold = 0.5): boolean => {
      const b = pad!.buttons[idx];
      if (!b) return false;
      return b.pressed || b.value >= threshold;
    };

    const justPressed = (idx: number): boolean => {
      const cur = isPressed(idx);
      const prev = Boolean(this.prevGamepadButtons[idx]);
      return cur && !prev;
    };

    // Menu & modal controls when not actively in combat
    if (this.state === 'START' && !this.isGenerating) {
      if (justPressed(0) || justPressed(9)) {
        this.startGame();
      } else if (justPressed(3) || justPressed(15)) {
        this.regenerateNewSeed();
      } else if (justPressed(8)) {
        this.toggleDebug();
      }
    } else if (this.state === 'PAUSED' && !this.isGenerating) {
      if (justPressed(9) || justPressed(0) || justPressed(1)) {
        this.resumeGame();
      } else if (justPressed(2)) {
        this.restartGame();
      } else if (justPressed(3)) {
        this.regenerateNewSeed();
      } else if (justPressed(8)) {
        this.toggleDebug();
      } else if (justPressed(14) || justPressed(15)) {
        const order: QualityPreset[] = ['LOW', 'MEDIUM', 'HIGH'];
        const curIdx = order.indexOf(this.quality);
        const dir = justPressed(15) ? 1 : -1;
        const nextPreset = order[(curIdx + dir + order.length) % order.length];
        this.setQuality(nextPreset);
      }
    } else if (this.state === 'GAMEOVER') {
      if (justPressed(0) || justPressed(9)) {
        this.restartGame();
      } else if (justPressed(3)) {
        this.regenerateNewSeed();
      }
    } else if (this.state === 'PLAYING') {
      // 1. Start / Options (button 9) pauses game
      if (justPressed(9)) {
        this.state = 'PAUSED';
        this.clearScopeInput();
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        this.emitHud();
        for (let i = 0; i < pad.buttons.length; i++) {
          this.prevGamepadButtons[i] = isPressed(i);
        }
        return;
      }

      // 2. Back / Select (button 8) toggles F3 Debug & Heightmap
      if (justPressed(8)) {
        this.toggleDebug();
      }

      // 3. D-Pad utilities: Left (14) = Mute Audio, Right (15) = New Seed (F4)
      if (justPressed(14)) {
        this.audio.toggleMute();
        this.emitHud();
      }
      if (justPressed(15)) {
        this.regenerateNewSeed();
      }

      // 4. Left Stick (axes[0], axes[1]) Analog Movement with Radial Deadzone
      const rawLx = pad.axes[0] ?? 0;
      const rawLy = pad.axes[1] ?? 0;
      const lMag = Math.hypot(rawLx, rawLy);
      const moveDeadzone = 0.14;
      if (lMag > moveDeadzone) {
        const normL = Math.min(1, (lMag - moveDeadzone) / (1 - moveDeadzone));
        this.gamepadMove.x = (rawLx / lMag) * normL;
        this.gamepadMove.z = (rawLy / lMag) * normL;
      } else {
        this.gamepadMove.x = 0;
        this.gamepadMove.z = 0;
        this.gamepadSprintToggled = false;
      }

      // L3 (button 10) toggles sprint while moving; LB (button 4) also sprints when hip-firing
      if (justPressed(10)) {
        this.gamepadSprintToggled = !this.gamepadSprintToggled;
        if (this.gamepadSprintToggled && this.isScopeToggled) {
          this.isScopeToggled = false;
          this.syncScopeState();
        }
      }
      this.gamepadMove.sprint =
        this.gamepadSprintToggled || (!this.weapon.isAds && isPressed(4));
      this.gamepadMove.jump = isPressed(0); // A / Cross = Jump

      // 5. Left Trigger (LT / L2, button 6) & R3 (button 11) Scope / ADS + Magnification
      const ltHeld = isPressed(6, 0.2);
      if (ltHeld !== this.isGamepadAdsDown) {
        this.isGamepadAdsDown = ltHeld;
        if (ltHeld) {
          this.isScopeToggled = false;
        }
        this.syncScopeState();
        this.emitHud();
      }

      if (justPressed(11)) {
        // R3: If holding LT, cycle zoom (2.0x/3.0x/4.0x); otherwise toggle scope
        if (ltHeld) {
          this.weapon.cycleScopeZoom();
        } else {
          this.isScopeToggled = !this.isScopeToggled;
          this.syncScopeState();
        }
        this.emitHud();
      }

      if (this.weapon.isAds) {
        if (justPressed(4) || justPressed(3)) {
          this.weapon.cycleScopeZoom();
          this.emitHud();
        } else if (justPressed(12)) {
          this.weapon.stepScopeZoom(1);
          this.emitHud();
        } else if (justPressed(13)) {
          this.weapon.stepScopeZoom(-1);
          this.emitHud();
        } else if (justPressed(1) && this.isScopeToggled) {
          this.isScopeToggled = false;
          this.syncScopeState();
          this.emitHud();
        }
      } else {
        if (justPressed(3) || justPressed(1) || justPressed(12)) {
          this.weapon.startInspect();
        }
        if (justPressed(13)) {
          this.toggleDebug();
        }
      }

      // 6. X / Square (button 2) = Reload
      if (justPressed(2)) {
        this.weapon.startReload(this.audio);
      }

      // 7. Right Trigger (RT / R2, button 7) or Right Bumper (RB / R1, button 5) = Fire
      const rtHeld = isPressed(7, 0.22) || isPressed(5, 0.5);
      if (rtHeld && !this.isGamepadFireDown) {
        this.isGamepadFireDown = true;
        this.handleShooting();
      } else if (!rtHeld) {
        this.isGamepadFireDown = false;
      }

      // 8. Right Stick (axes[2], axes[3]) Analog Look + Precision Response Curve + Aim Assist
      const rawRx = pad.axes[2] ?? 0;
      const rawRy = pad.axes[3] ?? 0;
      const rMag = Math.hypot(rawRx, rawRy);
      const lookDeadzone = 0.11;

      if (rMag > lookDeadzone) {
        const normR = Math.min(1, (rMag - lookDeadzone) / (1 - lookDeadzone));
        const curvedR = Math.pow(normR, 1.55);
        const rx = (rawRx / rMag) * curvedR;
        const ry = (rawRy / rMag) * curvedR;

        const fovRatio =
          Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) /
          Math.tan(THREE.MathUtils.degToRad(75 * 0.5));
        const adsLookScale = THREE.MathUtils.lerp(
          1.0,
          Math.max(0.24, fovRatio * 1.05),
          this.weapon.adsBlend
        );

        // Check if an active enemy is inside the aim-assist slowdown cone
        let assistSlowdown = 1.0;
        let assistYawDelta = 0;
        let assistPitchDelta = 0;
        const lookDirX = -Math.sin(this.player.yaw) * Math.cos(this.player.pitch);
        const lookDirY = Math.sin(this.player.pitch);
        const lookDirZ = -Math.cos(this.player.yaw) * Math.cos(this.player.pitch);
        const coneCos = this.weapon.adsBlend > 0.3 ? 0.994 : 0.988;

        for (let i = 0; i < this.enemies.length; i++) {
          const e = this.enemies[i];
          if (e.state !== 'CHASING') continue;
          const dx = e.group.position.x - this.player.position.x;
          const dy = e.group.position.y + 1.15 - this.player.position.y;
          const dz = e.group.position.z - this.player.position.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < 1.5 || dist > 68) continue;

          const dot = (dx * lookDirX + dy * lookDirY + dz * lookDirZ) / dist;
          if (dot > coneCos) {
            assistSlowdown = 0.62;
            const targetYaw = Math.atan2(-dx, -dz);
            let yawDiff = targetYaw - this.player.yaw;
            while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            const targetPitch = Math.asin(THREE.MathUtils.clamp(dy / dist, -0.95, 0.95));
            const pitchDiff = targetPitch - this.player.pitch;
            assistYawDelta = yawDiff * 1.65 * dt;
            assistPitchDelta = pitchDiff * 1.15 * dt;
            break;
          }
        }

        const baseYawSpeed = 2.75 * adsLookScale * assistSlowdown;
        const basePitchSpeed = 1.85 * adsLookScale * assistSlowdown;

        this.player.yaw -= rx * baseYawSpeed * dt - assistYawDelta;
        const maxPitch = Math.PI / 2 - 0.08;
        this.player.pitch = THREE.MathUtils.clamp(
          this.player.pitch - ry * basePitchSpeed * dt + assistPitchDelta,
          -maxPitch,
          maxPitch
        );

        this.weapon.onMouseMove(rx * 16, ry * 16);
      }
    }

    for (let i = 0; i < pad.buttons.length; i++) {
      this.prevGamepadButtons[i] = isPressed(i);
    }
  }

  private requestPointerLock(): void {
    try {
      const el = this.renderer.domElement;
      if (el.requestPointerLock) {
        const promise = el.requestPointerLock() as unknown as Promise<void>;
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {});
        }
      }
    } catch {
      // Ignore pointer lock restriction in constrained sandboxes
    }
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  private onContextMenu = (e: MouseEvent): void => {
    if (this.state === 'PLAYING' || e.target === this.renderer.domElement) {
      e.preventDefault();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.state !== 'PLAYING' || !this.weapon.isAds) return;
    if (Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    // Scroll up zooms in (+1), scroll down zooms out (-1)
    this.weapon.stepScopeZoom(e.deltaY < 0 ? 1 : -1);
    this.emitHud();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys[e.code] = true;

    // Section 11: F3 toggles debug overlay & collider outlines
    if (e.code === 'F3') {
      e.preventDefault();
      this.debugMode = !this.debugMode;
      if (this.map) {
        this.map.colliderDebugGroup.visible = this.debugMode;
      }
      this.emitHud();
      return;
    }

    // Section 11: F4 regenerates map with a new random seed
    if (e.code === 'F4') {
      e.preventDefault();
      this.regenerateNewSeed();
      return;
    }

    if (e.code === 'KeyM') {
      this.audio.toggleMute();
      this.emitHud();
    }

    if (this.state === 'PLAYING') {
      if (e.code === 'KeyR') {
        this.weapon.startReload(this.audio);
      } else if (e.code === 'KeyF') {
        this.weapon.startInspect();
      } else if (e.code === 'KeyQ' && !e.repeat) {
        this.isScopeToggled = !this.isScopeToggled;
        this.syncScopeState();
        this.emitHud();
      } else if (e.code === 'KeyV' && !e.repeat) {
        this.weapon.cycleScopeZoom();
        this.emitHud();
      } else if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && this.isScopeToggled) {
        this.isScopeToggled = false;
        this.syncScopeState();
      } else if (e.code === 'Escape') {
        this.state = 'PAUSED';
        this.clearScopeInput();
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        this.emitHud();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private onWindowBlur = (): void => {
    this.keys = {};
    this.isMouseDown = false;
    this.clearScopeInput();
  };

  private onPointerLockChange = (): void => {
    if (!document.pointerLockElement && this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.keys = {};
      this.isMouseDown = false;
      this.clearScopeInput();
      this.emitHud();
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.state !== 'PLAYING') return;
    if (
      document.pointerLockElement === this.renderer.domElement ||
      this.isMouseDown ||
      this.weapon.isAds
    ) {
      this.player.onMouseMove(e.movementX, e.movementY, this.weapon.adsBlend, this.camera.fov);
      this.weapon.onMouseMove(e.movementX, e.movementY);
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.state !== 'PLAYING') return;
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.requestPointerLock();
    }
    if (e.button === 0) {
      this.isMouseDown = true;
      this.handleShooting();
    } else if (e.button === 2) {
      e.preventDefault();
      this.isRmbDown = true;
      this.isScopeToggled = false;
      this.syncScopeState();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.isMouseDown = false;
    } else if (e.button === 2) {
      this.isRmbDown = false;
      this.syncScopeState();
    }
  };

  private onResize = (): void => {
    if (this.isDisposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = w / h;
    this.viewmodelCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || !gl.fenceSync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.isDisposed) return;
      const rawDt = this.clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      // Measure real FPS
      this.frameCounter++;
      this.fpsAccum += rawDt;
      if (this.fpsAccum >= 0.5) {
        this.fps = Math.round(this.frameCounter / this.fpsAccum);
        this.frameCounter = 0;
        this.fpsAccum = 0;
      }

      this.update(dt);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      if (this.weapon.group.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    this.clock.start();
    tick();
  }

  private update(dt: number): void {
    if (!this.map || this.isGenerating) return;

    this.pollGamepad(dt);

    const elapsed = this.clock.getElapsedTime();

    if (this.state === 'START') {
      if (Math.abs(this.camera.fov - 75) > 0.05) {
        this.camera.fov = 75;
        this.camera.updateProjectionMatrix();
      }
      this.titleOrbitAngle += dt * 0.16;
      const ox = Math.sin(this.titleOrbitAngle) * 52;
      const oz = Math.cos(this.titleOrbitAngle) * 52;
      this.camera.position.set(ox, 22, oz);
      this.camera.lookAt(0, 8, 0);
      this.weapon.group.visible = false;
      this.map.update(dt, elapsed, 0, 0);
      this.audio.updateAmbience(dt, ox, 22, oz, this.titleOrbitAngle, this.map, false);
      return;
    }

    this.weapon.group.visible = true;
    this.viewmodelCamera.position.copy(this.camera.position);
    this.viewmodelCamera.quaternion.copy(this.camera.quaternion);

    if (this.state !== 'PLAYING') {
      this.audio.updateAmbience(
        dt,
        this.player.position.x,
        this.player.position.y - this.player.eyeHeight,
        this.player.position.z,
        this.player.yaw,
        this.map,
        false
      );
      return;
    }

    // 1. Update Player, Weapon, Camera ADS FOV Zoom, Spatial Valley Ambience, and Map
    this.player.update(
      dt,
      this.keys,
      this.map,
      this.camera,
      this.audio,
      (rx, rz) => {
        this.spawnWaterRipple(rx, rz, 1.85);
      },
      this.weapon.adsBlend,
      this.gamepadMove,
      () => {
        this.triggerGamepadRumble(65, 0.5, 0.35);
      }
    );
    this.audio.updateAmbience(
      dt,
      this.player.position.x,
      this.player.position.y - this.player.eyeHeight,
      this.player.position.z,
      this.player.yaw,
      this.map,
      true
    );
    this.weapon.update(
      dt,
      this.player.isMoving,
      this.player.isSprinting,
      this.player.isGrounded
    );

    // Optical variable magnification zoom when scoping through the ACR EOTech sight (2.0x / 3.0x / 4.0x)
    const baseHalfTan = Math.tan(THREE.MathUtils.degToRad(75 * 0.5));
    const scopedWorldFov = THREE.MathUtils.radToDeg(
      2 * Math.atan(baseHalfTan / this.weapon.scopeZoom)
    );
    const targetFov = THREE.MathUtils.lerp(75, scopedWorldFov, this.weapon.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    const scopedVmFov = THREE.MathUtils.lerp(40, 35, (this.weapon.scopeZoom - 2) / 2);
    const vmTargetFov = THREE.MathUtils.lerp(54, scopedVmFov, this.weapon.adsBlend);
    if (Math.abs(this.viewmodelCamera.fov - vmTargetFov) > 0.01) {
      this.viewmodelCamera.fov = vmTargetFov;
      this.viewmodelCamera.updateProjectionMatrix();
    }
    this.viewmodelCamera.position.copy(this.camera.position);
    this.viewmodelCamera.quaternion.copy(this.camera.quaternion);

    this.map.update(dt, elapsed, this.player.position.x, this.player.position.z);

    // Update player-following directional shadow camera aligned with golden-hour sun (0.60, 0.36, -0.71)
    this.dirLight.position.set(
      this.player.position.x + 60,
      this.player.position.y + 36,
      this.player.position.z - 71
    );
    this.dirLight.target.position.copy(this.player.position);
    this.dirLight.target.updateMatrixWorld();

    this.vmDirLight.position.copy(this.dirLight.position);
    this.vmDirLight.target.position.copy(this.dirLight.target.position);
    this.vmDirLight.target.updateMatrixWorld();

    if (this.isMouseDown || this.isGamepadFireDown) {
      this.handleShooting();
    }

    // 2. Update Enemies, Distance Culling & Wave Progression
    const maxEnemyDrawDist = CONFIG.QUALITY[this.quality].vegDrawDist + 10;
    let aliveCount = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this.player.position, this.map, this.enemies, (dmg, attackerPos) => {
        this.player.hp = Math.max(0, this.player.hp - dmg);
        this.damageFlash = 0.85;
        this.lastAttackerPos = attackerPos.clone();
        this.damageAngleTimer = 1.1;
        this.audio.playHurt();
        this.triggerGamepadRumble(180, 0.88, 0.5);

        if (this.player.hp <= 0) {
          this.state = 'GAMEOVER';
          this.isMouseDown = false;
          this.clearScopeInput();
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
        }
      });

      if (e.state === 'DEAD') {
        e.dispose(this.scene);
        this.enemies.splice(i, 1);
      } else if (e.state === 'CHASING') {
        const dEnemy = Math.hypot(
          e.group.position.x - this.player.position.x,
          e.group.position.z - this.player.position.z
        );
        e.group.visible = dEnemy <= maxEnemyDrawDist;
        aliveCount++;
      }
    }

    if (aliveCount === 0 && this.enemies.length === 0) {
      if (this.waveIntermissionTimer === 0) {
        this.waveIntermissionTimer = 3.5;
        this.score += 250;
        this.waveBannerText = `WAVE ${this.wave} CLEARED — NEXT WAVE IN 3s`;
        this.waveBannerTimer = 3.2;
      } else {
        this.waveIntermissionTimer -= dt;
        if (this.waveIntermissionTimer <= 0) {
          this.waveIntermissionTimer = 0;
          this.spawnWave(this.wave + 1);
        }
      }
    }

    // 3. Update Pickups & Object Pools
    this.pickupManager.update(dt, this.player, this.weapon, this.audio);
    this.updatePools(dt);

    // 4. Decay HUD timers
    if (this.hitMarkerTimer > 0) this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    if (this.damageAngleTimer > 0) {
      this.damageAngleTimer = Math.max(0, this.damageAngleTimer - dt);
      if (this.damageAngleTimer <= 0) this.lastAttackerPos = null;
    }
    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);
      if (this.waveBannerTimer <= 0) this.waveBannerText = null;
    }

    this.emitHud();
  }

  public emitHud(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    const projectedDamages: FloatingDamage[] = [];
    for (const fd of this.floatingDamages) {
      _projVec.copy(fd.worldPos).project(this.camera);
      if (_projVec.z < 1) {
        projectedDamages.push({
          id: fd.id,
          amount: fd.amount,
          isHeadshot: fd.isHeadshot,
          x: ((_projVec.x + 1) * 0.5) * w,
          y: ((-_projVec.y + 1) * 0.5) * h,
          opacity: Math.max(0, 1 - fd.age / 0.75),
        });
      }
    }

    let damageAngle: number | null = null;
    if (this.lastAttackerPos && this.damageAngleTimer > 0) {
      const dx = this.lastAttackerPos.x - this.player.position.x;
      const dz = this.lastAttackerPos.z - this.player.position.z;
      const worldAngle = Math.atan2(-dx, -dz);
      damageAngle = worldAngle - this.player.yaw;
    }

    const radarBlips: RadarBlip[] = [];
    let enemiesRemaining = 0;
    for (const e of this.enemies) {
      if (e.state === 'CHASING') {
        enemiesRemaining++;
        radarBlips.push({
          x: e.group.position.x,
          z: e.group.position.z,
          type: 'enemy',
        });
      }
    }
    for (const p of this.pickupManager.pickups) {
      if (!p.active) continue;
      radarBlips.push({
        x: p.position.x,
        z: p.position.z,
        type: p.type,
      });
    }

    const baseSpread = 8;
    const moveSpread = this.player.isMoving ? (this.player.isSprinting ? 12 : 6) : 0;
    const airSpread = !this.player.isGrounded ? 10 : 0;
    const recoilSpread = this.player.recoilPitch * 180;
    const adsSpreadFactor = THREE.MathUtils.lerp(1.0, 0.25, this.weapon.adsBlend);

    const biomeInfo = this.map
      ? this.map.getBiomeAt(this.player.position.x, this.player.position.z)
      : { name: 'Short Grass' };

    let reticleOffsetX = 0;
    let reticleOffsetY = 0;
    if (this.weapon.adsBlend > 0.05 && this.weapon.getReticleWorldPosition(_projVec)) {
      _projVec.project(this.viewmodelCamera);
      if (_projVec.z < 1) {
        reticleOffsetX = _projVec.x * w * 0.5;
        reticleOffsetY = -_projVec.y * h * 0.5;
      }
    }

    this.onHudUpdate({
      state: this.state,
      isGenerating: this.isGenerating,
      generationProgress: this.generationProgress,
      seed: this.seed,
      quality: this.quality,
      debugMode: this.debugMode,
      fps: this.fps,
      playerX: this.player.position.x,
      playerY: this.player.position.y - this.player.eyeHeight,
      playerZ: this.player.position.z,
      playerYaw: this.player.yaw,
      playerSlope: this.player.currentSlope,
      currentBiome: biomeInfo.name,
      inWater: this.player.inShallowWater,
      heightmapDataUrl: this.map ? this.map.heightmapDataUrl : '',
      minimapSplatCanvas: this.map ? this.map.minimapSplatCanvas : null,
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      magAmmo: this.weapon.magAmmo,
      maxMagAmmo: this.weapon.maxMagAmmo,
      reserveAmmo: this.weapon.reserveAmmo,
      isReloading: this.weapon.isReloading,
      reloadProgress: this.weapon.isReloading
        ? Math.min(1, this.weapon.reloadTimer / this.weapon.reloadDuration)
        : 0,
      adsBlend: this.weapon.adsBlend,
      scopeZoom: this.weapon.scopeZoom,
      reticleOffsetX,
      reticleOffsetY,
      wave: this.wave,
      enemiesRemaining,
      waveBannerText: this.waveBannerText,
      score: this.score,
      kills: this.kills,
      headshots: this.headshots,
      crosshairSpread: (baseSpread + moveSpread + airSpread + recoilSpread) * adsSpreadFactor,
      hitMarkerTimer: this.hitMarkerTimer,
      hitMarkerHeadshot: this.hitMarkerHeadshot,
      damageFlash: this.damageFlash,
      damageAngle,
      isMuted: this.audio.isMuted,
      gamepadConnected: this.gamepadConnected,
      gamepadName: this.gamepadName,
      floatingDamages: projectedDamages,
      radarBlips,
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);

    if (this.map) {
      this.map.dispose(this.scene);
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
