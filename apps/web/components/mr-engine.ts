/**
 * R4 spike (flag `mr.mirror_spike`): mixed-reality fitting mirror engine (three.js 0.186.1).
 *
 * immersive-ar (Quest passthrough, Android XR / ARCore phones): a hit-test reticle on the floor; select places
 * a plinth with a full-length mirror frame in the room; the figure on it is the shopper's own fitted 3D twin
 * (owner-only signed link) or a synthetic mannequin wearing the garment GLB. A floating panel switches colour
 * and size with a controller ray, hand pinch or screen tap. immersive-vr only (Vision Pro, VR headsets): the
 * same stage in a neutral virtual room. Inline: a turntable preview of the same stage.
 *
 * Privacy: passthrough is composited by the browser/OS; this page never requests `camera-access`, so no camera
 * frame is ever readable by the page, let alone uploaded.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type XrMode = "ar" | "vr";
export interface MirrorChoice {
  colours: { id: string; name: string; hex: string }[];
  sizes: string[];
  colour: string;
  size: string;
}
export interface MirrorOptions {
  canvas: HTMLCanvasElement;
  font: string;
  reducedMotion: boolean;
  lowEnd: boolean;
  onPick: (kind: "colour" | "size", value: string) => void;
  onXr: (mode: XrMode | null) => void;
  onPlaced: (placed: boolean) => void;
}

/** Approximate width grading for the synthetic body (the twin path uses a real per-size fit from E33). */
export const SIZE_SCALE: Record<string, number> = { XS: 0.92, S: 0.96, M: 1, L: 1.05, XL: 1.1, XXL: 1.15 };
const SHOULDER_Y = 1.42;
const WAIST_Y = 1.04;

