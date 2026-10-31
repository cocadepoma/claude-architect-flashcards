(() => {
  'use strict';

  const CARDS = Array.isArray(window.CARDS) ? window.CARDS : [];
  const DOMAINS = window.DOMAINS || {};
  const STORAGE_KEY = 'claude-architect-flashcards:v1';
  const SWIPE_MIN_PX = 50;

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'),
    faceFront: $('face-front'),
    faceBack: $('face-back'),
    front: $('front'),
    back: $('back'),
    backScroll: $('back-scroll'),
    counter: $('counter'),
    progress: $('progress'),
    prev: $('prev'),
    next: $('next'),
    flip: $('flip'),
    shuffle: $('shuffle'),
    domainBadges: document.querySelectorAll('[data-domain-badge]'),
  };

  if (CARDS.length === 0) {
    el.front.textContent = 'No cards found.';
    return;
  }

  const identityOrder = () => CARDS.map((_, i) => i);

  function shuffled(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function isValidState(s) {
    const n = CARDS.length;
    return s
      && Array.isArray(s.order)
      && s.order.length === n
      && s.order.every((i) => Number.isInteger(i) && i >= 0 && i < n)
      && new Set(s.order).size === n
      && Number.isInteger(s.pos) && s.pos >= 0 && s.pos < n;
  }

  // Remembering the position is a convenience only: storage may be blocked or empty.
  function loadState() {
    const fallback = { order: identityOrder(), pos: 0, shuffled: false };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return isValidState(saved)
        ? { order: saved.order, pos: saved.pos, shuffled: Boolean(saved.shuffled) }
        : fallback;
    } catch {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore: storage unavailable */
    }
  }

  const state = loadState();
  let flipped = false;

  function setFlipped(value) {
    flipped = value;
    el.card.classList.toggle('flipped', value);
    el.faceFront.setAttribute('aria-hidden', String(value));
    el.faceBack.setAttribute('aria-hidden', String(!value));
    el.card.setAttribute('aria-label', value ? 'Show term' : 'Show definition');
  }

  // Unflip without animation so the next card's definition is never revealed mid-turn.
  function resetToFront() {
    if (!flipped) return;
    el.card.classList.add('instant');
    setFlipped(false);
    void el.card.offsetWidth;
    el.card.classList.remove('instant');
  }

  function playEnter(direction) {
    el.card.classList.remove('in-next', 'in-prev');
    void el.card.offsetWidth;
    el.card.classList.add(direction > 0 ? 'in-next' : 'in-prev');
  }

  function renderDomain(domain) {
    const name = DOMAINS[domain];
    el.domainBadges.forEach((badge) => {
      badge.hidden = !name;
      if (!name) return;
      badge.querySelector('.domain-id').textContent = `D${domain}`;
      badge.querySelector('.domain-name').textContent = `· ${name}`;
      badge.title = `Domain ${domain}: ${name}`;
    });
  }

  function render(direction = 0) {
    const card = CARDS[state.order[state.pos]];
    resetToFront();
    el.front.textContent = card.front;
    el.back.textContent = card.back;
    renderDomain(card.domain);
    el.backScroll.scrollTop = 0;
    el.counter.textContent = `${state.pos + 1} / ${CARDS.length}`;
    el.progress.style.width = `${((state.pos + 1) / CARDS.length) * 100}%`;
    el.shuffle.setAttribute('aria-pressed', String(state.shuffled));
    el.shuffle.textContent = state.shuffled ? 'Shuffled ✓' : 'Shuffle';
    if (direction) playEnter(direction);
    saveState();
  }

  function go(delta) {
    const n = CARDS.length;
    state.pos = (state.pos + delta + n) % n;
    render(delta);
  }

  function toggleShuffle() {
    const current = state.order[state.pos];
    if (state.shuffled) {
      state.order = identityOrder();
      state.pos = current;
      state.shuffled = false;
    } else {
      // Keep the card on screen as the first one of the new random order.
      state.order = [current, ...shuffled(identityOrder().filter((i) => i !== current))];
      state.pos = 0;
      state.shuffled = true;
    }
    render();
  }

  // Swipe left/right on touch screens; a swipe must not also count as a tap.
  let touchStart = null;
  let suppressClick = false;

  el.card.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  el.card.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 400);
      go(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  el.card.addEventListener('click', () => {
    if (suppressClick) return;
    setFlipped(!flipped);
  });

  el.flip.addEventListener('click', () => setFlipped(!flipped));
  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));
  el.shuffle.addEventListener('click', toggleShuffle);

  // Shortcuts only apply while the flashcards section is on screen.
  const cardsVisible = () => document.body.dataset.view === 'cards';

  document.addEventListener('keydown', (e) => {
    if (!cardsVisible() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === ' ') {
      // Space always flips, even when a button has focus.
      e.preventDefault();
      if (!e.repeat) setFlipped(!flipped);
    } else if (e.key === 'Enter' && e.target === el.card) {
      e.preventDefault();
      setFlipped(!flipped);
    }
  });

  // Some browsers activate a focused button on Space keyup; block that double action.
  document.addEventListener('keyup', (e) => {
    if (cardsVisible() && e.key === ' ') e.preventDefault();
  });

  render();
})();
