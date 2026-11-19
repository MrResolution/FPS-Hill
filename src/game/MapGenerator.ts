import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const CRATE_BASE_W = 1.9633;
const CRATE_BASE_H = 1.6330;
const CRATE_BASE_D = 1.6978;

let crateGeometryPromise: Promise<THREE.BufferGeometry> | null = null;

function loadCrateGeometry(): Promise<THREE.BufferGeometry> {
  if (!crateGeometryPromise) {
    crateGeometryPromise = new Promise((resolve, reject) => {
      const loader = new FBXLoader();
      loader.load(
        '/models/Crate.fbx',
        (group) => {
          group.updateMatrixWorld(true);
          let sourceMesh: THREE.Mesh | null = null;
          group.traverse((obj) => {
            if (!sourceMesh && (obj as THREE.Mesh).isMesh) {
              sourceMesh = obj as THREE.Mesh;
            }
          });
          if (!sourceMesh) {
            crateGeometryPromise = null;
            reject(new Error('No mesh found inside /models/Crate.fbx'));
            return;
          }

          const mesh = sourceMesh as THREE.Mesh;
          const geo = mesh.geometry.clone();
          // Bake parent FBX unit scale (0.01 cm->m) into geometry vertices
          geo.applyMatrix4(mesh.matrixWorld);
          geo.computeBoundingBox();

          if (geo.boundingBox) {
            const center = new THREE.Vector3();
            geo.boundingBox.getCenter(center);
            const minY = geo.boundingBox.min.y;
            geo.translate(-center.x, -minY, -center.z);
          }

          // Sanitize any non-finite UV coordinates present in the FBX mesh
          const uv = geo.getAttribute('uv');
          const pos = geo.getAttribute('position');
          if (uv && pos) {
            let fixedUv = false;
            for (let i = 0; i < uv.count; i++) {
              const u = uv.getX(i);
              const v = uv.getY(i);
              if (!Number.isFinite(u) || !Number.isFinite(v)) {
                const px = pos.getX(i);
                const py = pos.getY(i);
                const pz = pos.getZ(i);
                uv.setXY(i, (px + pz) * 0.45 + 0.5, py * 0.45);
                fixedUv = true;
              }
            }
            if (fixedUv) {
              uv.needsUpdate = true;
            }
          }

          geo.computeBoundingBox();
          geo.computeBoundingSphere();
          resolve(geo);
        },
        undefined,
        (err) => {
          crateGeometryPromise = null;
          reject(err);
        }
      );
    });
  }
  return crateGeometryPromise;
}

interface ShapesparkPrimitiveSpec {
  geometry: THREE.BufferGeometry;
  baseMaterial: THREE.MeshStandardMaterial;
  materialName: string;
  isTrunk: boolean;
}

interface ShapesparkPlantCatalog {
  variants: Map<string, ShapesparkPrimitiveSpec[]>;
}

let shapesparkCatalogPromise: Promise<ShapesparkPlantCatalog> | null = null;

function loadShapesparkPlantCatalog(): Promise<ShapesparkPlantCatalog> {
  if (!shapesparkCatalogPromise) {
    shapesparkCatalogPromise = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        '/plants/shapespark_plants.gltf',
        (gltf) => {
          const variants = new Map<string, ShapesparkPrimitiveSpec[]>();
          for (const child of gltf.scene.children) {
            if (!child.name) continue;
            const prims: ShapesparkPrimitiveSpec[] = [];
            child.traverse((obj) => {
              if ((obj as THREE.Mesh).isMesh) {
                const mesh = obj as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                const matName = mat?.name || '';
                prims.push({
                  geometry: mesh.geometry,
                  baseMaterial: mat,
                  materialName: matName,
                  isTrunk: matName.startsWith('trunk'),
                });
              }
            });
            if (prims.length > 0) {
              variants.set(child.name, prims);
            }
          }
          resolve({ variants });
        },
        undefined,
        (err) => {
          shapesparkCatalogPromise = null;
          reject(err);
        }
      );
    });
  }
  return shapesparkCatalogPromise;
}

// ============================================================================
// TOP-LEVEL TUNABLE CONFIGURATION (Section 11 Requirement)
// ============================================================================
export type QualityPreset = 'LOW' | 'MEDIUM' | 'HIGH';

export const CONFIG = {
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
  ROCK_COUNT: 38,
  GRASS_COUNT: 18000,
  REED_COUNT: 200,
  GRASS_RADIUS: 52,
  FOG_DENSITY: 0.0068,
  PICKUP_RESPAWN_TIME: 60.0,
  PLAYER_SPAWN: { x: 0, z: 95 },
  ENEMY_SPAWNS: [
    { x: -90, z: -90 },
    { x: 90, z: -90 },
    { x: -95, z: 10 },
    { x: 100, z: 30 },
    { x: -60, z: 90 },
    { x: 80, z: 90 },
    { x: 0, z: -105 },
    { x: -40, z: -60 },
  ],
  HEALTH_PADS: [
    { x: -3, z: 3, label: 'The Knoll Outpost' },
    { x: 74, z: 52, label: 'Southeast Lake Dock' },
    { x: 30, z: -57, label: 'North Forest Hut' },
    { x: -70, z: -27, label: 'West Stone Hut' },
  ],
  AMMO_PADS: [
    { x: -30, z: 30, label: 'River Bridge' },
    { x: 42, z: 20, label: 'East Road Midpoint' },
    { x: 4.5, z: -1.5, label: 'Watchtower Base' },
    { x: -60, z: 60, label: 'Southwest Meadow' },
  ],
  QUALITY: {
    LOW: { grassCount: 6000, shadowMapSize: 1024, vegDrawDist: 105 },
    MEDIUM: { grassCount: 12000, shadowMapSize: 2048, vegDrawDist: 135 },
    HIGH: { grassCount: 18000, shadowMapSize: 2048, vegDrawDist: 165 },
  } as Record<QualityPreset, { grassCount: number; shadowMapSize: number; vegDrawDist: number }>,
};

export const BIOME_NAMES = [
  'Water',
  'Sand / Mud',
  'Short Grass',
  'Dark Forest Floor',
  'Rock (Slope > 35°)',
  'High Rock (> 9m)',
  'Dirt Road',
] as const;

export type BiomeId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ============================================================================
// SEEDED PRNG (mulberry32) & FRACTAL VALUE NOISE
// ============================================================================
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, x));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

