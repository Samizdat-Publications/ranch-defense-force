// Ranch Defense Force landing page: clips play while on screen, and the page darkens from first light to full dark
// as you scroll (the game's own premise: the light is the clock). The page works without this script except the motion.
(function () {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection;
  // Only real data saver or a very slow link skips autoplay (a "3g" label is common on fine connections).
  const saveData = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

  const play = (v) => {
    if (saveData || reduced) {
      v.controls = true;
      return;
    }
    if (v.preload === 'none') v.preload = 'auto';
    v.play().catch(() => (v.controls = true));
  };

  // hero loop: stop it on reduced motion or data saver, show controls instead
  const hero = document.getElementById('hero-video');
  if (hero && (saveData || reduced)) {
    hero.removeAttribute('autoplay');
    hero.pause();
    hero.controls = true;
  }

  // clips that play while they are on screen
  const inview = [...document.querySelectorAll('video[data-inview]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting) play(e.target);
          else e.target.pause();
        }
      },
      { threshold: 0.4 },
    );
    inview.forEach((v) => io.observe(v));
    if (hero && !saveData && !reduced) io.observe(hero);
  } else {
    inview.forEach((v) => (v.controls = true));
  }

  // The day: 6:30 AM at the top of the page to 10:00 PM at the bottom. The page colour follows the game's own light.
  const STOPS = [
    [0.0, [43, 41, 46]],   // first light: cool, grey-lilac
    [0.3, [52, 58, 38]],   // high sun over the wheat
    [0.65, [64, 42, 22]],  // golden hour into red
    [1.0, [10, 12, 20]],   // full dark
  ];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const colourAt = (p) => {
    for (let i = 1; i < STOPS.length; i++) {
      if (p <= STOPS[i][0]) {
        const [p0, c0] = STOPS[i - 1];
        const [p1, c1] = STOPS[i];
        return mix(c0, c1, (p - p0) / (p1 - p0));
      }
    }
    return STOPS[STOPS.length - 1][1];
  };
  const dot = document.getElementById('clock-dot');
  const label = document.getElementById('clock-value');
  const root = document.documentElement;
  const START_MIN = 6 * 60 + 30;
  const END_MIN = 22 * 60;
  let ticking = false;
  const tick = () => {
    ticking = false;
    const h = root.scrollHeight - window.innerHeight;
    const p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
    const [r, g, b] = colourAt(p);
    root.style.setProperty('--sky', `rgb(${r}, ${g}, ${b})`);
    if (dot) dot.style.top = `${p * 100}%`;
    if (label) {
      const m = Math.round(START_MIN + p * (END_MIN - START_MIN));
      const hh = Math.floor(m / 60);
      const mm = String(m % 60).padStart(2, '0');
      label.textContent = `${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? 'AM' : 'PM'}`;
    }
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(tick);
    }
  }, { passive: true });
  window.addEventListener('resize', tick);
  tick();
})();
