/* ============================================================
   weather-env.js — Cinematic environment engine
   Canvas-based nature animations that change with weather
   ============================================================ */

const canvas = document.getElementById('envCanvas');
const ctx = canvas.getContext('2d');
let W, H;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ── Current weather mode ────────────────────────────────────
let weatherMode = 'clear'; // clear | rain | snow | storm | cloudy | fog

// ── Mouse parallax ──────────────────────────────────────────
let mx = 0.5, my = 0.5;
document.addEventListener('mousemove', (e) => {
  mx = e.clientX / W;
  my = e.clientY / H;
});

// ── Utility ─────────────────────────────────────────────────
function rand(a, b) { return Math.random() * (b - a) + a; }
function lerp(a, b, t) { return a + (b - a) * t; }

// ── Sky gradient ────────────────────────────────────────────
const skyPalettes = {
  clear:  { top: '#1a3a6e', mid: '#3b7dd8', bot: '#f0c27f' },
  rain:   { top: '#1a2030', mid: '#2a3548', bot: '#3a4a5a' },
  snow:   { top: '#5a6a80', mid: '#8a9ab0', bot: '#b8c8d8' },
  storm:  { top: '#0a0e18', mid: '#151d2e', bot: '#2a3040' },
  cloudy: { top: '#3a4a5e', mid: '#5a6a7e', bot: '#8a9098' },
  fog:    { top: '#6a7080', mid: '#8a9098', bot: '#a0a8b0' },
};
let curSky = { ...skyPalettes.clear };
let tgtSky = { ...skyPalettes.clear };

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r,g,b];
}
function rgbToHex([r,g,b]) {
  return '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
}
function lerpColor(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca.map((v,i) => lerp(v, cb[i], t)));
}

