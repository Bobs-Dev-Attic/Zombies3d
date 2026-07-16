// Unified input for the 3D shooter:
//   • Desktop — pointer-lock mouse look, WASD move, click/space fire, R/Q/1-9.
//   • Touch   — left virtual stick moves, right half of screen drags to look,
//               on-screen FIRE / reload / swap / sprint buttons.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // Movement (local space): forward +1 .. back -1, strafe right +1 .. left -1.
    this.moveF = 0;
    this.moveS = 0;
    this.sprint = false;

    // Accumulated look deltas (pixels); consumed by the game each frame.
    this.lookDX = 0;
    this.lookDY = 0;

    // Held / queued actions.
    this.firing = false;
    this.reloadQueued = false;
    this.swapQueued = false;
    this.interactQueued = false;
    this.pauseQueued = false;
    this.selectIndex = -1; // weapon slot from number keys, -1 = none

    this.usingTouch = false;
    this.pointerLocked = false;

    this.keys = new Set();
    this._joyId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._joyRadius = 56;
    this._lookId = null;
    this._lookLast = { x: 0, y: 0 };

    this._bindKeyboard();
    this._bindMouse();
    this._bindStick();
    this._bindLookPad();
    this._bindButtons();
  }

  requestPointerLock() {
    if (!this.usingTouch && this.canvas.requestPointerLock) {
      try { this.canvas.requestPointerLock(); } catch (_) {}
    }
  }

  _bindKeyboard() {
    const held = { KeyW: "f+", ArrowUp: "f+", KeyS: "f-", ArrowDown: "f-",
                   KeyA: "s-", ArrowLeft: "s-", KeyD: "s+", ArrowRight: "s+" };
    window.addEventListener("keydown", (e) => {
      const k = e.code;
      if (held[k]) this.keys.add(held[k]);
      if (k === "ShiftLeft" || k === "ShiftRight") this.sprint = true;
      if (k === "Space") { this.firing = true; e.preventDefault(); }
      if (k === "KeyR") this.reloadQueued = true;
      if (k === "KeyQ") this.swapQueued = true;
      if (k === "KeyE") this.interactQueued = true;
      if (k === "Escape") this.pauseQueued = true;
      if (k.startsWith("Digit")) {
        const n = parseInt(k.slice(5), 10);
        if (n >= 1 && n <= 9) this.selectIndex = n - 1;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      const k = e.code;
      if (held[k]) this.keys.delete(held[k]);
      if (k === "ShiftLeft" || k === "ShiftRight") this.sprint = false;
      if (k === "Space") this.firing = false;
    });
    window.addEventListener("blur", () => { this.keys.clear(); this.firing = false; this.sprint = false; });
  }

  _bindMouse() {
    this.canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.firing = true; });
    window.addEventListener("mouseup", (e) => { if (e.button === 0 && !this.usingTouch) this.firing = false; });
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
      }
    });
    this.canvas.addEventListener("wheel", () => { this.swapQueued = true; }, { passive: true });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.firing = false;
    });
  }

  _bindStick() {
    const joy = document.getElementById("move-stick");
    if (!joy) return;
    const knob = joy.querySelector(".stick-knob");
    const R = this._joyRadius;
    const start = (t) => {
      this.usingTouch = true;
      this._joyId = t.identifier;
      const r = joy.getBoundingClientRect();
      this._joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      move(t);
    };
    const move = (t) => {
      let dx = t.clientX - this._joyOrigin.x;
      let dy = t.clientY - this._joyOrigin.y;
      const mag = Math.hypot(dx, dy) || 1;
      const cl = Math.min(mag, R);
      const nx = dx / mag, ny = dy / mag;
      knob.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`;
      const scale = Math.min(mag / R, 1);
      this.moveS = nx * scale;
      this.moveF = -ny * scale; // up on screen = forward
      this.sprint = scale > 0.92;
    };
    const end = () => {
      this._joyId = null;
      this.moveF = this.moveS = 0; this.sprint = false;
      knob.style.transform = "translate(0,0)";
    };
    joy.addEventListener("touchstart", (e) => { e.preventDefault(); if (this._joyId === null) start(e.changedTouches[0]); }, { passive: false });
    joy.addEventListener("touchmove", (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === this._joyId) move(t); }, { passive: false });
    const drop = (e) => { for (const t of e.changedTouches) if (t.identifier === this._joyId) end(); };
    joy.addEventListener("touchend", drop);
    joy.addEventListener("touchcancel", drop);
  }

  _bindLookPad() {
    const pad = document.getElementById("look-pad");
    if (!pad) return;
    pad.addEventListener("touchstart", (e) => {
      e.preventDefault(); this.usingTouch = true;
      if (this._lookId === null) {
        const t = e.changedTouches[0];
        this._lookId = t.identifier;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    pad.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) {
          this.lookDX += (t.clientX - this._lookLast.x) * 1.4;
          this.lookDY += (t.clientY - this._lookLast.y) * 1.4;
          this._lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });
    const drop = (e) => { for (const t of e.changedTouches) if (t.identifier === this._lookId) this._lookId = null; };
    pad.addEventListener("touchend", drop);
    pad.addEventListener("touchcancel", drop);
  }

  _bindButtons() {
    const fire = document.getElementById("btn-fire");
    if (fire) {
      fire.addEventListener("touchstart", (e) => { e.preventDefault(); this.usingTouch = true; this.firing = true; }, { passive: false });
      fire.addEventListener("touchend", (e) => { e.preventDefault(); this.firing = false; }, { passive: false });
      fire.addEventListener("touchcancel", () => { this.firing = false; });
    }
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("touchstart", (e) => { e.preventDefault(); this.usingTouch = true; fn(); }, { passive: false });
    };
    tap("btn-reload", () => (this.reloadQueued = true));
    tap("btn-swap", () => (this.swapQueued = true));
    const sprintBtn = document.getElementById("btn-sprint");
    if (sprintBtn) {
      sprintBtn.addEventListener("touchstart", (e) => {
        e.preventDefault(); this.usingTouch = true;
        this._sprintHold = !this._sprintHold;
        sprintBtn.classList.toggle("on", this._sprintHold);
      }, { passive: false });
    }
  }

  // Merge keyboard movement each frame (touch stick already set moveF/moveS).
  sampleKeyboard() {
    if (this._joyId !== null) return; // touch stick wins
    let f = 0, s = 0;
    if (this.keys.has("f+")) f += 1;
    if (this.keys.has("f-")) f -= 1;
    if (this.keys.has("s+")) s += 1;
    if (this.keys.has("s-")) s -= 1;
    if (f || s) { const m = Math.hypot(f, s); this.moveF = f / m; this.moveS = s / m; }
    else if (!this.usingTouch) { this.moveF = this.moveS = 0; }
    if (this._sprintHold && (this.moveF || this.moveS)) this.sprint = true;
  }

  // Consume accumulated look deltas.
  takeLook() {
    const d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return d;
  }

  // Consume one-shot flags.
  consume() {
    const r = {
      reload: this.reloadQueued, swap: this.swapQueued,
      interact: this.interactQueued, pause: this.pauseQueued, select: this.selectIndex,
    };
    this.reloadQueued = this.swapQueued = this.interactQueued = this.pauseQueued = false;
    this.selectIndex = -1;
    return r;
  }
}
