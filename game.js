(() => {
  'use strict';

  // ---------- Helpers ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrap = (p, w, h) => {
    if (p.x < 0) p.x += w;
    else if (p.x >= w) p.x -= w;
    if (p.y < 0) p.y += h;
    else if (p.y >= h) p.y -= h;
  };
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx*dx + dy*dy;
  };

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
  }
  function hideMessage() {
    msg.hidden = true;
  }

  // ---------- Input ----------
  const input = {
    left: false, right: false, thrust: false, shoot: false,
    shootPressed: false, // edge
  };

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.left = true;
    if (k === 'arrowright' || k === 'd') input.right = true;
    if (k === 'arrowup' || k === 'w') input.thrust = true;
    if (k === ' ' || k === 'enter') { if (!input.shoot) input.shootPressed = true; input.shoot = true; }
    if (k === 'p') togglePause();
    if (k === 'r') restart();
    // Prevent scroll on arrows/space
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
    const verts = [];
    const n = Math.floor(rand(10, 16));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const r = radius * rand(0.72, 1.12);
      verts.push({ t, r });
    }
    return { x, y, vx, vy, radius, size, verts };
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
        if (dist2(x,y, W*0.5, H*0.5) > (220*220)) break;
      }
      asteroids.push(makeAsteroid(x, y, 3));
    }
  }

  function addParticles(x, y, count, speed, life, color) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.35, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(life*0.5, life),
        max: life,
        color
      });
    }
  }

  function shoot() {
    if (ship.cooldown > 0) return;
    ship.cooldown = 0.18; // seconds
    const speed = 420;
    const bx = ship.x + Math.cos(ship.angle) * (ship.radius + 4);
    const by = ship.y + Math.sin(ship.angle) * (ship.radius + 4);
    bullets.push({
      x: bx, y: by,
      vx: ship.vx + Math.cos(ship.angle) * speed,
      vy: ship.vy + Math.sin(ship.angle) * speed,
      life: 1.1
    });
  }

  function loseLife() {
    state.lives -= 1;
    elLives.textContent = String(state.lives);
    addParticles(ship.x, ship.y, 28, 220, 0.7, 'rgba(251,113,133,1)');
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

  function startIfNeeded() {
    if (paused) return;
    if (state.gameOver) {
      restart();
      return;
    }
    if (!running) {
      hideMessage();
      running = true;
      // prevent stuck edge shoot from message tap
      input.shootPressed = false;
    }
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
      const accel = 220;
      ship.vx += Math.cos(ship.angle) * accel * dt;
      ship.vy += Math.sin(ship.angle) * accel * dt;
      addParticles(
        ship.x - Math.cos(ship.angle) * ship.radius,
        ship.y - Math.sin(ship.angle) * ship.radius,
        1, 70, 0.25, 'rgba(125,211,252,1)'
      );
    }

    // Friction (space drag)
    const drag = Math.pow(0.985, dt * 60);
    ship.vx *= drag;
    ship.vy *= drag;

    // Cap speed
    const maxSpeed = 420;
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
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b, W, H);
      b.life -= dt;
      if (b.life <= 0) bullets.splice(i, 1);
    }

    // Asteroids
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
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
          // Hit!
          hit = true;
          bullets.splice(bi, 1);
          asteroids.splice(ai, 1);

          // score
          const add = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
          state.score += add;
          elScore.textContent = String(state.score);

          addParticles(a.x, a.y, 18, 260, 0.55, 'rgba(232,237,246,1)');

          // split
          if (a.size > 1) {
            const n = 2 + (Math.random() < 0.25 ? 1 : 0);
            for (let k = 0; k < n; k++) {
              const na = makeAsteroid(a.x, a.y, a.size - 1);
              // give slight kick
              na.vx += rand(-70, 70);
              na.vy += rand(-70, 70);
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
    // Clear
    ctx.clearRect(0, 0, W, H);

    // Starfield
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) {
      const x = (i * 9973) % W;
      const y = (i * 6067) % H;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();

    // Asteroids
    ctx.save();
    ctx.strokeStyle = 'rgba(232,237,246,0.85)';
    ctx.lineWidth = 2;
    for (const a of asteroids) {
      ctx.beginPath();
      for (let i = 0; i < a.verts.length; i++) {
        const v = a.verts[i];
        const x = a.x + Math.cos(v.t) * v.r;
        const y = a.y + Math.sin(v.t) * v.r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // Bullets
    ctx.save();
    ctx.fillStyle = 'rgba(125,211,252,0.95)';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Particles
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
      ctx.strokeStyle = 'rgba(232,237,246,0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ship.radius, 0);
      ctx.lineTo(-ship.radius * 0.85, ship.radius * 0.7);
      ctx.lineTo(-ship.radius * 0.6, 0);
      ctx.lineTo(-ship.radius * 0.85, -ship.radius * 0.7);
      ctx.closePath();
      ctx.stroke();

      // thrust flame
      if (input.thrust) {
        ctx.strokeStyle = 'rgba(125,211,252,0.9)';
        ctx.beginPath();
        ctx.moveTo(-ship.radius * 0.75, 0);
        ctx.lineTo(-ship.radius * 1.2 - rand(0, 8), 0);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Crosshair / subtle center dot (helps on phones)
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W/2-1, H/2-1, 2, 2);
    ctx.restore();
  }

  // ---------- Main Loop ----------
  let last = performance.now();

  function perfNow(){ return performance.now(); }

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.033);
    last = now;

    if (running && !paused && !state.gameOver) update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  restart(); // sets up level & message
  requestAnimationFrame(frame);
})(); 
