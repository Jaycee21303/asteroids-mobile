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

    // Keep a 16:9 logical space but scale to fit screen
    const targetAR = 16 / 9;
    let logicalW = ww;
    let logicalH = wh;
    if (logicalW / logicalH > targetAR) logicalW = logicalH * targetAR;
    else logicalH = logicalW / targetAR;

    W = Math.round(logicalW);
    H = Math.round(logicalH);

    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width  = ww + 'px';
    canvas.style.height = wh + 'px';

    ctx.setTransform(DPR, 0, 0, DPR, (ww - W) / 2, (wh - H) / 2);
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

  // Ensure keyboard works in iframe
  canvas.tabIndex = 0;

  // ---------------- Sound (tiny synth, no external files) ----------------
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
  function wrap(p) {
    if (p.x < 0) p.x += W;
    if (p.x > W) p.x -= W;
    if (p.y < 0) p.y += H;
    if (p.y > H) p.y -= H;
  }

  function vecFromAng(a) { return { x: Math.cos(a), y: Math.sin(a) }; }

  const ship = {
    x: W * 0.5, y: H * 0.5,
    vx: 0, vy: 0,
    a: -Math.PI / 2,
    r: 12,
    invuln: 0
  };

  const bullets = [];
  const asteroids = [];
  const particles = [];

  let score = 0;
  let lives = 3;
  let best = parseInt(safeStorageGet('neonAsteroidsBest', '0'), 10) || 0;
  $best.textContent = String(best);

  // State
  let state = 'menu'; // menu | game | over
  let paused = false;
  let lastT = now();
  let shootCD = 0;
  let wave = 0;

  function toast(msg) {
    $toast.textContent = msg;
    $toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => ($toast.style.opacity = '0'), 1200);
  }

  function resetShip() {
    ship.x = W * 0.5; ship.y = H * 0.5;
    ship.vx = 0; ship.vy = 0;
    ship.a = -Math.PI / 2;
    ship.invuln = 1.2;
  }

  function spawnAsteroid(size = 3, x = null, y = null) {
    const radius = size === 3 ? rand(38, 56) : size === 2 ? rand(24, 36) : rand(14, 22);
    let ax = x ?? rand(0, W);
    let ay = y ?? rand(0, H);

    // Avoid spawning right on the ship
    if (hypot(ax - ship.x, ay - ship.y) < 140) {
      ax = (ax + W * 0.5) % W;
      ay = (ay + H * 0.5) % H;
    }

    const speed = rand(35, 85) / (size * 0.9);
    const ang = rand(0, TAU);
    const v = vecFromAng(ang);

    // Jagged polygon shape
    const verts = [];
    const n = Math.floor(rand(9, 14));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const wobble = rand(0.68, 1.12);
      verts.push({ x: Math.cos(t) * radius * wobble, y: Math.sin(t) * radius * wobble });
    }

    asteroids.push({
      x: ax, y: ay,
      vx: v.x * speed,
      vy: v.y * speed,
      r: radius,
      size,
      verts,
      spin: rand(-1.4, 1.4),
      rot: rand(0, TAU)
    });
  }

  function spawnWave() {
    wave++;
    const count = 2 + Math.min(6, wave);
    for (let i = 0; i < count; i++) spawnAsteroid(3);
    toast(`Wave ${wave}`);
  }

  function burst(x, y, baseHue = rand(160, 310), amount = 42, power = 1) {
    for (let i = 0; i < amount; i++) {
      const a = rand(0, TAU);
      const s = rand(30, 220) * power;
      const v = vecFromAng(a);
      particles.push({
        x, y,
        vx: v.x * s,
        vy: v.y * s,
        life: rand(0.35, 0.95),
        t: 0,
        hue: (baseHue + rand(-24, 24) + i) % 360,
        r: rand(1.2, 3.5) * (power * 0.9 + 0.1),
        glow: rand(8, 20)
      });
    }
  }

  function shoot() {
    if (shootCD > 0) return;
    shootCD = 0.12;
    const dir = vecFromAng(ship.a);
    const speed = 520;
    bullets.push({
      x: ship.x + dir.x * 16,
      y: ship.y + dir.y * 16,
      vx: ship.vx + dir.x * speed,
      vy: ship.vy + dir.y * speed,
      life: 0.95,
      t: 0,
      hue: rand(40, 320)
    });
    ensureAudio();
    beep(880 + rand(-40, 60), 0.04, 'square', 0.05);
  }

  function splitAsteroid(a) {
    const baseHue = rand(170, 310);
    burst(a.x, a.y, baseHue, 36, 1);
    if (a.size > 1) {
      const n = a.size === 3 ? 2 : 2;
      for (let i = 0; i < n; i++) spawnAsteroid(a.size - 1, a.x + rand(-8, 8), a.y + rand(-8, 8));
    }
  }

  function killShip() {
    lives--;
    $lives.textContent = String(lives);
    ensureAudio();
    beep(120, 0.1, 'sawtooth', 0.08);
    beep(80, 0.16, 'sawtooth', 0.07);
    burst(ship.x, ship.y, rand(0, 360), 80, 1.25);
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
    // Hide overlay and start new run
    $overlay.classList.remove('show');
    document.querySelector('.title').textContent = 'NEON ASTEROIDS';
    document.querySelector('.sub').innerHTML = 'Tap / Press <b>Space</b> to start';
    $startBtn.textContent = 'Start';

    // reset state
    state = 'game';
    score = 0;
    lives = 3;
    wave = 0;
    $score.textContent = '0';
    $lives.textContent = '3';

    bullets.length = 0;
    asteroids.length = 0;
    particles.length = 0;

    resetShip();
    spawnWave();

    ensureAudio();
    pokiGameplayStart();
  }

  $startBtn.addEventListener('click', () => startGame(), { passive: true });

  // ---------------- Main loop ----------------
  function step() {
    const t = now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = clamp(dt, 0, 0.033); // cap dt to avoid huge jumps

    update(dt);
    render();

    requestAnimationFrame(step);
  }

  function update(dt) {
    if (state !== 'game') return;

    // cooldowns
    if (shootCD > 0) shootCD -= dt;
    if (ship.invuln > 0) ship.invuln -= dt;

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
        // steer based on vertical position
        if (pointerY < wh * 0.5) pLeft = true;
        else pRight = true;
      } else {
        pThrust = true;
      }
    }

    const turn = (left || pLeft ? -1 : 0) + (right || pRight ? 1 : 0);
    ship.a += turn * 3.4 * dt;

    // Thrust
    const thrusting = up || pThrust;
    if (thrusting) {
      const d = vecFromAng(ship.a);
      ship.vx += d.x * 240 * dt;
      ship.vy += d.y * 240 * dt;
      // small thrust particles
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

    // Friction
    ship.vx *= Math.pow(0.996, dt * 60);
    ship.vy *= Math.pow(0.996, dt * 60);

    // Move ship
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrap(ship);

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b);
      if (b.life <= 0) bullets.splice(i, 1);
    }

    // Asteroids
    for (const a of asteroids) {
      a.rot += a.spin * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      wrap(a);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.985, dt * 60);
      p.vy *= Math.pow(0.985, dt * 60);
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Collisions: bullets vs asteroids
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      // bullet hits
      let hit = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const d = hypot(a.x - b.x, a.y - b.y);
        if (d < a.r) {
          bullets.splice(j, 1);
          hit = true;
          break;
        }
      }
      if (hit) {
        asteroids.splice(i, 1);
        splitAsteroid(a);
        const pts = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
        score += pts;
        $score.textContent = String(score);
        ensureAudio();
        beep(320 + pts * 2 + rand(-40, 40), 0.05, 'triangle', 0.06);
      }
    }

    // Collisions: ship vs asteroids
    if (ship.invuln <= 0) {
      for (const a of asteroids) {
        const d = hypot(a.x - ship.x, a.y - ship.y);
        if (d < a.r + ship.r * 0.65) {
          ship.invuln = 1.2;
          killShip();
          break;
        }
      }
    }

    // Next wave
    if (asteroids.length === 0) {
      spawnWave();
      // Natural break: show ad when new wave starts (poki recommendation)
      // Don't block gameplay; schedule a break
      (async () => {
        pokiGameplayStop();
        await pokiCommercialBreak();
        pokiGameplayStart();
      })();
    }
  }

  // ---------------- Rendering ----------------
  function clear() {
    // Fill background
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, (window.innerWidth - W) / 2, (window.innerHeight - H) / 2);
    ctx.fillStyle = '#070916';
    ctx.fillRect(0, 0, W, H);

    // Stars
    const t = now() * 0.00008;
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.2 + t * 210) % W;
      const y = (i * 53.7 + t * 140) % H;
      const s = (i % 3) + 1;
      ctx.globalAlpha = 0.22 + (i % 7) * 0.02;
      ctx.fillStyle = i % 2 ? '#b6c7ff' : '#8fffe8';
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGlowCircle(x, y, r, hue, alpha = 1, glow = 18) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = glow;
    ctx.shadowColor = `hsla(${hue}, 100%, 70%, 0.85)`;
    ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.95)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    clear();

    // confine drawing to logical game rect centered in screen
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, (window.innerWidth - W) / 2, (window.innerHeight - H) / 2);

    // particles
    for (const p of particles) {
      const a = clamp(p.life, 0, 1);
      drawGlowCircle(p.x, p.y, p.r, p.hue, a, p.glow);
    }

    // bullets
    for (const b of bullets) {
      drawGlowCircle(b.x, b.y, 2.6, b.hue, 1, 16);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = `hsla(${b.hue}, 100%, 75%, 0.6)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
      ctx.stroke();
      ctx.restore();
    }

    // asteroids
    for (const a of asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);

      // glow outline
      ctx.shadowBlur = 18;
      ctx.shadowColor = 'rgba(120, 195, 255, 0.25)';
      ctx.strokeStyle = 'rgba(210, 235, 255, 0.65)';
      ctx.lineWidth = 2;

      ctx.beginPath();
      const v0 = a.verts[0];
      ctx.moveTo(v0.x, v0.y);
      for (let i = 1; i < a.verts.length; i++) {
        const v = a.verts[i];
        ctx.lineTo(v.x, v.y);
      }
      ctx.closePath();
      ctx.stroke();

      // subtle fill
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(100, 120, 160, 0.12)';
      ctx.fill();

      ctx.restore();
    }

    // ship
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.a);

    const blink = ship.invuln > 0 ? (Math.sin(now() * 0.02) > 0 ? 0.35 : 1) : 1;
    ctx.globalAlpha = blink;

    // ship glow
    ctx.shadowBlur = 22;
    ctx.shadowColor = 'rgba(72, 255, 222, 0.35)';

    // hull
    ctx.strokeStyle = 'rgba(235, 255, 252, 0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 9);
    ctx.closePath();
    ctx.stroke();

    // cockpit accent
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
    // tell Poki when the loading is finished; our assets are procedural so it's instant.
    pokiLoadingFinished();

    // show overlay (menu)
    state = 'menu';
    $overlay.classList.add('show');

    // focus for keyboard in iframe
    setTimeout(() => { try { canvas.focus(); } catch {} }, 50);
  }

  // Start poki init then boot
  pokiInitThen(bootGame);

  // Safety: if user interacts before init completes, allow start
  window.addEventListener('pointerdown', () => ensureAudio(), { passive: true });
  window.addEventListener('keydown', () => ensureAudio(), { passive: true });

  requestAnimationFrame(step);
})();