/**
 * R4 spike: three.js layer that draws other participants in the E35 showroom as stylised synthetic avatars
 * (capsule body, visor head, pseudonym label; never a likeness or a twin), smooths their 10 Hz poses, floats
 * spatial emoji reactions and enforces the personal-space bubble (anyone closer than ~0.9 m fades out).
 * Loaded with `import()` next to vr-engine so three.js stays out of the page bundle.
 */
import { AVATAR_HUES, PRESENCE, type PoseEntry, type PresenceMember } from "@nyambika/contracts";
import * as THREE from "three";
import type { ShowroomEngine } from "./vr-engine";

interface Body {
  m: PresenceMember;
  root: THREE.Group;
  label: THREE.Sprite;
  mats: THREE.MeshStandardMaterial[];
  target: THREE.Vector3;
  yaw: number;
  shownYaw: number;
  seen: number;
  hidden: boolean;
}

interface Float {
  s: THREE.Sprite;
  t: number;
  y0: number;
}

function textSprite(text: string, opts: { font: string; size?: number; bg?: string; fg?: string; w?: number }) {
  const w = opts.w ?? 512;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.beginPath();
    g.roundRect(8, 20, w - 16, h - 40, 44);
    g.fill();
  }
  g.fillStyle = opts.fg ?? "#fff";
  g.font = `900 ${opts.size ?? 54}px ${opts.font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2, w - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set((w / h) * 0.16, 0.16, 1);
  s.renderOrder = 5;
  return s;
}

export class PresenceLayer {
  private group = new THREE.Group();
  private bodies = new Map<string, Body>();
  private floats: Float[] = [];
  private detachers: (() => void)[] = [];
  private hiddenByUser = new Set<string>();
  bubble = true;

  constructor(
    private engine: ShowroomEngine,
    private opts: { font: string; reducedMotion: boolean; selfSid: () => string | null },
  ) {
    this.detachers.push(engine.attach(this.group), engine.onFrame((dt) => this.frame(dt)));
  }

  private build(m: PresenceMember): Body {
    const root = new THREE.Group();
    const hue = new THREE.Color(AVATAR_HUES[m.hue % AVATAR_HUES.length]);
    const skin = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.55, metalness: 0.05, emissive: hue.clone().multiplyScalar(0.18), transparent: true });
    const visor = new THREE.MeshStandardMaterial({ color: 0x111018, roughness: 0.2, metalness: 0.6, transparent: true });
    const bodyH = m.seated ? 0.75 : 1.05;
    const torso =
      m.shape === 1
        ? new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, bodyH, 20), skin)
        : m.shape === 2
          ? new THREE.Mesh(new THREE.CapsuleGeometry(0.2, bodyH - 0.4, 6, 16), skin)
          : new THREE.Mesh(new THREE.CapsuleGeometry(0.17, bodyH - 0.34, 6, 16), skin);
    torso.position.y = bodyH / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), skin);
    head.position.y = bodyH + 0.2;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), visor);
    band.position.set(0, bodyH + 0.22, -0.12); // faces -Z (the avatar's forward)
    root.add(torso, head, band);
    if (m.role === "host") {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 8, 32), new THREE.MeshBasicMaterial({ color: 0xf0b429, transparent: true }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = bodyH + 0.42;
      root.add(halo);
    }
    const label = textSprite(`${m.role === "host" ? "★ " : ""}${m.nick}${m.muted ? " 🔇" : ""}`, { font: this.opts.font, bg: "rgba(10,9,15,.72)", size: 46 });
    label.position.y = bodyH + 0.62;
    root.add(label);
    root.visible = false;
    this.group.add(root);
    const mats = [skin, visor];
    root.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mm && !mats.includes(mm) && !(o instanceof THREE.Sprite)) mats.push(mm);
    });
    return { m, root, label, mats, target: new THREE.Vector3(), yaw: 0, shownYaw: 0, seen: 0, hidden: false };
  }

  /** Roster change (join / mute / welcome). Spectators and self are never drawn. */
  upsert(m: PresenceMember) {
    const old = this.bodies.get(m.sid);
    if (old && old.m.muted === m.muted && old.m.role === m.role) return void (old.m = m);
    if (old) this.remove(m.sid);
    if (m.seat !== "avatar" || m.sid === this.opts.selfSid()) return;
    const b = this.build(m);
    if (old) {
      b.target.copy(old.target);
      b.root.position.copy(old.root.position);
      b.seen = old.seen;
    }
    this.bodies.set(m.sid, b);
  }

  remove(sid: string) {
    const b = this.bodies.get(sid);
    if (!b) return;
    this.group.remove(b.root);
    b.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material & { map?: THREE.Texture };
      mat?.map?.dispose();
      mat?.dispose?.();
    });
    this.bodies.delete(sid);
  }

  poses(p: PoseEntry[]) {
    const now = performance.now();
    for (const [sid, x, y, z, yw] of p) {
      const b = this.bodies.get(sid);
      if (!b) continue;
      b.target.set(x / 100, Math.max(0, y / 100 - (b.m.seated ? 1.15 : 1.6)), z / 100);
      b.yaw = yw / 1000;
      if (!b.seen) {
        b.root.position.copy(b.target);
        b.shownYaw = b.yaw;
      }
      b.seen = now;
    }
  }

  /** Locally hide (block) someone: their avatar and reactions disappear for this viewer only. */
  setHidden(sid: string, hidden: boolean) {
    if (hidden) this.hiddenByUser.add(sid);
    else this.hiddenByUser.delete(sid);
  }

  /** A reaction rises from the sender (or in front of the viewer for their own). */
  react(sid: string, emoji: string) {
    if (this.hiddenByUser.has(sid)) return;
    const s = textSprite(emoji, { font: "system-ui, 'Apple Color Emoji', 'Noto Color Emoji'", size: 92, w: 128 });
    s.scale.set(0.26, 0.26, 1);
    const b = this.bodies.get(sid);
    if (b?.root.visible) s.position.set(b.root.position.x, b.root.position.y + (b.m.seated ? 1.5 : 1.9), b.root.position.z);
    else {
      const v = this.engine.viewerPose();
      s.position.set(v.x - Math.sin(v.yaw) * 1.2, v.y + 0.25, v.z - Math.cos(v.yaw) * 1.2);
    }
    this.group.add(s);
    this.floats.push({ s, t: 0, y0: s.position.y });
  }

  private frame(dt: number) {
    const now = performance.now();
    const me = this.engine.viewerPose();
    const k = 1 - Math.exp(-dt * 10); // ~100 ms smoothing matches the 10 Hz feed
    for (const b of this.bodies.values()) {
      const stale = !b.seen || now - b.seen > 2500;
      b.root.visible = !stale && !this.hiddenByUser.has(b.m.sid);
      if (!b.root.visible) continue;
      b.root.position.lerp(b.target, this.opts.reducedMotion ? 1 : k);
      let d = b.yaw - b.shownYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.shownYaw += d * (this.opts.reducedMotion ? 1 : k);
      b.root.rotation.y = b.shownYaw;
      // Personal-space bubble: fade anyone inside ~0.9 m and hide their label.
      const close = this.bubble && Math.hypot(b.root.position.x - me.x, b.root.position.z - me.z) < PRESENCE.bubbleM;
      const op = close ? 0.12 : 1;
      for (const m of b.mats) m.opacity += (op - m.opacity) * Math.min(1, dt * 8);
      b.label.visible = !close;
    }
    for (const f of this.floats) {
      f.t += dt;
      const p = f.t / 1.8;
      if (!this.opts.reducedMotion) f.s.position.y = f.y0 + p * 0.5;
      (f.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p * p);
    }
    for (const f of this.floats.filter((x) => x.t > 1.8)) {
      this.group.remove(f.s);
      f.s.material.map?.dispose();
      f.s.material.dispose();
    }
    this.floats = this.floats.filter((x) => x.t <= 1.8);
  }

  /** A floor point ~2.2 m in front of someone (outside their bubble), facing them; null if not in view. */
  near(sid: string): { x: number; z: number; yaw: number } | null {
    const b = this.bodies.get(sid);
    if (!b?.root.visible) return null;
    const a = b.shownYaw + (Math.random() - 0.5) * 0.9;
    const x = b.root.position.x - Math.sin(a) * 2.2;
    const z = b.root.position.z - Math.cos(a) * 2.2;
    return { x, z, yaw: Math.atan2(x - b.root.position.x, z - b.root.position.z) };
  }

  visibleCount() {
    return [...this.bodies.values()].filter((b) => b.root.visible).length;
  }

  dispose() {
    for (const sid of [...this.bodies.keys()]) this.remove(sid);
    for (const f of this.floats) this.group.remove(f.s);
    this.detachers.forEach((d) => d());
  }
}
