// Entry point: wires the DOM/UI to the Game instance.
import { Game } from "./game.js";
import { WEAPONS } from "./weapons.js";
import { sfx } from "./audio.js";
import { VERSION, CHANGELOG } from "./version.js";

const $ = (id) => document.getElementById(id);
const canvas = $("game");

// Version tags.
$("menu-version").textContent = VERSION;
$("hud-version").textContent = VERSION;
document.title = `Zombies 3D: Escape the Horde — v${VERSION}`;

let toastTimer = null;
function toast(a, b) {
  const el = $("toast");
  el.innerHTML = b ? `${a}<br><span style="font-size:11px;color:var(--muted)">${b}</span>` : a;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
}

function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
}

let game;
try {
  game = new Game(canvas, {
    onToast: toast,
    vibrate,
    onSetting: (name) => { $("setting-label").textContent = name; },
    onWave: (w) => { $("wave-label").textContent = "WAVE " + w; },
    onStats: (s) => {
      $("hp-fill").style.width = (s.hp * 100).toFixed(1) + "%";
      const st = $("stamina-fill");
      st.style.width = (s.stamina * 100).toFixed(1) + "%";
      st.style.opacity = s.exhausted ? "0.5" : "1";
      $("wave-label").textContent = "WAVE " + s.wave;
      $("score-label").textContent = s.score;
      $("weapon-name").textContent = s.weapon;
      const ammo = $("ammo-count");
      ammo.textContent = s.ammo;
      ammo.classList.toggle("low", !!s.lowAmmo);
      const ring = $("reload-ring");
      if (ring) {
        ring.classList.toggle("hidden", !s.reloading);
        if (s.reloading) ring.style.setProperty("--p", (s.reloadProgress || 0).toFixed(3));
      }
      updateWeaponBar(s);
    },
    onPause: (p) => { p ? show("pause") : hideOverlays(); },
    onLevelClear: ({ next }) => {
      $("lc-next").textContent = "Next: " + next;
      show("levelclear");
      hideGameUI();
    },
    onGameOver: ({ score, wave, kills }) => {
      $("final-score").textContent = score;
      $("final-wave").textContent = wave;
      $("final-kills").textContent = kills;
      show("gameover");
      hideGameUI();
      vibrate([60, 40, 120]);
    },
  });
} catch (err) {
  console.error(err);
  $("loading").innerHTML = `<div class="menu-card"><h2>WebGL unavailable</h2><p class="stat-line">This game needs a WebGL-capable browser.</p></div>`;
  show("loading");
}
$("loading").classList.add("hidden");
// Expose the instance for debugging / automated smoke tests.
window.__game = game;

// ---------------- Weapon bar ----------------
let weaponBarKey = "";
function updateWeaponBar(s) {
  const bar = $("weapon-bar");
  if (!bar || !s.owned) return;
  const key = s.owned.join(",");
  if (key !== weaponBarKey) {
    weaponBarKey = key;
    bar.innerHTML = "";
    for (const id of s.owned) {
      const btn = document.createElement("button");
      btn.className = "wbtn";
      btn.dataset.id = id;
      btn.textContent = (WEAPONS[id] && WEAPONS[id].tag) || id;
      btn.title = (WEAPONS[id] && WEAPONS[id].name) || id;
      btn.addEventListener("click", () => game.selectWeapon(id));
      bar.appendChild(btn);
    }
  }
  for (const btn of bar.children) {
    const isCur = btn.dataset.id === s.current;
    btn.classList.toggle("active", isCur);
    btn.classList.toggle("reloading", isCur && !!s.reloading);
  }
}

// ---------------- Screen management ----------------
const overlays = ["menu", "how", "changelog", "pause", "levelclear", "gameover", "loading"];
function show(id) { for (const o of overlays) $(o).classList.toggle("hidden", o !== id); }
function hideOverlays() { for (const o of overlays) $(o).classList.add("hidden"); }
function showGameUI() { $("hud").classList.remove("hidden"); $("touch-ui").classList.remove("hidden"); $("crosshair").classList.remove("hidden"); }
function hideGameUI() { $("touch-ui").classList.add("hidden"); $("crosshair").classList.add("hidden"); }

function beginGame() {
  if (!game) return;
  sfx.resume();
  hideOverlays();
  showGameUI();
  game.start();
}

// ---------------- Sound ----------------
sfx.enabled = localStorage.getItem("z3_sound") !== "off";
function updateMuteBtn() { const b = $("mute-btn"); if (b) b.textContent = sfx.enabled ? "🔊 Sound: On" : "🔇 Sound: Off"; }
$("mute-btn")?.addEventListener("click", () => {
  sfx.setEnabled(!sfx.enabled);
  localStorage.setItem("z3_sound", sfx.enabled ? "on" : "off");
  updateMuteBtn();
  if (sfx.enabled) { sfx.resume(); sfx.play("ui"); }
});
updateMuteBtn();
const wake = () => sfx.resume();
window.addEventListener("pointerdown", wake, { once: true });
window.addEventListener("keydown", wake, { once: true });

// ---------------- Buttons ----------------
$("start-btn").addEventListener("click", beginGame);
$("retry-btn").addEventListener("click", beginGame);
$("how-btn").addEventListener("click", () => { sfx.play("ui"); show("how"); });
$("changelog-btn").addEventListener("click", () => { sfx.play("ui"); renderChangelog(); show("changelog"); });
$("resume-btn")?.addEventListener("click", () => { sfx.play("ui"); game.setPaused(false); });
$("quit-btn")?.addEventListener("click", () => { sfx.play("ui"); game.quit(); hideGameUI(); show("menu"); });
$("next-btn")?.addEventListener("click", () => { sfx.play("ui"); hideOverlays(); showGameUI(); game.continueToNextSetting(); });
for (const btn of document.querySelectorAll(".close-overlay")) {
  btn.addEventListener("click", () => { sfx.play("ui"); hideOverlays(); $("menu").classList.remove("hidden"); });
}

// ---------------- Changelog rendering ----------------
function renderChangelog() {
  const body = $("changelog-body");
  body.innerHTML = CHANGELOG.map((rel) => `
    <h3>v${rel.version} — ${rel.title}</h3>
    <div class="cl-date">${rel.date}</div>
    <ul>${rel.changes.map((c) => `<li>• ${c}</li>`).join("")}</ul>
  `).join("");
}

// Pause when the tab is hidden.
document.addEventListener("visibilitychange", () => {
  if (game && game.running && document.hidden) game.pause(true);
});

// Prevent iOS double-tap zoom / scroll bounce on the play surface.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

// Show the menu at boot.
show("menu");