class SeededNoise2D {
  private table = new Float32Array(4096);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    for (let i = 0; i < 4096; i++) {
      this.table[i] = rand();
    }
  }

  private val(ix: number, iz: number): number {
    return this.table[((iz & 63) << 6) | (ix & 63)];
  }

  public sample(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const u = fx * fx * (3 - 2 * fx);
    const w = fz * fz * (3 - 2 * fz);
    const a = this.val(ix, iz) * (1 - u) + this.val(ix + 1, iz) * u;
    const b = this.val(ix, iz + 1) * (1 - u) + this.val(ix + 1, iz + 1) * u;
    return a * (1 - w) + b * w;
  }

  public fbm(x: number, z: number, octaves = 5, freq = 0.012, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1.0;
    let f = freq;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.sample(x * f + i * 17.3, z * f + i * 9.1);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function distToPolyline(px: number, pz: number, pts: [number, number][]): number {
  let minD = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

// ============================================================================
// COLLIDER & SPATIAL HASH TYPES
// ============================================================================
export interface CylinderCollider {
  type: 'cylinder';
  x: number;
  z: number;
  r: number;
  minY: number;
  maxY: number;
}

export interface AabbCollider {
  type: 'aabb';
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  walkableTop?: boolean;
  isRamp?: boolean;
  rampAxis?: 'x' | 'z';
  rampStartY?: number;
  rampEndY?: number;
  yaw?: number;
}

export type MapCollider = CylinderCollider | AabbCollider;

export interface BridgeSpec {
  cx: number;
  cz: number;
  yaw: number;
  spanLen: number;
  deckW: number;
  rampLen: number;
  minDeckY: number;
}

export const BRIDGE_LOCATIONS: BridgeSpec[] = [
  { cx: -30, cz: 30, yaw: 0, spanLen: 13.6, deckW: 5.4, rampLen: 3.6, minDeckY: 1.95 },
  { cx: 37.43, cz: 49.03, yaw: -0.3547, spanLen: 12.8, deckW: 5.2, rampLen: 3.6, minDeckY: 1.85 },
];

export function isPointInBridge(
  wx: number,
  wz: number,
  b: BridgeSpec,
  extraW = 0,
  extraL = 0
): boolean {
  const dx = wx - b.cx;
  const dz = wz - b.cz;
  const cosY = Math.cos(b.yaw);
  const sinY = Math.sin(b.yaw);
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;
  return Math.abs(lx) < b.deckW * 0.5 + extraW && Math.abs(lz) < b.spanLen * 0.5 + b.rampLen + extraL;
}

// ============================================================================
// SPLINE DEFINITIONS (River & Catmull-Rom Road)
// ============================================================================
export const RIVER_CONTROL_PTS: [number, number][] = [
  [60, 55],
  [35, 48],
  [10, 50],
  [-15, 38],
  [-30, 30],
  [-60, 25],
  [-90, 24],
  [-120, 20],
];

const ROAD_CONTROL_VEC3 = [
  new THREE.Vector3(0, 0, 100),
  new THREE.Vector3(15, 0, 80),
  new THREE.Vector3(35, 0, 55),
  new THREE.Vector3(42, 0, 20),
  new THREE.Vector3(32, 0, -22),
  new THREE.Vector3(8, 0, -42),
  new THREE.Vector3(-10, 0, -68),
  new THREE.Vector3(0, 0, -100),
];

const roadCurve = new THREE.CatmullRomCurve3(ROAD_CONTROL_VEC3);
export const ROAD_POLYLINE: [number, number][] = roadCurve.getPoints(48).map((v) => [v.x, v.z]);

const riverCurve = new THREE.CatmullRomCurve3(
  RIVER_CONTROL_PTS.map(([x, z]) => new THREE.Vector3(x, CONFIG.WATER_LEVEL + 0.04, z))
);
const _flowPt = new THREE.Vector3();
const _flowTan = new THREE.Vector3();
const _flowDummy = new THREE.Object3D();

// ============================================================================
// MAIN MOSSY HOLLOW MAP GENERATOR CLASS
// ============================================================================
export class MossyHollowMap {
  public readonly seed: number;
  public readonly heights: Float32Array;
  public readonly slopes: Float32Array;
  public readonly normals: Float32Array;
  public readonly biomes: Uint8Array;
  public readonly vegDensity: Float32Array;

  public readonly rootGroup = new THREE.Group();
  public readonly colliderDebugGroup = new THREE.Group();
  public readonly shootables: THREE.Object3D[] = [];
  public readonly allColliders: MapCollider[] = [];
  public readonly spatialGrid = new Map<string, MapCollider[]>();

  // Coarse 48x48 navigation grid (cell size = 5 units) for enemy A* pathfinding
  public readonly navGridSize = 48;
  public readonly navCellSize = 5;
  public readonly navBlocked = new Uint8Array(48 * 48);

  public heightmapDataUrl = '';
  public minimapSplatCanvas: HTMLCanvasElement;

  public waterMesh!: THREE.Mesh;
  private skyDome!: THREE.Mesh;
  private fogBarrierGroup = new THREE.Group();
  private currentQuality: QualityPreset = 'HIGH';
  private waterColorTex!: THREE.CanvasTexture;
  private waterNormalTex!: THREE.CanvasTexture;
  private riverFlowInstanced!: THREE.InstancedMesh;
  private riverFlowParticles: {
    t: number;
    lat: number;
    speed: number;
    length: number;
    width: number;
    phase: number;
  }[] = [];
  private cloudGroup = new THREE.Group();
  private grassInstanced!: THREE.InstancedMesh;
  private grassOffsets: { dx: number; dz: number; rot: number; scale: number }[] = [];
  private readonly grassGridRes = 512;
  private grassObjDist = new Float32Array(512 * 512).fill(10.0);
  private grassPushX = new Float32Array(512 * 512);
  private grassPushZ = new Float32Array(512 * 512);
  private rockStoneFootprints: { x: number; z: number; r: number }[] = [];
  private bushFootprints: { x: number; z: number }[] = [];
  private staticVegSets: {
    meshes: THREE.InstancedMesh[];
    coloredMeshes?: THREE.InstancedMesh[];
    items: {
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      sx: number;
      sy: number;
      sz: number;
      color?: THREE.Color;
    }[];
  }[] = [];
  private lastCullCenterX = 9999;
  private lastCullCenterZ = 9999;
  private windUniforms: {
    uTime: { value: number };
    uFogBarrierDist: { value: number };
    uPlayerPos: { value: THREE.Vector3 };
  } = {
    uTime: { value: 0 },
    uFogBarrierDist: { value: CONFIG.QUALITY.HIGH.vegDrawDist },
    uPlayerPos: { value: new THREE.Vector3(CONFIG.PLAYER_SPAWN.x, 0, CONFIG.PLAYER_SPAWN.z) },
  };
  private disposables: { dispose: () => void }[] = [];
  private isDisposed = false;

  constructor(
    scene: THREE.Scene,
    seed = CONFIG.SEED,
    quality: QualityPreset = 'HIGH',
    isSoftwareGl = false
  ) {
    this.seed = seed;
    this.currentQuality = quality;
    this.windUniforms.uFogBarrierDist.value = CONFIG.QUALITY[quality].vegDrawDist;
    const N = CONFIG.GRID_RES; // 257
    this.heights = new Float32Array(N * N);
    this.slopes = new Float32Array(N * N);
    this.normals = new Float32Array(N * N * 3);
    this.biomes = new Uint8Array(N * N);
    this.vegDensity = new Float32Array(256 * 256);
    this.minimapSplatCanvas = document.createElement('canvas');

    this.generateHeightfield();
    this.computeNormalsAndSlopes();
    this.generateVegetationAndBiomes();
    this.generateHeightmapPreview();

    this.buildSkyAndAtmosphere(isSoftwareGl);
    this.buildTerrainMesh(isSoftwareGl);
    this.buildWaterMesh();
    this.buildStructures(isSoftwareGl);
    this.buildVegetationInstances(quality, isSoftwareGl);
    this.buildCrates(isSoftwareGl);
    this.buildGrassObstacleField();
    this.lastGrassCenterX = 9999;
    this.updateGrassAroundPlayer(CONFIG.PLAYER_SPAWN.x, CONFIG.PLAYER_SPAWN.z);
    this.buildNavGrid();

    this.colliderDebugGroup.visible = false;
    this.rootGroup.add(this.colliderDebugGroup);
    scene.add(this.rootGroup);
  }

  // --------------------------------------------------------------------------
  // 2. TERRAIN HEIGHT MAP GENERATION (257x257 Float32Array)
  // --------------------------------------------------------------------------
  private generateHeightfield(): void {
    const N = CONFIG.GRID_RES;
    const step = CONFIG.MAP_SIZE / (N - 1);
    const noise = new SeededNoise2D(this.seed);
    const raw = new Float32Array(N * N);

    for (let j = 0; j < N; j++) {
      const z = -CONFIG.HALF_SIZE + j * step;
      for (let i = 0; i < N; i++) {
        const x = -CONFIG.HALF_SIZE + i * step;

        // 1. Base 5-octave fractal noise (freq 0.012, lacunarity 2.0, gain 0.5) scaled 0..6
        let y = noise.fbm(x, z, 5, 0.012, 2.0, 0.5) * 6.0;

        // 2a. Central Hill ("The Knoll"): center (0,0), radius 35, height +10, plateau radius 10
        const dKnoll = Math.hypot(x, z);
        const knollFactor = 1.0 - smoothstep(10, 35, dKnoll);
        y += 10.0 * knollFactor;
        if (dKnoll < 12) {
          const plateauBlend = 1.0 - smoothstep(8, 12, dKnoll);
          y = lerp(y, 11.8, plateauBlend * 0.85);
        }

        // 2b. Northwest Ridge: elongated ridge (-100, -80) to (-40, -100), width 25, height +12
        const dRidge = distToSegment(x, z, -100, -80, -40, -100);
        y += 12.0 * (1.0 - smoothstep(0, 25, dRidge));

        // 2c. Southeast Lake Basin: center (60, 55), radius 30, depth -6 (below y=0)
        const dLake = Math.hypot(x - 60, z - 55);
        const lakeBlend = 1.0 - smoothstep(6, 30, dLake);
        y = lerp(y, -3.6, lakeBlend);

        // 2d. Southwest Meadow: center (-60, 60), radius 30, flatten to 1.5
        const dMeadow = Math.hypot(x - -60, z - 60);
        const meadowBlend = 1.0 - smoothstep(8, 30, dMeadow);
        y = lerp(y, 1.5, meadowBlend);

        // 2e. Northeast Highlands: center (80, -70), radius 30, height +8 with rocky noise
        const dHigh = Math.hypot(x - 80, z - -70);
        const highBlend = 1.0 - smoothstep(6, 30, dHigh);
        y += highBlend * (8.0 + noise.sample(x * 0.1, z * 0.1) * 2.8);

        // 3. River spline from (60, 55) to (-120, 20): width 6, depth -2 with smoothed banks
        const dRiver = distToPolyline(x, z, RIVER_CONTROL_PTS);
        const riverBlend = 1.0 - smoothstep(1.8, 6.5, dRiver);
        y = lerp(y, -1.35, riverBlend);

        // 4. Winding dirt road causeway (keep road embankment dry above lake level while preserving river channel)
        const dRoad = distToPolyline(x, z, ROAD_POLYLINE);
        if (dRoad < 5.8 && dRiver > 4.6) {
          const roadBlend =
            (1.0 - smoothstep(2.2, 5.8, dRoad)) * 0.78 * smoothstep(4.6, 7.6, dRiver);
          y = lerp(y, Math.max(1.25, y * 0.92), roadBlend);
        }

        // 5. Edge mountains: ramp from 0 to 14 in outer 20 units on all four sides
        const edgeDist = Math.min(CONFIG.HALF_SIZE - Math.abs(x), CONFIG.HALF_SIZE - Math.abs(z));
        if (edgeDist < 20) {
          const edgeRamp = 1.0 - smoothstep(0, 20, edgeDist);
          y += 14.0 * edgeRamp;
        }

        raw[j * N + i] = clamp(y, -6.0, CONFIG.MAX_HEIGHT + 2);
      }
    }

    // 5a. One 3x3 box-blur pass
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let sum = 0;
        let count = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = i + di;
            const nj = j + dj;
            if (ni >= 0 && nj >= 0 && ni < N && nj < N) {
              sum += raw[nj * N + ni];
              count++;
            }
          }
        }
        this.heights[j * N + i] = sum / count;
      }
    }

    // 5b. Flatten pads (blend radius 5) for Outpost, Huts, Player Spawn, Lake Port shore, and Pickups
    const pads: { x: number; z: number; r: number; fixedH?: number }[] = [
      { x: 0, z: 0, r: 9 }, // Outpost plateau
      { x: 0, z: 95, r: 5 }, // Player spawn
      { x: -70, z: -30, r: 5 }, // Hut 1
      { x: 70, z: 70, r: 5 }, // Hut 2
      { x: 30, z: -60, r: 5 }, // Hut 3
      { x: -60, z: 60, r: 5 }, // Meadow ammo pad
      { x: 86.2, z: 52, r: 3.4, fixedH: 0.86 }, // East shore landing pad behind Lake Port abutment
    ];

    for (const pad of pads) {
      const targetH = pad.fixedH ?? Math.max(1.2, this.getHeightAt(pad.x, pad.z));
      const blendR = pad.r + 5;
      for (let j = 0; j < N; j++) {
        const z = -CONFIG.HALF_SIZE + j * step;
        if (Math.abs(z - pad.z) > blendR) continue;
        for (let i = 0; i < N; i++) {
          const x = -CONFIG.HALF_SIZE + i * step;
          const d = Math.hypot(x - pad.x, z - pad.z);
          if (d < blendR) {
            const t = 1.0 - smoothstep(pad.r * 0.6, blendR, d);
            const idx = j * N + i;
            this.heights[idx] = lerp(this.heights[idx], targetH, t);
          }
        }
      }
    }

    // Carve clean water clearance underneath the Wooden Lake Port deck (x: 69.5..82.8, z: 48.8..55.2)
    // so the shore terrain never pokes through or Z-fights with the wooden pier planks
    for (let j = 0; j < N; j++) {
      const z = -CONFIG.HALF_SIZE + j * step;
      if (z < 47.0 || z > 57.0) continue;
      const zT = 1.0 - smoothstep(2.2, 4.6, Math.abs(z - 52.0));
      if (zT <= 0) continue;
      for (let i = 0; i < N; i++) {
        const x = -CONFIG.HALF_SIZE + i * step;
        if (x < 68.5 || x > 83.2) continue;
        // Smoothly slope seabed from -2.2m under the pier up to -0.45m right in front of the stone abutment (x=82.8)
        const shoreT = smoothstep(79.5, 83.1, x);
        const maxAllowedY = lerp(-2.2, -0.35, shoreT);
        const idx = j * N + i;
        if (this.heights[idx] > maxAllowedY) {
          this.heights[idx] = lerp(this.heights[idx], maxAllowedY, zT);
        }
      }
    }

    // 5c. Grade level earth approach embankments at both River Bridges so ramp toes and wing-walls
    // sit flush on solid, level ground across their full width while keeping the under-bridge channel deep
    for (const b of BRIDGE_LOCATIONS) {
      const cosY = Math.cos(b.yaw);
      const sinY = Math.sin(b.yaw);
      const halfSpan = b.spanLen * 0.5;
      const rampEnd = halfSpan + b.rampLen;
      const toWorldPt = (lx: number, lz: number) => ({
        x: b.cx + lx * cosY + lz * sinY,
        z: b.cz - lx * sinY + lz * cosY,
      });

      const northSamplePt = toWorldPt(0, -(rampEnd + 1.5));
      const southSamplePt = toWorldPt(0, rampEnd + 1.5);
      const northBankY = clamp(this.getHeightAt(northSamplePt.x, northSamplePt.z), 1.3, 1.65);
      const southBankY = clamp(this.getHeightAt(southSamplePt.x, southSamplePt.z), 1.3, 1.65);

      const maxRadius = rampEnd + 8.0;
      for (let j = 0; j < N; j++) {
        const z = -CONFIG.HALF_SIZE + j * step;
        if (Math.abs(z - b.cz) > maxRadius) continue;
        for (let i = 0; i < N; i++) {
          const x = -CONFIG.HALF_SIZE + i * step;
          if (Math.abs(x - b.cx) > maxRadius) continue;

          const dx = x - b.cx;
          const dz = z - b.cz;
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;
          const absLx = Math.abs(lx);
          const absLz = Math.abs(lz);
          const idx = j * N + i;

          // Keep central river channel under bridge span carved deep below water
          if (absLz < halfSpan - 1.0 && absLx < b.deckW * 0.5 + 3.8) {
            const chanW =
              (1.0 - smoothstep(halfSpan - 2.4, halfSpan - 1.0, absLz)) *
              (1.0 - smoothstep(b.deckW * 0.5 + 1.2, b.deckW * 0.5 + 3.8, absLx));
            this.heights[idx] = lerp(this.heights[idx], Math.min(this.heights[idx], -1.35), chanW);
          }

          // Grade level earth embankment under abutments & approach ramps (no sideways tilt or lake undercut)
          if (absLz >= halfSpan - 0.8 && absLz <= rampEnd + 7.0 && absLx <= b.deckW * 0.5 + 6.0) {
            const bankTarget = lz < 0 ? northBankY : southBankY;
            // Under the ramp itself (halfSpan..rampEnd), recessed by 0.15m towards abutment so terrain never pokes through wooden planks
            const underRampRecess =
              (1.0 - smoothstep(halfSpan - 0.2, rampEnd - 0.2, absLz)) * 0.22;
            const targetH = bankTarget - underRampRecess;

            const latBlend = 1.0 - smoothstep(b.deckW * 0.5 + 1.5, b.deckW * 0.5 + 6.0, absLx);
            const lonBlend =
              smoothstep(halfSpan - 0.8, halfSpan - 0.05, absLz) *
              (1.0 - smoothstep(rampEnd + 2.2, rampEnd + 7.0, absLz));
            const w = latBlend * lonBlend;
            this.heights[idx] = lerp(this.heights[idx], targetH, w);
          }
        }
      }
    }
  }

  private computeNormalsAndSlopes(): void {
    const N = CONFIG.GRID_RES;
    const step = CONFIG.MAP_SIZE / (N - 1);
    const sampleIdx = (i: number, j: number) =>
      this.heights[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const dhdx = (sampleIdx(i + 1, j) - sampleIdx(i - 1, j)) / (2 * step);
        const dhdz = (sampleIdx(i, j + 1) - sampleIdx(i, j - 1)) / (2 * step);

        // Normal vector (-dhdx, 1, -dhdz) normalized
        const nx = -dhdx;
        const ny = 1.0;
        const nz = -dhdz;
        const len = Math.hypot(nx, ny, nz);
        this.normals[k * 3] = nx / len;
        this.normals[k * 3 + 1] = ny / len;
        this.normals[k * 3 + 2] = nz / len;

        // Slope in degrees
        const grad = Math.hypot(dhdx, dhdz);
        this.slopes[k] = (Math.atan(grad) * 180) / Math.PI;
      }
    }
  }

  // --------------------------------------------------------------------------
  // EXPORTED TERRAIN QUERIES (Bilinear Height, Normal, Slope, Biome)
  // --------------------------------------------------------------------------
  public getHeightAt(x: number, z: number): number {
    const N = CONFIG.GRID_RES;
    const u = clamp((x + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE, 0, 1) * (N - 1);
    const v = clamp((z + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE, 0, 1) * (N - 1);
    const i0 = Math.min(N - 2, Math.floor(u));
    const j0 = Math.min(N - 2, Math.floor(v));
    const fx = u - i0;
    const fz = v - j0;

    const h00 = this.heights[j0 * N + i0];
    const h10 = this.heights[j0 * N + (i0 + 1)];
    const h01 = this.heights[(j0 + 1) * N + i0];
    const h11 = this.heights[(j0 + 1) * N + (i0 + 1)];

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    return h0 * (1 - fz) + h1 * fz;
  }

  public getNormalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    const N = CONFIG.GRID_RES;
    const i = clamp(Math.round(((x + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    const j = clamp(Math.round(((z + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    const k = (j * N + i) * 3;
    return target.set(this.normals[k], this.normals[k + 1], this.normals[k + 2]);
  }

  public getSlopeAt(x: number, z: number): number {
    const N = CONFIG.GRID_RES;
    const i = clamp(Math.round(((x + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    const j = clamp(Math.round(((z + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    return this.slopes[j * N + i];
  }

  public getBiomeAt(x: number, z: number): { id: BiomeId; name: string } {
    const N = CONFIG.GRID_RES;
    const i = clamp(Math.round(((x + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    const j = clamp(Math.round(((z + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * (N - 1)), 0, N - 1);
    const id = (this.biomes[j * N + i] as BiomeId) || 0;
    return { id, name: BIOME_NAMES[id] };
  }

  // --------------------------------------------------------------------------
  // 3 & 4. VEGETATION DENSITY MAP & BIOME CLASSIFICATION
  // --------------------------------------------------------------------------
  private generateVegetationAndBiomes(): void {
    const N = CONFIG.GRID_RES;
    const step = CONFIG.MAP_SIZE / (N - 1);
    const vegNoise = new SeededNoise2D(this.seed + 99);

    for (let j = 0; j < N; j++) {
      const z = -CONFIG.HALF_SIZE + j * step;
      for (let i = 0; i < N; i++) {
        const x = -CONFIG.HALF_SIZE + i * step;
        const k = j * N + i;
        const y = this.heights[k];
        const slope = this.slopes[k];
        const dRoad = distToPolyline(x, z, ROAD_POLYLINE);
        const dRiver = distToPolyline(x, z, RIVER_CONTROL_PTS);

        // Vegetation density calculation
        let d = smoothstep(0.32, 0.75, vegNoise.sample(x * 0.03, z * 0.03));

        // Boost in North Forest (-10, -75, r=40) and East Woods (95, 20, r=30)
        const northForest = 1.0 - smoothstep(0, 40, Math.hypot(x - -10, z - -75));
        const eastWoods = 1.0 - smoothstep(0, 30, Math.hypot(x - 95, z - 20));
        d = Math.min(1.0, d + 0.55 * Math.max(northForest, eastWoods));

        // Slope mask (0 above 30°) and height mask (0 above 9 and below 0.8)
        d *= 1.0 - smoothstep(24, 30, slope);
        d *= smoothstep(0.8, 1.5, y) * (1.0 - smoothstep(8.0, 9.0, y));

        // Reduce density in Southwest Meadow (-60, 60, r=30) to ~0.15
        const swMeadow = 1.0 - smoothstep(14, 30, Math.hypot(x - -60, z - 60));
        d *= 1.0 - 0.85 * swMeadow;

        // Zero density near road, outpost plateau, bridge, dock, player spawn, huts, entrances, and pickups
        if (this.isInClearZone(x, z, 0)) {
          d = 0;
        }

        if (i < 256 && j < 256) {
          this.vegDensity[j * 256 + i] = clamp(d, 0, 1);
        }

        // Biome ID classification
        let bioId: BiomeId = 2; // Short grass default
        if (y < 0.0) bioId = 0; // Water
        else if (y < 0.8 || dRiver < 4.0) bioId = 1; // Sand / mud
        else if (dRoad < 3.4) bioId = 6; // Dirt road
        else if (slope > 35.0) bioId = 4; // Steep Rock
        else if (y > 9.0) bioId = 5; // High rock / dirt
        else if (d > 0.52) bioId = 3; // Dark forest floor

        this.biomes[k] = bioId;
      }
    }
  }

  private getVegDensityAt(x: number, z: number): number {
    const i = clamp(Math.floor(((x + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * 255), 0, 255);
    const j = clamp(Math.floor(((z + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * 255), 0, 255);
    return this.vegDensity[j * 256 + i];
  }

  /**
   * Returns true if (x, z) is on or near any road, path, structure footprint,
   * structure entrance/doorway corridor, bridge ramp, dock, or spawn/pickup pad.
   */
  private isInClearZone(x: number, z: number, extraMargin = 0): boolean {
    // 1. Main winding Dirt Road corridor
    if (distToPolyline(x, z, ROAD_POLYLINE) < 6.2 + extraMargin) return true;

    // 2. Ruined Outpost on The Knoll (0, 0) + its 4 cardinal entrance corridors & road connector
    if (Math.hypot(x, z) < 18.5 + extraMargin) return true;
    if (Math.abs(x) < 5.5 + extraMargin && Math.abs(z) < 28.0 + extraMargin) return true;
    if (Math.abs(z) < 5.5 + extraMargin && x > -28.0 - extraMargin && x < 44.0 + extraMargin) {
      return true;
    }

    // 3. Three Ruined Stone Huts (-70, -30), (70, 70), (30, -60) + front (+Z) doorway courtyards
    const huts: [number, number][] = [
      [-70, -30],
      [70, 70],
      [30, -60],
    ];
    for (const [hx, hz] of huts) {
      if (Math.hypot(x - hx, z - hz) < 9.5 + extraMargin) return true;
      // Front doorway faces +Z at (hx, hz + 2.5): keep a wide entrance courtyard clear in front
      if (
        Math.abs(x - hx) < 6.5 + extraMargin &&
        z >= hz - 2.0 &&
        z <= hz + 16.0 + extraMargin
      ) {
        return true;
      }
    }

    // 4. Bridges (West River Bridge & East Road Crossing Bridge) + approach corridors
    for (const b of BRIDGE_LOCATIONS) {
      if (isPointInBridge(x, z, b, 3.0 + extraMargin, 3.0 + extraMargin)) {
        return true;
      }
    }

    // 5. Southeast Lake Port / Dock on the Eastern Pond Shore at (77, 52) + shore staging area
    if (Math.hypot(x - 78, z - 52) < 11.5 + extraMargin) return true;
    if (distToSegment(x, z, 70, 52, 88, 52) < 5.5 + extraMargin) return true;

    // 6. Player Spawn (0, 95), Health/Ammo Pickup Pads & Enemy Spawns
    if (Math.hypot(x - CONFIG.PLAYER_SPAWN.x, z - CONFIG.PLAYER_SPAWN.z) < 8.5 + extraMargin) {
      return true;
    }
    for (const pad of CONFIG.HEALTH_PADS) {
      if (Math.hypot(x - pad.x, z - pad.z) < 6.0 + extraMargin) return true;
    }
    for (const pad of CONFIG.AMMO_PADS) {
      if (Math.hypot(x - pad.x, z - pad.z) < 6.0 + extraMargin) return true;
    }
    for (const sp of CONFIG.ENEMY_SPAWNS) {
      if (Math.hypot(x - sp.x, z - sp.z) < 5.0 + extraMargin) return true;
    }

    return false;
  }

  private generateHeightmapPreview(): void {
    const N = CONFIG.GRID_RES;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let k = 0; k < N * N; k++) {
      const g = Math.round(clamp((this.heights[k] + 4) / 18, 0, 1) * 255);
      const o = k * 4;
      img.data[o] = g;
      img.data[o + 1] = g;
      img.data[o + 2] = g;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.heightmapDataUrl = canvas.toDataURL();
  }

  // --------------------------------------------------------------------------
  // 3. TERRAIN SPLAT TEXTURE (512x512 Smooth Biome Blend + Detail Noise)
  // --------------------------------------------------------------------------
  private buildTerrainMesh(isSoftwareGl: boolean): void {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = 256;
    roughCanvas.height = 256;
    const rCtx = roughCanvas.getContext('2d')!;
    const rImg = rCtx.createImageData(256, 256);

    const detailNoise = new SeededNoise2D(this.seed + 313);

    // Biome RGB targets:
    // Sand: #c8b273 (200, 178, 115)
    // Short grass: #5f9e3c (95, 158, 60)
    // Dark forest floor: #3e6b2a (62, 107, 42)
    // Steep rock: #7a7a75 (122, 122, 117)
    // High rock/dirt: #8b7d6b (139, 125, 107)
    // Dirt road: #8a6a46 (138, 106, 70)
    for (let py = 0; py < size; py++) {
      const z = -CONFIG.HALF_SIZE + (py / (size - 1)) * CONFIG.MAP_SIZE;
      for (let px = 0; px < size; px++) {
        const x = -CONFIG.HALF_SIZE + (px / (size - 1)) * CONFIG.MAP_SIZE;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        const veg = this.getVegDensityAt(x, z);
        const dRoad = distToPolyline(x, z, ROAD_POLYLINE);
        const dRiver = distToPolyline(x, z, RIVER_CONTROL_PTS);

        // Start with short grass base (#5f9e3c)
        let r = 95;
        let g = 158;
        let b = 60;

        // Smooth blend into Dark Forest Floor (#3e6b2a)
        const forestW = smoothstep(0.35, 0.7, veg);
        r = lerp(r, 62, forestW);
        g = lerp(g, 107, forestW);
        b = lerp(b, 42, forestW);

        // Smooth blend into Sand / Mud (#c8b273) near water (y < 0.8 or dRiver < 4)
        const shoreH = 1.0 - smoothstep(0.2, 1.15, h);
        const riverBank = h < 2.2 ? 1.0 - smoothstep(2.2, 4.8, dRiver) : 0;
        const sandW = Math.max(shoreH, riverBank);
        r = lerp(r, 200, sandW);
        g = lerp(g, 178, sandW);
        b = lerp(b, 115, sandW);

        // Wet shoreline & submerged river/lake bed pebble tinting (below y < 0.35)
        if (h < 0.35) {
          const dampW = 1.0 - smoothstep(0.0, 0.35, h);
          r = lerp(r, r * 0.72, dampW * 0.55);
          g = lerp(g, g * 0.74, dampW * 0.55);
          b = lerp(b, b * 0.78, dampW * 0.55);
        }
        if (h < 0.15) {
          const subW = 1.0 - smoothstep(-2.4, 0.15, h);
          r = lerp(r, 38, subW);
          g = lerp(g, 82, subW);
          b = lerp(b, 96, subW);
        }

        // Smooth blend into High Rock / Dirt (#8b7d6b) above y > 9
        const highW = smoothstep(7.8, 10.2, h);
        r = lerp(r, 139, highW);
        g = lerp(g, 125, highW);
        b = lerp(b, 107, highW);

        // Smooth blend into Steep Rock (#7a7a75) above slope > 35°
        const rockW = smoothstep(28, 38, slope);
        r = lerp(r, 122, rockW);
        g = lerp(g, 122, rockW);
        b = lerp(b, 117, rockW);

        // Smooth blend into Dirt Road (#8a6a46) with subtle wheel-track edge wear
        if (h > 0.1) {
          const roadW = 1.0 - smoothstep(1.6, 3.2, dRoad);
          const trackW = Math.exp(-Math.pow((dRoad - 0.95) * 1.9, 2)) * 0.14 * roadW;
          r = lerp(r, 138 - trackW * 90, roadW);
          g = lerp(g, 106 - trackW * 75, roadW);
          b = lerp(b, 70 - trackW * 55, roadW);
        }

        // ====================================================================
        // BAKED CAVITY & CONTACT AMBIENT OCCLUSION (Terrain Crevices, Gullies,
        // Forest Canopy Shade, and Structure Foundations)
        // ====================================================================
        const hAvg =
          (this.getHeightAt(x + 2.2, z) +
            this.getHeightAt(x - 2.2, z) +
            this.getHeightAt(x, z + 2.2) +
            this.getHeightAt(x, z - 2.2)) *
          0.25;
        const cavityCurvature = clamp((hAvg - h) * 0.35, -0.12, 0.26);
        const slopeCreviceAo = smoothstep(22, 42, slope) * 0.12;
        const canopyAo = smoothstep(0.42, 0.85, veg) * 0.14;

        // Contact AO around structure foundations (Outpost perimeter, Huts, Bridge abutments)
        let structContactAo = 0;
        const outpostWallDist = Math.min(
          Math.abs(Math.max(Math.abs(x), Math.abs(z)) - 6.0),
          Math.hypot(x - 3.6, z - -3.6) - 1.8
        );
        if (Math.max(Math.abs(x), Math.abs(z)) < 8.0 && outpostWallDist < 1.4) {
          structContactAo = Math.max(structContactAo, (1.0 - smoothstep(0.2, 1.4, Math.max(0, outpostWallDist))) * 0.24);
        }
        const hutCenters: [number, number][] = [
          [-70, -30],
          [70, 70],
          [30, -60],
        ];
        for (const [hx, hz] of hutCenters) {
          const dHutWall = Math.abs(Math.max(Math.abs(x - hx), Math.abs(z - hz)) - 2.5);
          if (Math.max(Math.abs(x - hx), Math.abs(z - hz)) < 4.2 && dHutWall < 1.2) {
            structContactAo = Math.max(structContactAo, (1.0 - smoothstep(0.1, 1.2, dHutWall)) * 0.25);
          }
        }

        const aoFactor = clamp(
          1.0 - cavityCurvature - slopeCreviceAo - canopyAo - structContactAo,
          0.62,
          1.06
        );

        // Multi-scale detail brightness noise overlay
        const nVal = detailNoise.sample(x * 0.35, z * 0.35);
        const microVal = detailNoise.sample(x * 1.4, z * 1.4);
        const grain = (0.88 + nVal * 0.16 + (microVal - 0.5) * 0.08) * aoFactor;

        const idx = (py * size + px) * 4;
        img.data[idx] = clamp(Math.round(r * grain), 0, 255);
        img.data[idx + 1] = clamp(Math.round(g * grain), 0, 255);
        img.data[idx + 2] = clamp(Math.round(b * grain), 0, 255);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Build World-Space Terrain Roughness & Shoreline Wetness Map (256x256)
    for (let py = 0; py < 256; py++) {
      const z = -CONFIG.HALF_SIZE + (py / 255) * CONFIG.MAP_SIZE;
      for (let px = 0; px < 256; px++) {
        const x = -CONFIG.HALF_SIZE + (px / 255) * CONFIG.MAP_SIZE;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        const dRoad = distToPolyline(x, z, ROAD_POLYLINE);
        const dRiver = distToPolyline(x, z, RIVER_CONTROL_PTS);

        // Default meadow / forest roughness (matte botanical surface)
        let rough = 0.88;
        // Compacted dirt road has slightly smoother sheen
        if (h > 0.1 && dRoad < 3.2) {
          rough = lerp(rough, 0.68, 1.0 - smoothstep(1.4, 3.2, dRoad));
        }
        // Exposed steep rock facets catch crisp golden-hour grazing light
        if (slope > 26) {
          rough = lerp(rough, 0.62, smoothstep(26, 40, slope));
        }
        // Wet riverbanks and lake shoreline glisten in golden-hour sunlight
        const wetShore = Math.max(
          1.0 - smoothstep(-0.2, 0.85, h),
          h < 1.8 ? (1.0 - smoothstep(1.8, 4.2, dRiver)) * 0.75 : 0
        );
        rough = lerp(rough, 0.26, wetShore);

        const rByte = clamp(Math.round(rough * 255), 40, 245);
        const rIdx = (py * 256 + px) * 4;
        rImg.data[rIdx] = rByte;
        rImg.data[rIdx + 1] = rByte;
        rImg.data[rIdx + 2] = rByte;
        rImg.data[rIdx + 3] = 255;
      }
    }
    rCtx.putImageData(rImg, 0, 0);

    // Build Tileable Tangent-Space Terrain Micro-Normal Map (256x256, Repeat 28x28)
    // Encodes fine soil grit, pebble bumps, grass micro-relief, and rock crevices
    const normSize = 256;
    const normCanvas = document.createElement('canvas');
    normCanvas.width = normSize;
    normCanvas.height = normSize;
    const nCtx = normCanvas.getContext('2d')!;
    const nImg = nCtx.createImageData(normSize, normSize);
    const microNoise = new SeededNoise2D(this.seed + 818);
    const TAU = Math.PI * 2;

    const microHeight = (u: number, v: number): number => {
      // Seamless periodic multi-octave soil + pebble + blade micro-relief
      const s1 =
        Math.sin(u * TAU * 3.0) * Math.cos(v * TAU * 3.0) * 0.35 +
        Math.sin((u * 5.0 + v * 4.0) * TAU) * 0.25 +
        Math.cos((u * 8.0 - v * 7.0) * TAU) * 0.18;
      // Periodic wrapped noise lookup for fine organic grit
      const wx = Math.cos(u * TAU) * 2.4 + Math.sin(v * TAU) * 1.2 + 10.0;
      const wz = Math.sin(u * TAU) * 2.4 + Math.cos(v * TAU) * 1.2 + 10.0;
      const grit = microNoise.fbm(wx * 8.0, wz * 8.0, 3, 0.6, 2.1, 0.5);
      return s1 * 0.45 + grit * 0.55;
    };

    const eps = 1.0 / normSize;
    for (let y = 0; y < normSize; y++) {
      const v = y / normSize;
      for (let x = 0; x < normSize; x++) {
        const u = x / normSize;
        const hL = microHeight((u - eps + 1) % 1, v);
        const hR = microHeight((u + eps) % 1, v);
        const hD = microHeight(u, (v - eps + 1) % 1);
        const hU = microHeight(u, (v + eps) % 1);

        const dx = (hL - hR) * 3.6;
        const dy = (hD - hU) * 3.6;
        const dz = 1.0;
        const len = Math.hypot(dx, dy, dz) || 1;

        const nIdx = (y * normSize + x) * 4;
        nImg.data[nIdx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
        nImg.data[nIdx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
        nImg.data[nIdx + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
        nImg.data[nIdx + 3] = 255;
      }
    }
    nCtx.putImageData(nImg, 0, 0);

    // Save a copy for the HUD minimap background
    this.minimapSplatCanvas.width = 128;
    this.minimapSplatCanvas.height = 128;
    const mCtx = this.minimapSplatCanvas.getContext('2d')!;
    mCtx.drawImage(canvas, 0, 0, 128, 128);
    // Draw wooden bridge markers onto minimap
    for (const b of BRIDGE_LOCATIONS) {
      const mx = ((b.cx + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * 128;
      const mz = ((b.cz + CONFIG.HALF_SIZE) / CONFIG.MAP_SIZE) * 128;
      const mw = Math.max(3, (b.deckW / CONFIG.MAP_SIZE) * 128);
      const ml = Math.max(7, ((b.spanLen + b.rampLen * 1.4) / CONFIG.MAP_SIZE) * 128);
      mCtx.save();
      mCtx.translate(mx, mz);
      mCtx.rotate(-b.yaw);
      mCtx.fillStyle = '#c89b62';
      mCtx.fillRect(-mw * 0.5, -ml * 0.5, mw, ml);
      mCtx.strokeStyle = '#473019';
      mCtx.lineWidth = 0.8;
      mCtx.strokeRect(-mw * 0.5, -ml * 0.5, mw, ml);
      mCtx.restore();
    }

    const splatTex = new THREE.CanvasTexture(canvas);
    splatTex.colorSpace = THREE.SRGBColorSpace;
    splatTex.wrapS = THREE.ClampToEdgeWrapping;
    splatTex.wrapT = THREE.ClampToEdgeWrapping;

    const terrainRoughTex = new THREE.CanvasTexture(roughCanvas);
    terrainRoughTex.wrapS = THREE.ClampToEdgeWrapping;
    terrainRoughTex.wrapT = THREE.ClampToEdgeWrapping;

    const terrainNormTex = new THREE.CanvasTexture(normCanvas);
    terrainNormTex.wrapS = THREE.RepeatWrapping;
    terrainNormTex.wrapT = THREE.RepeatWrapping;
    terrainNormTex.repeat.set(28, 28);

    this.disposables.push(splatTex, terrainRoughTex, terrainNormTex);

    // Build displaced PlaneGeometry (256x256 segments = 257x257 vertices)
    const geo = new THREE.PlaneGeometry(
      CONFIG.MAP_SIZE,
      CONFIG.MAP_SIZE,
      CONFIG.SEGMENTS,
      CONFIG.SEGMENTS
    );
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    for (let k = 0; k < posAttr.count; k++) {
      posAttr.setY(k, this.heights[k]);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    this.disposables.push(geo);

    const terrainMat = new THREE.MeshStandardMaterial({
      map: splatTex,
      roughnessMap: terrainRoughTex,
      normalMap: terrainNormTex,
      normalScale: new THREE.Vector2(0.52, 0.52),
      roughness: 1.0,
      metalness: 0.04,
    });

    // Inject smooth horizon fog barrier fade on distant terrain so the map boundary melts into the golden-hour sky
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFogBarrierDist = this.windUniforms.uFogBarrierDist;
      shader.uniforms.uPlayerPos = this.windUniforms.uPlayerPos;
      shader.vertexShader =
        `varying vec3 vTerrainWorldPos;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader =
        `uniform float uFogBarrierDist;\nuniform vec3 uPlayerPos;\nvarying vec3 vTerrainWorldPos;\n` +
        shader.fragmentShader.replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
           float dHoriz = length(vTerrainWorldPos.xz - uPlayerPos.xz);
           float barrierFog = smoothstep(uFogBarrierDist * 0.58, uFogBarrierDist * 1.04, dHoriz);
           vec3 sunDir = normalize(vec3(0.60, 0.36, -0.71));
           vec3 viewRay = normalize(vTerrainWorldPos - cameraPosition);
           float sunForward = pow(max(0.0, dot(viewRay, sunDir)), 3.0);
           vec3 horizonMistCol = mix(vec3(0.76, 0.62, 0.49), vec3(0.98, 0.80, 0.55), sunForward * 0.55);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, horizonMistCol, barrierFog * 0.92);`
        );
    };

    this.disposables.push(terrainMat);

    const terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.receiveShadow = !isSoftwareGl;
    terrainMesh.castShadow = false;
    this.rootGroup.add(terrainMesh);
    this.shootables.push(terrainMesh);
  }

  // --------------------------------------------------------------------------
  // 6 & 7. HIGH-QUALITY FLOWING WATER PLANE (y = 0), RIVER CURRENT & SKY DOME
  // --------------------------------------------------------------------------
  public getWaterFlowAndDist(
    x: number,
    z: number
  ): {
    dist: number;
    dirX: number;
    dirZ: number;
    flowX: number;
    flowZ: number;
    speed: number;
    isRiver: boolean;
  } {
    // 1. Closest point & downstream tangent along the River spline
    let minRiverDist = 1e9;
    let bestCx = 0;
    let bestCz = 0;
    let bestTx = -0.92;
    let bestTz = -0.39;

    for (let i = 0; i < RIVER_CONTROL_PTS.length - 1; i++) {
      const [ax, az] = RIVER_CONTROL_PTS[i];
      const [bx, bz] = RIVER_CONTROL_PTS[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      const len = Math.sqrt(lenSq) || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / lenSq, 0, 1);
      const cx = ax + t * dx;
      const cz = az + t * dz;
      const d = Math.hypot(x - cx, z - cz);
      if (d < minRiverDist) {
        minRiverDist = d;
        bestCx = cx;
        bestCz = cz;
        bestTx = dx / len;
        bestTz = dz / len;
      }
    }

    // 2. Distance to Southeast Lake basin (center 60, 55, radius ~26)
    const lx = x - 60;
    const lz = z - 55;
    const dCenterLake = Math.hypot(lx, lz);
    const dLakeEdge = Math.max(0, dCenterLake - 24);
    const dRiverEdge = Math.max(0, minRiverDist - 3.6);

    const isRiver = minRiverDist < dCenterLake - 12;
    const dist = Math.min(dRiverEdge, dLakeEdge);

    // Direction from (x, z) toward nearest water body for spatial stereo panning
    const targetX = dRiverEdge <= dLakeEdge ? bestCx : 60;
    const targetZ = dRiverEdge <= dLakeEdge ? bestCz : 55;
    const toWaterLen = Math.hypot(targetX - x, targetZ - z) || 1;
    const dirX = (targetX - x) / toWaterLen;
    const dirZ = (targetZ - z) / toWaterLen;

    // Downstream flow vector: strong along river channel, gentle circulation in lake toward river mouth (35, 48)
    let flowX = bestTx;
    let flowZ = bestTz;
    let speed = 0.35;

    if (minRiverDist < 12.0) {
      const riverFactor = 1.0 - smoothstep(2.5, 11.5, minRiverDist);
      // Extra speed boost in the narrows under both River Bridges
      const bridgeBoost = Math.max(
        1.0 - smoothstep(0, 18, Math.hypot(x - -30, z - 30)),
        1.0 - smoothstep(0, 18, Math.hypot(x - 37.43, z - 49.03))
      );
      speed = lerp(0.4, 1.0 + bridgeBoost * 0.35, riverFactor);
    } else if (dCenterLake < 34) {
      // Gentle lake current converging toward river outlet at (38, 49)
      const ox = 38 - x;
      const oz = 49 - z;
      const oLen = Math.hypot(ox, oz) || 1;
      flowX = ox / oLen;
      flowZ = oz / oLen;
      speed = 0.42;
    }

    return { dist, dirX, dirZ, flowX, flowZ, speed, isRiver };
  }

  private buildWaterMesh(): void {
    // 1. Procedural Seamless Water Caustic & Ripple Albedo Texture (512x512, RepeatWrapping)
    const texSize = 512;
    const waterCanvas = document.createElement('canvas');
    waterCanvas.width = texSize;
    waterCanvas.height = texSize;
    const wCtx = waterCanvas.getContext('2d')!;
    const wImg = wCtx.createImageData(texSize, texSize);

    // 2. Procedural Seamless Tangent-Space Water Normal Map (256x256, RepeatWrapping)
    const normSize = 256;
    const normCanvas = document.createElement('canvas');
    normCanvas.width = normSize;
    normCanvas.height = normSize;
    const nCtx = normCanvas.getContext('2d')!;
    const nImg = nCtx.createImageData(normSize, normSize);

    const TAU = Math.PI * 2;
    const waveHeightFn = (u: number, v: number): number => {
      const a = Math.sin(u * TAU * 2.0 + Math.cos(v * TAU * 2.0) * 1.4);
      const b = Math.cos(v * TAU * 3.0 - Math.sin(u * TAU * 3.0) * 1.2);
      const c = Math.sin((u + v) * TAU * 4.0) * 0.65;
      const d = Math.cos((u * 2.0 - v * 3.0) * TAU * 2.0) * 0.45;
      const e = Math.sin((u * 5.0 + v * 4.0) * TAU) * 0.25;
      return (a + b + c + d + e) / 3.35;
    };

    for (let y = 0; y < texSize; y++) {
      const v = y / texSize;
      for (let x = 0; x < texSize; x++) {
        const u = x / texSize;
        const w1 = waveHeightFn(u, v);
        const w2 = waveHeightFn((u + 0.37) % 1, (v + 0.61) % 1);
        // Cellular caustic ridge interference + directional current ripples
        const ridge1 = Math.pow(clamp(1.0 - Math.abs(w1 - w2) * 1.65, 0, 1), 3.0);
        const ridge2 = Math.pow(clamp(0.5 + 0.5 * Math.sin((u * 6 - v * 5) * TAU + w1 * 2.2), 0, 1), 3.8);
        const caustic = clamp(ridge1 * 0.78 + ridge2 * 0.48, 0, 1);

        // Deep emerald-azure base blended with bright turquoise caustics
        const r = clamp(Math.round(22 + w1 * 14 + caustic * 145), 0, 255);
        const g = clamp(Math.round(114 + w1 * 22 + caustic * 124), 0, 255);
        const b = clamp(Math.round(152 + w1 * 24 + caustic * 98), 0, 255);

        const idx = (y * texSize + x) * 4;
        wImg.data[idx] = r;
        wImg.data[idx + 1] = g;
        wImg.data[idx + 2] = b;
        wImg.data[idx + 3] = 255;
      }
    }
    wCtx.putImageData(wImg, 0, 0);

    const eps = 1.0 / normSize;
    for (let y = 0; y < normSize; y++) {
      const v = y / normSize;
      for (let x = 0; x < normSize; x++) {
        const u = x / normSize;
        const hL = waveHeightFn((u - eps + 1) % 1, v);
        const hR = waveHeightFn((u + eps) % 1, v);
        const hD = waveHeightFn(u, (v - eps + 1) % 1);
        const hU = waveHeightFn(u, (v + eps) % 1);

        const dx = (hL - hR) * 2.8;
        const dy = (hD - hU) * 2.8;
        const dz = 1.0;
        const len = Math.hypot(dx, dy, dz);

        const idx = (y * normSize + x) * 4;
        nImg.data[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
        nImg.data[idx + 3] = 255;
      }
    }
    nCtx.putImageData(nImg, 0, 0);

    // 3. World-Space Shoreline Foam, Pier Wakes & 2D Flow Vector Texture (256x256 RGBA)
    //    R = Shoreline & Pier Wake Foam (0..1)
    //    G = Flow Vector X (-1..+1 mapped to 0..255)
    //    B = Flow Vector Z (-1..+1 mapped to 0..255)
    //    A = River Current Speed / Rapids Intensity (0..255)
    const foamSize = 256;
    const foamCanvas = document.createElement('canvas');
    foamCanvas.width = foamSize;
    foamCanvas.height = foamSize;
    const fCtx = foamCanvas.getContext('2d')!;
    const fImg = fCtx.createImageData(foamSize, foamSize);
    const foamNoise = new SeededNoise2D(this.seed + 707);

    // Bridge pier world coordinates for water bow foam & downstream V-wakes
    const pierPts: [number, number][] = [];
    for (const b of BRIDGE_LOCATIONS) {
      const cosY = Math.cos(b.yaw);
      const sinY = Math.sin(b.yaw);
      const sideX = b.deckW * 0.5 - 0.55;
      for (const lz of [-2.7, 2.7]) {
        for (const lx of [-sideX, sideX]) {
          pierPts.push([b.cx + lx * cosY + lz * sinY, b.cz - lx * sinY + lz * cosY]);
        }
      }
    }

    for (let py = 0; py < foamSize; py++) {
      const wz = -CONFIG.HALF_SIZE + (py / (foamSize - 1)) * CONFIG.MAP_SIZE;
      for (let px = 0; px < foamSize; px++) {
        const wx = -CONFIG.HALF_SIZE + (px / (foamSize - 1)) * CONFIG.MAP_SIZE;
        const h = this.getHeightAt(wx, wz);
        const flowInfo = this.getWaterFlowAndDist(wx, wz);

        // Depth factor: 1 right at the water's edge (h ~ 0), fading out into deeper water
        let shallow = 0;
        if (h <= 0.25 && h >= -2.5) {
          const edgeBand = 1.0 - smoothstep(-0.45, 0.12, Math.abs(h + 0.08));
          const shallowness = 1.0 - smoothstep(-2.2, 0.0, h);
          const n = foamNoise.sample(wx * 0.45, wz * 0.45);
          shallow = clamp(edgeBand * (0.68 + n * 0.45) + (1.0 - shallowness) * 0.28, 0, 1);
        }

        // Add bow foam rings AND downstream turbulent V-wakes trailing behind bridge piers
        for (const [px0, pz0] of pierPts) {
          const dx = wx - px0;
          const dz = wz - pz0;
          const dp = Math.hypot(dx, dz);
          if (dp < 2.2) {
            shallow = Math.max(shallow, 1.0 - smoothstep(0.45, 2.2, dp));
          }
          // Downstream wake projection along river flow vector (-0.89, -0.45)
          const downDist = dx * -0.89 + dz * -0.45;
          const crossDist = Math.abs(dx * -0.45 - dz * -0.89);
          if (downDist > 0 && downDist < 7.5) {
            const wakeHalfWidth = 0.55 + downDist * 0.22;
            if (crossDist < wakeHalfWidth) {
              const wakeIntensity =
                (1.0 - downDist / 7.5) * (1.0 - crossDist / wakeHalfWidth) * 0.85;
              shallow = Math.max(shallow, wakeIntensity);
            }
          }
        }

        const idx = (py * foamSize + px) * 4;
        fImg.data[idx] = Math.round(clamp(shallow, 0, 1) * 255);
        fImg.data[idx + 1] = Math.round(clamp(flowInfo.flowX * 0.5 + 0.5, 0, 1) * 255);
        fImg.data[idx + 2] = Math.round(clamp(flowInfo.flowZ * 0.5 + 0.5, 0, 1) * 255);
        fImg.data[idx + 3] = Math.round(clamp(flowInfo.speed / 1.35, 0, 1) * 255);
      }
    }
    fCtx.putImageData(fImg, 0, 0);

    this.waterColorTex = new THREE.CanvasTexture(waterCanvas);
    this.waterColorTex.colorSpace = THREE.SRGBColorSpace;
    this.waterColorTex.wrapS = THREE.RepeatWrapping;
    this.waterColorTex.wrapT = THREE.RepeatWrapping;
    this.waterColorTex.repeat.set(22, 22);

    this.waterNormalTex = new THREE.CanvasTexture(normCanvas);
    this.waterNormalTex.wrapS = THREE.RepeatWrapping;
    this.waterNormalTex.wrapT = THREE.RepeatWrapping;
    this.waterNormalTex.repeat.set(28, 28);

    const shorelineFoamTex = new THREE.CanvasTexture(foamCanvas);
    shorelineFoamTex.wrapS = THREE.ClampToEdgeWrapping;
    shorelineFoamTex.wrapT = THREE.ClampToEdgeWrapping;

    const waterGeo = new THREE.PlaneGeometry(CONFIG.MAP_SIZE, CONFIG.MAP_SIZE, 128, 128);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0xd8f3ff,
      map: this.waterColorTex,
      normalMap: this.waterNormalTex,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.85,
    });

    waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.windUniforms.uTime;
      shader.uniforms.uFoamMap = { value: shorelineFoamTex };

      shader.vertexShader =
        `uniform float uTime;\nvarying vec2 vWorldUv;\nvarying vec2 vWorldPosXZ;\n` +
        shader.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
             float wx = position.x;
             float wz = position.z;
             // Traveling downstream waves propagating northwest (-x, -z)
             float flowPhase = (wx * 0.36 + wz * 0.18) + uTime * 3.4;
             float crossPhase = (wx * 0.22 - wz * 0.34) - uTime * 2.7;
             float dWaveDx = 0.048 * cos(flowPhase) + 0.028 * cos(crossPhase);
             float dWaveDz = 0.024 * cos(flowPhase) - 0.042 * sin(crossPhase);
             objectNormal = normalize(vec3(-dWaveDx, 1.0, -dWaveDz));`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vWorldPosXZ = position.xz;
             vWorldUv = (position.xz + vec2(${CONFIG.HALF_SIZE.toFixed(1)})) / ${CONFIG.MAP_SIZE.toFixed(1)};
             float wave1 = sin((position.x * 0.36 + position.z * 0.18) + uTime * 3.4) * 0.068;
             float wave2 = cos((position.x * 0.22 - position.z * 0.34) - uTime * 2.7) * 0.036;
             transformed.y += wave1 + wave2;`
          );

      shader.fragmentShader =
        `uniform float uTime;\nuniform sampler2D uFoamMap;\nvarying vec2 vWorldUv;\nvarying vec2 vWorldPosXZ;\n` +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
             vec4 flowSample = texture2D(uFoamMap, vWorldUv);
             float foamMask = flowSample.r;
             vec2 flowDir = normalize((flowSample.gb - 0.5) * 2.0 + vec2(-0.001, -0.001));
             float flowSpeed = mix(0.45, 1.55, flowSample.a);

             // Continuous downstream advection along the river's local tangent vector + dual-phase flow cycle
             vec2 baseScroll = -flowDir * (uTime * 0.14 * flowSpeed);
             float phase0 = fract(uTime * 0.38);
             float phase1 = fract(uTime * 0.38 + 0.5);
             float flowLerp = abs((0.5 - phase0) / 0.5);

             vec2 uvA = vMapUv + baseScroll - flowDir * phase0 * 0.35 * flowSpeed;
             vec2 uvB = vMapUv * 1.28 + baseScroll * 1.15 - flowDir * phase1 * 0.35 * flowSpeed + vec2(0.27, 0.41);

             vec4 texelA = texture2D(map, uvA);
             vec4 texelB = texture2D(map, uvB);
             vec4 sampledDiffuseColor = mix(texelA, texelB, flowLerp);

             // Animated whitewater current ribbons rushing downstream along the river channel
             float alongCoord = dot(vWorldPosXZ, flowDir);
             float acrossCoord = dot(vWorldPosXZ, vec2(-flowDir.y, flowDir.x));
             float streamRibbon1 = sin(acrossCoord * 3.4 + sin(alongCoord * 0.35 - uTime * 4.2) * 1.2);
             float streamRibbon2 = cos(acrossCoord * 5.8 - alongCoord * 0.55 + uTime * 5.6);
             float whitewaterCurrent = smoothstep(0.68, 0.96, streamRibbon1 * 0.6 + streamRibbon2 * 0.4)
                                     * smoothstep(0.32, 0.72, flowSample.a) * 0.48;

             // Animated shoreline & bridge-pier wake foam
             float foamRipple = 0.5 + 0.5 * sin(foamMask * 18.0 - uTime * 4.6 + alongCoord * 0.9);
             float foamAmt = smoothstep(0.26, 0.76, foamMask) * (0.62 + 0.38 * foamRipple) + whitewaterCurrent;
             sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.94, 0.99, 1.0), clamp(foamAmt, 0.0, 0.92));
             diffuseColor *= sampledDiffuseColor;
           #endif`
        );
    };

    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.y = CONFIG.WATER_LEVEL;
    this.waterMesh.receiveShadow = true;
    this.rootGroup.add(this.waterMesh);
    this.disposables.push(
      this.waterColorTex,
      this.waterNormalTex,
      shorelineFoamTex,
      waterGeo,
      waterMat
    );

    // 4. 3D Animated Flowing Whitewater Current Streaks along the River Spline
    this.buildRiverFlowStreaks();
  }

  private buildRiverFlowStreaks(): void {
    const streakCanvas = document.createElement('canvas');
    streakCanvas.width = 128;
    streakCanvas.height = 64;
    const sCtx = streakCanvas.getContext('2d')!;
    const sImg = sCtx.createImageData(128, 64);

    for (let y = 0; y < 64; y++) {
      const ny = (y / 63) * 2 - 1; // -1..1 across width
      const envY = Math.max(0, 1 - ny * ny);
      for (let x = 0; x < 128; x++) {
        const nx = (x / 127) * 2 - 1; // -1..1 along length
        const envX = Math.max(0, 1 - nx * nx);
        // Streaky whitewater foam filaments + bubbles
        const thread1 = 0.5 + 0.5 * Math.sin(ny * 14.0 + Math.sin(nx * 5.0) * 1.4);
        const thread2 = 0.5 + 0.5 * Math.cos(nx * 9.0 - ny * 8.0);
        const alpha = Math.pow(envX * envY, 1.35) * (0.35 + 0.65 * thread1 * thread2);
        const idx = (y * 128 + x) * 4;
        sImg.data[idx] = 236;
        sImg.data[idx + 1] = 250;
        sImg.data[idx + 2] = 255;
        sImg.data[idx + 3] = Math.round(clamp(alpha * 0.78, 0, 1) * 255);
      }
    }
    sCtx.putImageData(sImg, 0, 0);

    const streakTex = new THREE.CanvasTexture(streakCanvas);
    streakTex.colorSpace = THREE.SRGBColorSpace;
    const streakGeo = new THREE.PlaneGeometry(1, 1);
    streakGeo.rotateX(-Math.PI / 2);

    const streakMat = new THREE.MeshBasicMaterial({
      map: streakTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    });

    const count = 96;
    this.riverFlowInstanced = new THREE.InstancedMesh(streakGeo, streakMat, count);
    this.riverFlowInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rand = mulberry32(this.seed + 919);

    this.riverFlowParticles = [];
    for (let i = 0; i < count; i++) {
      this.riverFlowParticles.push({
        t: i / count + rand() * (1 / count),
        lat: (rand() - 0.5) * 4.2,
        speed: 0.036 + rand() * 0.022,
        length: 3.4 + rand() * 2.8,
        width: 0.65 + rand() * 0.65,
        phase: rand() * Math.PI * 2,
      });
    }

    this.updateRiverFlowStreaks(0, 0);
    this.rootGroup.add(this.riverFlowInstanced);
    this.disposables.push(streakTex, streakGeo, streakMat);
  }

  private updateRiverFlowStreaks(dt: number, elapsedTime: number): void {
    if (!this.riverFlowInstanced) return;
    for (let i = 0; i < this.riverFlowParticles.length; i++) {
      const p = this.riverFlowParticles[i];
      p.t = (p.t + dt * p.speed) % 1.0;

      riverCurve.getPointAt(p.t, _flowPt);
      riverCurve.getTangentAt(p.t, _flowTan);

      // Lateral normal perpendicular to river tangent in XZ plane
      const nx = -_flowTan.z;
      const nz = _flowTan.x;
      const sway = Math.sin(elapsedTime * 2.2 + p.phase) * 0.28;
      const wx = _flowPt.x + nx * (p.lat + sway);
      const wz = _flowPt.z + nz * (p.lat + sway);

      // Smooth fade-in at lake exit (t < 0.08) and fade-out at western edge (t > 0.92)
      const endFade = smoothstep(0.0, 0.08, p.t) * (1.0 - smoothstep(0.9, 1.0, p.t));
      const pulse = 0.82 + 0.18 * Math.sin(elapsedTime * 3.8 + p.phase);

      _flowDummy.position.set(wx, CONFIG.WATER_LEVEL + 0.045, wz);
      _flowDummy.rotation.set(0, Math.atan2(_flowTan.x, _flowTan.z) + Math.PI * 0.5, 0);
      _flowDummy.scale.set(p.length * endFade * pulse, 1, p.width * endFade);
      _flowDummy.updateMatrix();
      this.riverFlowInstanced.setMatrixAt(i, _flowDummy.matrix);
    }
    this.riverFlowInstanced.instanceMatrix.needsUpdate = true;
  }

  private buildSkyAndAtmosphere(isSoftwareGl: boolean): void {
    // 1. Camera-Centered Physical Golden-Hour Sky Dome (Rayleigh + Mie + Analytic Sun Disk)
    //    Radius 380m centered on player XZ every frame so camera.far (650m) NEVER clips the sphere
    //    and pitching the camera up/down never causes perspective circle distortion or polar UV pinch.
    const skyGeo = new THREE.SphereGeometry(380, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.windUniforms.uTime,
      },
      vertexShader: `
        varying vec3 vWorldOffset;
        void main() {
          vWorldOffset = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldOffset;

        void main() {
          vec3 dir = normalize(vWorldOffset);
          vec3 sunDir = normalize(vec3(0.60, 0.36, -0.71));
          float elev = clamp(dir.y, 0.0, 1.0);
          float sunCos = clamp(dot(dir, sunDir), 0.0, 1.0);

          // Rayleigh vertical atmospheric gradient (Zenith Cobalt -> Mid Azure -> Golden-Peach Horizon)
          vec3 zenithCol  = vec3(0.055, 0.165, 0.380);
          vec3 midSkyCol  = vec3(0.195, 0.415, 0.610);
          vec3 horizonCol = vec3(0.760, 0.620, 0.490);

          vec3 skyCol = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.34, elev));
          skyCol = mix(skyCol, zenithCol, smoothstep(0.28, 0.92, elev));

          // Directional golden-hour horizon band glow toward the sun azimuth
          float horizBand = pow(1.0 - elev, 3.2);
          float sunAzimuth = pow(clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0, 1.0), 2.2);
          skyCol += vec3(0.32, 0.16, 0.04) * horizBand * (0.35 + 0.65 * sunAzimuth);

          // High-altitude sunlit golden cirrus cloud wisps projected smoothly on the upper dome
          if (elev > 0.05) {
            vec2 skyUv = dir.xz / (elev + 0.22);
            float w1 = sin(skyUv.x * 2.6 + uTime * 0.025 + cos(skyUv.y * 2.2) * 1.3);
            float w2 = cos(skyUv.y * 3.8 - skyUv.x * 2.1 + uTime * 0.018);
            float w3 = sin((skyUv.x + skyUv.y) * 5.4 - uTime * 0.03);
            float cirrus = smoothstep(0.25, 0.88, (w1 * 0.45 + w2 * 0.35 + w3 * 0.20));
            float cirrusMask = cirrus * smoothstep(0.05, 0.22, elev) * (1.0 - smoothstep(0.68, 0.96, elev));
            vec3 cirrusCol = mix(vec3(0.88, 0.78, 0.68), vec3(1.15, 0.92, 0.66), pow(sunCos, 2.0));
            skyCol = mix(skyCol, cirrusCol, cirrusMask * 0.28);
          }

          // Analytic Mie Forward-Scattering Corona & Crisp Limb-Darkened Solar Disk
          float mieWide  = pow(sunCos, 3.5) * 0.18 * (1.0 - elev * 0.5);
          float mieHalo  = pow(sunCos, 16.0) * 0.46;
          float aureole  = pow(sunCos, 96.0) * 1.10;
          float sunDisk  = smoothstep(0.99945, 0.99982, sunCos) * 2.4;

          skyCol += vec3(0.96, 0.64, 0.28) * (mieWide + mieHalo);
          skyCol += vec3(1.00, 0.88, 0.62) * aureole;
          skyCol += vec3(1.25, 1.16, 0.96) * sunDisk;

          // Below-horizon ground-mist mirror so looking steeply down never shows a seam
          if (dir.y < 0.0) {
            float downT = clamp(-dir.y * 4.0, 0.0, 1.0);
            skyCol = mix(skyCol, vec3(0.68, 0.56, 0.44), downT);
          }

          gl_FragColor = vec4(skyCol, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });

    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -1000;
    this.skyDome.position.set(CONFIG.PLAYER_SPAWN.x, 0, CONFIG.PLAYER_SPAWN.z);
    this.rootGroup.add(this.skyDome);
    this.disposables.push(skyGeo, skyMat);

    // 2. Smooth 360° Volumetric Horizon Fog Barrier Ring (Follows Player XZ at vegDrawDist)
    //    Masks distant geometry culling and blends the valley perimeter seamlessly into the golden horizon.
    const barrierRings = [
      { radiusFactor: 0.88, height: 42, yCenter: 9, opacity: 0.52 },
      { radiusFactor: 1.01, height: 52, yCenter: 12, opacity: 0.88 },
    ];
    for (const ring of barrierRings) {
      const bGeo = new THREE.CylinderGeometry(
        ring.radiusFactor,
        ring.radiusFactor,
        ring.height,
        64,
        1,
        true
      );
      const bMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.windUniforms.uTime,
          uOpacity: { value: ring.opacity },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vLocalDir;
          void main() {
            vUv = uv;
            vLocalDir = normalize(vec3(position.x, 0.0, position.z));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uOpacity;
          varying vec2 vUv;
          varying vec3 vLocalDir;

          void main() {
            // Vertical bell-curve envelope: transparent at bottom & top, dense at horizon line
            float vFade = smoothstep(0.0, 0.28, vUv.y) * (1.0 - smoothstep(0.48, 1.0, vUv.y));
            // Gentle drifting valley mist modulation
            float angle = atan(vLocalDir.z, vLocalDir.x);
            float wisp = 0.86 + 0.14 * sin(angle * 8.0 + uTime * 0.22 + cos(angle * 5.0 - uTime * 0.15));

            vec3 sunHoriz = normalize(vec3(0.60, 0.0, -0.71));
            float sunAlign = pow(max(0.0, dot(vLocalDir, sunHoriz)), 2.4);
            vec3 mistCol = mix(vec3(0.76, 0.62, 0.49), vec3(0.98, 0.78, 0.52), sunAlign * 0.58);

            gl_FragColor = vec4(mistCol, vFade * wisp * uOpacity);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: true,
      });
      const bMesh = new THREE.Mesh(bGeo, bMat);
      bMesh.position.y = ring.yCenter;
      bMesh.frustumCulled = false;
      this.fogBarrierGroup.add(bMesh);
      this.disposables.push(bGeo, bMat);
    }

    const initDist = CONFIG.QUALITY[this.currentQuality].vegDrawDist;
    this.fogBarrierGroup.scale.set(initDist, 1, initDist);
    this.fogBarrierGroup.position.set(CONFIG.PLAYER_SPAWN.x, 0, CONFIG.PLAYER_SPAWN.z);
    this.rootGroup.add(this.fogBarrierGroup);

    // 3. Slow-moving golden-lit cumulus cloud planes
    if (!isSoftwareGl) {
      const cloudCanvas = document.createElement('canvas');
      cloudCanvas.width = 128;
      cloudCanvas.height = 128;
      const cCtx = cloudCanvas.getContext('2d')!;
      const cGrad = cCtx.createRadialGradient(64, 64, 8, 64, 64, 58);
      cGrad.addColorStop(0, 'rgba(255, 244, 224, 0.52)');
      cGrad.addColorStop(0.55, 'rgba(246, 226, 202, 0.24)');
      cGrad.addColorStop(1, 'rgba(246, 226, 202, 0)');
      cCtx.fillStyle = cGrad;
      cCtx.fillRect(0, 0, 128, 128);

      const cloudTex = new THREE.CanvasTexture(cloudCanvas);
      cloudTex.colorSpace = THREE.SRGBColorSpace;
      const cloudGeo = new THREE.PlaneGeometry(58, 38);
      cloudGeo.rotateX(-Math.PI / 2);
      const cloudMat = new THREE.MeshBasicMaterial({
        map: cloudTex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const cloudSpots = [
        [-60, 48, -50],
        [45, 52, -30],
        [-20, 50, 60],
        [75, 49, 55],
        [-80, 51, 20],
      ];
      for (const [cx, cy, cz] of cloudSpots) {
        const cm = new THREE.Mesh(cloudGeo, cloudMat);
        cm.position.set(cx, cy, cz);
        this.cloudGroup.add(cm);
      }
      this.rootGroup.add(this.cloudGroup);
      this.disposables.push(cloudTex, cloudGeo, cloudMat);
    }
  }

  // --------------------------------------------------------------------------
  // 4. VEGETATION INSTANCED MESHES (Pines, Oaks, Bushes, Rocks, Reeds, Grass)
  // --------------------------------------------------------------------------
  private buildVegetationInstances(quality: QualityPreset, isSoftwareGl: boolean): void {
    const rand = mulberry32(this.seed + 77);
    const placed: { type: string; x: number; z: number }[] = [];

    const placeType = (
      type: string,
      targetCount: number,
      minGap: number,
      clearMargin: number,
      predicate: (x: number, z: number, h: number, slope: number, veg: number) => boolean
    ) => {
      const list: { x: number; z: number }[] = [];
      let tries = 0;
      while (list.length < targetCount && tries++ < 55000) {
        const x = rand() * 220 - 110;
        const z = rand() * 220 - 110;
        if (this.isInClearZone(x, z, clearMargin)) continue;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        const veg = this.getVegDensityAt(x, z);
        if (!predicate(x, z, h, slope, veg)) continue;

        let tooClose = false;
        for (let i = 0; i < list.length; i++) {
          if (Math.hypot(list[i].x - x, list[i].z - z) < minGap) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        list.push({ x, z });
        placed.push({ type, x, z });
      }
      return list;
    };

    const pines = placeType(
      'pine',
      CONFIG.PINE_COUNT,
      3.8,
      2.5,
      (_x, _z, h, slope, veg) => h > 0.9 && slope < 30 && veg > 0.45 && rand() < veg
    );
    const oaks = placeType(
      'oak',
      CONFIG.OAK_COUNT,
      5.5,
      3.0,
      (x, z, h, slope, veg) =>
        h > 0.9 &&
        h < 5.5 &&
        slope < 24 &&
        veg > 0.18 &&
        veg < 0.75 &&
        (distToPolyline(x, z, RIVER_CONTROL_PTS) < 38 || Math.hypot(x - -60, z - 60) < 44)
    );
    const bushes = placeType(
      'bush',
      CONFIG.BUSH_COUNT,
      2.6,
      1.8,
      (_x, _z, h, slope, veg) => h > 0.8 && slope < 28 && veg > 0.22 && rand() < 0.8
    );
    const rocks = placeType(
      'rock',
      CONFIG.ROCK_COUNT,
      9.5,
      4.8,
      (x, z, h, slope, veg) => {
        if (h < 0.75 || h > 8.6 || slope > 22) return false;
        if (Math.hypot(x, z) < 30) return false; // Keep Central Hill ("The Knoll") approaches open

        // Never generate rocks in empty open fields — anchor them near trees, bushes, or waterbanks
        const nearRiver = distToPolyline(x, z, RIVER_CONTROL_PTS) < 10.5;
        const pondDist = Math.hypot(x - 60, z - 55);
        const nearPond = pondDist >= 15.5 && pondDist <= 28.5;

        let nearFoliage = false;
        if (!nearRiver && !nearPond) {
          if (veg < 0.22) return false;
          for (let i = 0; i < pines.length; i++) {
            if (Math.hypot(pines[i].x - x, pines[i].z - z) < 7.2) {
              nearFoliage = true;
              break;
            }
          }
          if (!nearFoliage) {
            for (let i = 0; i < oaks.length; i++) {
              if (Math.hypot(oaks[i].x - x, oaks[i].z - z) < 7.8) {
                nearFoliage = true;
                break;
              }
            }
          }
          if (!nearFoliage) {
            for (let i = 0; i < bushes.length; i++) {
              if (Math.hypot(bushes[i].x - x, bushes[i].z - z) < 5.8) {
                nearFoliage = true;
                break;
              }
            }
          }
        }
        if (!nearRiver && !nearPond && !nearFoliage) return false;

        // Reject uneven ledges or drop-offs so embedded boulders sit seamlessly in the ground
        const hN = this.getHeightAt(x, z - 2.2);
        const hS = this.getHeightAt(x, z + 2.2);
        const hE = this.getHeightAt(x + 2.2, z);
        const hW = this.getHeightAt(x - 2.2, z);
        const minH = Math.min(h, hN, hS, hE, hW);
        const maxH = Math.max(h, hN, hS, hE, hW);
        if (minH < 0.28 || maxH - minH > 0.78) return false;
        return rand() < 0.72;
      }
    );
    const reeds = placeType(
      'reed',
      CONFIG.REED_COUNT,
      1.6,
      1.5,
      (x, z, h) =>
        h > -0.35 &&
        h < 0.95 &&
        (distToPolyline(x, z, RIVER_CONTROL_PTS) < 7.5 || Math.hypot(x - 60, z - 55) < 32)
    );

    this.bushFootprints = bushes;

    const groundCover = placeType(
      'groundcover',
      280,
      2.2,
      2.0,
      (x, z, h, slope, veg) => {
        if (h <= 0.9 || h >= 8.0 || slope >= 20 || veg <= 0.14) return false;
        for (let i = 0; i < rocks.length; i++) {
          if (Math.hypot(rocks[i].x - x, rocks[i].z - z) < 3.1) return false;
        }
        return rand() < 0.72;
      }
    );

    interface VegItem {
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      sx: number;
      sy: number;
      sz: number;
      color?: THREE.Color;
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Precompute deterministic placements & add synchronous tree trunk colliders right away
    // so player/enemy collisions and navigation work immediately before GLTF finishes resolving.
    const pineVariants = ['Tree-03-1', 'Tree-03-2', 'Tree-03-3', 'Tree-03-4'] as const;
    const oakVariants = [
      'Tree-01-1',
      'Tree-01-2',
      'Tree-01-3',
      'Tree-01-4',
      'Tree-02-1',
      'Tree-02-2',
      'Tree-02-3',
      'Tree-02-4',
    ] as const;
    const bushVariants = [
      'Bush-01',
      'Bush-02',
      'Bush-03',
      'Bush-04',
      'Bush-05',
      'Flowers-02',
      'Flowers-04',
    ] as const;
    const reedVariants = ['Grass-01', 'Grass-02', 'Grass-03'] as const;
    const groundVariants = [
      'Clover-01',
      'Clover-02',
      'Clover-03',
      'Clover-04',
      'Clover-05',
      'Flowers-01',
      'Flowers-03',
    ] as const;

    const nonGiantBushes = [
      'Bush-01',
      'Bush-02',
      'Bush-03',
      'Bush-04',
      'Flowers-02',
      'Flowers-04',
    ] as const;

    const bucketByVariant = (variants: readonly string[]): Map<string, VegItem[]> => {
      const map = new Map<string, VegItem[]>();
      for (const v of variants) map.set(v, []);
      return map;
    };

    const pineBuckets = bucketByVariant(pineVariants);
    pines.forEach((p) => {
      const y = this.getHeightAt(p.x, p.z);
      const s = 0.88 + rand() * 0.44;
      const ry = rand() * Math.PI * 2;
      const variant = pineVariants[Math.floor(rand() * pineVariants.length)];
      color.setHSL(0.28 + (rand() - 0.5) * 0.04, 0.16, 0.92 + (rand() - 0.5) * 0.14);
      pineBuckets.get(variant)!.push({
        x: p.x,
        y: y - 0.14,
        z: p.z,
        rx: 0,
        ry,
        rz: 0,
        sx: s,
        sy: s,
        sz: s,
        color: color.clone(),
      });
      this.addCollider({
        type: 'cylinder',
        x: p.x,
        z: p.z,
        r: 0.36 * s,
        minY: y,
        maxY: y + 7.2 * s,
      });
    });

    const oakBuckets = bucketByVariant(oakVariants);
    oaks.forEach((o) => {
      const y = this.getHeightAt(o.x, o.z);
      const s = 0.86 + rand() * 0.42;
      const ry = rand() * Math.PI * 2;
      const variant = oakVariants[Math.floor(rand() * oakVariants.length)];
      color.setHSL(0.26 + (rand() - 0.5) * 0.05, 0.18, 0.94 + (rand() - 0.5) * 0.14);
      oakBuckets.get(variant)!.push({
        x: o.x,
        y: y - 0.12,
        z: o.z,
        rx: 0,
        ry,
        rz: 0,
        sx: s,
        sy: s,
        sz: s,
        color: color.clone(),
      });
      this.addCollider({
        type: 'cylinder',
        x: o.x,
        z: o.z,
        r: 0.38 * s,
        minY: y,
        maxY: y + 6.4 * s,
      });
    });

    const bushBuckets = bucketByVariant(bushVariants);
    bushes.forEach((b) => {
      const y = this.getHeightAt(b.x, b.z);
      const roll = rand();
      // 10% tall multi-stem Bush-05 thickets (scaled down slightly), 90% varied shrubs & flowering bushes
      const finalVariant =
        roll < 0.1
          ? 'Bush-05'
          : nonGiantBushes[Math.floor(rand() * nonGiantBushes.length)];
      const baseScale = finalVariant === 'Bush-05' ? 0.52 + rand() * 0.28 : 0.88 + rand() * 0.56;
      const sx = baseScale * (0.92 + rand() * 0.16);
      const sz = baseScale * (0.92 + rand() * 0.16);
      const ry = rand() * Math.PI * 2;
      color.setHSL(0.26 + (rand() - 0.5) * 0.04, 0.15, 0.94 + (rand() - 0.5) * 0.12);
      bushBuckets.get(finalVariant)!.push({
        x: b.x,
        y: y - 0.06,
        z: b.z,
        rx: 0,
        ry,
        rz: 0,
        sx,
        sy: baseScale,
        sz,
        color: color.clone(),
      });
    });

    const reedBuckets = bucketByVariant(reedVariants);
    reeds.forEach((rd) => {
      const y = this.getHeightAt(rd.x, rd.z);
      const ry = rand() * Math.PI * 2;
      const s = 0.85 + rand() * 0.45;
      const variant = reedVariants[Math.floor(rand() * reedVariants.length)];
      color.setHSL(0.22 + (rand() - 0.5) * 0.04, 0.14, 0.95 + (rand() - 0.5) * 0.12);
      reedBuckets.get(variant)!.push({
        x: rd.x,
        y: y - 0.08,
        z: rd.z,
        rx: 0,
        ry,
        rz: 0,
        sx: s,
        sy: s,
        sz: s,
        color: color.clone(),
      });
    });

    const groundBuckets = bucketByVariant(groundVariants);
    groundCover.forEach((gc) => {
      const y = this.getHeightAt(gc.x, gc.z);
      const ry = rand() * Math.PI * 2;
      const s = 0.72 + rand() * 0.48;
      const variant = groundVariants[Math.floor(rand() * groundVariants.length)];
      color.setHSL(0.26 + (rand() - 0.5) * 0.04, 0.12, 0.96 + (rand() - 0.5) * 0.1);
      groundBuckets.get(variant)!.push({
        x: gc.x,
        y: y - 0.015,
        z: gc.z,
        rx: 0,
        ry,
        rz: 0,
        sx: s,
        sy: s,
        sz: s,
        color: color.clone(),
      });
    });

    const applyShapesparkWindShader = (
      mat: THREE.MeshStandardMaterial,
      opts: {
        swayStrength: number;
        flutterStrength: number;
        heightNorm: number;
        isTrunk: boolean;
      }
    ) => {
      mat.customProgramCacheKey = () =>
        `shapespark-${opts.isTrunk ? 'trunk' : 'leaf'}-${opts.heightNorm}-${opts.swayStrength}-${opts.flutterStrength}`;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.windUniforms.uTime;
        shader.uniforms.uFogBarrierDist = this.windUniforms.uFogBarrierDist;
        shader.uniforms.uPlayerPos = this.windUniforms.uPlayerPos;
        shader.vertexShader =
          `uniform float uTime;\nvarying vec3 vFoliageWorldPos;\nvarying float vLocalHeight;\n` +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             float wx = instanceMatrix[3][0];
             float wz = instanceMatrix[3][2];
             vLocalHeight = clamp(position.y / ${opts.heightNorm.toFixed(2)}, 0.0, 1.0);
             float hPin = smoothstep(0.05, 0.35, vLocalHeight);
             float branchFlex = clamp(position.y * 0.38, 0.0, 2.6);
             float swayX = sin(uTime * 1.65 + wx * 0.35 + wz * 0.35) * ${opts.swayStrength.toFixed(4)};
             float swayZ = cos(uTime * 1.38 + wz * 0.38 - wx * 0.28) * ${(opts.swayStrength * 0.8).toFixed(4)};
             ${
               opts.flutterStrength > 0
                 ? `float leafFlutter = sin(uTime * 4.4 + position.x * 3.1 + position.y * 2.4 + wx) * ${opts.flutterStrength.toFixed(4)} * hPin;`
                 : `float leafFlutter = 0.0;`
             }
             transformed.x += swayX * branchFlex + leafFlutter;
             transformed.z += swayZ * branchFlex;
             vec4 wp = instanceMatrix * vec4(transformed, 1.0);
             vFoliageWorldPos = wp.xyz;`
          );

        let frag =
          `uniform float uFogBarrierDist;\nuniform vec3 uPlayerPos;\nvarying vec3 vFoliageWorldPos;\nvarying float vLocalHeight;\n` +
          shader.fragmentShader;

        if (!opts.isTrunk) {
          frag = frag
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               vec3 sunDir = normalize(vec3(0.60, 0.36, -0.71));
               vec3 viewDir = normalize(cameraPosition - vFoliageWorldPos);
               float sss = pow(max(0.0, dot(viewDir, -sunDir)), 2.4) * (0.25 + 0.75 * vLocalHeight);
               float crownSun = smoothstep(0.18, 0.95, vLocalHeight) * 0.055;
               float canopyAo = mix(0.76, 1.05, smoothstep(0.0, 0.62, vLocalHeight));
               diffuseColor.rgb = diffuseColor.rgb * canopyAo + vec3(0.12, 0.16, 0.02) * sss + vec3(0.05, 0.07, 0.015) * crownSun;`
            )
            .replace(
              '#include <normal_fragment_begin>',
              `#include <normal_fragment_begin>
               normal = normalize(vec3(normal.x * 0.55, abs(normal.y) + 0.55, normal.z * 0.55));`
            );
        }

        frag = frag.replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
           float dFoliageHoriz = length(vFoliageWorldPos.xz - uPlayerPos.xz);
           float fBarrier = smoothstep(uFogBarrierDist * 0.62, uFogBarrierDist * 0.98, dFoliageHoriz);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.80, 0.66, 0.51), fBarrier * 0.92);`
        );

        shader.fragmentShader = frag;
      };
    };

    // Instantiate Shapespark GLTF plant kits asynchronously into InstancedMeshes
    void loadShapesparkPlantCatalog()
      .then((catalog) => {
        if (this.isDisposed) return;

        const matCache = new Map<string, THREE.MeshStandardMaterial>();
        const depthMatCache = new Map<string, THREE.MeshDepthMaterial>();

        const getPlantMaterial = (
          prim: ShapesparkPrimitiveSpec,
          groupKey: string,
          swayStrength: number,
          flutterStrength: number,
          heightNorm: number,
          alphaTestVal: number
        ) => {
          const cacheKey = `${groupKey}:${prim.materialName}`;
          let mat = matCache.get(cacheKey);
          if (!mat) {
            mat = prim.baseMaterial.clone();
            mat.color.setHex(0xffffff);
            mat.metalness = 0.0;
            if (mat.map) {
              mat.map.anisotropy = isSoftwareGl ? 1 : 4;
            }
            if (prim.isTrunk) {
              mat.transparent = false;
              mat.alphaTest = 0;
              mat.depthWrite = true;
              mat.side = THREE.FrontSide;
              mat.roughness = 0.88;
              mat.emissive.setHex(0x16100a);
              mat.emissiveIntensity = 0.18;
            } else {
              mat.transparent = false;
              mat.alphaTest = alphaTestVal;
              mat.depthWrite = true;
              mat.side = THREE.DoubleSide;
              mat.roughness = 0.78;
              mat.emissive.setHex(0x11220d);
              mat.emissiveIntensity = 0.22;
            }
            applyShapesparkWindShader(mat, {
              swayStrength,
              flutterStrength: prim.isTrunk ? 0 : flutterStrength,
              heightNorm,
              isTrunk: prim.isTrunk,
            });
            mat.needsUpdate = true;
            matCache.set(cacheKey, mat);
            this.disposables.push(mat);
          }

          let depthMat: THREE.MeshDepthMaterial | undefined;
          if (!prim.isTrunk && !isSoftwareGl && mat.map) {
            depthMat = depthMatCache.get(cacheKey);
            if (!depthMat) {
              depthMat = new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                map: mat.map,
                alphaTest: alphaTestVal,
              });
              depthMatCache.set(cacheKey, depthMat);
              this.disposables.push(depthMat);
            }
          }

          return { mat, depthMat };
        };

        const spawnVariantBuckets = (
          buckets: Map<string, VegItem[]>,
          opts: {
            groupKey: string;
            swayStrength: number;
            flutterStrength: number;
            heightNorm: number;
            castShadow: boolean;
            shootableTrunks: boolean;
            alphaTestVal?: number;
          }
        ) => {
          const alphaCutoff = opts.alphaTestVal ?? 0.36;
          buckets.forEach((items, variantName) => {
            if (items.length === 0) return;
            const prims = catalog.variants.get(variantName);
            if (!prims || prims.length === 0) return;

            const meshes: THREE.InstancedMesh[] = [];
            const coloredMeshes: THREE.InstancedMesh[] = [];

            for (const prim of prims) {
              const { mat, depthMat } = getPlantMaterial(
                prim,
                opts.groupKey,
                opts.swayStrength,
                opts.flutterStrength,
                opts.heightNorm,
                alphaCutoff
              );
              const inst = new THREE.InstancedMesh(prim.geometry, mat, items.length);
              inst.castShadow = opts.castShadow && !isSoftwareGl;
              inst.receiveShadow = !isSoftwareGl;
              inst.frustumCulled = false;
              if (depthMat && inst.castShadow) {
                inst.customDepthMaterial = depthMat;
              }
              meshes.push(inst);
              if (!prim.isTrunk) {
                coloredMeshes.push(inst);
              }
              if (opts.shootableTrunks && prim.isTrunk) {
                this.shootables.push(inst);
              }
              this.disposables.push({ dispose: () => inst.dispose() });
            }

            items.forEach((it, idx) => {
              dummy.position.set(it.x, it.y, it.z);
              dummy.rotation.set(it.rx, it.ry, it.rz);
              dummy.scale.set(it.sx, it.sy, it.sz);
              dummy.updateMatrix();
              for (const inst of meshes) {
                inst.setMatrixAt(idx, dummy.matrix);
              }
              if (it.color) {
                for (const cMesh of coloredMeshes) {
                  cMesh.setColorAt(idx, it.color);
                }
              }
            });

            this.staticVegSets.push({
              meshes,
              coloredMeshes: coloredMeshes.length > 0 ? coloredMeshes : undefined,
              items,
            });
            this.rootGroup.add(...meshes);
          });
        };

        // 1. EVERGREEN / CONIFER FOREST (Shapespark Tree-03-1..4)
        spawnVariantBuckets(pineBuckets, {
          groupKey: 'pine',
          swayStrength: 0.044,
          flutterStrength: 0.014,
          heightNorm: 7.5,
          castShadow: true,
          shootableTrunks: true,
        });

        // 2. BROADLEAF WOODLAND TREES (Shapespark Tree-01-1..4 & Tree-02-1..4)
        spawnVariantBuckets(oakBuckets, {
          groupKey: 'oak',
          swayStrength: 0.05,
          flutterStrength: 0.016,
          heightNorm: 7.0,
          castShadow: true,
          shootableTrunks: true,
        });

        // 3. SHRUBS & FLOWERING BUSHES (Shapespark Bush-01..05, Flowers-02/04)
        spawnVariantBuckets(bushBuckets, {
          groupKey: 'bush',
          swayStrength: 0.052,
          flutterStrength: 0.015,
          heightNorm: 1.4,
          castShadow: true,
          shootableTrunks: false,
        });

        // 5. SHORELINE SEDGES & REEDS (Shapespark Grass-01..03)
        spawnVariantBuckets(reedBuckets, {
          groupKey: 'reed',
          swayStrength: 0.095,
          flutterStrength: 0.022,
          heightNorm: 1.35,
          castShadow: false,
          shootableTrunks: false,
        });

        // 5b. FOREST FLOOR CLOVER & WILDFLOWERS (Shapespark Clover-01..05, Flowers-01/03)
        spawnVariantBuckets(groundBuckets, {
          groupKey: 'ground',
          swayStrength: 0.025,
          flutterStrength: 0.008,
          heightNorm: 0.25,
          castShadow: false,
          shootableTrunks: false,
          alphaTestVal: 0.34,
        });

        // Force an immediate culling/distance update at the player's current position
        this.lastCullCenterX = 9999;
        this.lastCullCenterZ = 9999;
        this.updateStaticVegetationCulling(
          this.windUniforms.uPlayerPos.value.x,
          this.windUniforms.uPlayerPos.value.z
        );
      })
      .catch((err) => {
        console.error('Failed to load Shapespark plant assets:', err);
      });

    // ========================================================================
    // 4. SMOOTH RIVER-WORN MOSSY BOULDERS (3 Nested Smooth Cluster Archetypes,
    //    User-Supplied Stone Texture /assets/aistudio/image_e250dad1.png,
    //    Soft Organic Top Moss Cap + 3D Tufted Moss Crowns, Deep Ground
    //    Embedding & Seamless Meadow-Base Blending)
    // ========================================================================
    const rockNoise = new SeededNoise2D(this.seed + 515);

    // Load user-provided smooth stone texture with mirrored seamless wrapping
    const rockTexLoader = new THREE.TextureLoader();
    const rockBaseTex = rockTexLoader.load('/assets/aistudio/image_e250dad1.png');
    rockBaseTex.colorSpace = THREE.NoColorSpace; // Converted to linear inside triplanar shader
    rockBaseTex.wrapS = THREE.MirroredRepeatWrapping;
    rockBaseTex.wrapT = THREE.MirroredRepeatWrapping;
    rockBaseTex.anisotropy = isSoftwareGl ? 1 : 8;

    // Lightweight 256x256 seamless organic moss-edge & soft moss-cushion layer mask
    const mMaskSize = 256;
    const mMaskCanvas = document.createElement('canvas');
    mMaskCanvas.width = mMaskSize;
    mMaskCanvas.height = mMaskSize;
    const mMaskCtx = mMaskCanvas.getContext('2d')!;
    const mMaskImg = mMaskCtx.createImageData(mMaskSize, mMaskSize);

    const tileHash2 = (ix: number, iy: number, period: number, salt: number): number => {
      const wx = ((ix % period) + period) % period;
      const wy = ((iy % period) + period) % period;
      let h = (wx * 374761393 + wy * 668265263 + salt * 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967295;
    };

    const tileValueNoise = (u: number, v: number, period: number, salt: number): number => {
      const x = u * period;
      const y = v * period;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const n00 = tileHash2(ix, iy, period, salt);
      const n10 = tileHash2(ix + 1, iy, period, salt);
      const n01 = tileHash2(ix, iy + 1, period, salt);
      const n11 = tileHash2(ix + 1, iy + 1, period, salt);
      return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
    };

    const tileFbm = (
      u: number,
      v: number,
      basePeriod: number,
      octaves: number,
      salt: number
    ): number => {
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      let p = basePeriod;
      for (let o = 0; o < octaves; o++) {
        sum += tileValueNoise(u, v, p, salt + o * 31) * amp;
        norm += amp;
        p *= 2;
        amp *= 0.5;
      }
      return sum / norm;
    };

    for (let py = 0; py < mMaskSize; py++) {
      const v = py / mMaskSize;
      for (let px = 0; px < mMaskSize; px++) {
        const u = px / mMaskSize;
        // R: Soft organic feathered moss-edge mask
        const mossEdge = tileFbm(u, v, 5, 4, 349);
        // G: Gentle mossy cushion & blade-tip tonal variation
        const mossCushion = clamp(
          tileFbm(u, v, 10, 3, 719) * 0.65 + tileValueNoise(u, v, 28, 911) * 0.35,
          0,
          1
        );
        // B: Subtle painterly stone tonal warmth/coolness wash
        const stoneWash = tileFbm(u, v, 4, 3, 137);
        const idx = (py * mMaskSize + px) * 4;
        mMaskImg.data[idx] = Math.round(mossEdge * 255);
        mMaskImg.data[idx + 1] = Math.round(mossCushion * 255);
        mMaskImg.data[idx + 2] = Math.round(stoneWash * 255);
        mMaskImg.data[idx + 3] = 255;
      }
    }
    mMaskCtx.putImageData(mMaskImg, 0, 0);

    const rockMossMaskTex = new THREE.CanvasTexture(mMaskCanvas);
    rockMossMaskTex.colorSpace = THREE.NoColorSpace;
    rockMossMaskTex.wrapS = THREE.RepeatWrapping;
    rockMossMaskTex.wrapT = THREE.RepeatWrapping;
    rockMossMaskTex.anisotropy = isSoftwareGl ? 1 : 4;

    this.disposables.push(rockBaseTex, rockMossMaskTex);

    type SmoothStoneSpec = {
      ox: number;
      oy: number;
      oz: number;
      sx: number;
      sy: number;
      sz: number;
      phase: number;
      detail: number;
    };

    // Low oy values embed ~55-65% of each smooth rounded boulder naturally inside the ground
    const rockClusterPresets: SmoothStoneSpec[][] = [
      // 0: Smooth Rounded Pair (large pillowy boulder + tucked smaller companion stone)
      [
        { ox: -0.14, oy: 0.1, oz: 0.0, sx: 1.24, sy: 0.72, sz: 1.02, phase: 1.4, detail: 4 },
        { ox: 0.94, oy: -0.04, oz: 0.42, sx: 0.56, sy: 0.44, sz: 0.52, phase: 5.2, detail: 3 },
      ],
      // 1: Cozy Nestled 4-Stone Cluster (broad main dome + 3 smaller smooth mossy stones)
      [
        { ox: -0.1, oy: 0.12, oz: 0.0, sx: 1.28, sy: 0.74, sz: 1.06, phase: 2.8, detail: 4 },
        { ox: 0.96, oy: 0.04, oz: -0.34, sx: 0.62, sy: 0.48, sz: 0.56, phase: 6.7, detail: 3 },
        { ox: 0.88, oy: -0.06, oz: 0.46, sx: 0.58, sy: 0.44, sz: 0.54, phase: 9.4, detail: 3 },
        { ox: -1.04, oy: -0.08, oz: 0.24, sx: 0.48, sy: 0.36, sz: 0.44, phase: 12.1, detail: 3 },
      ],
      // 2: Wide Half-Buried Meadow Dome (low smooth glacier-worn stone + nestled shoulder stone)
      [
        { ox: 0.0, oy: 0.04, oz: 0.0, sx: 1.42, sy: 0.64, sz: 1.14, phase: 4.3, detail: 4 },
        { ox: -0.82, oy: -0.06, oz: 0.44, sx: 0.64, sy: 0.44, sz: 0.58, phase: 8.9, detail: 3 },
      ],
    ];

    // Build 3 smooth, river-worn, deeply embedded mossy boulder cluster archetypes
    const buildSmoothMossyBoulderArchetype = (variantSeed: number): THREE.BufferGeometry => {
      const stoneSpecs = rockClusterPresets[variantSeed % rockClusterPresets.length];
      const lobeGeos: THREE.BufferGeometry[] = [];

      for (let lIdx = 0; lIdx < stoneSpecs.length; lIdx++) {
        const st = stoneSpecs[lIdx];
        const g = new THREE.IcosahedronGeometry(1.0, st.detail);
        const pos = g.attributes.position as THREE.BufferAttribute;
        const maskAttr = new Float32Array(pos.count * 4);

        for (let i = 0; i < pos.count; i++) {
          let vx = pos.getX(i);
          let vy = pos.getY(i);
          let vz = pos.getZ(i);

          // Very gentle, smooth river-worn organic undulation (no harsh cracks or sharp facets)
          const nSoft = rockNoise.sample(
            (vx + st.phase) * 0.72,
            (vz - st.phase) * 0.72 + vy * 0.45
          );
          const gentleWave = Math.sin(vx * 2.1 + st.phase) * Math.cos(vz * 1.9 - st.phase) * 0.038;
          const disp = 0.93 + (nSoft - 0.5) * 0.14 + gentleWave;

          // Slightly fuller pillowed crown, softly flattened settled base
          const bottomSquash = vy < 0 ? 0.78 : 1.0;
          vx = vx * disp * st.sx + st.ox;
          vy = vy * bottomSquash * disp * st.sy + st.oy;
          vz = vz * disp * st.sz + st.oz;

          // Smooth wide buried skirt reaching well below ground (y down to -0.82)
          if (vy < -0.02) {
            const skirtT = clamp((-0.02 - vy) / 0.85, 0, 1);
            const flare = 1.0 + skirtT * 0.14;
            vx = st.ox + (vx - st.ox) * flare;
            vz = st.oz + (vz - st.oz) * flare;
            vy = Math.max(-0.82, vy - skirtT * 0.18);
          }

          pos.setXYZ(i, vx, vy, vz);

          // Bake smooth per-vertex mask channels (aRockMask):
          // x = Soft top-dome highlight factor
          const domeTop = clamp((vy - st.oy) / Math.max(0.2, st.sy), 0, 1);

          // y = Soft inter-stone contact shadow AO where companion stones nestle together
          let cavityAo = 1.0;
          for (let oIdx = 0; oIdx < stoneSpecs.length; oIdx++) {
            if (oIdx === lIdx) continue;
            const other = stoneSpecs[oIdx];
            const ndx = (vx - other.ox) / Math.max(0.25, other.sx);
            const ndy = (vy - other.oy) / Math.max(0.25, other.sy);
            const ndz = (vz - other.oz) / Math.max(0.25, other.sz);
            const ndist = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz);
            const prox = smoothstep(0.75, 1.48, ndist);
            cavityAo = Math.min(cavityAo, 0.42 + 0.58 * prox);
          }

          // z = Normalized height across boulder cluster
          const heightNorm = clamp((vy + 0.35) / 1.25, 0, 1);

          // w = Smooth ground-seam grass blend factor (1 at/below ground -> 0 on upper flanks)
          const groundBlend = 1.0 - smoothstep(-0.08, 0.32, vy);

          maskAttr[i * 4] = domeTop;
          maskAttr[i * 4 + 1] = cavityAo;
          maskAttr[i * 4 + 2] = heightNorm;
          maskAttr[i * 4 + 3] = groundBlend;
        }

        g.setAttribute('aRockMask', new THREE.BufferAttribute(maskAttr, 4));
        g.deleteAttribute('normal');
        g.deleteAttribute('uv');
        const welded = BufferGeometryUtils.mergeVertices(g, 1e-4);
        g.dispose();
        welded.computeVertexNormals();
        lobeGeos.push(welded);
      }

      const rockGeo = BufferGeometryUtils.mergeGeometries(lobeGeos) ?? lobeGeos[0].clone();
      lobeGeos.forEach((lg) => lg.dispose());
      rockGeo.computeVertexNormals();

      return rockGeo;
    };

    const rockArchetypes = [
      buildSmoothMossyBoulderArchetype(0),
      buildSmoothMossyBoulderArchetype(1),
      buildSmoothMossyBoulderArchetype(2),
    ];

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.02,
    });
    rockMat.customProgramCacheKey = () => 'mossy-hollow-smooth-river-boulder-v3';

    // Clean Smooth Triplanar Stone Shader using user's stone texture (/assets/aistudio/image_e250dad1.png):
    //  - Soft, uncluttered pale stone look (no harsh cracks or noisy grit)
    //  - Feathered lush green moss cap on top matching valley grass
    //  - Seamless grassy terrain blend around the buried rock base
    rockMat.onBeforeCompile = (shader) => {
      shader.uniforms.uRockBaseMap = { value: rockBaseTex };
      shader.uniforms.uRockMaskMap = { value: rockMossMaskTex };

      shader.vertexShader =
        `attribute vec4 aRockMask;
varying vec3 vRockWorldNormal;
varying vec3 vRockObjNormal;
varying vec3 vRockTriPos;
varying vec4 vRockMaskAttr;
varying float vRockLocalY;\n` +
        shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           vRockLocalY = position.y;
           vRockObjNormal = normalize(objectNormal);
           vRockMaskAttr = aRockMask;
           #ifdef USE_INSTANCING
             vec3 rInstScale = vec3(
               length(instanceMatrix[0].xyz),
               length(instanceMatrix[1].xyz),
               length(instanceMatrix[2].xyz)
             );
             mat3 rInstRot = mat3(
               instanceMatrix[0].xyz / max(rInstScale.x, 0.0001),
               instanceMatrix[1].xyz / max(rInstScale.y, 0.0001),
               instanceMatrix[2].xyz / max(rInstScale.z, 0.0001)
             );
             vRockWorldNormal = normalize(rInstRot * objectNormal);
             vec3 rSeedOff = fract(instanceMatrix[3].xyz * 0.137) * 2.0;
             vRockTriPos = position * rInstScale * 0.36 + rSeedOff;
           #else
             vRockWorldNormal = normalize(objectNormal);
             vRockTriPos = position * 0.36;
           #endif`
        );

      shader.fragmentShader =
        `uniform sampler2D uRockBaseMap;
uniform sampler2D uRockMaskMap;
varying vec3 vRockWorldNormal;
varying vec3 vRockObjNormal;
varying vec3 vRockTriPos;
varying vec4 vRockMaskAttr;
varying float vRockLocalY;

vec4 sampleRockTriplanar(sampler2D tex, vec3 p, vec3 blendW) {
  vec4 tx = texture2D(tex, p.zy);
  vec4 ty = texture2D(tex, p.xz);
  vec4 tz = texture2D(tex, p.xy);
  return tx * blendW.x + ty * blendW.y + tz * blendW.z;
}

vec3 rockPerturbNormal(vec3 surfPos, vec3 surfNorm, float bumpH, float bumpScale) {
  vec3 vSigmaX = dFdx(surfPos);
  vec3 vSigmaY = dFdy(surfPos);
  vec3 R1 = cross(vSigmaY, surfNorm);
  vec3 R2 = cross(surfNorm, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  if (abs(fDet) < 1e-6) return surfNorm;
  fDet *= (float(gl_FrontFacing) * 2.0 - 1.0);
  float dHdX = dFdx(bumpH) * bumpScale;
  float dHdY = dFdy(bumpH) * bumpScale;
  vec3 vGrad = sign(fDet) * (dHdX * R1 + dHdY * R2);
  return normalize(abs(fDet) * surfNorm - vGrad);
}\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             vec3 rTriW = pow(abs(normalize(vRockObjNormal)), vec3(3.5));
             rTriW /= max(rTriW.x + rTriW.y + rTriW.z, 0.0001);

             // Sample user's smooth pale stone texture + soft organic moss mask
             vec3 rRawStone = sampleRockTriplanar(uRockBaseMap, vRockTriPos, rTriW).rgb;
             vec3 rStoneTex = pow(max(rRawStone, vec3(0.001)), vec3(2.2));
             vec4 rMask = sampleRockTriplanar(uRockMaskMap, vRockTriPos * 0.9, rTriW);

             // Soften texture contrast slightly for clean smooth river-worn boulder appearance
             float rStoneLuma = dot(rStoneTex, vec3(0.299, 0.587, 0.114));
             vec3 rSmoothStone = mix(vec3(rStoneLuma * 0.96, rStoneLuma * 0.99, rStoneLuma * 1.03), rStoneTex, 0.58);

             // Gentle painterly cool-grey shading on lower flanks & nested stone crevices
             vec3 rCoolTint = mix(vec3(0.68, 0.74, 0.80), vec3(0.95, 0.96, 0.94), smoothstep(-0.2, 0.65, vRockWorldNormal.y));
             vec3 rCol = rSmoothStone * rCoolTint * diffuseColor.rgb;
             rCol *= mix(0.94, 1.04, rMask.b);
             rCol *= mix(0.54, 1.0, vRockMaskAttr.y);

             // Soft feathered lush green moss cap on top of each rounded stone dome
             float rMossEdge = (rMask.r - 0.5) * 0.24;
             float rMossCap = smoothstep(0.46, 0.72, vRockWorldNormal.y + rMossEdge)
               * smoothstep(-0.02, 0.16, vRockLocalY);
             vec3 rMossDeep = vec3(0.055, 0.165, 0.036);
             vec3 rMossBright = vec3(0.185, 0.375, 0.088);
             vec3 rMossCol = mix(rMossDeep, rMossBright, smoothstep(0.22, 0.82, rMask.g * 0.75 + vRockWorldNormal.y * 0.25));
             rCol = mix(rCol, rMossCol, rMossCap * 0.92);

             // Seamless meadow-grass & earth ground blend where the embedded rock meets the hill
             float rGroundSeam = vRockMaskAttr.w * smoothstep(0.15, 0.85, 0.65 + (rMask.r - 0.5) * 0.45);
             vec3 rMeadowBlend = mix(vec3(0.08, 0.16, 0.045), vec3(0.12, 0.23, 0.062), rMask.g);
             rCol = mix(rCol, rMeadowBlend, rGroundSeam * 0.76);
             rCol *= mix(0.74, 1.02, smoothstep(-0.38, 0.22, vRockLocalY));

             diffuseColor.rgb = rCol;
             float rSoftBump = rStoneLuma * (1.0 - rMossCap * 0.75) + rMask.g * rMossCap * 0.22;`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             // Smooth satin river stone (0.76) transitioning cleanly to velvety matte moss (0.95)
             float rRough = mix(0.76, 0.95, clamp(rMossCap + rGroundSeam * 0.75, 0.0, 1.0));
             roughnessFactor = clamp(rRough, 0.68, 0.96);`
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             // Subtle, gentle stone grain relief so boulders stay smooth and cohesive
             normal = rockPerturbNormal(-vViewPosition, normal, rSoftBump, 0.36);`
          );
    };

    const rockBuckets: { rk: { x: number; z: number }; s: number; rx: number; ry: number; rz: number }[][] = [
      [],
      [],
      [],
    ];

    rocks.forEach((rk, idx) => {
      const s = 0.85 + rand() * 1.15;
      const ry = rand() * Math.PI * 2;
      const rx = (rand() - 0.5) * 0.08;
      const rz = (rand() - 0.5) * 0.08;
      rockBuckets[idx % 3].push({ rk, s, rx, ry, rz });
    });

    const normalVec = new THREE.Vector3();
    for (let vIdx = 0; vIdx < 3; vIdx++) {
      const bList = rockBuckets[vIdx];
      const rockGeo = rockArchetypes[vIdx];
      this.disposables.push(rockGeo);
      if (bList.length === 0) continue;

      const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, bList.length);
      rockInst.castShadow = !isSoftwareGl;
      rockInst.receiveShadow = !isSoftwareGl;
      rockInst.frustumCulled = false;

      const rockItems: VegItem[] = [];

      bList.forEach(({ rk, s, rx, ry, rz }, i) => {
        // Sample center + 16 perimeter points across inner/outer footprint rings
        // and sink deeply so rocks stay mostly embedded inside the ground
        const hCenter = this.getHeightAt(rk.x, rk.z);
        let minFootY = hCenter;
        for (const ringMul of [0.68, 1.22]) {
          const footR = s * ringMul;
          for (let a = 0; a < 8; a++) {
            const ang = (a * Math.PI) / 4;
            const hSample = this.getHeightAt(
              rk.x + Math.cos(ang) * footR,
              rk.z + Math.sin(ang) * footR
            );
            if (hSample < minFootY) minFootY = hSample;
          }
        }

        // Deeply embed the smooth boulder cluster into the ground for a natural half-buried look
        const groundedY = minFootY - 0.14 - s * 0.11;
        this.getNormalAt(rk.x, rk.z, normalVec);
        const slopePitchX = clamp(normalVec.z * 0.36, -0.24, 0.24) + rx;
        const slopeRollZ = clamp(-normalVec.x * 0.36, -0.24, 0.24) + rz;

        const sx = s * (0.94 + rand() * 0.16);
        const sy = s * (0.82 + rand() * 0.16);
        const sz = s * (0.94 + rand() * 0.16);

        dummy.position.set(rk.x, groundedY, rk.z);
        dummy.rotation.set(slopePitchX, ry, slopeRollZ);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        rockInst.setMatrixAt(i, dummy.matrix);

        // Register every individual stone lobe in this cluster so grass never clips into any rock
        const tmpStonePos = new THREE.Vector3();
        for (const st of rockClusterPresets[vIdx]) {
          tmpStonePos.set(st.ox, 0, st.oz).applyMatrix4(dummy.matrix);
          const stoneRad = Math.max(st.sx * sx, st.sz * sz) * 0.98;
          this.rockStoneFootprints.push({ x: tmpStonePos.x, z: tmpStonePos.z, r: stoneRad });
        }

        const shade = 0.88 + rand() * 0.16;
        const coolShift = (rand() - 0.5) * 0.04;
        color.setRGB(shade - coolShift * 0.4, shade, shade + coolShift * 0.5);
        rockInst.setColorAt(i, color);

        rockItems.push({
          x: rk.x,
          y: groundedY,
          z: rk.z,
          rx: slopePitchX,
          ry,
          rz: slopeRollZ,
          sx,
          sy,
          sz,
          color: color.clone(),
        });

        if (s >= 0.9) {
          this.addCollider({
            type: 'cylinder',
            x: rk.x,
            z: rk.z,
            r: Math.max(sx, sz) * 0.82,
            minY: groundedY - 0.6,
            maxY: groundedY + sy * 0.72,
          });
        }
      });

      rockInst.instanceMatrix.needsUpdate = true;
      if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;

      this.staticVegSets.push({
        meshes: [rockInst],
        coloredMeshes: [rockInst],
        items: rockItems,
      });
      this.rootGroup.add(rockInst);
      this.shootables.push(rockInst);
      this.disposables.push({ dispose: () => rockInst.dispose() });
    }
    this.disposables.push(rockMat);

    // ========================================================================
    // 6. ULTRA-DENSE SHADER-DRIVEN 3D CURVED-BLADE MEADOW GRASS (18,000 Patches
    //    x 24 Arched 4-Segment 3D Blades = 432,000 Blades Around Player +
    //    Subsurface Sun Scattering, Rolling Wind Gusts & Cloud Dapple)
    // ========================================================================
    const grassParts: THREE.BufferGeometry[] = [];
    const bladeCount = 24;
    const gBladeRand = mulberry32(this.seed + 909);

    for (let b = 0; b < bladeCount; b++) {
      // 4 concentric rings up to r = 0.44m so adjacent patches interlace into a continuous thick meadow carpet
      const ring = b < 5 ? 0 : b < 11 ? 1 : b < 17 ? 2 : 3;
      const ang = (b * Math.PI * 2) / bladeCount + (gBladeRand() - 0.5) * 0.42;
      const dist =
        ring === 0
          ? 0.03 + gBladeRand() * 0.05
          : ring === 1
          ? 0.11 + gBladeRand() * 0.07
          : ring === 2
          ? 0.22 + gBladeRand() * 0.09
          : 0.33 + gBladeRand() * 0.11;
      const bladeH = 0.52 + gBladeRand() * 0.28 - ring * 0.035;
      const bladeW = 0.072 + gBladeRand() * 0.026;
      const bend = 0.14 + ring * 0.05 + gBladeRand() * 0.11;
      const twist = (gBladeRand() - 0.5) * 0.55;

      // 4-segment vertical strip bent into a graceful arch and tapered to a botanical point
      const bladeGeo = new THREE.PlaneGeometry(bladeW, bladeH, 1, 4).toNonIndexed();
      const pos = bladeGeo.attributes.position;
      for (let vi = 0; vi < pos.count; vi++) {
        const yNorm = clamp((pos.getY(vi) + bladeH * 0.5) / bladeH, 0, 1); // 0 at root .. 1 at tip
        const taper = 1.0 - Math.pow(yNorm, 1.28) * 0.92;
        const xOrig = pos.getX(vi) * taper;
        const rotTwist = twist * yNorm;
        const xTwisted = xOrig * Math.cos(rotTwist);
        const zArch = Math.pow(yNorm, 1.72) * bend + xOrig * Math.sin(rotTwist);

        pos.setX(vi, xTwisted);
        pos.setY(vi, yNorm * bladeH);
        pos.setZ(vi, zArch);
      }
      bladeGeo.rotateY(ang);
      bladeGeo.translate(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
      grassParts.push(bladeGeo);
    }

    const grassGeo = BufferGeometryUtils.mergeGeometries(grassParts);
    const gPos = grassGeo.attributes.position;
    const gNorm = grassGeo.attributes.normal;
    for (let vi = 0; vi < gPos.count; vi++) {
      gNorm.setXYZ(vi, 0, 1, 0);
    }

    const grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      roughness: 0.84,
      metalness: 0.02,
      emissive: 0x091405,
      emissiveIntensity: 0.05,
    });

    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.windUniforms.uTime;
      shader.vertexShader =
        `uniform float uTime;\n` +
        `varying float vGrassHeight;\n` +
        `varying float vWindGust;\n` +
        `varying vec3 vGrassWorldPos;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float wx = instanceMatrix[3][0] + position.x;
           float wz = instanceMatrix[3][2] + position.z;
           vGrassHeight = clamp(position.y / 0.72, 0.0, 1.0);
           float hCurve = pow(vGrassHeight, 1.5);
           float mainWave = sin(uTime * 2.3 + wx * 0.15 + wz * 0.12);
           float crossWave = cos(uTime * 1.8 + wz * 0.17 - wx * 0.10);
           float microFlutter = sin(uTime * 6.0 + wx * 2.1 + wz * 1.7) * 0.28;
           vWindGust = clamp(mainWave * 0.5 + 0.5, 0.0, 1.0);
           transformed.x += (mainWave * 0.21 + microFlutter * 0.08) * hCurve;
           transformed.z += (crossWave * 0.16 + microFlutter * 0.06) * hCurve;
           transformed.y -= (abs(mainWave) * 0.04) * hCurve;
           vec4 gwp = instanceMatrix * vec4(transformed, 1.0);
           vGrassWorldPos = gwp.xyz;`
        );

      shader.fragmentShader =
        `uniform float uTime;\n` +
        `varying float vGrassHeight;\n` +
        `varying float vWindGust;\n` +
        `varying vec3 vGrassWorldPos;\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             // Linear-space woodland greens calibrated to match Terrain Splat Map (#3e6b2a Forest & #5f9e3c Short Grass)
             vec3 rootCol = vec3(0.046, 0.138, 0.022); // Deep mossy root matching #3e6b2a
             vec3 midCol  = vec3(0.108, 0.335, 0.042); // Mid-blade matching #5f9e3c
             vec3 tipCol  = vec3(0.185, 0.455, 0.065); // Sunlit natural green blade tip
             vec3 bladeGrad = mix(rootCol, midCol, smoothstep(0.0, 0.52, vGrassHeight));
             bladeGrad = mix(bladeGrad, tipCol, smoothstep(0.48, 1.0, vGrassHeight));

             // Moving cloud dapple & root ambient occlusion
             float cloudDapple = 0.90 + 0.14 * sin(vGrassWorldPos.x * 0.075 + vGrassWorldPos.z * 0.065 + uTime * 0.22);

             // Golden-hour Subsurface Scattering (SSS) aligned with low-angle golden sun (0.60, 0.36, -0.71)
             vec3 sunDir = normalize(vec3(0.60, 0.36, -0.71));
             vec3 viewDir = normalize(cameraPosition - vGrassWorldPos);
             float sss = pow(max(0.0, dot(viewDir, -sunDir)), 2.4) * pow(vGrassHeight, 1.35);
             vec3 sssGlow = vec3(0.13, 0.19, 0.028) * sss;

             // Subtle golden wind-crest sheen
             float windSheen = pow(vWindGust, 1.8) * pow(vGrassHeight, 2.0) * 0.05;
             diffuseColor.rgb = diffuseColor.rgb * bladeGrad * cloudDapple + sssGlow + vec3(windSheen * 0.95, windSheen, windSheen * 0.32);`
          )
          .replace(
            '#include <normal_fragment_begin>',
            `#include <normal_fragment_begin>
             normal = normalize(vec3(normal.x * 0.25, 1.0, normal.z * 0.25));`
          );
    };

    this.disposables.push(grassGeo, grassMat);

    const grassCount = CONFIG.QUALITY[quality].grassCount;
    this.grassInstanced = new THREE.InstancedMesh(grassGeo, grassMat, CONFIG.GRASS_COUNT);
    this.grassInstanced.count = grassCount;
    this.grassInstanced.frustumCulled = false;

    for (let i = 0; i < CONFIG.GRASS_COUNT; i++) {
      // Uniformly tile offsets across [-GRASS_RADIUS, +GRASS_RADIUS]^2 with jitter for thick, even coverage
      const dx = (rand() * 2 - 1) * CONFIG.GRASS_RADIUS;
      const dz = (rand() * 2 - 1) * CONFIG.GRASS_RADIUS;
      this.grassOffsets.push({
        dx,
        dz,
        rot: rand() * Math.PI * 2,
        scale: 0.9 + rand() * 0.65,
      });
      // Subtle natural variation around white so linear bladeGrad controls the exact botanical green
      color.setHSL(0.28 + (rand() - 0.5) * 0.04, 0.18, 0.88 + (rand() - 0.5) * 0.14);
      this.grassInstanced.setColorAt(i, color);
    }
    this.rootGroup.add(this.grassInstanced);
    this.updateGrassAroundPlayer(CONFIG.PLAYER_SPAWN.x, CONFIG.PLAYER_SPAWN.z);
    this.updateStaticVegetationCulling(CONFIG.PLAYER_SPAWN.x, CONFIG.PLAYER_SPAWN.z);
  }

  public setQuality(quality: QualityPreset): void {
    this.currentQuality = quality;
    const preset = CONFIG.QUALITY[quality];
    this.windUniforms.uFogBarrierDist.value = preset.vegDrawDist;
    this.fogBarrierGroup.scale.set(preset.vegDrawDist, 1, preset.vegDrawDist);
    if (this.grassInstanced) {
      this.grassInstanced.count = preset.grassCount;
      this.lastGrassCenterX = 9999;
    }
    this.lastCullCenterX = 9999;
  }

  private updateStaticVegetationCulling(px: number, pz: number): void {
    if (Math.hypot(px - this.lastCullCenterX, pz - this.lastCullCenterZ) < 4.5) return;
    this.lastCullCenterX = px;
    this.lastCullCenterZ = pz;

    const maxDist = CONFIG.QUALITY[this.currentQuality].vegDrawDist + 6.0;
    const fadeStart = maxDist - 20.0;

    for (const set of this.staticVegSets) {
      let activeCount = 0;
      for (let i = 0; i < set.items.length; i++) {
        const it = set.items[i];
        const d = Math.hypot(it.x - px, it.z - pz);
        if (d > maxDist) continue;

        // Smooth scale taper over the final 20m inside the horizon fog barrier so nothing pops
        const distFade = 1.0 - smoothstep(fadeStart, maxDist, d);
        const effScale = 0.25 + 0.75 * distFade;

        this.grassDummy.position.set(it.x, it.y - (1.0 - effScale) * 0.6, it.z);
        this.grassDummy.rotation.set(it.rx, it.ry, it.rz);
        this.grassDummy.scale.set(it.sx * effScale, it.sy * effScale, it.sz * effScale);
        this.grassDummy.updateMatrix();

        for (let m = 0; m < set.meshes.length; m++) {
          set.meshes[m].setMatrixAt(activeCount, this.grassDummy.matrix);
        }
        if (set.coloredMeshes && it.color) {
          for (let c = 0; c < set.coloredMeshes.length; c++) {
            set.coloredMeshes[c].setColorAt(activeCount, it.color);
          }
        }
        activeCount++;
      }

      for (let m = 0; m < set.meshes.length; m++) {
        const inst = set.meshes[m];
        inst.count = activeCount;
        inst.instanceMatrix.needsUpdate = true;
      }
      if (set.coloredMeshes) {
        for (let c = 0; c < set.coloredMeshes.length; c++) {
          const cMesh = set.coloredMeshes[c];
          if (cMesh.instanceColor) cMesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  private lastGrassCenterX = 9999;
  private lastGrassCenterZ = 9999;
  private grassDummy = new THREE.Object3D();
  private grassYawQ = new THREE.Quaternion();
  private grassLeanQ = new THREE.Quaternion();
  private grassUpAxis = new THREE.Vector3(0, 1, 0);
  private grassLeanAxis = new THREE.Vector3();

  /**
   * Builds a 512x512 (0.5m resolution) signed-distance & outward-push obstacle field
   * covering every rock stone lobe, wooden crate, structure wall, bridge, dock, tree trunk,
   * bush core, and pickup pad so grass never spawns inside objects and gently parts around them.
   */
  private buildGrassObstacleField(): void {
    const G = this.grassGridRes;
    const half = CONFIG.HALF_SIZE;
    const cellSize = CONFIG.MAP_SIZE / G;
    const distArr = this.grassObjDist;
    const pushXArr = this.grassPushX;
    const pushZArr = this.grassPushZ;

    distArr.fill(10.0);
    pushXArr.fill(0);
    pushZArr.fill(0);

    const stampCircle = (cx: number, cz: number, radius: number, reactionHalo: number): void => {
      const totalR = radius + reactionHalo;
      const gxMin = clamp(Math.floor((cx - totalR + half) / cellSize), 0, G - 1);
      const gxMax = clamp(Math.ceil((cx + totalR + half) / cellSize), 0, G - 1);
      const gzMin = clamp(Math.floor((cz - totalR + half) / cellSize), 0, G - 1);
      const gzMax = clamp(Math.ceil((cz + totalR + half) / cellSize), 0, G - 1);

      for (let gz = gzMin; gz <= gzMax; gz++) {
        const wz = -half + (gz + 0.5) * cellSize;
        const dz = wz - cz;
        const rowOff = gz * G;
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const wx = -half + (gx + 0.5) * cellSize;
          const dx = wx - cx;
          const d = Math.hypot(dx, dz);
          const sd = d - radius;
          const idx = rowOff + gx;
          if (sd < distArr[idx]) {
            distArr[idx] = sd;
            if (d > 1e-4) {
              pushXArr[idx] = dx / d;
              pushZArr[idx] = dz / d;
            }
          }
        }
      }
    };

    const stampBox = (
      cx: number,
      cz: number,
      halfW: number,
      halfD: number,
      yaw: number,
      pad: number,
      reactionHalo: number
    ): void => {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const ex = halfW + pad;
      const ez = halfD + pad;
      const worldHalfX = Math.abs(cosY) * ex + Math.abs(sinY) * ez + reactionHalo;
      const worldHalfZ = Math.abs(sinY) * ex + Math.abs(cosY) * ez + reactionHalo;

      const gxMin = clamp(Math.floor((cx - worldHalfX + half) / cellSize), 0, G - 1);
      const gxMax = clamp(Math.ceil((cx + worldHalfX + half) / cellSize), 0, G - 1);
      const gzMin = clamp(Math.floor((cz - worldHalfZ + half) / cellSize), 0, G - 1);
      const gzMax = clamp(Math.ceil((cz + worldHalfZ + half) / cellSize), 0, G - 1);

      for (let gz = gzMin; gz <= gzMax; gz++) {
        const wz = -half + (gz + 0.5) * cellSize;
        const dz = wz - cz;
        const rowOff = gz * G;
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const wx = -half + (gx + 0.5) * cellSize;
          const dx = wx - cx;

          // Transform into box local coordinates
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;

          const qx = Math.abs(lx) - ex;
          const qz = Math.abs(lz) - ez;
          const outX = Math.max(qx, 0);
          const outZ = Math.max(qz, 0);
          const outsideDist = Math.hypot(outX, outZ);
          const insideDist = Math.min(Math.max(qx, qz), 0);
          const sd = outsideDist + insideDist;

          const idx = rowOff + gx;
          if (sd < distArr[idx]) {
            distArr[idx] = sd;
            let nlx = 0;
            let nlz = 0;
            if (outsideDist > 1e-4) {
              nlx = (lx >= 0 ? outX : -outX) / outsideDist;
              nlz = (lz >= 0 ? outZ : -outZ) / outsideDist;
            } else if (qx > qz) {
              nlx = lx >= 0 ? 1 : -1;
            } else {
              nlz = lz >= 0 ? 1 : -1;
            }
            // Rotate outward normal back to world XZ
            pushXArr[idx] = nlx * cosY + nlz * sinY;
            pushZArr[idx] = -nlx * sinY + nlz * cosY;
          }
        }
      }
    };

    // 1. Every individual smooth boulder stone lobe (padded by +0.42m so outer blades never poke into stone)
    for (let i = 0; i < this.rockStoneFootprints.length; i++) {
      const st = this.rockStoneFootprints[i];
      stampCircle(st.x, st.z, st.r + 0.42, 1.1);
    }

    // 2. All world colliders (crates, walls, huts, outpost, watchtower, sandbags, bridges, dock, tree trunks)
    for (let i = 0; i < this.allColliders.length; i++) {
      const col = this.allColliders[i];
      if (col.type === 'cylinder') {
        stampCircle(col.x, col.z, col.r + 0.36, 0.9);
      } else {
        stampBox(col.cx, col.cz, col.w * 0.5, col.d * 0.5, col.yaw ?? 0, 0.4, 0.9);
      }
    }

    // 3. Health & Ammo pickup pads (keep pads cleanly visible above meadow grass)
    for (const pad of CONFIG.HEALTH_PADS) {
      stampCircle(pad.x, pad.z, 1.45, 0.75);
    }
    for (const pad of CONFIG.AMMO_PADS) {
      stampCircle(pad.x, pad.z, 1.45, 0.75);
    }

    // 4. Inner woody stem core of bushes
    for (let i = 0; i < this.bushFootprints.length; i++) {
      const b = this.bushFootprints[i];
      stampCircle(b.x, b.z, 0.46, 0.6);
    }
  }

  public updateGrassAroundPlayer(px: number, pz: number): void {
    if (!this.grassInstanced) return;
    if (Math.hypot(px - this.lastGrassCenterX, pz - this.lastGrassCenterZ) < 2.0) return;
    this.lastGrassCenterX = px;
    this.lastGrassCenterZ = pz;

    const count = this.grassInstanced.count;
    const R = CONFIG.GRASS_RADIUS;
    const span = R * 2;
    const G = this.grassGridRes;
    const half = CONFIG.HALF_SIZE;
    const invCell = G / CONFIG.MAP_SIZE;
    const distArr = this.grassObjDist;
    const pushXArr = this.grassPushX;
    const pushZArr = this.grassPushZ;

    for (let i = 0; i < count; i++) {
      const off = this.grassOffsets[i];
      // Wrap grass position seamlessly within [px - R, px + R]
      const wx = px + ((((off.dx - px) % span) + span + R) % span - R);
      const wz = pz + ((((off.dz - pz) % span) + span + R) % span - R);

      // O(1) bilinear lookup against rocks, crates, walls, trees, huts, docks & pickup pads
      const fx = (wx + half) * invCell - 0.5;
      const fz = (wz + half) * invCell - 0.5;
      const ix0 = clamp(Math.floor(fx), 0, G - 2);
      const iz0 = clamp(Math.floor(fz), 0, G - 2);
      const tx = clamp(fx - ix0, 0, 1);
      const tz = clamp(fz - iz0, 0, 1);
      const i00 = iz0 * G + ix0;
      const i10 = i00 + 1;
      const i01 = i00 + G;
      const i11 = i01 + 1;

      const dTop = distArr[i00] + (distArr[i10] - distArr[i00]) * tx;
      const dBot = distArr[i01] + (distArr[i11] - distArr[i01]) * tx;
      const objDist = dTop + (dBot - dTop) * tz;

      // Hard cull grass inside any rock or world object
      if (objDist <= 0.0) {
        this.grassDummy.scale.setScalar(0.0001);
        this.grassDummy.updateMatrix();
        this.grassInstanced.setMatrixAt(i, this.grassDummy.matrix);
        continue;
      }

      const h = this.getHeightAt(wx, wz);
      const slope = this.getSlopeAt(wx, wz);
      const bio = this.getBiomeAt(wx, wz).id;
      const dRoad = distToPolyline(wx, wz, ROAD_POLYLINE);

      // Strictly forbid grass on the Dirt Road, Water/Sand, Rock/Highlands, and inside Outpost, Bridges, Dock, or Huts
      const inStructureOrPad =
        Math.hypot(wx, wz) < 8.8 || // Ruined Outpost courtyard
        BRIDGE_LOCATIONS.some((b) => isPointInBridge(wx, wz, b, 1.8, 1.5)) || // River Bridges & ramps
        Math.hypot(wx - 78, wz - 52) < 9.5 || // Southeast Lake Port
        Math.hypot(wx - -70, wz - -30) < 4.2 || // West Stone Hut
        Math.hypot(wx - 70, wz - 70) < 4.2 || // SE Stone Hut
        Math.hypot(wx - 30, wz - -60) < 4.2; // North Forest Hut

      if (
        dRoad < 3.8 ||
        inStructureOrPad ||
        h < 0.85 ||
        h > 8.8 ||
        slope > 28 ||
        (bio !== 2 && bio !== 3)
      ) {
        this.grassDummy.scale.setScalar(0.0001);
      } else {
        const distFromPlayer = Math.hypot(wx - px, wz - pz);
        const edgeFade = 1.0 - smoothstep(R - 8.0, R, distFromPlayer);
        // Smoothly taper grass height along the road verge (from dRoad = 3.8m to 5.4m)
        const roadVerge = smoothstep(3.8, 5.4, dRoad);
        const vegBoost = 0.82 + this.getVegDensityAt(wx, wz) * 0.45;

        // Organic grass reaction right around rock & object perimeters (0m .. 0.95m):
        // gently shortens and parts/leans blades outward away from the rock or wall
        const reactT = objDist < 0.95 ? 1.0 - smoothstep(0.0, 0.95, objDist) : 0.0;
        const objHeightTaper = lerp(1.0, 0.56, reactT);
        const finalScale = off.scale * roadVerge * vegBoost * edgeFade * objHeightTaper;

        if (finalScale < 0.15) {
          this.grassDummy.scale.setScalar(0.0001);
        } else {
          this.grassDummy.position.set(wx, h - 0.03, wz);
          if (reactT > 0.01) {
            const pxt = pushXArr[i00] + (pushXArr[i10] - pushXArr[i00]) * tx;
            const pxb = pushXArr[i01] + (pushXArr[i11] - pushXArr[i01]) * tx;
            const pzt = pushZArr[i00] + (pushZArr[i10] - pushZArr[i00]) * tx;
            const pzb = pushZArr[i01] + (pushZArr[i11] - pushZArr[i01]) * tx;
            const pushX = pxt + (pxb - pxt) * tz;
            const pushZ = pzt + (pzb - pzt) * tz;
            const pushLen = Math.hypot(pushX, pushZ);
            this.grassYawQ.setFromAxisAngle(this.grassUpAxis, off.rot);
            if (pushLen > 0.05) {
              // Tilt +Y outward toward (pushX, 0, pushZ) around axis = up x push = (pushZ, 0, -pushX)
              this.grassLeanAxis.set(pushZ / pushLen, 0, -pushX / pushLen);
              this.grassLeanQ.setFromAxisAngle(this.grassLeanAxis, reactT * 0.36);
              this.grassDummy.quaternion.multiplyQuaternions(this.grassLeanQ, this.grassYawQ);
            } else {
              this.grassDummy.quaternion.copy(this.grassYawQ);
            }
          } else {
            this.grassDummy.rotation.set(0, off.rot, 0);
          }
          this.grassDummy.scale.set(finalScale * 1.12, finalScale, finalScale * 1.12);
        }
      }
      this.grassDummy.updateMatrix();
      this.grassInstanced.setMatrixAt(i, this.grassDummy.matrix);
    }
    this.grassInstanced.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // 5. STRUCTURES (Ruined Outpost + Watchtower Ramp, Engineered Bridge, 3 Huts, Lake Dock)
  // --------------------------------------------------------------------------
  private buildStructures(isSoftwareGl: boolean): void {
    // 1. Procedural Coursed Stone Masonry Texture (256x256)
    const stoneCanvas = document.createElement('canvas');
    stoneCanvas.width = 256;
    stoneCanvas.height = 256;
    const stCtx = stoneCanvas.getContext('2d')!;
    stCtx.fillStyle = '#575d65';
    stCtx.fillRect(0, 0, 256, 256);
    const stRand = mulberry32(this.seed + 501);
    const rows = 8;
    const rowH = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * 32;
      const cols = 4;
      const colW = 256 / cols;
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset + (stRand() - 0.5) * 6;
        const shade = Math.round(92 + (stRand() - 0.5) * 28);
        stCtx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
        stCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        // Subtle highlight & shadow bevel on each stone block
        stCtx.fillStyle = 'rgba(255,255,255,0.08)';
        stCtx.fillRect(x + 2, y + 2, colW - 4, 2);
        stCtx.fillStyle = 'rgba(0,0,0,0.22)';
        stCtx.fillRect(x + 2, y + rowH - 4, colW - 4, 2);
      }
    }
    const stoneTex = new THREE.CanvasTexture(stoneCanvas);
    stoneTex.colorSpace = THREE.SRGBColorSpace;
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;
    stoneTex.repeat.set(2, 2);

    // 2. Procedural Weathered Timber Plank Texture (256x256)
    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 256;
    woodCanvas.height = 256;
    const wdCtx = woodCanvas.getContext('2d')!;
    wdCtx.fillStyle = '#7c5130';
    wdCtx.fillRect(0, 0, 256, 256);
    const wdRand = mulberry32(this.seed + 601);
    const plankCount = 8;
    const plankW = 256 / plankCount;
    for (let p = 0; p < plankCount; p++) {
      const px = p * plankW;
      const baseR = 122 + Math.round((wdRand() - 0.5) * 22);
      const baseG = 80 + Math.round((wdRand() - 0.5) * 16);
      const baseB = 47 + Math.round((wdRand() - 0.5) * 12);
      wdCtx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
      wdCtx.fillRect(px + 1, 0, plankW - 2, 256);
      // Wood grain streaks
      for (let s = 0; s < 18; s++) {
        const gx = px + 2 + wdRand() * (plankW - 4);
        wdCtx.fillStyle = wdRand() > 0.5 ? 'rgba(40,20,8,0.16)' : 'rgba(220,175,120,0.09)';
        wdCtx.fillRect(gx, 0, 1.5, 256);
      }
      // Dark seam & iron nail heads
      wdCtx.fillStyle = '#2b190c';
      wdCtx.fillRect(px, 0, 2, 256);
      wdCtx.fillStyle = '#334155';
      wdCtx.beginPath();
      wdCtx.arc(px + plankW * 0.3, 14, 2.2, 0, Math.PI * 2);
      wdCtx.arc(px + plankW * 0.7, 14, 2.2, 0, Math.PI * 2);
      wdCtx.arc(px + plankW * 0.3, 242, 2.2, 0, Math.PI * 2);
      wdCtx.arc(px + plankW * 0.7, 242, 2.2, 0, Math.PI * 2);
      wdCtx.fill();
    }
    const woodTex = new THREE.CanvasTexture(woodCanvas);
    woodTex.colorSpace = THREE.SRGBColorSpace;
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(2, 2);

    this.disposables.push(stoneTex, woodTex);

    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      map: stoneTex,
      roughness: 0.86,
      metalness: 0.08,
    });
    const darkStoneMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      map: stoneTex,
      roughness: 0.88,
      metalness: 0.12,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xd6b08c,
      map: woodTex,
      roughness: 0.78,
      metalness: 0.06,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x9c7248,
      map: woodTex,
      roughness: 0.82,
      metalness: 0.08,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x27303f,
      roughness: 0.38,
      metalness: 0.82,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.75,
    });
    const sandbagMat = new THREE.MeshStandardMaterial({
      color: 0xb4a078,
      roughness: 0.9,
    });

    this.disposables.push(
      stoneMat,
      darkStoneMat,
      woodMat,
      darkWoodMat,
      ironMat,
      lanternMat,
      barrelMat,
      sandbagMat
    );

    const addBoxStruct = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      walkableTop = false
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h * 0.5, z);
      m.castShadow = !isSoftwareGl;
      m.receiveShadow = !isSoftwareGl;
      this.rootGroup.add(m);
      this.shootables.push(m);
      this.addCollider({
        type: 'aabb',
        minX: x - w * 0.5,
        maxX: x + w * 0.5,
        minY: y,
        maxY: y + h,
        minZ: z - d * 0.5,
        maxZ: z + d * 0.5,
        cx: x,
        cz: z,
        w,
        d,
        walkableTop,
      });
    };

    // Helper for visual-only architectural details (truss braces, individual planks, arch ribs)
    const addDecorBox = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      rx = 0,
      ry = 0,
      rz = 0
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = !isSoftwareGl;
      m.receiveShadow = !isSoftwareGl;
      this.rootGroup.add(m);
      this.shootables.push(m);
      return m;
    };

    // 1. RUINED OUTPOST ON THE KNOLL (0, 0)
    const outpostY = this.getHeightAt(0, 0) - 0.15;
    // 4 broken square perimeter walls (12x12 units, 3u high, with doorway/breach gaps)
    addBoxStruct(-3.8, outpostY, -6, 4.4, 2.8, 0.7, stoneMat, true);
    addBoxStruct(3.8, outpostY, -6, 4.4, 2.4, 0.7, stoneMat, true);
    addBoxStruct(-3.8, outpostY, 6, 4.4, 2.6, 0.7, stoneMat, true);
    addBoxStruct(3.8, outpostY, 6, 4.4, 2.9, 0.7, stoneMat, true);
    addBoxStruct(-6, outpostY, -3.8, 0.7, 2.9, 4.4, stoneMat, true);
    addBoxStruct(-6, outpostY, 3.8, 0.7, 2.3, 4.4, stoneMat, true);
    addBoxStruct(6, outpostY, 3.8, 0.7, 2.7, 4.4, stoneMat, true);

    // 2-Story Watchtower in NE corner (x: 3.6, z: -3.6) with walkable ramp
    const tx = 3.6;
    const tz = -3.6;
    [
      [-1.5, -1.5],
      [1.5, -1.5],
      [-1.5, 1.5],
      [1.5, 1.5],
    ].forEach(([ox, oz]) => {
      addBoxStruct(tx + ox, outpostY, tz + oz, 0.45, 6.2, 0.45, darkStoneMat, false);
    });
    // 2nd Floor platform (y = outpostY + 3.0)
    addBoxStruct(tx, outpostY + 2.85, tz, 3.6, 0.3, 3.6, woodMat, true);
    // Roof / sniper parapet rails
    addBoxStruct(tx, outpostY + 3.15, tz - 1.65, 3.6, 0.9, 0.25, woodMat, true);
    addBoxStruct(tx + 1.65, outpostY + 3.15, tz, 0.25, 0.9, 3.6, woodMat, true);

    // Ladder-less inclined ramp up to Watchtower 2nd floor (from z = 2.0 to z = -1.8 at x = 3.6)
    const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 4.6), woodMat);
    rampMesh.position.set(tx, outpostY + 1.5, tz + 3.6);
    rampMesh.rotation.x = 0.64;
    rampMesh.castShadow = !isSoftwareGl;
    rampMesh.receiveShadow = !isSoftwareGl;
    this.rootGroup.add(rampMesh);
    this.shootables.push(rampMesh);
    this.addCollider({
      type: 'aabb',
      minX: tx - 0.85,
      maxX: tx + 0.85,
      minY: outpostY,
      maxY: outpostY + 3.15,
      minZ: tz + 1.5,
      maxZ: tz + 5.7,
      cx: tx,
      cz: tz + 3.6,
      w: 1.7,
      d: 4.2,
      walkableTop: true,
      isRamp: true,
      rampAxis: 'z',
      rampStartY: outpostY + 3.1, // at minZ
      rampEndY: outpostY,         // at maxZ
    });

    // 2 Cylindrical Barrels & Sandbags inside/around Outpost (Crates added dynamically via Crate.fbx)
    [
      [-1.2, 2.2],
      [1.8, -1.2],
    ].forEach(([bx, bz]) => {
      const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.25, 12), barrelMat);
      bm.position.set(bx, outpostY + 0.625, bz);
      bm.castShadow = !isSoftwareGl;
      bm.receiveShadow = !isSoftwareGl;
      this.rootGroup.add(bm);
      this.shootables.push(bm);
      this.addCollider({
        type: 'cylinder',
        x: bx,
        z: bz,
        r: 0.48,
        minY: outpostY,
        maxY: outpostY + 1.25,
      });
    });

    // Sandbag cover walls
    addBoxStruct(0, outpostY, 7.6, 3.2, 0.95, 0.75, sandbagMat, true);
    addBoxStruct(-7.6, outpostY, 0, 0.75, 0.95, 3.2, sandbagMat, true);

    // =========================================================================
    // 2. ENGINEERED ARCH-TRUSS TIMBER & STONE BRIDGES (Terrain-Adaptive Elevation)
    // =========================================================================
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 64;
    glowCanvas.height = 64;
    const gCtx = glowCanvas.getContext('2d')!;
    const gGrad = gCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gGrad.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
    gGrad.addColorStop(0.35, 'rgba(245, 158, 11, 0.45)');
    gGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    gCtx.fillStyle = gGrad;
    gCtx.fillRect(0, 0, 64, 64);
    const lanternGlowTex = new THREE.CanvasTexture(glowCanvas);
    const lanternGlowMat = new THREE.SpriteMaterial({
      map: lanternGlowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(lanternGlowTex, lanternGlowMat);

    const buildArchBridge = (b: BridgeSpec) => {
      const { cx: bx, cz: bz, yaw, spanLen, deckW, rampLen, minDeckY } = b;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const toWorld = (lx: number, lz: number) => ({
        x: bx + lx * cosY + lz * sinY,
        z: bz - lx * sinY + lz * cosY,
      });

      const bridgeGroup = new THREE.Group();
      bridgeGroup.position.set(bx, 0, bz);
      bridgeGroup.rotation.y = yaw;
      this.rootGroup.add(bridgeGroup);

      const addLocalMesh = (
        lx: number,
        ly: number,
        lz: number,
        w: number,
        h: number,
        d: number,
        mat: THREE.Material,
        rx = 0,
        ry = 0,
        rz = 0
      ) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(lx, ly, lz);
        m.rotation.set(rx, ry, rz);
        m.castShadow = !isSoftwareGl;
        m.receiveShadow = !isSoftwareGl;
        bridgeGroup.add(m);
        this.shootables.push(m);
        return m;
      };

      const addOrientedBoxCollider = (
        lx: number,
        czLocal: number,
        w: number,
        d: number,
        minY: number,
        maxY: number,
        walkableTop: boolean,
        rampOpts?: { startY: number; endY: number }
      ) => {
        const wp = toWorld(lx, czLocal);
        const absCos = Math.abs(cosY);
        const absSin = Math.abs(sinY);
        const boundW = w * absCos + d * absSin;
        const boundD = w * absSin + d * absCos;
        this.addCollider({
          type: 'aabb',
          minX: wp.x - boundW * 0.5,
          maxX: wp.x + boundW * 0.5,
          minY,
          maxY,
          minZ: wp.z - boundD * 0.5,
          maxZ: wp.z + boundD * 0.5,
          cx: wp.x,
          cz: wp.z,
          w,
          d,
          yaw,
          walkableTop,
          ...(rampOpts
            ? {
                isRamp: true,
                rampAxis: 'z' as const,
                rampStartY: rampOpts.startY,
                rampEndY: rampOpts.endY,
              }
            : {}),
        });
      };

      // Sample bank elevations across width at ramp toe and abutments so deck sits cleanly above terrain
      const halfSpan = spanLen * 0.5;
      const sampleEndMax = (lz: number) => {
        let maxY = -10;
        let minY = 99;
        for (const lx of [-deckW * 0.48, 0, deckW * 0.48]) {
          const wp = toWorld(lx, lz);
          const h = this.getHeightAt(wp.x, wp.z);
          if (h > maxY) maxY = h;
          if (h < minY) minY = h;
        }
        return { maxY, minY };
      };

      const northToe = sampleEndMax(-(halfSpan + rampLen));
      const southToe = sampleEndMax(halfSpan + rampLen);
      const northAbut = sampleEndMax(-halfSpan);
      const southAbut = sampleEndMax(halfSpan);

      // Anchor ramp toes slightly into the lowest terrain edge across their width so no corner ever hangs
      const northGroundY = Math.max(0.35, northToe.minY - 0.04);
      const southGroundY = Math.max(0.35, southToe.minY - 0.04);
      const highestBank = Math.max(northToe.maxY, southToe.maxY, northAbut.maxY, southAbut.maxY);
      const lowestFoundation = -2.4;

      const deckTopY = Math.max(minDeckY, highestBank + 0.36);

      // 2a. Underlying unified walkable deck collider
      addOrientedBoxCollider(0, 0, deckW, spanLen, deckTopY - 0.48, deckTopY, true);

      // 2b. Heavy Stone Masonry Abutments spanning solidly from deep riverbed foundation up to deck underside
      const abutTopY = deckTopY - 0.04;
      const abutH = Math.max(1.5, abutTopY - lowestFoundation);
      const abutCenterY = lowestFoundation + abutH * 0.5;
      addLocalMesh(0, abutCenterY, -halfSpan + 0.1, deckW + 0.9, abutH, 1.75, darkStoneMat);
      addLocalMesh(0, abutCenterY, halfSpan - 0.1, deckW + 0.9, abutH, 1.75, darkStoneMat);

      // 4 Corner Stone Entry Pillars with Beveled Caps & Wrought-Iron Lanterns
      const pillarOffsetX = deckW * 0.5 + 0.05;
      const pillarOffsetZ = halfSpan - 0.1;
      const pillarTopY = deckTopY + 1.52;
      const pillarH = pillarTopY - lowestFoundation;
      const pillarCenterY = lowestFoundation + pillarH * 0.5;
      const pillarCorners: [number, number][] = [
        [-pillarOffsetX, -pillarOffsetZ],
        [pillarOffsetX, -pillarOffsetZ],
        [-pillarOffsetX, pillarOffsetZ],
        [pillarOffsetX, pillarOffsetZ],
      ];
      for (const [px, pz] of pillarCorners) {
        addLocalMesh(px, pillarCenterY, pz, 0.84, pillarH, 0.84, stoneMat);
        addOrientedBoxCollider(px, pz, 0.84, 0.84, deckTopY - 0.4, pillarTopY + 0.1, false);
        // Beveled stone cap
        addLocalMesh(px, pillarTopY + 0.09, pz, 0.98, 0.18, 0.98, darkStoneMat);
        // Iron lantern post & horizontal bracket arm
        const inwardSign = px < 0 ? 1 : -1;
        addLocalMesh(px, pillarTopY + 0.50, pz, 0.12, 0.68, 0.12, ironMat);
        addLocalMesh(px + inwardSign * 0.28, pillarTopY + 0.77, pz, 0.58, 0.09, 0.09, ironMat);
        // Hanging lantern cage & glowing amber core
        const lx = px + inwardSign * 0.48;
        addLocalMesh(lx, pillarTopY + 0.55, pz, 0.24, 0.32, 0.24, lanternMat);
        addLocalMesh(lx, pillarTopY + 0.73, pz, 0.32, 0.06, 0.32, ironMat);
        const glowSprite = new THREE.Sprite(lanternGlowMat);
        glowSprite.position.set(lx, pillarTopY + 0.55, pz);
        glowSprite.scale.set(2.2, 2.2, 1);
        bridgeGroup.add(glowSprite);
      }

      // 2c. Submerged Cut-Stone & Timber Trestle Piers in River Channel
      const pierSideX = deckW * 0.5 - 0.55;
      const pierBottomY = -2.4;
      const footingTopY = 0.55;
      const footingH = footingTopY - pierBottomY;
      const postTopY = deckTopY - 0.14;
      const postH = Math.max(0.4, postTopY - (footingTopY - 0.08));
      const postCenterY = footingTopY - 0.08 + postH * 0.5;
      const braceMidY = (footingTopY + (deckTopY - 0.4)) * 0.5;
      const braceSpanV = Math.max(0.4, deckTopY - 0.4 - footingTopY);
      const braceSpanH = pierSideX * 2 - 0.3;
      const braceLen = Math.hypot(braceSpanH, braceSpanV);
      const braceAngle = Math.atan2(braceSpanV, braceSpanH);

      for (const pz of [-2.7, 2.7]) {
        for (const px of [-pierSideX, pierSideX]) {
          addLocalMesh(px, pierBottomY + footingH * 0.5, pz, 0.95, footingH, 1.25, darkStoneMat);
          addLocalMesh(px, postCenterY, pz, 0.42, postH, 0.42, darkWoodMat);
        }
        // Crossbeam & diagonal X-sway braces between pier posts beneath bridge
        addLocalMesh(0, deckTopY - 0.40, pz, deckW - 0.45, 0.28, 0.36, darkWoodMat);
        addLocalMesh(0, braceMidY, pz, braceLen, 0.16, 0.16, darkWoodMat, 0, 0, braceAngle);
        addLocalMesh(0, braceMidY, pz, braceLen, 0.16, 0.16, darkWoodMat, 0, 0, -braceAngle);
      }

      // 2d. 3 Heavy Longitudinal Under-Deck Timber Stringers + Arched Support Ribs
      for (const sx of [-pierSideX, 0, pierSideX]) {
        addLocalMesh(sx, deckTopY - 0.26, 0, 0.34, 0.28, spanLen + 0.4, darkWoodMat);
      }
      const archSegments = [
        { zOff: -(spanLen * 0.35), yOff: deckTopY - 0.72, pitch: -0.22, len: spanLen * 0.28 },
        { zOff: 0.0, yOff: deckTopY - 0.44, pitch: 0.0, len: spanLen * 0.42 },
        { zOff: spanLen * 0.35, yOff: deckTopY - 0.72, pitch: 0.22, len: spanLen * 0.28 },
      ];
      for (const sideX of [-(deckW * 0.5 - 0.32), deckW * 0.5 - 0.32]) {
        for (const seg of archSegments) {
          addLocalMesh(sideX, seg.yOff, seg.zOff, 0.24, 0.26, seg.len, darkWoodMat, seg.pitch, 0, 0);
        }
      }

      // 2e. Individual Beveled Timber Deck Planks + Wheel-Guard Curbs
      const numPlanks = Math.round(spanLen * 1.75);
      const plankStep = spanLen / numPlanks;
      for (let i = 0; i < numPlanks; i++) {
        const pz = -halfSpan + (i + 0.5) * plankStep;
        const useAltMat = i % 3 === 0 ? darkWoodMat : woodMat;
        const jitterH = (i % 2) * 0.008;
        addLocalMesh(0, deckTopY - 0.07 + jitterH, pz, deckW - 0.1, 0.14, plankStep - 0.05, useAltMat);
      }
      addLocalMesh(-(deckW * 0.5 - 0.28), deckTopY + 0.09, 0, 0.32, 0.18, spanLen, darkWoodMat);
      addLocalMesh(deckW * 0.5 - 0.28, deckTopY + 0.09, 0, 0.32, 0.18, spanLen, darkWoodMat);

      // 2f. X-Braced Timber Truss Side Railings + Solid Side Barrier Colliders
      const railOffsetX = deckW * 0.5 - 0.15;
      addOrientedBoxCollider(-railOffsetX, 0, 0.4, spanLen, deckTopY, deckTopY + 1.35, false);
      addOrientedBoxCollider(railOffsetX, 0, 0.4, spanLen, deckTopY, deckTopY + 1.35, false);

      const trussBays = 5;
      const bayLen = (spanLen - 1.2) / trussBays;
      for (const sideX of [-railOffsetX, railOffsetX]) {
        addLocalMesh(sideX, deckTopY + 1.18, 0, 0.24, 0.16, spanLen - 0.6, darkWoodMat);
        addLocalMesh(sideX, deckTopY + 0.62, 0, 0.18, 0.12, spanLen - 0.6, woodMat);

        for (let b = 0; b <= trussBays; b++) {
          const postZ = -(spanLen - 1.2) * 0.5 + b * bayLen;
          addLocalMesh(sideX, deckTopY + 0.62, postZ, 0.26, 1.28, 0.26, darkWoodMat);
          addLocalMesh(sideX, deckTopY + 0.14, postZ, 0.3, 0.22, 0.3, ironMat);

          if (b < trussBays) {
            const midZ = postZ + bayLen * 0.5;
            const diagLen = Math.hypot(bayLen, 1.05);
            const diagPitch = Math.atan2(bayLen, 1.05);
            addLocalMesh(sideX, deckTopY + 0.62, midZ, 0.12, diagLen, 0.12, woodMat, diagPitch, 0, 0);
            addLocalMesh(sideX, deckTopY + 0.62, midZ, 0.12, diagLen, 0.12, woodMat, -diagPitch, 0, 0);
          }
        }
      }

      // 2g. Graded North & South Approach Ramps with Deep Stone Masonry Sub-Bases & Retaining Wing-Walls
      const rampSubBaseH = 2.4;
      const wingWallH = 2.6;

      const northRampCenterZ = -(halfSpan + rampLen * 0.5);
      const northSlopeLen = Math.hypot(rampLen + 0.35, deckTopY - northGroundY);
      const northRampPitch = Math.atan2(deckTopY - northGroundY, rampLen);
      const northMidY = (deckTopY + northGroundY) * 0.5;
      // Top timber ramp planking
      addLocalMesh(
        0,
        northMidY - 0.12,
        northRampCenterZ,
        deckW,
        0.24,
        northSlopeLen,
        woodMat,
        -northRampPitch,
        0,
        0
      );
      // Solid stone masonry ramp sub-base extending deep into embankment (eliminates any under-ramp gap)
      addLocalMesh(
        0,
        northMidY - 0.22 - rampSubBaseH * 0.5,
        northRampCenterZ,
        deckW + 0.1,
        rampSubBaseH,
        northSlopeLen,
        darkStoneMat,
        -northRampPitch,
        0,
        0
      );
      // Buried stone toe threshold sill at North ramp entrance
      addLocalMesh(
        0,
        northGroundY - 1.1,
        -(halfSpan + rampLen),
        deckW + 0.55,
        2.25,
        0.75,
        darkStoneMat
      );
      // Deeply anchored left & right Stone Wing-Walls
      addLocalMesh(
        -deckW * 0.5,
        northMidY + 0.34 - wingWallH * 0.5,
        northRampCenterZ,
        0.48,
        wingWallH,
        northSlopeLen + 0.15,
        stoneMat,
        -northRampPitch,
        0,
        0
      );
      addLocalMesh(
        deckW * 0.5,
        northMidY + 0.34 - wingWallH * 0.5,
        northRampCenterZ,
        0.48,
        wingWallH,
        northSlopeLen + 0.15,
        stoneMat,
        -northRampPitch,
        0,
        0
      );
      addOrientedBoxCollider(
        0,
        northRampCenterZ,
        deckW,
        rampLen,
        Math.min(northGroundY, deckTopY) - 1.2,
        deckTopY,
        true,
        { startY: northGroundY, endY: deckTopY }
      );

      const southRampCenterZ = halfSpan + rampLen * 0.5;
      const southSlopeLen = Math.hypot(rampLen + 0.35, deckTopY - southGroundY);
      const southRampPitch = Math.atan2(deckTopY - southGroundY, rampLen);
      const southMidY = (deckTopY + southGroundY) * 0.5;
      // Top timber ramp planking
      addLocalMesh(
        0,
        southMidY - 0.12,
        southRampCenterZ,
        deckW,
        0.24,
        southSlopeLen,
        woodMat,
        southRampPitch,
        0,
        0
      );
      // Solid stone masonry ramp sub-base extending deep into embankment (eliminates any under-ramp gap)
      addLocalMesh(
        0,
        southMidY - 0.22 - rampSubBaseH * 0.5,
        southRampCenterZ,
        deckW + 0.1,
        rampSubBaseH,
        southSlopeLen,
        darkStoneMat,
        southRampPitch,
        0,
        0
      );
      // Buried stone toe threshold sill at South ramp entrance
      addLocalMesh(
        0,
        southGroundY - 1.1,
        halfSpan + rampLen,
        deckW + 0.55,
        2.25,
        0.75,
        darkStoneMat
      );
      // Deeply anchored left & right Stone Wing-Walls
      addLocalMesh(
        -deckW * 0.5,
        southMidY + 0.34 - wingWallH * 0.5,
        southRampCenterZ,
        0.48,
        wingWallH,
        southSlopeLen + 0.15,
        stoneMat,
        southRampPitch,
        0,
        0
      );
      addLocalMesh(
        deckW * 0.5,
        southMidY + 0.34 - wingWallH * 0.5,
        southRampCenterZ,
        0.48,
        wingWallH,
        southSlopeLen + 0.15,
        stoneMat,
        southRampPitch,
        0,
        0
      );
      addOrientedBoxCollider(
        0,
        southRampCenterZ,
        deckW,
        rampLen,
        Math.min(southGroundY, deckTopY) - 1.2,
        deckTopY,
        true,
        { startY: deckTopY, endY: southGroundY }
      );
    };

    for (const bridgeCfg of BRIDGE_LOCATIONS) {
      buildArchBridge(bridgeCfg);
    }

    // 3. THREE RUINED STONE HUTS AT (-70, -30), (70, 70), (30, -60)
    const huts = [
      [-70, -30],
      [70, 70],
      [30, -60],
    ];
    for (const [hx, hz] of huts) {
      const hy = this.getHeightAt(hx, hz) - 0.2;
      // Back wall, Left wall, Right wall, and broken Front wall with doorway gap
      addBoxStruct(hx, hy, hz - 2.5, 5.4, 2.7, 0.5, stoneMat, true);
      addBoxStruct(hx - 2.5, hy, hz, 0.5, 2.6, 5.4, stoneMat, true);
      addBoxStruct(hx + 2.5, hy, hz, 0.5, 2.4, 5.4, stoneMat, true);
      addBoxStruct(hx - 1.7, hy, hz + 2.5, 1.8, 2.5, 0.5, stoneMat, true);
      addBoxStruct(hx + 1.7, hy, hz + 2.5, 1.8, 2.2, 0.5, stoneMat, true);
    }

    // 4. WOODEN LAKE PORT / DOCK ON EASTERN POND SHORE AT (77, 52)
    const dockY = 0.65;
    const deckH = 0.28;
    const deckTopY = dockY + deckH; // 0.93
    // Main timber pier extending West from the stone abutment face (x = 82.8) out into deep pond water (x = 70.2)
    addBoxStruct(76.5, dockY, 52, 12.6, deckH, 4.2, woodMat, true);
    // Stone masonry shore abutment anchoring the east end of the port (x: 82.82..84.42, cleanly separated from wood deck)
    addBoxStruct(83.62, -1.8, 52, 1.6, 2.74, 4.8, darkStoneMat, true);
    // Side timber wheel-guard curbs resting cleanly on top of the deck (y = 0.935) without penetrating deck planks
    addBoxStruct(76.6, deckTopY + 0.005, 50.06, 12.2, 0.14, 0.22, darkWoodMat, false);
    addBoxStruct(76.6, deckTopY + 0.005, 53.94, 12.2, 0.14, 0.22, darkWoodMat, false);
    // Submerged timber support pilings (terminating cleanly at underside of deck y = 0.65)
    // and distinct mooring bollards mounted on top of the deck (y = 0.935) with zero coplanar overlap
    [
      [71.0, 50.36],
      [71.0, 53.64],
      [74.8, 50.36],
      [74.8, 53.64],
      [78.6, 50.36],
      [78.6, 53.64],
      [82.1, 50.36],
      [82.1, 53.64],
    ].forEach(([px, pz], idx) => {
      // Under-deck support piling: y = -3.20 .. 0.648 (never pokes through the top of the wooden deck)
      addBoxStruct(px, -3.2, pz, 0.34, 3.848, 0.34, darkWoodMat, false);
      if (idx < 4) {
        // Above-deck iron mooring bollard: y = 0.935 .. 1.395
        addBoxStruct(px, deckTopY + 0.005, pz, 0.32, 0.46, 0.32, ironMat, false);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 5b. SEEDED RANDOM CRATES (/models/Crate.fbx) WITH COLLIDERS & WOOD PBR
  // --------------------------------------------------------------------------
  private buildCrates(isSoftwareGl: boolean): void {
    const rand = mulberry32(this.seed + 707);

    // Rich weathered timber plank texture mapped onto Crate.fbx UVs
    const crateCanvas = document.createElement('canvas');
    crateCanvas.width = 512;
    crateCanvas.height = 512;
    const cCtx = crateCanvas.getContext('2d')!;
    cCtx.fillStyle = '#8b5e38';
    cCtx.fillRect(0, 0, 512, 512);

    const plankCount = 10;
    const plankW = 512 / plankCount;
    for (let p = 0; p < plankCount; p++) {
      const px = p * plankW;
      const tone = (rand() - 0.5) * 26;
      const r = clamp(Math.round(148 + tone), 95, 195);
      const g = clamp(Math.round(103 + tone * 0.72), 65, 150);
      const b = clamp(Math.round(62 + tone * 0.48), 35, 105);
      cCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      cCtx.fillRect(px + 2, 0, plankW - 3, 512);

      // Horizontal cross-cut subtle bands & vertical wood grain streaks
      for (let s = 0; s < 36; s++) {
        const gx = px + 3 + rand() * (plankW - 6);
        cCtx.fillStyle = rand() > 0.45 ? 'rgba(42, 22, 10, 0.16)' : 'rgba(235, 195, 145, 0.1)';
        cCtx.fillRect(gx, 0, 1 + rand() * 1.8, 512);
      }

      // Plank bevel seam + dark edge AO
      cCtx.fillStyle = '#331e0e';
      cCtx.fillRect(px, 0, 2.5, 512);
      cCtx.fillStyle = 'rgba(255, 232, 195, 0.12)';
      cCtx.fillRect(px + 2.5, 0, 1.5, 512);

      // Metal nail heads at board ends
      cCtx.fillStyle = '#27303f';
      for (const ny of [20, 256, 492]) {
        cCtx.beginPath();
        cCtx.arc(px + plankW * 0.28, ny, 3.2, 0, Math.PI * 2);
        cCtx.arc(px + plankW * 0.72, ny, 3.2, 0, Math.PI * 2);
        cCtx.fill();
      }
    }

    const crateTex = new THREE.CanvasTexture(crateCanvas);
    crateTex.colorSpace = THREE.SRGBColorSpace;
    crateTex.wrapS = THREE.RepeatWrapping;
    crateTex.wrapT = THREE.RepeatWrapping;
    crateTex.repeat.set(2, 2);
    crateTex.anisotropy = isSoftwareGl ? 1 : 4;
    this.disposables.push(crateTex);

    const crateMats = [
      new THREE.MeshStandardMaterial({
        color: 0xd9b38c,
        map: crateTex,
        roughness: 0.76,
        metalness: 0.08,
        side: THREE.FrontSide,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xb28456,
        map: crateTex,
        roughness: 0.82,
        metalness: 0.1,
        side: THREE.FrontSide,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x9aa47b,
        map: crateTex,
        roughness: 0.78,
        metalness: 0.12,
        side: THREE.FrontSide,
      }),
    ];
    this.disposables.push(...crateMats);

    interface CrateSpec {
      x: number;
      y: number;
      z: number;
      yaw: number;
      sx: number;
      sy: number;
      sz: number;
      colW: number;
      colH: number;
      colD: number;
      matIdx: number;
    }

    const specs: CrateSpec[] = [];

    const overlapsExisting = (cx: number, cz: number, halfW: number, halfD: number): boolean => {
      const pad = 0.35;
      const rApprox = Math.hypot(halfW, halfD);
      const minX = cx - halfW - pad;
      const maxX = cx + halfW + pad;
      const minZ = cz - halfD - pad;
      const maxZ = cz + halfD + pad;

      for (let i = 0; i < this.allColliders.length; i++) {
        const col = this.allColliders[i];
        if (col.type === 'cylinder') {
          if (Math.hypot(cx - col.x, cz - col.z) < col.r + rApprox + pad) return true;
        } else {
          if (maxX > col.minX && minX < col.maxX && maxZ > col.minZ && minZ < col.maxZ) {
            return true;
          }
        }
      }
      return false;
    };

    const isClearOfSpawnsAndPaths = (cx: number, cz: number, allowOutpost = false): boolean => {
      if (Math.hypot(cx - CONFIG.PLAYER_SPAWN.x, cz - CONFIG.PLAYER_SPAWN.z) < 6.5) return false;
      for (const pad of CONFIG.HEALTH_PADS) {
        if (Math.hypot(cx - pad.x, cz - pad.z) < 3.0) return false;
      }
      for (const pad of CONFIG.AMMO_PADS) {
        if (Math.hypot(cx - pad.x, cz - pad.z) < 3.0) return false;
      }
      for (const sp of CONFIG.ENEMY_SPAWNS) {
        if (Math.hypot(cx - sp.x, cz - sp.z) < 4.5) return false;
      }
      // Keep both River Bridges and approach ramps clear
      for (const b of BRIDGE_LOCATIONS) {
        if (isPointInBridge(cx, cz, b, 2.2, 2.5)) return false;
      }
      // Keep Lake Port wooden deck and shore entrance clear
      if (cx > 69 && cx < 86 && cz > 48.5 && cz < 55.5) return false;
      // Keep hut doorways (+Z front entrances) open
      for (const [hx, hz] of [
        [-70, -30],
        [70, 70],
        [30, -60],
      ]) {
        if (Math.abs(cx - hx) < 3.0 && cz >= hz - 1.5 && cz <= hz + 7.5) return false;
      }
      if (!allowOutpost) {
        if (distToPolyline(cx, cz, ROAD_POLYLINE) < 4.0) return false;
      } else {
        // Keep Outpost N/S/E/W wall breaches & Watchtower ramp clear
        if (Math.abs(cx) < 1.9 && Math.abs(cz) > 3.6 && Math.abs(cz) < 8.5) return false;
        if (Math.abs(cz) < 1.9 && Math.abs(cx) > 3.6 && Math.abs(cx) < 8.5) return false;
        if (cx > 1.8 && cx < 5.6 && cz > -5.5 && cz < 3.2) return false;
      }
      return true;
    };

    const tryAddCrate = (
      cx: number,
      cz: number,
      scaleMin: number,
      scaleMax: number,
      yaw: number,
      allowOutpost = false
    ): boolean => {
      if (Math.abs(cx) > 106 || Math.abs(cz) > 106) return false;
      if (!isClearOfSpawnsAndPaths(cx, cz, allowOutpost)) return false;

      const s = scaleMin + rand() * (scaleMax - scaleMin);
      const sx = s * (0.94 + rand() * 0.12);
      const sy = s * (0.92 + rand() * 0.14);
      const sz = s * (0.94 + rand() * 0.12);

      const wRaw = CRATE_BASE_W * sx;
      const hRaw = CRATE_BASE_H * sy;
      const dRaw = CRATE_BASE_D * sz;
      const absCos = Math.abs(Math.cos(yaw));
      const absSin = Math.abs(Math.sin(yaw));
      const colW = (wRaw * absCos + dRaw * absSin) * 0.94;
      const colD = (wRaw * absSin + dRaw * absCos) * 0.94;

      const hCenter = this.getHeightAt(cx, cz);
      const slope = this.getSlopeAt(cx, cz);
      if (hCenter < CONFIG.WATER_LEVEL + 0.45 || slope > 24) return false;

      // Grounding check across footprint corners so crates sit solidly on terrain
      const rx = colW * 0.45;
      const rz = colD * 0.45;
      const h1 = this.getHeightAt(cx - rx, cz - rz);
      const h2 = this.getHeightAt(cx + rx, cz - rz);
      const h3 = this.getHeightAt(cx - rx, cz + rz);
      const h4 = this.getHeightAt(cx + rx, cz + rz);
      const minH = Math.min(hCenter, h1, h2, h3, h4);
      const maxH = Math.max(hCenter, h1, h2, h3, h4);
      if (minH < CONFIG.WATER_LEVEL + 0.3 || maxH - minH > 0.38) return false;

      if (overlapsExisting(cx, cz, colW * 0.5, colD * 0.5)) return false;

      const baseY = minH - 0.04;
      const spec: CrateSpec = {
        x: cx,
        y: baseY,
        z: cz,
        yaw,
        sx,
        sy,
        sz,
        colW,
        colH: hRaw,
        colD,
        matIdx: Math.floor(rand() * crateMats.length),
      };
      specs.push(spec);

      this.addCollider({
        type: 'aabb',
        minX: cx - colW * 0.5,
        maxX: cx + colW * 0.5,
        minY: baseY,
        maxY: baseY + hRaw,
        minZ: cz - colD * 0.5,
        maxZ: cz + colD * 0.5,
        cx,
        cz,
        w: colW,
        d: colD,
        walkableTop: true,
      });

      return true;
    };

    // 1. Outpost cover crates around The Knoll (0, 0)
    let outpostAdded = 0;
    for (let tries = 0; tries < 220 && outpostAdded < 6; tries++) {
      const ang = rand() * Math.PI * 2;
      const dist = 1.6 + rand() * 7.2;
      const cx = Math.cos(ang) * dist;
      const cz = Math.sin(ang) * dist;
      if (tryAddCrate(cx, cz, 0.54, 0.72, rand() * Math.PI * 2, true)) {
        outpostAdded++;
      }
    }

    // 2. Supply crates ONLY right beside structures (3 Stone Huts, Pond Port shore, and Bridge heads)
    const structureCrateZones: [number, number, number, number, number][] = [
      [-70, -30, 3.6, 6.4, 3], // West Stone Hut
      [70, 70, 3.6, 6.4, 3], // Southeast Stone Hut
      [30, -60, 3.6, 6.4, 3], // North Forest Stone Hut
      [86.5, 52, 2.2, 5.2, 3], // Pond Port shore cargo staging area
      [-30, 30, 7.6, 11.2, 2], // West River Bridge checkpoint
      [37.43, 49.03, 7.6, 11.2, 2], // East Road Bridge checkpoint
    ];
    for (const [ax, az, rMin, rMax, targetCount] of structureCrateZones) {
      let localAdded = 0;
      for (let tries = 0; tries < 100 && localAdded < targetCount; tries++) {
        const ang = rand() * Math.PI * 2;
        const r = rMin + rand() * (rMax - rMin);
        const cx = ax + Math.cos(ang) * r;
        const cz = az + Math.sin(ang) * r;
        if (tryAddCrate(cx, cz, 0.56, 0.78, rand() * Math.PI * 2, false)) {
          localAdded++;
        }
      }
    }

    // Load /models/Crate.fbx once and instantiate all seeded random crate meshes
    void loadCrateGeometry()
      .then((crateGeo) => {
        if (this.isDisposed) return;
        for (const spec of specs) {
          const mesh = new THREE.Mesh(crateGeo, crateMats[spec.matIdx]);
          mesh.position.set(spec.x, spec.y, spec.z);
          mesh.rotation.y = spec.yaw;
          mesh.scale.set(spec.sx, spec.sy, spec.sz);
          mesh.castShadow = !isSoftwareGl;
          mesh.receiveShadow = !isSoftwareGl;
          this.rootGroup.add(mesh);
          this.shootables.push(mesh);
        }
      })
      .catch((err) => {
        console.error('Failed to load /models/Crate.fbx:', err);
      });
  }

  // --------------------------------------------------------------------------
  // SPATIAL HASH GRID (10x10 cells) & DEBUG COLLIDER OUTLINES
  // --------------------------------------------------------------------------
  private getCellKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private addCollider(col: MapCollider): void {
    this.allColliders.push(col);

    const minX = col.type === 'cylinder' ? col.x - col.r : col.minX;
    const maxX = col.type === 'cylinder' ? col.x + col.r : col.maxX;
    const minZ = col.type === 'cylinder' ? col.z - col.r : col.minZ;
    const maxZ = col.type === 'cylinder' ? col.z + col.r : col.maxZ;

    const cMinX = Math.floor(minX / CONFIG.CELL_SIZE);
    const cMaxX = Math.floor(maxX / CONFIG.CELL_SIZE);
    const cMinZ = Math.floor(minZ / CONFIG.CELL_SIZE);
    const cMaxZ = Math.floor(maxZ / CONFIG.CELL_SIZE);

    for (let cz = cMinZ; cz <= cMaxZ; cz++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        const key = this.getCellKey(cx, cz);
        let bucket = this.spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.spatialGrid.set(key, bucket);
        }
        bucket.push(col);
      }
    }

    // Add wireframe outline for F3 debug toggle
    const wireMat = new THREE.MeshBasicMaterial({
      color: col.type === 'cylinder' ? 0x22c55e : 0xf59e0b,
      wireframe: true,
    });
    if (col.type === 'cylinder') {
      const h = col.maxY - col.minY;
      const wg = new THREE.CylinderGeometry(col.r, col.r, h, 8);
      const wm = new THREE.Mesh(wg, wireMat);
      wm.position.set(col.x, col.minY + h * 0.5, col.z);
      this.colliderDebugGroup.add(wm);
    } else {
      const h = col.maxY - col.minY;
      const wg = new THREE.BoxGeometry(col.w, h, col.d);
      const wm = new THREE.Mesh(wg, wireMat);
      wm.position.set(col.cx, col.minY + h * 0.5, col.cz);
      if (col.yaw) {
        wm.rotation.y = col.yaw;
      }
      this.colliderDebugGroup.add(wm);
    }
  }

  public getNearbyColliders(x: number, z: number): MapCollider[] {
    const cx = Math.floor(x / CONFIG.CELL_SIZE);
    const cz = Math.floor(z / CONFIG.CELL_SIZE);
    const result: MapCollider[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.spatialGrid.get(this.getCellKey(cx + dx, cz + dz));
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            result.push(bucket[i]);
          }
        }
      }
    }
    return result;
  }

  // Returns walkable surface height (terrain or bridge/dock/watchtower ramp/floor)
  public getSupportHeightAt(x: number, z: number, currentFeetY: number): number {
    let supportY = this.getHeightAt(x, z);
    const nearby = this.getNearbyColliders(x, z);
    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      if (c.type === 'aabb' && c.walkableTop) {
        const yaw = c.yaw ?? 0;
        let inFootprint = false;
        let rampT = 0;

        if (yaw === 0) {
          inFootprint =
            x >= c.minX - 0.35 && x <= c.maxX + 0.35 && z >= c.minZ - 0.35 && z <= c.maxZ + 0.35;
          if (inFootprint && c.isRamp) {
            rampT = clamp((z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ), 0, 1);
          }
        } else {
          const dx = x - c.cx;
          const dz = z - c.cz;
          const cosY = Math.cos(yaw);
          const sinY = Math.sin(yaw);
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;
          inFootprint =
            Math.abs(lx) <= c.w * 0.5 + 0.35 && Math.abs(lz) <= c.d * 0.5 + 0.35;
          if (inFootprint && c.isRamp) {
            rampT = clamp((lz + c.d * 0.5) / Math.max(0.01, c.d), 0, 1);
          }
        }

        if (inFootprint) {
          if (c.isRamp && c.rampStartY !== undefined && c.rampEndY !== undefined) {
            const rampY = lerp(c.rampStartY, c.rampEndY, rampT);
            if (currentFeetY >= rampY - 0.9) {
              supportY = Math.max(supportY, rampY);
            }
          } else if (currentFeetY >= c.maxY - 0.65) {
            supportY = Math.max(supportY, c.maxY);
          }
        }
      }
    }
    return supportY;
  }

  // --------------------------------------------------------------------------
  // COARSE 48x48 A* NAVIGATION GRID FOR ENEMY PATHFINDING
  // --------------------------------------------------------------------------
  private buildNavGrid(): void {
    const G = this.navGridSize; // 48
    const cs = this.navCellSize; // 5 units
    for (let gz = 0; gz < G; gz++) {
      const z = -CONFIG.HALF_SIZE + (gz + 0.5) * cs;
      for (let gx = 0; gx < G; gx++) {
        const x = -CONFIG.HALF_SIZE + (gx + 0.5) * cs;
        const h = this.getHeightAt(x, z);
        const slope = this.getSlopeAt(x, z);
        const onBridge = BRIDGE_LOCATIONS.some((b) => isPointInBridge(x, z, b, 1.5, 1.5));
        // Block deep water (depth > 1.2 => h < -1.2) unless on bridge, and slopes > 40°
        if ((!onBridge && h < -1.1) || slope > 40) {
          this.navBlocked[gz * G + gx] = 1;
        } else {
          this.navBlocked[gz * G + gx] = 0;
        }
      }
    }
  }

  public findNextWaypoint(startX: number, startZ: number, goalX: number, goalZ: number): { x: number; z: number } {
    const G = this.navGridSize;
    const cs = this.navCellSize;
    const toCell = (v: number) => clamp(Math.floor((v + CONFIG.HALF_SIZE) / cs), 0, G - 1);
    const toWorld = (c: number) => -CONFIG.HALF_SIZE + (c + 0.5) * cs;

    const sx = toCell(startX);
    const sz = toCell(startZ);
    const gx = toCell(goalX);
    const gz = toCell(goalZ);

    if (sx === gx && sz === gz) return { x: goalX, z: goalZ };

    // Fast bounded A* on 48x48 grid
    const total = G * G;
    const gScore = new Float32Array(total).fill(1e9);
    const cameFrom = new Int16Array(total).fill(-1);
    const closed = new Uint8Array(total);

    const startIdx = sz * G + sx;
    const goalIdx = gz * G + gx;
    gScore[startIdx] = 0;

    const open: number[] = [startIdx];
    let steps = 0;
    let bestIdx = startIdx;
    let bestDist = Math.hypot(gx - sx, gz - sz);

    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [-1, 1, 1.414],
      [1, -1, 1.414],
      [-1, -1, 1.414],
    ];

    while (open.length > 0 && steps++ < 260) {
      // Pop node with lowest f = g + h
      let minPos = 0;
      let minF = 1e9;
      for (let i = 0; i < open.length; i++) {
        const idx = open[i];
        const cx = idx % G;
        const cz = (idx / G) | 0;
        const f = gScore[idx] + Math.hypot(gx - cx, gz - cz);
        if (f < minF) {
          minF = f;
          minPos = i;
        }
      }

      const current = open[minPos];
      open.splice(minPos, 1);

      if (current === goalIdx) {
        bestIdx = goalIdx;
        break;
      }

      closed[current] = 1;
      const cx = current % G;
      const cz = (current / G) | 0;
      const dToGoal = Math.hypot(gx - cx, gz - cz);
      if (dToGoal < bestDist) {
        bestDist = dToGoal;
        bestIdx = current;
      }

      for (const [dx, dz, cost] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
        const nIdx = nz * G + nx;
        if (closed[nIdx] || this.navBlocked[nIdx]) continue;

        const tentativeG = gScore[current] + cost;
        if (tentativeG < gScore[nIdx]) {
          cameFrom[nIdx] = current;
          gScore[nIdx] = tentativeG;
          if (!open.includes(nIdx)) open.push(nIdx);
        }
      }
    }

    // Trace back to the second step along the path
    let curr = bestIdx;
    let prev = bestIdx;
    let guard = 0;
    while (cameFrom[curr] !== -1 && cameFrom[curr] !== startIdx && guard++ < 120) {
      prev = curr;
      curr = cameFrom[curr];
    }
    const targetCell = curr !== startIdx ? curr : prev;
    return {
      x: toWorld(targetCell % G),
      z: toWorld((targetCell / G) | 0),
    };
  }

  public update(dt: number, elapsedTime: number, playerX: number, playerZ: number): void {
    this.windUniforms.uTime.value = elapsedTime;
    this.windUniforms.uPlayerPos.value.set(playerX, 0, playerZ);
    if (this.skyDome) {
      this.skyDome.position.set(playerX, 0, playerZ);
    }
    this.fogBarrierGroup.position.set(playerX, 0, playerZ);

    this.updateGrassAroundPlayer(playerX, playerZ);
    this.updateStaticVegetationCulling(playerX, playerZ);

    // Continuously scroll water normal map & color texture downstream along river flow
    if (this.waterNormalTex) {
      this.waterNormalTex.offset.x = (this.waterNormalTex.offset.x + dt * 0.34) % 1;
      this.waterNormalTex.offset.y = (this.waterNormalTex.offset.y + dt * 0.16) % 1;
    }
    if (this.waterColorTex) {
      this.waterColorTex.offset.x = (this.waterColorTex.offset.x + dt * 0.18) % 1;
      this.waterColorTex.offset.y = (this.waterColorTex.offset.y + dt * 0.085) % 1;
    }

    // Update 3D whitewater current streaks gliding along the river spline
    this.updateRiverFlowStreaks(dt, elapsedTime);

    // Drift clouds gently across valley
    for (let i = 0; i < this.cloudGroup.children.length; i++) {
      const c = this.cloudGroup.children[i];
      c.position.x += dt * 1.4;
      if (c.position.x > 130) c.position.x = -130;
    }
  }

  public dispose(scene: THREE.Scene): void {
    this.isDisposed = true;
    scene.remove(this.rootGroup);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
