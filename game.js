(() => {
  'use strict';

  // ---------- Helpers ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrap = (p, w, h) => {
    if (p.x < 0) p.x += w; else if (p.x >= w) p.x -= w;
    if (p.y < 0) p.y += h; else if (p.y >= h) p.y -= h;
  };
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx*dx + dy*dy;
  };
  const hsla = (h, s, l, a=1) => `hsla(${h},${s}%,${l}%,${a})`;

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ---------- UI ----------
  const elScore = document.getElementById('score');
  const elLives = document.getElementById('lives');
  const msg = document.getElementById('centerMessage');
  const msgTitle = document.getElementById('msgTitle');
  const msgSub = document.getElementById('msgSub');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');

  function showMessage(title, sub) {
    msgTitle.textContent = title;
    msgSub.textContent = sub;
    msg.hidden = false;
    msg.style.display = 'flex';
  }
  function hideMessage() {
    msg.hidden = true;
    msg.style.display = 'none';
  }

  // ---------- Input ----------
  const input = {
    left: false, right: false, thrust: false, shoot: false,
    shootPressed: false, // edge
  };

  function startIfNeeded() {
    if (paused) return;
    if (state.gameOver) { restart(); return; }
    if (!running) {
      hideMessage();
      running = true;
      input.shootPressed = false;
    }
  }

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = true;
    if (k === 'arrowright' || k === 'd') input.right = true;
    if (k === 'arrowup' || k === 'w') input.thrust = true;

    if (k === ' ' || k === 'enter') {
      if (!input.shoot) input.shootPressed = true;
      input.shoot = true;
      startIfNeeded(); // <-- ensure banner disappears if you start via keyboard
    }

    if (k === 'p') togglePause();
    if (k === 'r') restart();

    if (['arrowleft','arrowright','arrowup',' '].includes(e.key.toLowerCase())) e.preventDefault();
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = false;
    if (k === 'arrowright' || k === 'd') input.right = false;
    if (k === 'arrowup' || k === 'w') input.thrust = false;
    if (k === ' ' || k === 'enter') input.shoot = false;
  }, { passive: true });

  // Touch buttons (pointer events)
  function bindHold(btn, field, edge=false) {
    const down = (e) => {
      e.preventDefault();
      if (edge) { if (!input[field]) input.shootPressed = true; }
      input[field] = true;
      startIfNeeded();
      btn.setPointerCapture?.(e.pointerId);
    };
    const up = (e) => {
      e.preventDefault();
      input[field] = false;
      try { btn.releasePointerCapture?.(e.pointerId); } catch {}
    };
    btn.addEventListener('pointerdown', down, { passive: false });
    btn.addEventListener('pointerup', up, { passive: false });
    btn.addEventListener('pointercancel', up, { passive: false });
    btn.addEventListener('pointerleave', up, { passive: false });
  }

  bindHold(document.getElementById('btnLeft'), 'left');
  bindHold(document.getElementById('btnRight'), 'right');
  bindHold(document.getElementById('btnThrust'), 'thrust');
  bindHold(document.getElementById('btnShoot'), 'shoot', true);

  // Tap canvas / message to start
  canvas.addEventListener('pointerdown', () => startIfNeeded(), { passive: true });
  msg.addEventListener('pointerdown', () => startIfNeeded(), { passive: true });

  pauseBtn.addEventListener('click', () => togglePause());
  restartBtn.addEventListener('click', () => restart());

  // ---------- Game State ----------
  let running = false;
  let paused = false;

  const state = {
    score: 0,
    lives: 3,
    level: 1,
    gameOver: false,
  };

  const ship = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    angle: -Math.PI / 2,
    radius: 14,
    invincible: 0,
    cooldown: 0,
  };

  const bullets = [];
  const asteroids = [];
  const particles = [];

  function resetShip() {
    ship.x = W * 0.5;
    ship.y = H * 0.5;
    ship.vx = 0;
    ship.vy = 0;
    ship.angle = -Math.PI / 2;
    ship.invincible = 2.0; // seconds
    ship.cooldown = 0;
  }

  function makeAsteroid(x, y, size) {
    const base = size === 3 ? 60 : size === 2 ? 38 : 22;
    const radius = base * rand(0.85, 1.1);
    const speed = rand(35, 70) + (state.level - 1) * 6;
    const a = rand(0, TAU);
    const vx = Math.cos(a) * speed;
    const vy = Math.sin(a) * speed;

    // More "HD" rock silhouette
    const verts = [];
    const n = Math.floor(rand(11, 18));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      // less jagged, slightly smoother than before
      const r = radius * rand(0.78, 1.10);
      verts.push({ t, r });
    }

    // Give each asteroid a tint + rotation for more life
    const hue = Math.floor(rand(180, 320));
    return {
      x, y, vx, vy,
      radius, size, verts,
      rot: rand(0, TAU),
      rv: rand(-0.9, 0.9) * (size === 3 ? 0.25 : size === 2 ? 0.4 : 0.55),
      hue
    };
  }

  function spawnLevel() {
    asteroids.length = 0;
    bullets.length = 0;
    particles.length = 0;
    resetShip();

    const count = clamp(3 + state.level, 4, 10);
    for (let i = 0; i < count; i++) {
      // Spawn away from center
      let x, y;
      for (let tries = 0; tries < 50; tries++) {
        x = rand(0, W);
        y = rand(0, H);
        if (dist2(x, y, W * 0.5, H * 0.5) > (220 * 220)) break;
      }
      asteroids.push(makeAsteroid(x, y, 3));
    }
  }

  function addParticles(x, y, count, speed, life, colorOrFn) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.35, speed);
      const col = (typeof colorOrFn === 'function') ? colorOrFn(i) : colorOrFn;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(life * 0.5, life),
        max: life,
        color: col
      });
    }
  }

  function shoot() {
    if (ship.cooldown > 0) return;
    ship.cooldown = 0.16; // a touch snappier

    const speed = 460;
    const bx = ship.x + Math.cos(ship.angle) * (ship.radius + 4);
    const by = ship.y + Math.sin(ship.angle) * (ship.radius + 4);

    // Colorful neon bullets
    const hue = Math.floor(rand(175, 215)); // cyan family
    bullets.push({
      x: bx, y: by,
      px: bx, py: by,
      vx: ship.vx + Math.cos(ship.angle) * speed,
      vy: ship.vy + Math.sin(ship.angle) * speed,
      life: 1.1,
      hue
    });
  }

  function loseLife() {
    state.lives -= 1;
    elLives.textContent = String(state.lives);

    // Colorful ship explosion
    const baseHue = Math.floor(rand(330, 360));
    addParticles(ship.x, ship.y, 36, 260, 0.8, (i) => hsla(baseHue + rand(-25, 25), 95, 65, 1));

    if (state.lives <= 0) {
      state.gameOver = true;
      running = false;
      showMessage('GAME OVER', `Score: ${state.score} — Tap to restart`);
    } else {
      resetShip();
    }
  }

  function nextLevel() {
    state.level += 1;
    spawnLevel();
    showMessage(`LEVEL ${state.level}`, 'Tap to continue');
    running = false;
  }

  function restart() {
    state.score = 0;
    state.lives = 3;
    state.level = 1;
    state.gameOver = false;
    elScore.textContent = '0';
    elLives.textContent = '3';
    spawnLevel();
    showMessage('ASTEROIDS', 'Tap to start');
    running = false;
    paused = false;
    pauseBtn.textContent = 'Pause';
  }

  function togglePause() {
    if (state.gameOver) return;
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    if (paused) {
      showMessage('PAUSED', 'Tap Resume or press P');
      running = false;
    } else {
      hideMessage();
      running = true;
    }
  }

  // ---------- Update & Draw ----------
  function update(dt) {
    // Ship rotation + thrust
    const rotSpeed = 3.8; // rad/s
    if (input.left) ship.angle -= rotSpeed * dt;
    if (input.right) ship.angle += rotSpeed * dt;

    // Thrust
    if (input.thrust) {
      const accel = 230;
      ship.vx += Math.cos(ship.angle) * accel * dt;
      ship.vy += Math.sin(ship.angle) * accel * dt;

      // subtle cyan exhaust sparks
      addParticles(
        ship.x - Math.cos(ship.angle) * ship.radius,
        ship.y - Math.sin(ship.angle) * ship.radius,
        1, 75, 0.25, () => hsla(195 + rand(-10, 10), 95, 65, 1)
      );
    }

    // Space drag
    const drag = Math.pow(0.985, dt * 60);
    ship.vx *= drag;
    ship.vy *= drag;

    // Cap speed
    const maxSpeed = 440;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > maxSpeed) {
      ship.vx = (ship.vx / sp) * maxSpeed;
      ship.vy = (ship.vy / sp) * maxSpeed;
    }

    // Move ship
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrap(ship, W, H);

    if (ship.invincible > 0) ship.invincible -= dt;
    if (ship.cooldown > 0) ship.cooldown -= dt;

    // Shooting (edge triggered)
    if (input.shootPressed) {
      shoot();
      input.shootPressed = false;
    }

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b, W, H);
      b.life -= dt;

      // faint bullet trail
      addParticles(b.x, b.y, 1, 45, 0.20, () => hsla(b.hue + rand(-8, 8), 95, 70, 1));

      if (b.life <= 0) bullets.splice(i, 1);
    }

    // Asteroids
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.rv * dt;
      wrap(a, W, H);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      wrap(p, W, H);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Collisions: bullets vs asteroids
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      let hit = false;
      for (let ai = asteroids.length - 1; ai >= 0; ai--) {
        const a = asteroids[ai];
        const r = a.radius;
        if (dist2(b.x, b.y, a.x, a.y) <= r * r) {
          hit = true;
          bullets.splice(bi, 1);
          asteroids.splice(ai, 1);

          // Score
          const add = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
          state.score += add;
          elScore.textContent = String(state.score);

          // Colorful explosion (more vibrant)
          const baseHue = a.hue;
          addParticles(a.x, a.y, 26, 310, 0.65, (i) => hsla(baseHue + rand(-35, 35), 95, 62, 1));
          addParticles(a.x, a.y, 10, 220, 0.55, 'rgba(255,255,255,1)');

          // Split
          if (a.size > 1) {
            const n = 2 + (Math.random() < 0.25 ? 1 : 0);
            for (let k = 0; k < n; k++) {
              const na = makeAsteroid(a.x, a.y, a.size - 1);
              na.vx += rand(-80, 80);
              na.vy += rand(-80, 80);
              asteroids.push(na);
            }
          }
          break;
        }
      }
      if (hit) continue;
    }

    // Ship vs asteroids
    if (ship.invincible <= 0) {
      for (const a of asteroids) {
        const r = a.radius + ship.radius * 0.85;
        if (dist2(ship.x, ship.y, a.x, a.y) <= r * r) {
          loseLife();
          break;
        }
      }
    }

    // Level clear
    if (asteroids.length === 0) {
      nextLevel();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Starfield
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const x = (i * 9973) % W;
      const y = (i * 6067) % H;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();

    // Asteroids (slightly more "HD" with glow + subtle fill)
    ctx.save();
    ctx.lineWidth = 2.25;
    for (const a of asteroids) {
      const stroke = 'rgba(232,237,246,0.92)';
      const fill = hsla(a.hue, 55, 45, 0.12);

      ctx.shadowColor = hsla(a.hue, 85, 65, 0.35);
      ctx.shadowBlur = 10;

      ctx.beginPath();
      for (let i = 0; i < a.verts.length; i++) {
        const v = a.verts[i];
        const t = v.t + a.rot;
        const x = a.x + Math.cos(t) * v.r;
        const y = a.y + Math.sin(t) * v.r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = stroke;
      ctx.stroke();

      // inner highlight stroke (makes it pop a bit)
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = hsla(a.hue, 90, 70, 0.45);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Bullets (neon + tiny trail line)
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (const b of bullets) {
      ctx.shadowColor = hsla(b.hue, 95, 70, 0.7);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = hsla(b.hue, 95, 65, 0.95);
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = hsla(b.hue, 95, 70, 0.95);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Particles (colorful explosions)
    ctx.save();
    for (const p of particles) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    ctx.restore();

    // Ship
    ctx.save();
    const blink = ship.invincible > 0 ? (Math.floor(perfNow() * 0.01) % 2 === 0) : true;
    if (blink) {
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.angle);

      // ship body
      ctx.shadowColor = 'rgba(125,211,252,0.20)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(232,237,246,0.95)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ship.radius, 0);
      ctx.lineTo(-ship.radius * 0.85, ship.radius * 0.7);
      ctx.lineTo(-ship.radius * 0.6, 0);
      ctx.lineTo(-ship.radius * 0.85, -ship.radius * 0.7);
      ctx.closePath();
      ctx.stroke();

      // thrust flame
      if (input.thrust) {
        ctx.shadowColor = 'rgba(125,211,252,0.6)';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = hsla(195, 95, 70, 0.95);
        ctx.beginPath();
        ctx.moveTo(-ship.radius * 0.75, 0);
        ctx.lineTo(-ship.radius * 1.25 - rand(0, 9), 0);
        ctx.stroke();
      }
    }
    ctx.restore();

    // subtle center dot
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W / 2 - 1, H / 2 - 1, 2, 2);
    ctx.restore();
  }

  // ---------- Main Loop ----------
  let last = performance.now();
  function perfNow() { return performance.now(); }

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;

    if (running && !paused && !state.gameOver) update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  restart();
  requestAnimationFrame(frame);
})(); 
