// Renders the course slides (window.LESSONS) into #view-lessons: lessons grouped by exam domain, a slide
// viewer with each slide's transcribed text, and search across every slide.
// Routes: #lessons (list), #lessons/<lesson> and #lessons/<lesson>/<slide> (viewer).
(() => {
  'use strict';

  const DATA = window.LESSONS;
  const root = document.getElementById('view-lessons');
  const { h, domainChip, storage } = window.DOM;
  if (!DATA || !root || DATA.decks.length === 0) return;

  const GROUP_KEY = 'cca-f:lessons-group';
  const LAST_KEY = 'cca-f:lessons-last';
  const MAX_HITS = 40;
  const ROUTE = /^#lessons(?:\/(\d+)(?:\/(\d+))?)?$/;

  const groupIds = DATA.groups.map((g) => g.id);
  // Course order used by "next/previous lesson": the groups as shown, each in lesson-number order.
  const ordered = DATA.groups.flatMap((g) => DATA.decks.filter((d) => d.group === g.id));
  const byId = new Map(DATA.decks.map((d) => [d.id, d]));
  const weights = new Map(((window.COMPANION || {}).domains || []).map((d) => [String(d.id), d.weight]));

  let group = storage.get(GROUP_KEY, groupIds[0]);
  if (!groupIds.includes(group)) group = groupIds[0];
  let query = '';
  let current = null; // { deck, index } while the viewer is open

  const pad = (n) => String(n).padStart(2, '0');
  const slideCount = (decks) => decks.reduce((n, d) => n + d.slides.length, 0);
  const blockText = ([kind, value]) => (kind === 'l' ? value.join(' ') : value);

  // Lowercase search text per slide, built once.
  const index = DATA.decks.flatMap((deck) => deck.slides.map((slide, i) => ({
    deck,
    i,
    text: [slide.title, ...slide.text.map(blockText)].join(' \n '),
  })));
  index.forEach((entry) => { entry.lower = entry.text.toLowerCase(); });

  // ---------- List: group picker + lessons ----------
  const picker = h('div', { class: 'domain-picker lesson-picker', role: 'tablist', 'aria-label': 'Lesson groups' },
    DATA.groups.map((g) => h('button', {
      class: 'domain-tab',
      type: 'button',
      role: 'tab',
      'data-group': g.id,
      title: g.name,
      onclick: () => selectGroup(g.id),
    }, h('b', { text: g.label }), h('span', {}, String(ordered.filter((d) => d.group === g.id).length), h('span', { class: 'unit', text: ' lessons' })))));
  const groupPanel = h('div', { class: 'domain-panel', role: 'tabpanel' });

  function deckLink(deck, extra) {
    return h('a', { class: 'deck-link', href: `#lessons/${deck.id}` },
      h('span', { class: 'deck-num', text: pad(deck.id) }),
      h('span', { class: 'deck-main' },
        h('span', { class: 'deck-title', text: deck.title }),
        h('span', { class: 'deck-meta' }, `${deck.slides.length} slides`, extra || null)));
  }

  function renderGroup() {
    const g = DATA.groups.find((x) => x.id === group);
    const decks = ordered.filter((d) => d.group === g.id);
    const isDomain = /^\d$/.test(g.id);
    const eyebrow = isDomain
      ? `Domain ${g.id}${weights.has(g.id) ? ` · ${weights.get(g.id)}% of the exam` : ''}`
      : g.label;

    let lists;
    if (isDomain) {
      const sections = new Map();
      for (const d of decks) {
        const key = d.section || '';
        if (!sections.has(key)) sections.set(key, { title: d.sectionTitle, decks: [] });
        sections.get(key).decks.push(d);
      }
      lists = [...sections].map(([id, s]) => h('section', { class: 'cmp-section' },
        id ? h('h3', {}, h('span', { class: 'section-id', text: id }), s.title) : null,
        h('ul', { class: 'deck-list' }, s.decks.map((d) => h('li', {}, deckLink(d))))));
    } else {
      lists = [h('ul', { class: 'deck-list' }, decks.map((d) => h('li', {}, deckLink(d,
        d.domain ? h('span', { class: 'deck-domain' }, domainChip(d.domain, false),
          d.taskStatement ? ` Task ${d.taskStatement}` : null) : null))))];
    }

    groupPanel.replaceChildren(h('div', { class: 'domain-body' },
      h('header', { class: 'domain-head' },
        h('div', {},
          h('p', { class: 'eyebrow', text: eyebrow }),
          h('h2', { text: g.name }),
          h('p', { class: 'fine', text: `${decks.length} lessons · ${slideCount(decks)} slides` }))),
      lists));
  }

  function selectGroup(id) {
    group = id;
    storage.set(GROUP_KEY, id);
    picker.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.group === id));
    });
    renderGroup();
  }

  // ---------- Search ----------
  const results = h('div', { class: 'search-results', hidden: true });
  const resultCount = h('p', { class: 'fine', 'aria-live': 'polite' });
  const search = h('input', {
    type: 'search',
    class: 'search',
    placeholder: 'Search the text of every slide',
    'aria-label': 'Search all slides',
    oninput: (e) => { query = e.target.value.trim(); renderSearch(); },
  });

  function snippet(text, at, length) {
    const start = Math.max(0, at - 70);
    const end = Math.min(text.length, at + length + 90);
    const clean = (s) => s.replace(/\s*\n\s*/g, ' · ');
    return h('span', { class: 'hit-snippet' },
      start > 0 ? '…' : '',
      clean(text.slice(start, at)),
      h('mark', { text: clean(text.slice(at, at + length)) }),
      clean(text.slice(at + length, end)),
      end < text.length ? '…' : '');
  }

  function renderSearch() {
    const active = query.length >= 2;
    results.hidden = !active;
    picker.hidden = active;
    groupPanel.hidden = active;
    if (!active) return;
    const needle = query.toLowerCase();
    const hits = index.filter((e) => e.lower.includes(needle));
    resultCount.textContent = hits.length > MAX_HITS
      ? `${hits.length} slides match · showing the first ${MAX_HITS}`
      : `${hits.length} ${hits.length === 1 ? 'slide matches' : 'slides match'}`;
    results.replaceChildren(resultCount, ...(hits.length
      ? [h('ul', { class: 'hit-list' }, hits.slice(0, MAX_HITS).map((e) => h('li', {},
        h('a', { class: 'search-hit', href: `#lessons/${e.deck.id}/${e.i + 1}` },
          h('span', { class: 'hit-head', text: `Lesson ${pad(e.deck.id)} · Slide ${e.i + 1} · ${e.deck.slides[e.i].title}` }),
          snippet(e.text, e.lower.indexOf(needle), needle.length)))))]
      : [h('p', { class: 'lead', text: 'No slides match your search.' })]));
  }

  // ---------- Viewer ----------
  const viewer = h('div', { class: 'slide-viewer-host' });

  // Blocks: h = heading, p = paragraph, c = code line, l = short diagram labels.
  function transcript(slide) {
    const nodes = [];
    let code = null;
    for (const [kind, value] of slide.text) {
      if (kind === 'c') {
        if (!code) {
          code = h('pre', { class: 'slide-code' });
          nodes.push(code);
        }
        code.append(code.childNodes.length ? `\n${value}` : value);
        continue;
      }
      code = null;
      if (kind === 'h') nodes.push(h('h4', { text: value }));
      else if (kind === 'l') nodes.push(h('p', { class: 'diagram-text' }, h('span', { text: 'In the diagram: ' }), value.join(' · ')));
      else nodes.push(h('p', { text: value }));
    }
    const hasCode = slide.text.some(([kind]) => kind === 'c');
    return h('section', { class: 'transcript', 'aria-label': 'Slide text' },
      h('h3', { class: 'slide-title', text: slide.title }),
      nodes,
      hasCode ? h('p', { class: 'fine', text: 'Code is transcribed from the image; check the slide for exact symbols.' }) : null);
  }

  function neighbour(deck, step) {
    return ordered[ordered.indexOf(deck) + step] || null;
  }

  function renderViewer() {
    const { deck, index: i } = current;
    const slide = deck.slides[i];
    const total = deck.slides.length;
    const prevDeck = neighbour(deck, -1);
    const nextDeck = neighbour(deck, 1);
    const atStart = i === 0 && !prevDeck;
    const atEnd = i === total - 1 && !nextDeck;
    const context = deck.topic
      ? `Companion topic: ${deck.topic}`
      : (DATA.groups.find((g) => g.id === deck.group) || {}).name;

    viewer.replaceChildren(h('article', { class: 'slide-viewer' },
      h('div', { class: 'viewer-top' },
        h('button', { class: 'btn ghost small slide-back', type: 'button', text: '← All lessons', onclick: () => { location.hash = '#lessons'; } }),
        deck.domain ? domainChip(deck.domain, true) : null),
      h('header', { class: 'viewer-head' },
        h('p', { class: 'eyebrow', text: `Lesson ${pad(deck.id)}` }),
        h('h2', { class: 'viewer-title', text: deck.title }),
        context ? h('p', { class: 'fine', text: context }) : null),
      h('figure', { class: 'slide-frame' },
        slideImage(slide)),
      h('div', { class: 'progress', 'aria-hidden': 'true' },
        h('div', { class: 'progress-bar', style: `width: ${((i + 1) / total) * 100}%` })),
      h('div', { class: 'controls', role: 'group', 'aria-label': 'Slide navigation' },
        h('button', { class: 'btn slide-prev', type: 'button', 'aria-label': 'Previous slide', text: '←', disabled: atStart, onclick: () => step(-1) }),
        h('span', { class: 'slide-counter', 'aria-live': 'polite', text: `${i + 1} / ${total}` }),
        h('button', { class: 'btn slide-next', type: 'button', 'aria-label': 'Next slide', text: '→', disabled: atEnd, onclick: () => step(1) })),
      h('p', { class: 'keys', text: '← → to change slide' }),
      transcript(slide),
      h('nav', { class: 'deck-nav', 'aria-label': 'Other lessons' },
        prevDeck ? h('a', { class: 'deck-nav-link', href: `#lessons/${prevDeck.id}` },
          h('span', { class: 'fine', text: '← Previous lesson' }), h('span', { text: `${pad(prevDeck.id)} · ${prevDeck.title}` })) : h('span'),
        nextDeck ? h('a', { class: 'deck-nav-link next', href: `#lessons/${nextDeck.id}` },
          h('span', { class: 'fine', text: 'Next lesson →' }), h('span', { text: `${pad(nextDeck.id)} · ${nextDeck.title}` })) : h('span'))));

    // Decrypt the next slide ahead of time so stepping through feels instant.
    const next = deck.slides[i + 1] || (nextDeck && nextDeck.slides[0]);
    if (next) window.VAULT.image(next.src).catch(() => {});
  }

  // Slide images are encrypted (vault/slides); js/gate.js decrypts them into blob URLs.
  function slideImage(slide) {
    const img = h('img', { class: 'slide-img', alt: slide.title, width: slide.w, height: slide.h, decoding: 'async' });
    window.VAULT.image(slide.src).then((url) => { img.src = url; }, () => { img.alt = `${slide.title} (image unavailable)`; });
    return img;
  }

  function show(deck, i) {
    current = { deck, index: Math.min(Math.max(i, 0), deck.slides.length - 1) };
    storage.set(LAST_KEY, { deck: deck.id, slide: current.index + 1 });
    renderViewer();
  }

  // Moving between slides rewrites the hash without adding history entries.
  function step(delta) {
    if (!current) return;
    let { deck, index: i } = current;
    i += delta;
    if (i >= deck.slides.length) {
      deck = neighbour(deck, 1);
      i = 0;
    } else if (i < 0) {
      deck = neighbour(deck, -1);
      i = deck ? deck.slides.length - 1 : 0;
    }
    if (!deck) return;
    history.replaceState(null, '', `#lessons/${deck.id}/${i + 1}`);
    show(deck, i);
  }

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'lessons' || !current) return;
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });

  // ---------- Layout + routing ----------
  const resume = h('p', { class: 'resume' });
  const listView = h('div', { class: 'lessons-list' },
    h('header', { class: 'doc-head' },
      h('h2', { class: 'doc-title', text: 'Lessons' }),
      h('p', { class: 'lead', text: 'Every slide of the course, grouped by exam domain, with the text of each slide below it. Open a lesson from here or from a Companion topic.' }),
      h('ul', { class: 'stats' },
        h('li', { text: `${DATA.decks.length} lessons` }),
        h('li', { text: `${slideCount(DATA.decks).toLocaleString('en-US')} slides` })),
      resume),
    h('div', { class: 'gl-tools' }, search),
    results,
    picker,
    groupPanel,
    h('p', { class: 'fine', text: 'Slide text was transcribed automatically from the slide images; if anything reads oddly, the slide image is the reference.' }));

  function renderResume() {
    const last = storage.get(LAST_KEY, null);
    const deck = last && byId.get(last.deck);
    resume.hidden = !deck;
    resume.replaceChildren(...(deck
      ? [h('a', { class: 'resume-link', href: `#lessons/${deck.id}/${last.slide}` },
        `Continue: Lesson ${pad(deck.id)} · ${deck.title} · slide ${last.slide}`)]
      : []));
  }

  function route() {
    if (location.hash.split('/')[0] !== '#lessons') return;
    const m = ROUTE.exec(location.hash);
    const deck = m && m[1] && byId.get(Number(m[1]));
    if (deck) {
      if (deck.group !== group) selectGroup(deck.group);
      show(deck, m[2] ? Number(m[2]) - 1 : 0);
      // An out-of-range slide number is clamped; make the URL say which slide is shown.
      if (m[2] && Number(m[2]) !== current.index + 1) {
        history.replaceState(null, '', `#lessons/${deck.id}/${current.index + 1}`);
      }
      listView.hidden = true;
      viewer.hidden = false;
    } else {
      // #lessons, or a malformed/unknown lesson link: show the list under a clean URL.
      if (location.hash !== '#lessons') history.replaceState(null, '', '#lessons');
      current = null;
      viewer.replaceChildren();
      renderResume();
      listView.hidden = false;
      viewer.hidden = true;
    }
  }

  root.append(listView, viewer);
  selectGroup(group);
  window.addEventListener('hashchange', route);
  route();
  if (!ROUTE.test(location.hash)) {
    renderResume();
    viewer.hidden = true;
  }
})();