function drawSky() {
  // Smoothly transition sky
  for (const k of ['top','mid','bot']) {
    curSky[k] = lerpColor(curSky[k], tgtSky[k], 0.005);
  }
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, curSky.top);
  grad.addColorStop(0.5, curSky.mid);
  grad.addColorStop(1, curSky.bot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// ── Mountains ───────────────────────────────────────────────
function drawMountains() {
  const px = (mx - 0.5) * 15;
  // Far mountains
  ctx.fillStyle = 'rgba(25,40,55,0.6)';
  ctx.beginPath();
  ctx.moveTo(-50 + px*0.3, H);
  for (let x = -50; x <= W + 50; x += 80) {
    const y = H * 0.45 + Math.sin(x * 0.003) * H * 0.12 + Math.cos(x * 0.007) * H * 0.06;
    ctx.lineTo(x + px * 0.3, y);
  }
  ctx.lineTo(W + 50, H);
  ctx.fill();

  // Near mountains
  ctx.fillStyle = 'rgba(15,30,20,0.75)';
  ctx.beginPath();
  ctx.moveTo(-50 + px * 0.6, H);
  for (let x = -50; x <= W + 50; x += 60) {
    const y = H * 0.55 + Math.sin(x * 0.005 + 1) * H * 0.1 + Math.cos(x * 0.01) * H * 0.04;
    ctx.lineTo(x + px * 0.6, y);
  }
  ctx.lineTo(W + 50, H);
  ctx.fill();

  // Treeline
  ctx.fillStyle = 'rgba(10,25,15,0.85)';
  ctx.beginPath();
  ctx.moveTo(-50 + px, H);
  for (let x = -50; x <= W + 50; x += 30) {
    const base = H * 0.68 + Math.sin(x * 0.008 + 2) * H * 0.04;
    const tree = Math.sin(x * 0.05) * 12 + Math.sin(x * 0.12) * 6;
    ctx.lineTo(x + px, base + tree);
  }
  ctx.lineTo(W + 50, H);
  ctx.fill();

  // Ground
  ctx.fillStyle = 'rgba(8,18,10,0.9)';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
}

// ── Sun / Moon ──────────────────────────────────────────────
let sunAngle = 0;
function drawSun() {
  if (weatherMode === 'storm' || weatherMode === 'rain') return;
  sunAngle += 0.001;
  const sx = W * 0.75 + Math.sin(sunAngle) * 40 + (mx - 0.5) * -30;
  const sy = H * 0.18 + Math.cos(sunAngle * 0.5) * 10 + (my - 0.5) * -20;
  const alpha = weatherMode === 'cloudy' || weatherMode === 'fog' ? 0.3 : 0.8;

  // Glow
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 200);
  glow.addColorStop(0, `rgba(255,220,130,${alpha * 0.6})`);
  glow.addColorStop(0.3, `rgba(255,200,100,${alpha * 0.2})`);
  glow.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sx - 200, sy - 200, 400, 400);

  // Sun disc
  ctx.beginPath();
  ctx.arc(sx, sy, 28, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,230,150,${alpha})`;
  ctx.fill();

  // Light rays
  if (weatherMode === 'clear') {
    ctx.save();
    ctx.globalAlpha = 0.04 + Math.sin(Date.now() * 0.001) * 0.02;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + sunAngle * 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * 500, sy + Math.sin(a) * 500);
      ctx.lineTo(sx + Math.cos(a + 0.08) * 500, sy + Math.sin(a + 0.08) * 500);
      ctx.fillStyle = '#ffe080';
      ctx.fill();
    }
    ctx.restore();
  }
}

// ── Clouds ──────────────────────────────────────────────────
class Cloud {
  constructor() { this.reset(true); }
  reset(init) {
    this.x = init ? rand(-200, W + 200) : -300;
    this.y = rand(H * 0.05, H * 0.35);
    this.w = rand(180, 400);
    this.h = rand(40, 80);
    this.speed = rand(0.15, 0.5);
    this.alpha = rand(0.15, 0.45);
    if (weatherMode === 'cloudy' || weatherMode === 'rain' || weatherMode === 'storm') {
      this.alpha = rand(0.4, 0.7);
      this.speed *= 1.5;
    }
  }
  update() {
    this.x += this.speed * (weatherMode === 'storm' ? 3 : 1);
    if (this.x > W + 400) this.reset(false);
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = weatherMode === 'storm' ? '#1a1e2a' : '#dde4ee';
    // Draw cloud as overlapping ellipses
    const cx = this.x + (mx - 0.5) * -20;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (i - 2) * this.w * 0.2, this.y + Math.sin(i) * 8,
        this.w * 0.25, this.h * (0.6 + Math.sin(i * 1.5) * 0.3), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
const clouds = Array.from({ length: 12 }, () => new Cloud());

// ── Birds ───────────────────────────────────────────────────
class Bird {
  constructor() { this.reset(true); }
  reset(init) {
    this.x = init ? rand(-100, W) : -60;
    this.y = rand(H * 0.08, H * 0.35);
    this.speed = rand(1.2, 2.5);
    this.wingPhase = rand(0, Math.PI * 2);
    this.wingSpeed = rand(0.08, 0.14);
    this.size = rand(4, 8);
  }
  update() {
    this.x += this.speed;
    this.y += Math.sin(this.x * 0.01) * 0.3;
    this.wingPhase += this.wingSpeed;
    if (this.x > W + 80) this.reset(false);
  }
  draw() {
    const wing = Math.sin(this.wingPhase) * this.size;
    ctx.save();
    ctx.strokeStyle = 'rgba(20,20,20,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x - this.size, this.y + wing);
    ctx.quadraticCurveTo(this.x, this.y - Math.abs(wing) * 0.3, this.x + this.size, this.y + wing);
    ctx.stroke();
    ctx.restore();
  }
}
const birds = Array.from({ length: 6 }, () => new Bird());

// ── Leaves ──────────────────────────────────────────────────
class Leaf {
  constructor() { this.reset(true); }
  reset(init) {
    this.x = rand(-50, W + 50);
    this.y = init ? rand(-H, H) : rand(-100, -20);
    this.vx = rand(-0.5, 0.5);
    this.vy = rand(0.5, 1.5);
    this.rot = rand(0, Math.PI * 2);
    this.rotSpeed = rand(-0.03, 0.03);
    this.size = rand(4, 10);
    this.sway = rand(0.01, 0.03);
    this.swayOff = rand(0, Math.PI * 2);
    // autumn colors
    const colors = ['#c0552a','#d4883a','#8a6a2a','#6a8a30','#3a7a28'];
    this.color = colors[Math.floor(rand(0, colors.length))];
  }
  update() {
    this.x += this.vx + Math.sin(this.y * this.sway + this.swayOff) * 0.8;
    this.y += this.vy;
    this.rot += this.rotSpeed;
    if (weatherMode === 'storm') { this.vx += rand(-0.1, 0.1); this.vy *= 1.001; }
    if (this.y > H + 30) this.reset(false);
  }
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.size, this.size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // leaf vein
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-this.size, 0); ctx.lineTo(this.size, 0); ctx.stroke();
    ctx.restore();
  }
}
const leaves = Array.from({ length: 20 }, () => new Leaf());

// ── Rain particles ──────────────────────────────────────────
class Raindrop {
  constructor() { this.reset(); }
  reset() {
    this.x = rand(0, W);
    this.y = rand(-H, 0);
    this.len = rand(12, 28);
    this.speed = rand(12, 22);
    this.alpha = rand(0.15, 0.4);
    this.wind = weatherMode === 'storm' ? rand(3, 8) : rand(0.5, 2);
  }
  update() {
    this.x += this.wind;
    this.y += this.speed;
    if (this.y > H + 30) this.reset();
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.strokeStyle = '#aac8e8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.wind * 0.8, this.y - this.len);
    ctx.stroke();
    ctx.restore();
  }
}
let raindrops = [];

// ── Snow particles ──────────────────────────────────────────
class Snowflake {
  constructor() { this.reset(true); }
  reset(init) {
    this.x = rand(0, W);
    this.y = init ? rand(-H, H) : rand(-50, -10);
    this.r = rand(1.5, 5);
    this.speed = rand(0.5, 1.8);
    this.drift = rand(-0.3, 0.3);
    this.sway = rand(0.005, 0.02);
    this.swayOff = rand(0, 100);
    this.alpha = rand(0.4, 0.9);
  }
  update() {
    this.x += this.drift + Math.sin(this.y * this.sway + this.swayOff) * 0.5;
    this.y += this.speed;
    if (this.y > H + 20) this.reset(false);
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#eef4ff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
let snowflakes = [];

// ── Ambient particles (dust / pollen / mist) ────────────────
class Particle {
  constructor() { this.reset(true); }
  reset(init) {
    this.x = rand(0, W);
    this.y = init ? rand(0, H) : rand(-10, H);
    this.r = rand(0.5, 2.5);
    this.speedX = rand(-0.2, 0.2);
    this.speedY = rand(-0.3, -0.05);
    this.alpha = rand(0.08, 0.25);
    this.life = rand(200, 600);
    this.age = init ? rand(0, this.life) : 0;
  }
  update() {
    this.x += this.speedX + Math.sin(this.age * 0.02) * 0.15;
    this.y += this.speedY;
    this.age++;
    if (this.age > this.life || this.y < -20) this.reset(false);
  }
  draw() {
    const fade = 1 - (this.age / this.life);
    ctx.save();
    ctx.globalAlpha = this.alpha * fade;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
const particles = Array.from({ length: 40 }, () => new Particle());

// ── Fog layers ──────────────────────────────────────────────
function drawFog() {
  if (weatherMode !== 'fog' && weatherMode !== 'snow' && weatherMode !== 'clear') return;
  const t = Date.now() * 0.0001;
  const alpha = weatherMode === 'fog' ? 0.25 : 0.08;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
    grad.addColorStop(0, 'rgba(200,210,220,0)');
    grad.addColorStop(1, `rgba(200,210,220,${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.sin(t + i) * 50, H * 0.6 + i * 30, W, H * 0.4);
    ctx.restore();
  }
}

