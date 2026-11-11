/**
 * E35 three.js engines for the WebXR showroom and the virtual fashion-show runway (FR-VR-01/02/04/05/07/08).
 * Imported only with `import("@/components/vr-engine")` when a 3D view opens, so three.js (pinned 0.186.1)
 * stays out of the Maker Space bundle.
 *
 * Comfort (FR-VR-07): teleport only in VR (no smooth locomotion, no forced camera motion), snap turn,
 * seated mode; reduced motion → instant moves and no ambient animation; high-contrast labels.
 * Input: controller rays and hand pinch (three's XR controllers cover tracked-pointer, hands and
 * transient-pointer on Vision Pro), gaze + dwell when nothing else is there.
 */
import { walkPose, type Placement, type RunwayCursor } from "@nyambika/contracts";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

export interface Palette {
  primary: string;
  secondary: string;
  deep: string;
}

// ── shared helpers ─────────────────────────────────────────────────────────
function makeRenderer(canvas: HTMLCanvasElement, lowEnd: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !lowEnd;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Imigongo-inspired zigzag / diamond tiling for floors and wall bands. */
function imigongo(g: CanvasRenderingContext2D, w: number, h: number, a: string, b: string, cell = 64) {
  g.fillStyle = a;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = b;
  g.lineWidth = cell * 0.12;
  g.lineJoin = "miter";
  for (let y = 0; y < h + cell; y += cell) {
    g.beginPath();
    for (let x = 0; x <= w + cell; x += cell) {
      g.lineTo(x, y + (Math.floor(x / cell) % 2 ? cell * 0.5 : 0));
    }
    g.stroke();
  }
  g.fillStyle = b;
  for (let y = cell * 0.25; y < h; y += cell) {
    for (let x = cell * 0.5; x < w; x += cell * 2) {
      g.beginPath();
      g.moveTo(x, y - cell * 0.12);
      g.lineTo(x + cell * 0.12, y);
      g.lineTo(x, y + cell * 0.12);
      g.lineTo(x - cell * 0.12, y);
      g.fill();
    }
  }
}

function mix(a: string, b: string, t: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

function labelTexture(font: string, title: string, sub: string, high: boolean, active = false) {
  return canvasTexture(640, 200, (g) => {
    roundRect(g, 6, 6, 628, 188, 46);
    g.fillStyle = high ? "#ffffff" : active ? "rgba(32,22,44,.92)" : "rgba(14,11,20,.80)";
    g.fill();
    g.lineWidth = active ? 8 : 4;
    g.strokeStyle = high ? "#000000" : active ? "#F2B84B" : "rgba(255,255,255,.22)";
    g.stroke();
    g.fillStyle = high ? "#000000" : "#ffffff";
    g.font = `900 54px ${font}`;
    g.textBaseline = "middle";
    let t = title;
    while (g.measureText(t).width > 560 && t.length > 4) t = t.slice(0, -2);
    if (t !== title) t = t.trimEnd() + "…";
    g.fillText(t, 40, 76);
    g.fillStyle = high ? "#5a3300" : "#F2B84B";
    g.font = `800 44px ${font}`;
    g.fillText(sub, 40, 140);
  });
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** Load GLBs with byte progress; callers keep at most `concurrency` downloads running (FR-VR-08 streaming). */
class Streamer {
  private loader = new GLTFLoader();
  private queue: { url: string; resolve: (g: GLTF | null) => void; onBytes: (b: number) => void }[] = [];
  private running = 0;
  constructor(private concurrency = 2) {}
  load(url: string, onBytes: (b: number) => void = () => {}) {
    return new Promise<GLTF | null>((resolve) => {
      this.queue.push({ url, resolve, onBytes });
      this.pump();
    });
  }
  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running += 1;
      let last = 0;
      this.loader.load(
        job.url,
        (g) => {
          this.running -= 1;
          job.resolve(g);
          this.pump();
        },
        (e) => {
          job.onBytes(e.loaded - last);
          last = e.loaded;
        },
        () => {
          this.running -= 1;
          job.resolve(null);
          this.pump();
        },
      );
    }
  }
}

// ── Showroom ───────────────────────────────────────────────────────────────
export interface RoomPiece {
  id: string;
  title: string;
  price: string;
  glb: string;
  poster: string | null;
  heightM: number;
  place: Placement;
}

export interface ShowroomOptions {
  canvas: HTMLCanvasElement;
  pieces: RoomPiece[];
  palette: Palette;
  brand: string;
  banner: string;
  font: string;
  reducedMotion: boolean;
  highContrast: boolean;
  lowEnd: boolean;
  onSelect: (id: string | null) => void;
  onHoldBuy: (id: string) => void;
  onProgress: (p: { loaded: number; total: number; bytes: number }) => void;
  onXr: (active: boolean) => void;
  onReady: () => void;
}

interface PieceNode {
  piece: RoomPiece;
  anchor: THREE.Group;
  holder: THREE.Group;
  hit: THREE.Mesh;
  label: THREE.Mesh;
  glow: THREE.Mesh | null;
  poster: THREE.Mesh | null;
  model: THREE.Object3D | null;
  twin: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
}

const HOLD_MS = 1200;
const DWELL_MS = 1600;
const ROOM_R = 8.5;
const WALK_R = 6.6;
const START = new THREE.Vector3(0, 0, 3.2);

export class ShowroomEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private dolly = new THREE.Group();
  private nodes: PieceNode[] = [];
  private teleports: THREE.Mesh[] = [];
  private floor!: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private streamer = new Streamer(2);
  private yaw = 0;
  private pitch = -0.06;
  private keys = new Set<string>();
  private glide: { from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; t: number; dur: number } | null = null;
  private selected: string | null = null;
  private seated = false;
  private eye = 1.6;
  private dust: THREE.Points | null = null;
  private loaded = 0;
  private bytes = 0;
  private firstFrame = false;
  private disposed = false;
  // XR
  private controllers: THREE.Group[] = [];
  private panel: THREE.Group | null = null;
  private buyBtn: THREE.Mesh | null = null;
  private closeBtn: THREE.Mesh | null = null;
  private hold: { start: number; source: THREE.Object3D | "gaze" } | null = null;
  private reticle: THREE.Mesh;
  private dwell: { target: THREE.Object3D | null; since: number } = { target: null, since: 0 };
  private snapReady = true;
  private pointer: { x: number; y: number; id: number; moved: boolean; yaw: number; pitch: number } | null = null;
  private ro: ResizeObserver;

  constructor(private o: ShowroomOptions) {
    this.renderer = makeRenderer(o.canvas, o.lowEnd);
    this.renderer.xr.enabled = true;
    const { clientWidth: w, clientHeight: h } = o.canvas;
    this.renderer.setSize(w, h, false);
    this.camera = new THREE.PerspectiveCamera(62, w / Math.max(1, h), 0.05, 40);
    this.camera.position.set(0, this.eye, 0);
    this.dolly.position.copy(START);
    this.dolly.add(this.camera);
    this.scene.add(this.dolly);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.032, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.buildRoom();
    this.buildPieces();
    this.setupXr();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.canvas);
    this.bindPointer();
    this.renderer.setAnimationLoop((t, f) => this.tick(t, f));
    void this.stream();
  }

  // ── scene ──
  private buildRoom() {
    const { palette: p } = this.o;
    const deep = new THREE.Color(p.deep).multiplyScalar(0.55);
    this.scene.background = deep;
    this.scene.fog = new THREE.Fog(deep, 7, 19);

    const hemi = new THREE.HemisphereLight(0xfff0e0, new THREE.Color(p.deep), 1.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4ea, 1.6);
    key.position.set(2.5, 7, 5);
    if (!this.o.lowEnd) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 20 });
      key.shadow.radius = 4;
      key.shadow.bias = -0.0008;
    }
    this.scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(p.secondary), 2.4, 14, 1.6);
    rim.position.set(0, 3.6, -5);
    this.scene.add(rim);

    const floorTex = canvasTexture(512, 512, (g) => imigongo(g, 512, 512, mix(p.deep, "#000000", 0.35), mix(p.deep, p.primary, 0.28), 64));
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(5, 5);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.08 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.name = "floor";
    this.scene.add(this.floor);
    const stage = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64), new THREE.MeshStandardMaterial({ color: mix(p.deep, "#ffffff", 0.12), roughness: 0.25, metalness: 0.35 }));
    stage.rotation.x = -Math.PI / 2;
    stage.position.set(0, 0.004, 0.6);
    stage.receiveShadow = true;
    this.scene.add(stage);

    const wallTex = canvasTexture(1024, 512, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, mix(p.deep, "#000000", 0.5));
      grad.addColorStop(0.55, mix(p.deep, p.primary, 0.32));
      grad.addColorStop(1, mix(p.deep, "#000000", 0.25));
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 512);
      g.save();
      g.translate(0, 300);
      g.globalAlpha = 0.55;
      imigongo(g, 1024, 64, "rgba(0,0,0,0)", mix(p.secondary, p.deep, 0.35), 32);
      g.restore();
    });
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.repeat.set(4, 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(ROOM_R, ROOM_R, 5.4, 96, 1, true), new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.95 }));
    wall.position.y = 2.7;
    this.scene.add(wall);

    for (const [r, y, c] of [[5.6, 4.4, p.secondary], [3.2, 4.7, p.primary]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 128), new THREE.MeshBasicMaterial({ color: c }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y, 0);
      this.scene.add(ring);
    }

    // Banner with the maker's name (FR-VR-03 branding).
    const font = this.o.font;
    const banner = canvasTexture(1400, 420, (g) => {
      roundRect(g, 10, 10, 1380, 400, 60);
      const grad = g.createLinearGradient(0, 0, 1400, 0);
      grad.addColorStop(0, mix(p.primary, "#000000", 0.25));
      grad.addColorStop(1, mix(p.deep, p.secondary, 0.25));
      g.fillStyle = grad;
      g.fill();
      g.fillStyle = "#ffffff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `900 128px ${font}`;
      g.fillText(this.o.brand, 700, 170, 1300);
      g.font = `800 52px ${font}`;
      g.fillStyle = "#FFE7B0";
      g.fillText(this.o.banner, 700, 300, 1300);
    });
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.38), new THREE.MeshBasicMaterial({ map: banner, transparent: true, fog: false }));
    bannerMesh.position.set(0, 3.1, -ROOM_R + 0.35);
    this.scene.add(bannerMesh);

    // Teleport spots: entrance, centre, sides.
    const spots = [START.clone(), new THREE.Vector3(0, 0, 0.6), new THREE.Vector3(-3.3, 0, -0.4), new THREE.Vector3(3.3, 0, -0.4)];
    for (const s of spots) this.addTeleport(s);

    if (!this.o.reducedMotion && !this.o.lowEnd) {
      const n = 260;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(Math.random()) * 7;
        const a = Math.random() * Math.PI * 2;
        pos.set([Math.cos(a) * r, 0.3 + Math.random() * 3.8, Math.sin(a) * r], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: p.secondary, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(this.dust);
    }
  }

  private addTeleport(at: THREE.Vector3) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 48), new THREE.MeshBasicMaterial({ color: this.o.palette.secondary, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.012, at.z);
    ring.userData.teleport = at.clone();
    this.scene.add(ring);
    this.teleports.push(ring);
  }

  private buildPieces() {
    const { palette: p } = this.o;
    const sideRails: Record<string, THREE.Vector3[]> = { "-1": [], "1": [] };
    for (const piece of this.o.pieces) {
      const anchor = new THREE.Group();
      anchor.position.set(piece.place.x, 0, piece.place.z);
      anchor.rotation.y = piece.place.rotY;
      this.scene.add(anchor);
      const holder = new THREE.Group();
      anchor.add(holder);
      let glow: THREE.Mesh | null = null;
      const isM = piece.place.kind === "mannequin";
      if (isM) {
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.47, 0.18, 48), new THREE.MeshStandardMaterial({ color: mix(p.deep, "#000000", 0.25), roughness: 0.3, metalness: 0.4 }));
        plinth.position.y = 0.09;
        plinth.castShadow = plinth.receiveShadow = true;
        anchor.add(plinth);
        glow = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 48), new THREE.MeshBasicMaterial({ color: p.secondary, transparent: true, opacity: 0.55 }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.182;
        anchor.add(glow);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.3 }));
        pole.position.y = 0.78;
        pole.userData.stand = true;
        anchor.add(pole);
        const neck = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), new THREE.MeshStandardMaterial({ color: mix(p.deep, "#ffffff", 0.7), roughness: 0.6 }));
        neck.scale.set(1, 1.25, 1);
        neck.position.y = 1.72;
        neck.userData.stand = true;
        anchor.add(neck);
        if (!this.o.lowEnd) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(0.85, 3.4, 40, 1, true),
            new THREE.MeshBasicMaterial({ color: p.secondary, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
          );
          cone.position.y = 1.9;
          anchor.add(cone);
          const spot = new THREE.SpotLight(0xfff1dc, 9, 6, 0.42, 0.7, 1.4);
          spot.position.set(0, 3.9, 0.6);
          spot.target = holder;
          anchor.add(spot);
        }
      } else {
        sideRails[String(Math.sign(piece.place.x) || 1)].push(anchor.position.clone());
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 24, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.3 }));
        hook.position.y = 2.02;
        anchor.add(hook);
      }
      holder.position.y = isM ? 0 : 0;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, piece.heightM + 0.2, 0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      const top = isM ? 1.62 : 1.98;
      hit.position.y = top - piece.heightM / 2;
      hit.userData.piece = piece.id;
      anchor.add(hit);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.26), new THREE.MeshBasicMaterial({ map: labelTexture(this.o.font, piece.title, piece.price, this.o.highContrast), transparent: true, depthWrite: false, fog: false }));
      label.position.set(0, isM ? top + 0.38 : top - piece.heightM - 0.24, 0);
      label.userData.piece = piece.id;
      anchor.add(label);
      let poster: THREE.Mesh | null = null;
      if (piece.poster) {
        const tex = new THREE.TextureLoader().load(piece.poster);
        tex.colorSpace = THREE.SRGBColorSpace;
        poster = new THREE.Mesh(new THREE.PlaneGeometry(piece.heightM * 0.8, piece.heightM), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
        poster.position.y = top - piece.heightM / 2;
        anchor.add(poster);
      }
      // A teleport spot in front of every mannequin.
      if (isM) {
        const front = anchor.position.clone().add(new THREE.Vector3(Math.sin(piece.place.rotY), 0, Math.cos(piece.place.rotY)).multiplyScalar(1.45));
        this.addTeleport(front);
      }
      this.nodes.push({ piece, anchor, holder, hit, label, glow, poster, model: null, twin: null, mixer: null });
    }
    for (const pts of Object.values(sideRails)) {
      if (!pts.length) continue;
      const ordered = pts.sort((a, b) => a.z - b.z);
      const ext = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(a.clone().sub(b).setLength(0.6));
      const path = ordered.length === 1 ? [ordered[0].clone().add(new THREE.Vector3(0, 0, -0.6)), ordered[0], ordered[0].clone().add(new THREE.Vector3(0, 0, 0.6))] : [ext(ordered[0], ordered[1]), ...ordered, ext(ordered[ordered.length - 1], ordered[ordered.length - 2])];
      const curve = new THREE.CatmullRomCurve3(path.map((v) => new THREE.Vector3(v.x, 2.08, v.z)));
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.018, 8), new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.28 }));
      this.scene.add(rail);
      for (const end of [path[0], path[path.length - 1]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.08, 10), rail.material);
        post.position.set(end.x, 1.04, end.z);
        this.scene.add(post);
      }
    }
  }

  /** Stream garments nearest-first, two at a time; posters stand in until each GLB arrives. */
  private async stream() {
    const total = this.nodes.length;
    this.o.onProgress({ loaded: 0, total, bytes: 0 });
    const order = [...this.nodes].sort((a, b) => a.anchor.position.distanceTo(START) - b.anchor.position.distanceTo(START));
    await Promise.all(
      order.map(async (n) => {
        const g = await this.streamer.load(n.piece.glb, (b) => {
          this.bytes += b;
        });
        if (this.disposed) return;
        this.loaded += 1;
        if (g) this.place(n, g.scene);
        this.o.onProgress({ loaded: this.loaded, total, bytes: this.bytes });
      }),
    );
  }

  private place(n: PieceNode, model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const top = n.piece.place.kind === "mannequin" ? 1.62 : 1.98;
    model.position.set(-centre.x, top - box.max.y, -centre.z);
    model.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });
    n.holder.add(model);
    n.model = model;
    n.hit.scale.set(Math.max(0.6, size.x + 0.15) / 0.8, 1, Math.max(0.4, size.z + 0.2) / 0.6);
    if (n.poster) {
      n.anchor.remove(n.poster);
      disposeTree(n.poster);
      n.poster = null;
    }
  }

  // ── public controls ──
  select(id: string | null, move = true) {
    this.selected = id;
    for (const n of this.nodes) {
      const on = n.piece.id === id;
      const mat = n.label.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = labelTexture(this.o.font, n.piece.title, n.piece.price, this.o.highContrast, on);
      mat.needsUpdate = true;
      n.label.scale.setScalar(on ? 1.15 : 1);
      if (n.glow) (n.glow.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.55;
    }
    const n = this.nodes.find((x) => x.piece.id === id);
    if (this.renderer.xr.isPresenting) this.showPanel(n ?? null);
    else if (n && move) {
      const dir = new THREE.Vector3(Math.sin(n.piece.place.rotY), 0, Math.cos(n.piece.place.rotY));
      const to = n.anchor.position.clone().add(dir.multiplyScalar(n.piece.place.kind === "mannequin" ? 1.75 : 1.6));
      this.glideTo(to, Math.atan2(to.x - n.anchor.position.x, to.z - n.anchor.position.z));
    }
    this.o.onSelect(id);
  }

  /** Previous / next piece (keyboard and the on-screen arrows). */
  step(dir: 1 | -1) {
    const ids = this.o.pieces.map((p) => p.id);
    const i = this.selected ? ids.indexOf(this.selected) : -1;
    this.select(ids[(i + dir + ids.length) % ids.length] ?? null);
  }

  home() {
    this.select(null, false);
    this.glideTo(START.clone(), 0);
  }

  /** Redraw the spatial labels with new price text (display-currency change). */
  setPrices(prices: Record<string, string>) {
    for (const n of this.nodes) if (prices[n.piece.id]) n.piece.price = prices[n.piece.id];
    this.select(this.selected, false);
  }

  setHighContrast(on: boolean) {
    this.o.highContrast = on;
    this.select(this.selected, false);
  }

  setSeated(on: boolean) {
    this.seated = on;
    this.eye = on ? 1.2 : 1.6;
    if (!this.renderer.xr.isPresenting) this.camera.position.y = this.eye;
  }

  key(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  turn(rad: number) {
    this.glide = null;
    this.yaw += rad;
  }

  /** Show a fitted 3D twin (the signed-in shopper's own, via a signed link) in place of the mannequin. */
  async showTwin(id: string, url: string) {
    const n = this.nodes.find((x) => x.piece.id === id);
    if (!n) return false;
    const g = await new GLTFLoader().loadAsync(url).catch(() => null);
    if (!g || this.disposed) return false;
    this.clearTwin();
    const twin = g.scene;
    twin.position.y = n.piece.place.kind === "mannequin" ? 0.18 : 0;
    twin.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });
    if (n.model) n.model.visible = false;
    n.anchor.children.forEach((c) => {
      if (c.userData.stand) c.visible = false;
    });
    n.anchor.add(twin);
    n.twin = twin;
    const idle = g.animations.find((a) => a.name === "Idle");
    if (idle && !this.o.reducedMotion) {
      n.mixer = new THREE.AnimationMixer(twin);
      n.mixer.clipAction(idle).play();
    }
    return true;
  }

  clearTwin() {
    for (const n of this.nodes) {
      if (!n.twin) continue;
      n.anchor.remove(n.twin);
      disposeTree(n.twin);
      n.twin = null;
      n.mixer = null;
      if (n.model) n.model.visible = true;
      n.anchor.children.forEach((c) => {
        if (c.userData.stand) c.visible = true;
      });
    }
  }

  async enterXR(seated: boolean) {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error("WebXR is not available in this browser");
    this.setSeated(seated);
    const session = await xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
    this.renderer.xr.setReferenceSpaceType(seated ? "local" : "local-floor");
    await this.renderer.xr.setSession(session);
  }

  exitXR() {
    void this.renderer.xr.getSession()?.end();
  }

  // ── R4 spike hooks (multi-user presence layer, flag vr.multiuser_spike) ──
  private frameHooks = new Set<(dt: number) => void>();
  /** Add an object to the room (returns a remover). */
  attach(obj: THREE.Object3D) {
    this.scene.add(obj);
    return () => void this.scene.remove(obj);
  }
  /** Run every rendered frame, inline and in XR (window rAF pauses in XR). */
  onFrame(fn: (dt: number) => void) {
    this.frameHooks.add(fn);
    return () => void this.frameHooks.delete(fn);
  }
  /** Glide (inline) or teleport (XR) to a floor point facing `yaw` (presence "go near"). */
  moveTo(x: number, z: number, yaw: number) {
    const p = new THREE.Vector3(x, 0, z);
    if (this.renderer.xr.isPresenting) this.teleport(p);
    else this.glideTo(p, yaw);
  }
  /** Viewer eye position (metres, room space) and facing yaw (radians), inline or in XR. */
  viewerPose() {
    const xr = this.renderer.xr.isPresenting;
    const cam = xr ? this.renderer.xr.getCamera() : this.camera;
    const p = xr ? this.head() : this.camera.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-d.x, -d.z), xr, seated: this.seated };
  }

  dispose() {
    this.frameHooks.clear();
    this.disposed = true;
    this.exitXR();
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.unbind();
    disposeTree(this.scene);
    this.renderer.dispose();
  }

  // ── inline input ──
  private unbind: () => void = () => {};
  private bindPointer() {
    const c = this.o.canvas;
    const down = (e: PointerEvent) => {
      if (this.pointer) return;
      this.pointer = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, yaw: this.yaw, pitch: this.pitch };
      c.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) p.moved = true;
      if (p.moved) {
        this.glide = null;
        this.yaw = p.yaw + dx * 0.0055;
        this.pitch = Math.max(-0.7, Math.min(0.5, p.pitch + dy * 0.004));
      }
    };
    const up = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (!p.moved) this.tap(e);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.walk(-Math.sign(e.deltaY) * 0.35, 0);
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    this.unbind = () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }

  private tap(e: PointerEvent) {
    const r = this.o.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.activate(this.pick(), false);
  }

  private targets() {
    return [...this.nodes.map((n) => n.hit), ...this.nodes.map((n) => n.label), ...this.teleports, this.floor, ...(this.panel?.visible ? [this.buyBtn!, this.closeBtn!] : [])];
  }

  private pick() {
    const hits = this.ray.intersectObjects(this.targets(), false);
    return hits[0] ?? null;
  }

  /** What a tap / trigger / dwell on a target does. */
  private activate(hit: THREE.Intersection | null, xr: boolean) {
    if (!hit) return;
    const o = hit.object;
    if (o === this.closeBtn) return this.select(null, false);
    if (o.userData.piece) return this.select(o.userData.piece as string);
    const at = (o.userData.teleport as THREE.Vector3 | undefined) ?? (o === this.floor ? hit.point.clone().setY(0) : null);
    if (at && at.length() < WALK_R + 0.2) {
      if (xr) this.teleport(at);
      else this.glideTo(at, this.yaw);
    }
  }

  private walk(forward: number, strafe: number) {
    this.glide = null;
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.dolly.position.addScaledVector(dir, forward).addScaledVector(side, strafe);
    this.keepInside(this.dolly.position);
  }

  private keepInside(p: THREE.Vector3) {
    const r = Math.hypot(p.x, p.z);
    if (r > WALK_R) p.multiplyScalar(WALK_R / r);
    for (const n of this.nodes) {
      if (n.piece.place.kind !== "mannequin") continue;
      const d = new THREE.Vector3(p.x - n.anchor.position.x, 0, p.z - n.anchor.position.z);
      if (d.length() < 0.75) p.copy(n.anchor.position.clone().add(d.setLength(0.75)).setY(0));
    }
  }

  private glideTo(to: THREE.Vector3, toYaw: number) {
    this.keepInside(to);
    // Shortest way round for the yaw.
    let dy = toYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (this.o.reducedMotion) {
      this.dolly.position.copy(to);
      this.yaw += dy;
      this.glide = null;
      return;
    }
    const dist = this.dolly.position.distanceTo(to);
    this.glide = { from: this.dolly.position.clone(), to, fromYaw: this.yaw, toYaw: this.yaw + dy, t: 0, dur: Math.min(1.4, 0.45 + dist * 0.18) };
  }

  // ── XR ──
  private setupXr() {
    const hands = new XRHandModelFactory();
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: this.o.palette.secondary, transparent: true, opacity: 0.85 }));
      line.scale.z = 5;
      line.name = "ray";
      c.add(line);
      c.addEventListener("connected", (e) => {
        const mode = (e as unknown as { data: XRInputSource }).data?.targetRayMode;
        c.userData.mode = mode;
        line.visible = mode === "tracked-pointer";
      });
      c.addEventListener("disconnected", () => (c.userData.mode = null));
      c.addEventListener("selectstart", () => this.xrSelectStart(c));
      c.addEventListener("selectend", () => this.xrSelectEnd(c));
      this.dolly.add(c);
      this.controllers.push(c);
      const hand = this.renderer.xr.getHand(i);
      hand.add(hands.createHandModel(hand, "spheres"));
      this.dolly.add(hand);
    }
    this.renderer.xr.addEventListener("sessionstart", () => {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.dolly.rotation.set(0, this.yaw, 0);
      this.dolly.position.y = this.seated ? 1.2 : 0;
      this.o.onXr(true);
      if (this.selected) this.showPanel(this.nodes.find((n) => n.piece.id === this.selected) ?? null);
    });
    this.renderer.xr.addEventListener("sessionend", () => {
      this.dolly.position.y = 0;
      this.dolly.rotation.set(0, 0, 0);
      this.camera.position.set(0, this.eye, 0);
      this.hold = null;
      this.reticle.visible = false;
      if (this.panel) this.panel.visible = false;
      this.o.onXr(false);
    });
  }

  private rayFrom(src: THREE.Object3D) {
    const m = new THREE.Matrix4().extractRotation(src.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(src.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
  }

  private xrSelectStart(c: THREE.Group) {
    this.rayFrom(c);
    const hit = this.pick();
    if (hit?.object === this.buyBtn) this.hold = { start: performance.now(), source: c };
  }

  private xrSelectEnd(c: THREE.Group) {
    if (this.hold?.source === c) {
      this.hold = null;
      this.drawBuy(0);
      return;
    }
    this.rayFrom(c);
    this.activate(this.pick(), true);
  }

  private head() {
    return new THREE.Vector3().setFromMatrixPosition(this.renderer.xr.getCamera().matrixWorld);
  }

  private teleport(p: THREE.Vector3) {
    const h = this.head();
    this.dolly.position.x += p.x - h.x;
    this.dolly.position.z += p.z - h.z;
  }

  private snapTurn(rad: number) {
    const before = this.head();
    this.dolly.rotation.y += rad;
    this.dolly.updateMatrixWorld(true);
    const after = this.head();
    this.dolly.position.x += before.x - after.x;
    this.dolly.position.z += before.z - after.z;
  }

  private showPanel(n: PieceNode | null) {
    if (!n) {
      if (this.panel) this.panel.visible = false;
      return;
    }
    if (!this.panel) {
      this.panel = new THREE.Group();
      this.buyBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.17), new THREE.MeshBasicMaterial({ transparent: true }));
      this.buyBtn.position.set(-0.06, -0.1, 0.002);
      this.closeBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTexture(128, 128, (g) => {
        g.fillStyle = "rgba(255,255,255,.16)";
        g.beginPath();
        g.arc(64, 64, 60, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#fff";
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(40, 40);
        g.lineTo(88, 88);
        g.moveTo(88, 40);
        g.lineTo(40, 88);
        g.stroke();
      }) }));
      this.closeBtn.position.set(0.36, -0.1, 0.002);
      this.panel.add(this.buyBtn, this.closeBtn);
      this.scene.add(this.panel);
    }
    this.drawBuy(0);
    const dir = new THREE.Vector3(Math.sin(n.piece.place.rotY), 0, Math.cos(n.piece.place.rotY));
    this.panel.position.copy(n.anchor.position).add(dir.multiplyScalar(0.62)).setY(1.05);
    this.panel.rotation.set(0, n.piece.place.rotY, 0);
    this.panel.userData.piece = n.piece.id;
    this.panel.visible = true;
  }

  private drawBuy(progress: number) {
    if (!this.buyBtn) return;
    const mat = this.buyBtn.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = canvasTexture(620, 170, (g) => {
      roundRect(g, 4, 4, 612, 162, 80);
      const grad = g.createLinearGradient(0, 0, 620, 0);
      grad.addColorStop(0, "#E0703F");
      grad.addColorStop(1, "#8B5CF6");
      g.fillStyle = grad;
      g.fill();
      if (progress > 0) {
        g.save();
        roundRect(g, 4, 4, 612, 162, 80);
        g.clip();
        g.fillStyle = "rgba(242,184,75,.85)";
        g.fillRect(4, 4, 612 * progress, 162);
        g.restore();
      }
      g.fillStyle = "#fff";
      g.font = `900 64px ${this.o.font}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(progress > 0 ? "Keep holding…" : "✋ Hold to buy", 310, 88);
    });
    mat.needsUpdate = true;
  }

  // ── frame ──
  private resize() {
    const c = this.o.canvas;
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
  }

  private tick(_t: number, frame?: XRFrame) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const xr = this.renderer.xr.isPresenting;
    if (!xr) {
      if (this.glide) {
        const g = this.glide;
        g.t = Math.min(1, g.t + dt / g.dur);
        const k = ease(g.t);
        this.dolly.position.lerpVectors(g.from, g.to, k);
        this.yaw = g.fromYaw + (g.toYaw - g.fromYaw) * k;
        if (g.t >= 1) this.glide = null;
      }
      const f = (this.keys.has("ArrowUp") || this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("ArrowDown") || this.keys.has("KeyS") ? 1 : 0);
      const tr = (this.keys.has("ArrowLeft") || this.keys.has("KeyA") ? 1 : 0) - (this.keys.has("ArrowRight") || this.keys.has("KeyD") ? 1 : 0);
      const st = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
      if (f || st) this.walk(f * 1.7 * dt, st * 1.4 * dt);
      if (tr) this.turn(tr * 1.5 * dt);
      this.dolly.rotation.y = this.yaw;
      this.camera.rotation.set(this.pitch, 0, 0, "YXZ");
    } else {
      this.xrFrame(frame);
    }
    // Labels turn towards the viewer around the vertical axis (spatial, readable from anywhere).
    const eye = xr ? this.head() : this.camera.getWorldPosition(new THREE.Vector3());
    for (const n of this.nodes) {
      const lp = n.label.getWorldPosition(new THREE.Vector3());
      const worldYaw = Math.atan2(eye.x - lp.x, eye.z - lp.z);
      n.label.rotation.y = worldYaw - n.piece.place.rotY;
      n.mixer?.update(dt);
    }
    if (this.dust) this.dust.rotation.y += dt * 0.02;
    for (const f of this.frameHooks) f(dt);
    if (!this.o.reducedMotion) {
      const pulse = 0.45 + Math.sin(performance.now() / 700) * 0.15;
      for (const t of this.teleports) (t.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrame) {
      this.firstFrame = true;
      this.o.onReady();
    }
  }

  private xrFrame(frame?: XRFrame) {
    const session = this.renderer.xr.getSession();
    const sources = session ? Array.from(session.inputSources) : [];
    // Snap turn on the thumbstick (30°), with a dead zone and re-arm.
    for (const s of sources) {
      const ax = s.gamepad?.axes;
      if (!ax || ax.length < 4) continue;
      const x = ax[2];
      if (Math.abs(x) > 0.7 && this.snapReady) {
        this.snapReady = false;
        this.snapTurn(x > 0 ? -Math.PI / 6 : Math.PI / 6);
      } else if (Math.abs(x) < 0.3) this.snapReady = true;
    }
    // Hold to buy: progress while the trigger / pinch / dwell stays on the button.
    if (this.hold) {
      const p = Math.min(1, (performance.now() - this.hold.start) / HOLD_MS);
      this.drawBuy(p);
      if (p >= 1) {
        const id = this.panel?.userData.piece as string | undefined;
        this.hold = null;
        if (id) {
          this.exitXR();
          this.o.onHoldBuy(id);
        }
      }
    }
    // Gaze fallback: no pointer-capable input → reticle in the view centre + dwell.
    const pointer = sources.some((s) => s.targetRayMode === "tracked-pointer" || s.targetRayMode === "transient-pointer" || Boolean(s.hand));
    if (pointer || !frame) {
      this.reticle.visible = false;
      return;
    }
    const cam = this.renderer.xr.getCamera();
    this.rayFrom(cam);
    const hit = this.pick();
    this.reticle.visible = Boolean(hit);
    if (!hit) return;
    this.reticle.position.copy(hit.point).addScaledVector(this.ray.ray.direction, -0.02);
    this.reticle.lookAt(this.ray.ray.origin);
    const now = performance.now();
    if (this.dwell.target !== hit.object) {
      this.dwell = { target: hit.object, since: now };
      if (this.hold?.source === "gaze") {
        this.hold = null;
        this.drawBuy(0);
      }
      return;
    }
    if (hit.object === this.buyBtn) {
      if (!this.hold) this.hold = { start: now, source: "gaze" };
      return;
    }
    if (now - this.dwell.since > DWELL_MS && hit.object !== this.floor) {
      this.dwell.since = now + 1e9; // fire once per target
      this.activate(hit, true);
    }
  }
}

// ── Runway ─────────────────────────────────────────────────────────────────
export interface RunwayLook {
  /** Dressed synthetic avatar (READY) or the bare garment on a stand (FALLBACK). */
  glb: string | null;
  kind: "avatar" | "garment" | "poster";
  poster: string | null;
}

export interface RunwayOptions {
  canvas: HTMLCanvasElement;
  palette: Palette;
  brand: string;
  title: string;
  font: string;
  looks: RunwayLook[];
  reducedMotion: boolean;
  lowEnd: boolean;
  onReady: () => void;
}

interface LookNode {
  root: THREE.Group;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  materials: THREE.Material[];
  loading: boolean;
}

const HALF = 4.2;

export class RunwayEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private nodes: LookNode[];
  private streamer = new Streamer(2);
  private spot: THREE.SpotLight;
  private orbit = 0;
  private target = new THREE.Vector3(0, 1.05, 0.6);
  private drag: { x: number; o: number; id: number } | null = null;
  private ro: ResizeObserver;
  private first = false;
  private cursor: RunwayCursor | null = null;
  private titleGlow: THREE.MeshBasicMaterial;
  private unbind: () => void;

  constructor(private o: RunwayOptions) {
    this.renderer = makeRenderer(o.canvas, o.lowEnd);
    const { clientWidth: w, clientHeight: h } = o.canvas;
    this.renderer.setSize(w, h, false);
    this.camera = new THREE.PerspectiveCamera(48, w / Math.max(1, h), 0.05, 60);
    const p = o.palette;
    const deep = new THREE.Color(p.deep).multiplyScalar(0.35);
    this.scene.background = deep;
    this.scene.fog = new THREE.Fog(deep, 9, 22);
    this.scene.add(new THREE.HemisphereLight(0xffeedd, new THREE.Color(p.deep), 0.55));
    this.spot = new THREE.SpotLight(0xfff3e4, 40, 14, 0.34, 0.6, 1.2);
    this.spot.position.set(0, 7, 4);
    this.spot.castShadow = !o.lowEnd;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.spot, this.spot.target);
    const fill = new THREE.DirectionalLight(new THREE.Color(p.secondary), 0.6);
    fill.position.set(-4, 3, 6);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: mix(p.deep, "#000000", 0.6), roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const runway = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, HALF * 2 + 1.2), new THREE.MeshStandardMaterial({ color: mix(p.deep, "#ffffff", 0.08), roughness: 0.18, metalness: 0.5 }));
    runway.position.set(0, 0.07, -0.0);
    runway.receiveShadow = true;
    this.scene.add(runway);
    for (const x of [-0.97, 0.97]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, HALF * 2 + 1.2), new THREE.MeshBasicMaterial({ color: p.secondary }));
      strip.position.set(x, 0.15, 0);
      this.scene.add(strip);
    }
    // Backdrop with the maker's name and show title, framed by an imigongo arch.
    const back = canvasTexture(1600, 1070, (g) => {
      imigongo(g, 1600, 1070, mix(p.deep, "#000000", 0.4), mix(p.deep, p.primary, 0.3), 70);
      const grad = g.createRadialGradient(800, 420, 60, 800, 420, 900);
      grad.addColorStop(0, "rgba(0,0,0,.15)");
      grad.addColorStop(1, "rgba(0,0,0,.85)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 1600, 1070);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#ffffff";
      g.font = `900 150px ${o.font}`;
      g.fillText(o.brand, 800, 250, 1500);
      g.fillStyle = "#FFE7B0";
      g.font = `800 64px ${o.font}`;
      g.fillText(o.title, 800, 380, 1500);
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshBasicMaterial({ map: back, fog: false }));
    backdrop.position.set(0, 3.0, -HALF - 1.1);
    this.scene.add(backdrop);
    this.titleGlow = new THREE.MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.5 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 10, 64, Math.PI), this.titleGlow);
    arch.position.set(0, 0.15, -HALF - 0.6);
    this.scene.add(arch);
    // Audience silhouettes on both sides (depth cue, no faces).
    const seat = new THREE.CapsuleGeometry(0.17, 0.45, 4, 8);
    const crowd = new THREE.InstancedMesh(seat, new THREE.MeshStandardMaterial({ color: mix(p.deep, "#000000", 0.2), roughness: 1 }), 48);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const side of [-1, 1]) for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) {
      m.makeTranslation(side * (1.8 + row * 0.7), 0.55 + row * 0.1, -HALF + 0.4 + i * 0.72);
      crowd.setMatrixAt(k++, m);
    }
    this.scene.add(crowd);

    this.nodes = o.looks.map(() => {
      const root = new THREE.Group();
      root.visible = false;
      this.scene.add(root);
      return { root, model: null, mixer: null, walk: null, idle: null, materials: [], loading: false };
    });
    this.ro = new ResizeObserver(() => {
      this.renderer.setSize(o.canvas.clientWidth, o.canvas.clientHeight, false);
      this.camera.aspect = o.canvas.clientWidth / Math.max(1, o.canvas.clientHeight);
      this.camera.updateProjectionMatrix();
    });
    this.ro.observe(o.canvas);
    const c = o.canvas;
    const down = (e: PointerEvent) => (this.drag = { x: e.clientX, o: this.orbit, id: e.pointerId });
    const move = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.orbit = Math.max(-0.7, Math.min(0.7, this.drag.o - (e.clientX - this.drag.x) * 0.004));
    };
    const up = () => (this.drag = null);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    this.unbind = () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
    this.ensure(0);
    this.ensure(1);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Viewer-controlled seat angle (keyboard / buttons); never moved by the show itself. */
  look(delta: number) {
    this.orbit = Math.max(-0.7, Math.min(0.7, this.orbit + delta));
  }

  private ensure(i: number) {
    const n = this.nodes[i];
    const look = this.o.looks[i];
    if (!n || !look || n.loading || n.model) return;
    n.loading = true;
    if (!look.glb) {
      if (look.poster) {
        const tex = new THREE.TextureLoader().load(look.poster);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05 });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.6), mat);
        plane.position.y = 0.95;
        n.root.add(plane);
        n.model = plane;
        n.materials = [mat];
      }
      return;
    }
    void this.streamer.load(look.glb).then((g) => {
      if (!g) return;
      const model = g.scene;
      if (look.kind === "garment") {
        const box = new THREE.Box3().setFromObject(model);
        model.position.y = 1.62 - box.max.y;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 40), new THREE.MeshBasicMaterial({ color: this.o.palette.secondary, transparent: true, opacity: 0.7 }));
        disc.position.y = 0.16;
        n.root.add(disc);
      } else model.position.y = 0.14;
      model.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mt of mats) n.materials.push(mt);
      });
      n.root.add(model);
      n.model = model;
      if (g.animations.length) {
        n.mixer = new THREE.AnimationMixer(model);
        const walk = g.animations.find((a) => a.name === "Walk");
        const idle = g.animations.find((a) => a.name === "Idle");
        n.walk = walk ? n.mixer.clipAction(walk) : null;
        n.idle = idle ? n.mixer.clipAction(idle) : null;
        n.walk?.play();
        n.idle?.play();
      }
    });
  }

  private fade(n: LookNode, a: number) {
    for (const m of n.materials) {
      const want = a < 0.999;
      if (m.transparent !== want && !(m as THREE.MeshBasicMaterial).alphaTest) {
        m.transparent = want || (m.userData.wasTransparent as boolean) || false;
        m.needsUpdate = true;
      }
      m.opacity = a;
    }
  }

  /** Called every frame by the page with the show clock (server-synced live, local for replay). */
  setCursor(c: RunwayCursor) {
    this.cursor = c;
  }

  private tick() {
    const c = this.cursor;
    const t = performance.now() / 1000;
    for (const n of this.nodes) n.root.visible = false;
    if (c) {
      if (c.stage === "walk") {
        this.ensure(c.index);
        this.ensure(c.index + 1);
        const n = this.nodes[c.index];
        if (n) {
          const pose = walkPose(c.t, HALF);
          n.root.visible = true;
          n.root.position.set(0, 0, pose.z);
          n.root.rotation.y = pose.yaw;
          this.fade(n, pose.opacity);
          if (n.walk && n.idle) {
            n.walk.weight = pose.moving ? 1 : 0;
            n.idle.weight = pose.moving ? 0 : 1;
            n.mixer!.setTime(c.elapsed);
          } else if (!n.mixer && !this.o.reducedMotion) n.root.rotation.y += Math.sin(t) * 0.2;
          this.spot.target.position.set(0, 1, pose.z);
        }
      } else if (c.stage === "outro" || c.stage === "after") {
        // Finale: every look that loaded lines up at the front.
        const ready = this.nodes.filter((n) => n.model);
        ready.forEach((n, j) => {
          n.root.visible = true;
          n.root.position.set((j - (ready.length - 1) / 2) * 0.8, 0, HALF * 0.55 - Math.abs(j - (ready.length - 1) / 2) * 0.25);
          n.root.rotation.y = 0;
          this.fade(n, 1);
          if (n.walk && n.idle) {
            n.walk.weight = 0;
            n.idle.weight = 1;
            n.mixer!.setTime(c.elapsed);
          }
        });
        this.spot.target.position.set(0, 1, HALF * 0.5);
      } else this.spot.target.position.set(0, 1.5, -HALF);
      this.titleGlow.opacity = c.stage === "intro" ? 0.5 + 0.5 * Math.sin(c.t * Math.PI) : 0.45;
    }
    const r = 7.4;
    this.camera.position.set(Math.sin(this.orbit) * r, 1.35, this.target.z + Math.cos(this.orbit) * r);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
    if (!this.first) {
      this.first = true;
      this.o.onReady();
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.unbind();
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}
