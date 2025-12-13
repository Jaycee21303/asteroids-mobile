(() => {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });

  const $score = document.getElementById('score');
  const $lives = document.getElementById('lives');
  const $best  = document.getElementById('best');
  const $overlay = document.getElementById('overlay');
  const $startBtn = document.getElementById('startBtn');
  const $toast = document.getElementById('toast');
  const $fireBtn = document.getElementById('fireBtn');

  // ---------------- Poki SDK integration (safe fallback) ----------------
  let pokiReady = false;
  let pokiInitTried = false;

  function pokiInitThen(cb) {
    if (pokiInitTried) return cb();
    pokiInitTried = true;

    if (!window.PokiSDK || !window.PokiSDK.init) return cb();
    try {
      window.PokiSDK.init().then(() => {
        pokiReady = true;
        cb();
      }).catch(() => cb());
    } catch {
      cb();
    }
  }

  function pokiLoadingFinished() {
    if (!pokiReady) return;
    try { window.PokiSDK.gameLoadingFinished(); } catch {}
  }
  function pokiGameplayStart() {
    if (!pokiReady) return;
    try { window.PokiSDK.gameplayStart(); } catch {}
  }
  function pokiGameplayStop() {
    if (!pokiReady) return;
    try { window.PokiSDK.gameplayStop(); } catch {}
  }
  async function pokiCommercialBreak() {
    if (!pokiReady || !window.PokiSDK.commercialBreak) return;
    try {
      await window.PokiSDK.commercialBreak(() => {});
    } catch {}
  }

  // ---------------- Utilities ----------------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const hypot = Math.hypot;
  const now = () => performance.now();

  function safeStorageGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch { return fallback; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  // ---------------- Responsive canvas ----------------
  let W = 960, H = 540;
  let DPR = 1;

  function resize() {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    W = Math.max(480, Math.round(ww));
    H = Math.max(270, Math.round(wh));

    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width  = ww + 'px';
    canvas.style.height = wh + 'px';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    seedStars();
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ---------------- Input ----------------
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'Space' && (state === 'menu' || state === 'over')) startGame();
    if (e.code === 'Space' && state === 'game' && !paused) shoot();
  }, { passive: false });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // Touch / pointer steering
  let pointerDown = false;
  let pointerX = 0, pointerY = 0;

  window.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    pointerX = e.clientX;
    pointerY = e.clientY;
    canvas.focus?.();
    if (state === 'menu' || state === 'over') startGame();
  }, { passive: true });

  window.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
  }, { passive: true });

  window.addEventListener('pointerup', () => { pointerDown = false; }, { passive: true });

  $fireBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'menu' || state === 'over') startGame();
    if (state === 'game' && !paused) shoot();
  }, { passive: false });

  canvas.tabIndex = 0;

  // ---------------- Sound (tiny synth) ----------------
  let audioCtx = null;
  let muted = false;

  function ensureAudio() {
    if (audioCtx || muted) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { muted = true; }
  }

  function beep(freq = 440, dur = 0.05, type = 'square', gain = 0.06) {
    if (!audioCtx || muted) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur);
  }

  // ---------------- Game entities ----------------
  function vecFromAng(a) { return { x: Math.cos(a), y: Math.sin(a) }; }

  const ship = {
    x: W * 0.5, y: H * 0.72,
    vx: 0, vy: 0,
    a: -Math.PI / 2,
    r: 12,
    invuln: 0
  };

  const bullets = [];
  const obstacles = [];
  const particles = [];
  const enemyBullets = [];

  let score = 0;
  let lives = 3;
  let best = parseInt(safeStorageGet('neonAsteroidsBest', '0'), 10) || 0;
  $best.textContent = String(best);

  // State
  let state = 'menu'; // menu | game | over
  let paused = false;
  let lastT = now();
  let shootCD = 0;
  let section = 0;
  let distance = 0;
  let spawnAcc = 0;
  let forwardSpeed = 180;
  const MAX_LIVES = 6;
  let panelOffset = 0;
  let trenchPulse = 0;
  let trenchBank = 0;
  let currentTheme = { laneHue: 190, wallHue: 220, fog: 'rgba(8,12,22,0.7)' };

  const starsFar = [];
  const starsNear = [];

  function toast(msg) {
    $toast.textContent = msg;
    $toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => ($toast.style.opacity = '0'), 1200);
  }

  function resetShip() {
    ship.x = W * 0.5; ship.y = H * 0.72;
    ship.vx = 0; ship.vy = 0;
    ship.a = -Math.PI / 2;
    ship.invuln = 1.1;
  }

  function corridor() {
    const undulate = Math.sin(distance * 0.0006) * 0.1;
    const width = clamp(W * (0.68 + undulate), 320, W - 80);
    const bank = Math.sin(distance * 0.00075 + trenchBank) * width * 0.08;
    const left = (W - width) * 0.5 + bank;
    return { left, right: left + width, width };
  }

  function seedStars() {
    starsFar.length = 0;
    starsNear.length = 0;
    for (let i = 0; i < 60; i++) {
      starsFar.push({ x: rand(0, W), y: rand(0, H), r: rand(0.8, 1.8), a: rand(0.2, 0.55), s: rand(20, 60) });
    }
    for (let i = 0; i < 28; i++) {
      starsNear.push({ x: rand(0, W), y: rand(0, H), r: rand(1.2, 2.6), a: rand(0.3, 0.7), s: rand(50, 110) });
    }
  }

  function addObstacle(type = 'crate', opts = {}) {
    const lane = corridor();
    const baseY = opts.y ?? -rand(140, 260);
    const o = {
      type,
      x: opts.x ?? rand(lane.left + 36, lane.right - 36),
      y: baseY,
      w: 56,
      h: 56,
      hp: 2,
      special: false,
      turret: false,
      fireCD: rand(1, 1.7),
      hue: rand(180, 250)
    };

    if (type === 'crate') {
      o.w = rand(42, 64);
      o.h = rand(42, 64);
      o.hp = 1.5;
      o.hue = rand(180, 240);
    } else if (type === 'pillar') {
      o.w = rand(90, 130);
      o.h = rand(24, 36);
      o.hp = 2.5;
      o.hue = 210;
    } else if (type === 'turret') {
      o.w = 54; o.h = 40; o.hp = 3.2; o.turret = true; o.hue = 340;
    } else if (type === 'supply') {
      o.w = 48; o.h = 48; o.hp = 2.6; o.special = true; o.hue = 50; o.type = 'supply';
    }

    obstacles.push(o);
  }

  function spawnSection() {
    section++;
    toast(`Section ${section}`);
    forwardSpeed = clamp(180 + section * 18, 180, 520);

    const themes = [
      { laneHue: 190, wallHue: 220, fog: 'rgba(8, 14, 28, 0.68)' },
      { laneHue: 310, wallHue: 260, fog: 'rgba(12, 6, 18, 0.65)' },
      { laneHue: 120, wallHue: 180, fog: 'rgba(6, 14, 12, 0.64)' }
    ];
    currentTheme = themes[Math.floor(Math.random() * themes.length)];

    // Preload a few obstacles up the lane
    const startY = -rand(240, 480);
    const patterns = ['slalom', 'pair', 'wall', 'spray'];
    const pickPattern = patterns[Math.floor(Math.random() * patterns.length)];
    spawnPattern(pickPattern, startY);

    // One supply crate each section
    addObstacle('supply', { y: startY - rand(360, 520) });
  }

  function spawnPattern(pattern, startY = -220) {
    const lane = corridor();
    const center = (lane.left + lane.right) * 0.5;

    if (pattern === 'wall') {
      addObstacle('pillar', { x: lane.left + 70, y: startY });
      addObstacle('pillar', { x: lane.right - 70, y: startY - 110 });
    } else if (pattern === 'pair') {
      addObstacle('crate', { x: center - 90, y: startY });
      addObstacle('crate', { x: center + 90, y: startY - 70 });
      if (section >= 2) addObstacle('turret', { x: center + rand(-30, 30), y: startY - 180 });
    } else if (pattern === 'slalom') {
      addObstacle('crate', { x: lane.left + 80, y: startY });
      addObstacle('crate', { x: lane.right - 80, y: startY - 90 });
      addObstacle('crate', { x: lane.left + 110, y: startY - 180 });
    } else if (pattern === 'spray') {
      for (let i = 0; i < 4; i++) {
        addObstacle(Math.random() > 0.6 ? 'crate' : 'pillar', { y: startY - i * 80 });
      }
    }
  }

  function burst(x, y, baseHue = rand(160, 310), amount = 36, power = 1) {
    for (let i = 0; i < amount; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 240) * power;
      const v = vecFromAng(a);
      particles.push({
        x, y,
        vx: v.x * s,
        vy: v.y * s,
        life: rand(0.35, 0.95),
        t: 0,
        hue: (baseHue + rand(-18, 18) + i) % 360,
        r: rand(1.4, 3.4) * (power * 0.9 + 0.1),
        glow: rand(8, 20)
      });
    }
  }

  function shoot() {
    if (shootCD > 0) return;
    shootCD = 0.13;
    const dir = vecFromAng(ship.a);
    const speed = 620;
    bullets.push({
      x: ship.x + dir.x * 16,
      y: ship.y + dir.y * 16,
      vx: ship.vx + dir.x * speed,
      vy: ship.vy + dir.y * speed - forwardSpeed * 0.45,
      life: 1.1,
      t: 0,
      hue: rand(40, 320)
    });
    ensureAudio();
    beep(880 + rand(-40, 60), 0.04, 'square', 0.05);
  }

  function killShip() {
    lives--;
    $lives.textContent = String(lives);
    ensureAudio();
    beep(120, 0.1, 'sawtooth', 0.08);
    beep(80, 0.16, 'sawtooth', 0.07);
    burst(ship.x, ship.y, rand(0, 360), 80, 1.15);
    resetShip();
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    state = 'over';
    pokiGameplayStop();
    if (score > best) {
      best = score;
      safeStorageSet('neonAsteroidsBest', String(best));
      $best.textContent = String(best);
    }
    $overlay.classList.add('show');
    document.querySelector('.title').textContent = 'GAME OVER';
    document.querySelector('.sub').innerHTML = `Score: <b>${score}</b> • Tap / Press <b>Space</b> to retry`;
    $startBtn.textContent = 'Play Again';
  }

  function startGame() {
    $overlay.classList.remove('show');
    document.querySelector('.title').textContent = 'NEON TRENCH RUN';
    document.querySelector('.sub').innerHTML = 'Tap / Press <b>Space</b> to start';
    $startBtn.textContent = 'Start';

    state = 'game';
    score = 0;
    lives = 3;
    section = 0;
    distance = 0;
    spawnAcc = 0;
    panelOffset = 0;
    trenchPulse = 0;
    trenchBank = 0;
    $score.textContent = '0';
    $lives.textContent = '3';

    bullets.length = 0;
    obstacles.length = 0;
    particles.length = 0;
    enemyBullets.length = 0;

    resetShip();
    spawnSection();

    ensureAudio();
    pokiGameplayStart();
  }

  $startBtn.addEventListener('click', () => startGame(), { passive: true });

  // ---------------- Collision helpers ----------------
  function circleRectHit(px, py, pr, rx, ry, rw, rh) {
    const cx = clamp(px, rx - rw * 0.5, rx + rw * 0.5);
    const cy = clamp(py, ry - rh * 0.5, ry + rh * 0.5);
    return hypot(px - cx, py - cy) < pr + 4;
  }

  // ---------------- Main loop ----------------
  function step() {
    const t = now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = clamp(dt, 0, 0.033);

    update(dt);
    render();

    requestAnimationFrame(step);
  }

  function update(dt) {
    if (state !== 'game') return;

    if (shootCD > 0) shootCD -= dt;
    if (ship.invuln > 0) ship.invuln -= dt;

    for (const s of starsFar) {
      s.y += (s.s + forwardSpeed * 0.12) * dt;
      if (s.y > H + 6) { s.y = -6; s.x = rand(0, W); }
    }
    for (const s of starsNear) {
      s.y += (s.s + forwardSpeed * 0.2) * dt;
      if (s.y > H + 6) { s.y = -6; s.x = rand(0, W); }
    }

    // Inputs
    const left  = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up    = keys.has('ArrowUp') || keys.has('KeyW');

    // Pointer steering: left half = rotate, right half = thrust
    const isCoarse = matchMedia('(pointer: coarse)').matches;
    const ww = window.innerWidth, wh = window.innerHeight;
    const inBounds = pointerDown;

    let pLeft = false, pRight = false, pThrust = false;
    if (isCoarse && inBounds) {
      if (pointerX < ww * 0.5) {
        if (pointerY < wh * 0.5) pLeft = true; else pRight = true;
      } else {
        pThrust = true;
      }
    }

    const turn = (left || pLeft ? -1 : 0) + (right || pRight ? 1 : 0);
    ship.a += turn * 3.4 * dt;

    const thrusting = up || pThrust;
    if (thrusting) {
      const d = vecFromAng(ship.a);
      ship.vx += d.x * 240 * dt;
      ship.vy += d.y * 240 * dt;
      if (Math.random() < 0.65) {
        const back = vecFromAng(ship.a + Math.PI);
        particles.push({
          x: ship.x + back.x * 12,
          y: ship.y + back.y * 12,
          vx: ship.vx + back.x * rand(60, 180) + rand(-24, 24),
          vy: ship.vy + back.y * rand(60, 180) + rand(-24, 24),
          life: rand(0.15, 0.35),
          t: 0,
          hue: rand(30, 70),
          r: rand(1.0, 2.2),
          glow: rand(10, 18)
        });
      }
    }

    // Forward drift down the trench
    ship.vy -= forwardSpeed * 0.05 * dt;

    // Friction
    ship.vx *= Math.pow(0.996, dt * 60);
    ship.vy *= Math.pow(0.996, dt * 60);

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    const lane = corridor();
    const margin = 24;
    ship.x = clamp(ship.x, lane.left + margin, lane.right - margin);
    ship.y = clamp(ship.y, H * 0.5, H - 32);

    distance += forwardSpeed * dt;
    spawnAcc += forwardSpeed * dt;

    const gap = clamp(220 - section * 10, 110, 220);
    while (spawnAcc > gap) {
      spawnAcc -= gap;
      const choice = Math.random();
      if (choice > 0.78) spawnPattern('wall', -rand(180, 260));
      else if (choice > 0.6) spawnPattern('pair', -rand(160, 240));
      else if (choice > 0.35) addObstacle('pillar');
      else addObstacle('crate');
    }

    const sectionDistance = 1400 + section * 240;
    if (distance > section * sectionDistance + sectionDistance) {
      spawnSection();
    }

    panelOffset = (panelOffset + forwardSpeed * dt) % 220;
    trenchPulse += dt * 0.7;
    trenchBank = clamp(trenchBank + (ship.vx * 0.0004), -1.4, 1.4);

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt - forwardSpeed * dt * 0.25;
      if (b.life <= 0 || b.y < -80 || b.y > H + 120) bullets.splice(i, 1);
    }

    // Enemy bullets (turrets)
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.t += dt;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt + forwardSpeed * dt * 0.35;
      if (b.life <= 0 || b.y > H + 120) enemyBullets.splice(i, 1);
    }

    // Obstacles scrolling down the trench
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.y += (forwardSpeed + 40) * dt;

      if (o.turret) {
        o.fireCD -= dt;
        if (o.fireCD <= 0 && o.y > 40 && o.y < H * 0.9) {
          o.fireCD = rand(1.2, 1.8);
          const ang = Math.atan2(ship.y - o.y, ship.x - o.x);
          const dir = vecFromAng(ang);
          enemyBullets.push({
            x: o.x,
            y: o.y,
            vx: dir.x * 220,
            vy: dir.y * 220 + 80,
            life: 2,
            t: 0,
            hue: 350
          });
          ensureAudio();
          beep(220 + rand(-20, 20), 0.05, 'sawtooth', 0.04);
        }
      }

      if (o.y - o.h * 0.5 > H + 80) {
        obstacles.splice(i, 1);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt + forwardSpeed * dt * 0.12;
      p.vx *= Math.pow(0.985, dt * 60);
      p.vy *= Math.pow(0.985, dt * 60);
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Collisions: bullets vs obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      let hit = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (circleRectHit(b.x, b.y, 6, o.x, o.y, o.w, o.h)) {
          bullets.splice(j, 1);
          hit = true;
          break;
        }
      }
      if (hit) {
        o.hp -= 1;
        burst(o.x, o.y, o.hue, 14, 0.8);
        if (o.hp <= 0) {
          obstacles.splice(i, 1);
          const pts = o.turret ? 120 : o.special ? 50 : 80;
          score += pts;
          $score.textContent = String(score);
          ensureAudio();
          beep(320 + rand(-40, 40), 0.05, 'triangle', 0.06);
          if (o.special) {
            lives = Math.min(MAX_LIVES, lives + 1);
            $lives.textContent = String(lives);
            toast('Extra life!');
            beep(520, 0.08, 'sine', 0.06);
            beep(640, 0.1, 'triangle', 0.06);
          }
        }
      }
    }

    // Collisions: ship vs obstacles
    if (ship.invuln <= 0) {
      for (const o of obstacles) {
        if (circleRectHit(ship.x, ship.y, ship.r, o.x, o.y, o.w, o.h)) {
          ship.invuln = 1.2;
          killShip();
          break;
        }
      }

      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (hypot(b.x - ship.x, b.y - ship.y) < ship.r + 6) {
          enemyBullets.splice(i, 1);
          ship.invuln = 1.2;
          killShip();
          break;
        }
      }
    }

    // Drip score over distance
    score += Math.floor(forwardSpeed * dt * 0.5);
    $score.textContent = String(score);
  }

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(8, 10, 20, 0.95)');
    grad.addColorStop(1, currentTheme.fog);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    for (const star of starsFar) {
      ctx.fillStyle = `rgba(180, 200, 255, ${star.a})`;
      ctx.fillRect(star.x, star.y, star.r, star.r);
    }
    for (const star of starsNear) {
      ctx.fillStyle = `rgba(120, 200, 255, ${star.a})`;
      ctx.fillRect(star.x, star.y, star.r, star.r);
    }

    // Trench rails and floor
    const lane = corridor();
    ctx.save();
    const railGrad = ctx.createLinearGradient(0, 0, 0, H);
    railGrad.addColorStop(0, `hsla(${currentTheme.laneHue}, 80%, 70%, 0.65)`);
    railGrad.addColorStop(1, `hsla(${currentTheme.wallHue}, 80%, 60%, 0.4)`);
    ctx.strokeStyle = railGrad;
    ctx.lineWidth = 3;
    ctx.shadowColor = `hsla(${currentTheme.laneHue}, 100%, 70%, 0.6)`;
    ctx.shadowBlur = 22;

    ctx.beginPath();
    ctx.moveTo(lane.left, 0);
    ctx.lineTo(lane.left, H);
    ctx.moveTo(lane.right, 0);
    ctx.lineTo(lane.right, H);
    ctx.stroke();

    ctx.shadowBlur = 0;
    const panelGap = 120;
    for (let y = -panelOffset; y < H + panelGap; y += panelGap) {
      const t = (y + panelOffset) / H + 0.2;
      const brightness = clamp(0.4 + Math.sin(t * Math.PI * 2 + trenchPulse) * 0.2, 0.2, 0.9);
      ctx.fillStyle = `hsla(${currentTheme.wallHue}, 80%, ${brightness * 50}%, 0.16)`;
      ctx.fillRect(lane.left + 6, y, lane.width - 12, panelGap * 0.7);
    }

    ctx.restore();

    // Particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / 1, 0, 1);
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, 0.85)`;
      ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, 0.6)`;
      ctx.shadowBlur = p.glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Obstacles
    for (const o of obstacles) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.shadowBlur = 16;
      ctx.shadowColor = o.special ? 'rgba(255, 200, 120, 0.6)' : `hsla(${o.hue}, 80%, 70%, 0.5)`;
      ctx.strokeStyle = o.special ? 'rgba(255, 220, 150, 0.9)' : `hsla(${o.hue}, 80%, 75%, 0.9)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.rect(-o.w * 0.5, -o.h * 0.5, o.w, o.h);
      ctx.stroke();

      if (o.turret) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 140, 160, 0.4)';
        ctx.fillRect(-12, -o.h * 0.5, 24, o.h);
      } else if (o.special) {
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(255, 210, 140, 0.25)';
        ctx.fill();
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = `hsla(${o.hue}, 70%, 50%, 0.18)`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Enemy bullets
    for (const b of enemyBullets) {
      ctx.save();
      ctx.globalAlpha = clamp(b.life / 2, 0, 1);
      ctx.strokeStyle = 'rgba(255, 160, 160, 0.9)';
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 18;
      ctx.shadowColor = 'rgba(255, 120, 140, 0.6)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
      ctx.restore();
    }

    // Bullets
    for (const b of bullets) {
      ctx.save();
      ctx.globalAlpha = clamp(b.life / 1.1, 0, 1);
      ctx.strokeStyle = `hsla(${b.hue}, 100%, 70%, 0.9)`;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 16;
      ctx.shadowColor = `hsla(${b.hue}, 100%, 60%, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
      ctx.stroke();
      ctx.restore();
    }

    // Ship
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.a);

    const blink = ship.invuln > 0 ? (Math.sin(now() * 0.02) > 0 ? 0.35 : 1) : 1;
    ctx.globalAlpha = blink;

    ctx.shadowBlur = 22;
    ctx.shadowColor = 'rgba(72, 255, 222, 0.35)';
    ctx.strokeStyle = 'rgba(235, 255, 252, 0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 9);
    ctx.closePath();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(144, 92, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-6, 0);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  // ---------------- Boot ----------------
  function bootGame() {
    pokiLoadingFinished();
    state = 'menu';
    $overlay.classList.add('show');
    setTimeout(() => { try { canvas.focus(); } catch {} }, 50);
  }

  pokiInitThen(bootGame);
  window.addEventListener('pointerdown', () => ensureAudio(), { passive: true });
  window.addEventListener('keydown', () => ensureAudio(), { passive: true });

  requestAnimationFrame(step);
})();