function mannequin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfc6bc, roughness: 0.75, metalness: 0.02 });
  // Torso: lathe profile (radius, height) of a neutral 1.70 m figure.
  const prof = [
    [0.0, 0.86],
    [0.17, 0.88],
    [0.185, 0.95],
    [0.15, 1.04],
    [0.165, 1.2],
    [0.18, 1.33],
    [0.19, 1.41],
    [0.12, 1.47],
    [0.055, 1.5],
    [0.05, 1.56],
    [0.0, 1.56],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), mat);
  torso.scale.z = 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), mat);
  head.position.y = 1.64;
  head.scale.set(0.9, 1.1, 0.95);
  const limb = (r: number, len: number) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  const legL = limb(0.065, 0.74);
  legL.position.set(-0.09, 0.45, 0);
  const legR = legL.clone();
  legR.position.x = 0.09;
  const armL = limb(0.042, 0.56);
  armL.position.set(-0.24, 1.12, 0);
  armL.rotation.z = -0.12;
  const armR = armL.clone();
  armR.position.x = 0.24;
  armR.rotation.z = 0.12;
  g.add(torso, head, legL, legR, armL, armR);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = true), (o.receiveShadow = true)) : undefined));
  return g;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function chipTexture(font: string, text: string, on: boolean, swatch?: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = on ? "#f0b429" : "rgba(18,16,26,.88)";
  g.beginPath();
  g.roundRect(6, 6, 244, 116, 58);
  g.fill();
  if (swatch) {
    g.fillStyle = swatch;
    g.beginPath();
    g.arc(64, 64, 38, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = on ? "#0b0a0f" : "rgba(255,255,255,.6)";
    g.stroke();
  }
  g.fillStyle = on ? "#0b0a0f" : "#fff";
  g.font = `900 ${swatch ? 34 : 50}px ${font}`;
  g.textAlign = swatch ? "left" : "center";
  g.textBaseline = "middle";
  g.fillText(text, swatch ? 116 : 128, 66, swatch ? 128 : 220);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MirrorEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private stage = new THREE.Group();
  private turn = new THREE.Group();
  private body: THREE.Group;
  private garment: THREE.Object3D | null = null;
  private twin: THREE.Object3D | null = null;
  private panel = new THREE.Group();
  private buttons: THREE.Mesh[] = [];
  private reticle: THREE.Mesh;
  private vrRoom = new THREE.Group();
  private controllers: THREE.Group[] = [];
  private hitSource: XRHitTestSource | null = null;
  private mode: XrMode | null = null;
  private placed = false;
  private choice: MirrorChoice | null = null;
  private drag: { x: number; yaw: number; id: number } | null = null;
  private ro: ResizeObserver;
  private disposed = false;
  private loader = new GLTFLoader();
  private loadSeq = 0;
  private sizeScale = 1;
  private unbind: () => void;

  constructor(private o: MirrorOptions) {
    const r = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: !o.lowEnd, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.lowEnd ? 1.25 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = !o.lowEnd;
    r.xr.enabled = true;
    this.renderer = r;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30);
    this.camera.position.set(0, 1.25, 3.1);
    this.camera.lookAt(0, 0.98, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff4ea, 0x2a2233, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.6, 3, 2.2);
    key.castShadow = !o.lowEnd;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    // Plinth with a glowing rim, mirror frame behind the figure.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x1b1824, roughness: 0.35, metalness: 0.4 }));
    plinth.position.y = 0.04;
    plinth.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: 0xf0b429 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.082;
    const frameShape = roundedRect(1.12, 2.12, 0.5);
    frameShape.holes.push(roundedRect(1.0, 2.0, 0.45) as unknown as THREE.Path);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.04, bevelEnabled: false, curveSegments: 24 }), new THREE.MeshStandardMaterial({ color: 0xd4a24c, roughness: 0.3, metalness: 0.85 }));
    frame.position.set(0, 1.14, -0.42);
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(1.0, 2.0, 0.45), 24), new THREE.MeshPhysicalMaterial({ color: 0x9fb4d8, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.28 }));
    glass.position.set(0, 1.14, -0.415);
    this.body = mannequin();
    this.body.position.y = 0.08;
    this.turn.add(this.body);
    this.stage.add(plinth, rim, frame, glass, this.turn);
    this.scene.add(this.stage);

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Neutral room for immersive-vr (no passthrough): floor disc + soft dome.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.9 }));
    floor.receiveShadow = true;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshBasicMaterial({ color: 0x17141f, side: THREE.BackSide }));
    this.vrRoom.add(floor, dome);
    this.vrRoom.visible = false;
    this.scene.add(this.vrRoom);

    this.panel.visible = false;
    this.scene.add(this.panel);
    this.setupControllers();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.canvas);
    this.resize();
    this.unbind = this.bindDrag();
    r.setAnimationLoop((_t, f) => this.tick(f));
  }

  // ── content ──
  private fitGarment(obj: THREE.Object3D, category: string) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const top = /skirt|trouser|pant/i.test(category) ? WAIST_Y : SHOULDER_Y;
    // E27 GLBs are metric; guard against odd exports by capping the height to the body.
    const k = size.y > 1.6 ? 1.5 / size.y : 1;
    obj.scale.setScalar(k);
    obj.position.set(-centre.x * k, 0.08 + top - box.max.y * k, -centre.z * k + 0.01);
  }

  /** Synthetic mannequin wearing the garment GLB (E27). Size only grades the width, labelled approximate. */
  async showGarment(url: string, category: string, size: string) {
    const seq = ++this.loadSeq;
    const g = await this.loader.loadAsync(url).catch(() => null);
    if (!g || this.disposed || seq !== this.loadSeq) return Boolean(g);
    this.clearTwin();
    if (this.garment) this.turn.remove(this.garment);
    const holder = new THREE.Group();
    holder.add(g.scene);
    g.scene.traverse((c) => ((c as THREE.Mesh).isMesh ? (c.castShadow = true) : undefined));
    this.fitGarment(g.scene, category);
    this.garment = holder;
    this.turn.add(holder);
    this.body.visible = true;
    this.setSize(size);
    return true;
  }

  setSize(size: string) {
    this.sizeScale = SIZE_SCALE[size] ?? 1;
    if (this.garment) this.garment.scale.set(this.sizeScale, 1, this.sizeScale);
  }

  /** The shopper's own fitted twin (E33 /twin3d/fit GLB via a ≤ 5 min signed link): body and garment in one. */
  async showTwin(url: string) {
    const seq = ++this.loadSeq;
    const g = await this.loader.loadAsync(url).catch(() => null);
    if (!g || this.disposed || seq !== this.loadSeq) return Boolean(g);
    this.clearTwin();
    if (this.garment) this.turn.remove(this.garment);
    this.garment = null;
    g.scene.position.y = 0.08;
    g.scene.traverse((c) => ((c as THREE.Mesh).isMesh ? (c.castShadow = true) : undefined));
    this.twin = g.scene;
    this.turn.add(g.scene);
    this.body.visible = false;
    return true;
  }

  private clearTwin() {
    if (!this.twin) return;
    this.turn.remove(this.twin);
    this.twin.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
    this.twin = null;
  }

  /** Colours + sizes for the in-headset panel (the inline page uses HTML controls). */
  setChoice(c: MirrorChoice) {
    this.choice = c;
    this.buildPanel();
  }

  private buildPanel() {
    for (const b of this.buttons) {
      (b.material as THREE.MeshBasicMaterial).map?.dispose();
      b.geometry.dispose();
    }
    this.panel.clear();
    this.buttons = [];
    const c = this.choice;
    if (!c) return;
    const add = (text: string, action: { kind: string; value: string }, x: number, y: number, on: boolean, swatch?: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: chipTexture(this.o.font, text, on, swatch), transparent: true }));
      m.position.set(x, y, 0);
      m.userData.action = action;
      this.panel.add(m);
      this.buttons.push(m);
    };
    c.colours.slice(0, 6).forEach((col, i) => add(col.name, { kind: "colour", value: col.id }, (i % 2) * 0.22, -Math.floor(i / 2) * 0.12, col.id === c.colour, col.hex));
    const top = -Math.ceil(Math.min(6, c.colours.length) / 2) * 0.12 - 0.04;
    c.sizes.slice(0, 6).forEach((s, i) => add(s, { kind: "size", value: s }, (i % 3) * 0.15 - 0.03, top - Math.floor(i / 3) * 0.12, s === c.size));
    const bottom = top - Math.ceil(Math.min(6, c.sizes.length) / 3) * 0.12 - 0.04;
    add("↻ Move", { kind: "move", value: "" }, 0, bottom, false);
    add("✕ Exit", { kind: "exit", value: "" }, 0.22, bottom, false);
  }

  // ── XR ──
  static async support(): Promise<{ ar: boolean; vr: boolean }> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return { ar: false, vr: false };
    const [ar, vr] = await Promise.all([xr.isSessionSupported("immersive-ar").catch(() => false), xr.isSessionSupported("immersive-vr").catch(() => false)]);
    return { ar, vr };
  }

  async enter(mode: XrMode, overlay?: HTMLElement | null) {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error("WebXR is not available in this browser");
    const init: XRSessionInit =
      mode === "ar"
        ? { requiredFeatures: ["hit-test"], optionalFeatures: ["local-floor", "hand-tracking", "anchors", ...(overlay ? ["dom-overlay"] : [])], ...(overlay ? { domOverlay: { root: overlay } } : {}) }
        : { optionalFeatures: ["local-floor", "hand-tracking"] };
    const session = await xr.requestSession(`immersive-${mode}`, init);
    this.mode = mode;
    this.placed = false;
    this.renderer.xr.setReferenceSpaceType(mode === "ar" ? "local" : "local-floor");
    await this.renderer.xr.setSession(session);
    this.vrRoom.visible = mode === "vr";
    this.stage.visible = false;
    if (mode === "ar") {
      const viewer = await session.requestReferenceSpace("viewer");
      this.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;
    }
    session.addEventListener("end", () => this.onEnd());
    this.o.onXr(mode);
    if (mode === "vr") this.placeAt(new THREE.Vector3(0, 0, -1.7));
  }

  exit() {
    void this.renderer.xr.getSession()?.end();
  }

  private onEnd() {
    this.hitSource?.cancel();
    this.hitSource = null;
    this.mode = null;
    this.placed = false;
    this.panel.visible = false;
    this.reticle.visible = false;
    this.vrRoom.visible = false;
    this.stage.visible = true;
    this.stage.position.set(0, 0, 0);
    this.stage.rotation.set(0, 0, 0);
    this.o.onXr(null);
    this.o.onPlaced(false);
  }

  private placeAt(p: THREE.Vector3) {
    const head = new THREE.Vector3().setFromMatrixPosition(this.renderer.xr.getCamera().matrixWorld);
    this.stage.position.copy(p);
    this.stage.rotation.set(0, Math.atan2(head.x - p.x, head.z - p.z), 0);
    this.turn.rotation.y = 0;
    this.stage.visible = true;
    this.reticle.visible = false;
    this.placed = true;
    // Panel to the stage's right, at chest height, angled towards the shopper.
    const right = new THREE.Vector3(0.85, 1.25, 0.25).applyEuler(this.stage.rotation).add(p);
    this.panel.position.copy(right);
    this.panel.rotation.set(0, this.stage.rotation.y - 0.35, 0);
    this.panel.visible = true;
    this.o.onPlaced(true);
  }

  private setupControllers() {
    const ray = new THREE.Raycaster();
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1.5)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      c.add(line);
      c.addEventListener("connected", (e) => (line.visible = (e as unknown as { data: XRInputSource }).data.targetRayMode === "tracked-pointer"));
      c.addEventListener("select", () => {
        if (!this.placed) {
          if (this.reticle.visible) this.placeAt(new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix));
          return;
        }
        const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
        ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
        ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
        const hit = ray.intersectObjects(this.buttons, false)[0];
        const a = hit?.object.userData.action as { kind: string; value: string } | undefined;
        if (!a) return;
        if (a.kind === "move") {
          this.placed = this.mode === "vr";
          if (this.mode === "ar") {
            this.panel.visible = false;
            this.stage.visible = false;
            this.o.onPlaced(false);
          }
        } else if (a.kind === "exit") this.exit();
        else this.o.onPick(a.kind as "colour" | "size", a.value);
      });
      this.scene.add(c);
      this.controllers.push(c);
    }
  }

  // ── inline preview ──
  private bindDrag() {
    const c = this.o.canvas;
    const down = (e: PointerEvent) => {
      this.drag = { x: e.clientX, yaw: this.turn.rotation.y, id: e.pointerId };
      c.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.turn.rotation.y = this.drag.yaw + (e.clientX - this.drag.x) / 90;
    };
    const up = (e: PointerEvent) => this.drag?.id === e.pointerId && (this.drag = null);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }

  /** Keyboard / button turn for the inline preview. */
  rotate(rad: number) {
    this.turn.rotation.y += rad;
  }

  private resize() {
    if (this.renderer.xr.isPresenting) return;
    const c = this.o.canvas;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
  }

  private tick(frame?: XRFrame) {
    if (this.mode === "ar" && frame && !this.placed && this.hitSource) {
      const ref = this.renderer.xr.getReferenceSpace();
      const hit = ref ? frame.getHitTestResults(this.hitSource)[0] : undefined;
      const pose = hit && ref ? hit.getPose(ref) : undefined;
      this.reticle.visible = Boolean(pose);
      if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
    }
    if (!this.mode && !this.drag && !this.o.reducedMotion) this.turn.rotation.y += 0.0035;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.exit();
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.unbind();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
