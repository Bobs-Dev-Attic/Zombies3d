// Level / arena generation. Each "setting" is a walled arena with themed
// lighting, ground and cover obstacles, plus a glowing EXIT to reach once the
// horde is cleared. Obstacles double as axis-aligned box colliders shared by
// the player and the zombies.
import * as THREE from "three";
import { rand, randInt, chance } from "./util.js";

export const SETTINGS = [
  { name: "The Streets",     fog: 0x10140f, ground: 0x2b2f28, wall: 0x3a4038, accent: 0x6b7a5a, obstacle: "car",   sky: 0x0a0d0a },
  { name: "The Mall",        fog: 0x14110f, ground: 0x3a3330, wall: 0x4a4340, accent: 0x8a7a5a, obstacle: "shelf", sky: 0x0e0b09 },
  { name: "The Hospital",    fog: 0x0d1214, ground: 0x2c3336, wall: 0x39434a, accent: 0x5a7a8a, obstacle: "crate", sky: 0x080d10 },
  { name: "Blackpine Woods", fog: 0x0a0f0a, ground: 0x1f2a1c, wall: 0x2a3524, accent: 0x3a5a30, obstacle: "tree",  sky: 0x060a06 },
];

export const ARENA_HALF = 46; // arena spans -46..46 on X and Z

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];   // { minX, maxX, minZ, maxZ }
    this.exit = null;
    this.setting = SETTINGS[0];
    this._exitMesh = null;
    this._exitLight = null;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const m = o.material; Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose(); }
    });
    this.scene.remove(this.group);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.colliders = [];
  }

  build(settingIndex) {
    this.dispose();
    const s = SETTINGS[settingIndex % SETTINGS.length];
    this.setting = s;
    const H = ARENA_HALF;

    // Fog + background tint.
    this.scene.fog = new THREE.Fog(s.fog, 32, 135);
    this.scene.background = new THREE.Color(s.sky);

    // Ground.
    const groundMat = new THREE.MeshStandardMaterial({ color: s.ground, roughness: 0.96, metalness: 0.0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Subtle grid seams for depth perception.
    const grid = new THREE.GridHelper(H * 2, H, s.accent, s.accent);
    grid.material.transparent = true; grid.material.opacity = 0.08;
    grid.position.y = 0.02;
    this.group.add(grid);

    // Perimeter walls (4 slabs), each a collider.
    const wallMat = new THREE.MeshStandardMaterial({ color: s.wall, roughness: 0.9 });
    const T = 2, WH = 6; // thickness, height
    const walls = [
      { x: 0, z: -H, w: H * 2 + T, d: T },
      { x: 0, z: H, w: H * 2 + T, d: T },
      { x: -H, z: 0, w: T, d: H * 2 + T },
      { x: H, z: 0, w: T, d: H * 2 + T },
    ];
    for (const w of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WH, w.d), wallMat);
      mesh.position.set(w.x, WH / 2, w.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      this._addCollider(w.x, w.z, w.w, w.d);
    }

    // Cover obstacles, avoiding the centre spawn and the exit.
    const exitPos = { x: 0, z: -H + 5 };
    const count = 26 + settingIndex * 4;
    for (let i = 0; i < count; i++) {
      const x = rand(-H + 6, H - 6);
      const z = rand(-H + 6, H - 6);
      if (Math.hypot(x, z) < 8) continue;             // keep centre clear
      if (Math.hypot(x - exitPos.x, z - exitPos.z) < 9) continue; // keep exit clear
      this._addObstacle(s.obstacle, x, z);
    }

    // Ambient scatter (non-colliding decoration).
    this._scatterDebris(s);

    // Exit gate.
    this._buildExit(exitPos.x, exitPos.z, s.accent);
  }

  _addObstacle(kind, x, z) {
    let w, d, h, color, y;
    switch (kind) {
      case "car":
        w = rand(2.4, 3.2); d = rand(5, 6.4); h = 1.6; color = 0x2a2f36; break;
      case "shelf":
        w = rand(1.6, 2.2); d = rand(5, 8); h = rand(2.6, 3.4); color = 0x5a4a38; break;
      case "crate":
        w = d = rand(1.8, 3); h = rand(1.6, 2.6); color = 0x6a5a3a; break;
      case "tree":
        w = d = rand(1.2, 2); h = rand(5, 8); color = 0x2e2419; break;
      default:
        w = d = 2; h = 2; color = 0x555555;
    }
    y = h / 2;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = kind === "car" ? (chance(0.5) ? 0 : Math.PI / 2) : rand(0, Math.PI);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);

    if (kind === "tree") {
      // A leafy canopy on top (decoration only).
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(rand(2.6, 3.6), rand(4, 6), 7),
        new THREE.MeshStandardMaterial({ color: 0x24401d, roughness: 1 })
      );
      canopy.position.set(x, h + 2, z);
      canopy.castShadow = true;
      this.group.add(canopy);
    }

    // Collider uses the un-rotated footprint for right-angle turns; good enough
    // for gameplay and cheap. Widen slightly to account for rotation.
    const wc = mesh.rotation.y % Math.PI === 0 ? w : Math.max(w, d);
    const dc = mesh.rotation.y % Math.PI === 0 ? d : Math.max(w, d);
    this._addCollider(x, z, wc, dc);
  }

  _scatterDebris(s) {
    const mat = new THREE.MeshStandardMaterial({ color: s.accent, roughness: 1 });
    const geo = new THREE.BoxGeometry(0.5, 0.15, 0.5);
    const mesh = new THREE.InstancedMesh(geo, mat, 60);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      m.makeRotationY(rand(0, Math.PI));
      m.setPosition(rand(-ARENA_HALF + 3, ARENA_HALF - 3), 0.08, rand(-ARENA_HALF + 3, ARENA_HALF - 3));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  _buildExit(x, z, accent) {
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x111511, roughness: 0.8, emissive: accent, emissiveIntensity: 0.15 });
    const post = new THREE.BoxGeometry(0.6, 5, 0.6);
    const left = new THREE.Mesh(post, postMat); left.position.set(-2.4, 2.5, 0);
    const right = new THREE.Mesh(post, postMat); right.position.set(2.4, 2.5, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.6, 0.6), postMat); top.position.set(0, 5, 0);
    g.add(left, right, top);

    // Glowing portal plane.
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.6),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
    );
    portal.position.set(0, 2.5, 0);
    g.add(portal);

    const light = new THREE.PointLight(accent, 0, 16);
    light.position.set(0, 3, 0);
    g.add(light);

    g.position.set(x, 0, z);
    this.group.add(g);
    this._exitMesh = portal;
    this._exitLight = light;
    this.exit = { x, z, radius: 2.6, active: false };
  }

  // Turn the exit on/off (glows when active).
  setExitActive(on) {
    if (!this.exit) return;
    this.exit.active = on;
    if (this._exitLight) this._exitLight.intensity = on ? 2.4 : 0;
    if (this._exitMesh) this._exitMesh.material.opacity = on ? 0.6 : 0.12;
  }

  animate(t) {
    if (this.exit && this.exit.active && this._exitMesh) {
      this._exitMesh.material.opacity = 0.45 + Math.sin(t * 3) * 0.18;
    }
  }

  _addCollider(cx, cz, w, d) {
    this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  // Push a circle (position on XZ, given radius) out of walls/obstacles and
  // clamp inside the arena. Mutates and returns {x, z}.
  resolve(x, z, radius) {
    const H = ARENA_HALF - radius - 0.4;
    if (x < -H) x = -H; else if (x > H) x = H;
    if (z < -H) z = -H; else if (z > H) z = H;
    for (const c of this.colliders) {
      // Nearest point on the box to the circle centre.
      const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
      const nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (radius - d);
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // Centre inside the box — push out along the shallowest axis.
          const toLeft = Math.abs(x - c.minX), toRight = Math.abs(c.maxX - x);
          const toTop = Math.abs(z - c.minZ), toBot = Math.abs(c.maxZ - z);
          const min = Math.min(toLeft, toRight, toTop, toBot);
          if (min === toLeft) x = c.minX - radius;
          else if (min === toRight) x = c.maxX + radius;
          else if (min === toTop) z = c.minZ - radius;
          else z = c.maxZ + radius;
        }
      }
    }
    return { x, z };
  }

  // A spawn point near the arena edge, at least minDist from the player.
  spawnPoint(player, minDist = 26) {
    for (let tries = 0; tries < 30; tries++) {
      const edge = randInt(0, 3);
      const along = rand(-ARENA_HALF + 5, ARENA_HALF - 5);
      const off = rand(2, 7);
      let x, z;
      if (edge === 0) { x = along; z = -ARENA_HALF + off; }
      else if (edge === 1) { x = along; z = ARENA_HALF - off; }
      else if (edge === 2) { x = -ARENA_HALF + off; z = along; }
      else { x = ARENA_HALF - off; z = along; }
      if (Math.hypot(x - player.x, z - player.z) >= minDist) {
        const r = this.resolve(x, z, 0.5);
        return { x: r.x, z: r.z };
      }
    }
    return { x: rand(-ARENA_HALF + 6, ARENA_HALF - 6), z: -ARENA_HALF + 5 };
  }
}