// ── Set weather mode ────────────────────────────────────────
function setWeatherMode(mode) {
  if (mode === weatherMode) return;
  weatherMode = mode;
  tgtSky = { ...skyPalettes[mode] || skyPalettes.clear };

  // Update overlay
  const ov = document.querySelector('.env-overlay');
  if (ov) ov.className = 'env-overlay ' + mode;

  // Manage rain
  if (mode === 'rain' || mode === 'storm') {
    const count = mode === 'storm' ? 300 : 150;
    while (raindrops.length < count) raindrops.push(new Raindrop());
    raindrops.length = count;
  } else {
    raindrops = [];
  }

  // Manage snow
  if (mode === 'snow') {
    while (snowflakes.length < 120) snowflakes.push(new Snowflake());
  } else {
    snowflakes = [];
  }

  // Card frost
  const card = document.querySelector('.weather-card');
  if (card) {
    if (mode === 'snow') card.classList.add('frost');
    else card.classList.remove('frost');
  }
}

// Expose globally
window.setWeatherMode = setWeatherMode;

// ── Lightning ───────────────────────────────────────────────
let nextLightning = 0;
function checkLightning() {
  if (weatherMode !== 'storm') return;
  const now = Date.now();
  if (now > nextLightning) {
    const el = document.querySelector('.lightning-flash');
    if (el) {
      el.classList.remove('active');
      void el.offsetWidth; // reflow
      el.classList.add('active');
      setTimeout(() => el.classList.remove('active'), 400);
    }
    nextLightning = now + rand(3000, 10000);
  }
}

// ── Main render loop ────────────────────────────────────────
function frame() {
  ctx.clearRect(0, 0, W, H);

  drawSky();
  drawSun();
  clouds.forEach(c => { c.update(); c.draw(); });
  drawMountains();
  drawFog();
  birds.forEach(b => { b.update(); b.draw(); });
  leaves.forEach(l => { l.update(); l.draw(); });
  raindrops.forEach(r => { r.update(); r.draw(); });
  snowflakes.forEach(s => { s.update(); s.draw(); });
  particles.forEach(p => { p.update(); p.draw(); });
  checkLightning();

  requestAnimationFrame(frame);
}

frame();
