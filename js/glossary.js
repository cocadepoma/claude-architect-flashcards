// Renders the key terms glossary (window.GLOSSARY) into #view-glossary: A–Z, searchable, filterable by domain.
(() => {
  'use strict';

  const DATA = window.GLOSSARY;
  const root = document.getElementById('view-glossary');
  const { h, domainChip } = window.DOM;
  if (!Array.isArray(DATA) || !root) return;

  const sorted = [...DATA].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
  let query = '';
  let domain = 0;

  const list = h('div', { class: 'gl-list' });
  const count = h('p', { class: 'fine', 'aria-live': 'polite' });
  const search = h('input', {
    type: 'search',
    class: 'search',
    placeholder: 'Search terms and definitions',
    'aria-label': 'Search the glossary',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); update(); },
  });
  const chips = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by domain' },
    [0, 1, 2, 3, 4, 5].map((d) => h('button', {
      type: 'button',
      class: 'chip',
      'data-domain': d,
      title: d ? `Domain ${d}: ${(window.DOMAINS || {})[d] || ''}` : 'All domains',
      text: d ? `D${d}` : 'All',
      onclick: () => { domain = d; update(); },
    })));

  const letterOf = (term) => (/^[a-z]/i.test(term) ? term[0].toUpperCase() : '#');

  function update() {
    chips.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.domain) === domain));
    });
    const items = sorted.filter((e) => (!domain || e.domain === domain)
      && (!query || e.term.toLowerCase().includes(query) || e.definition.toLowerCase().includes(query)));

    const groups = new Map();
    for (const entry of items) {
      const letter = letterOf(entry.term);
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(entry);
    }

    count.textContent = `${items.length} of ${DATA.length} terms`;
    list.replaceChildren(...(items.length
      ? [...groups].map(([letter, entries]) => h('section', { class: 'gl-group' },
        h('h3', { class: 'gl-letter', text: letter }),
        h('dl', { class: 'gl-entries' }, entries.map((e) => [
          h('dt', {}, h('span', { text: e.term }), domainChip(e.domain, false)),
          h('dd', { text: e.definition }),
        ]))))
      : [h('p', { class: 'lead', text: 'No terms match your search.' })]));
  }

  root.append(
    h('header', { class: 'doc-head' },
      h('h2', { class: 'doc-title', text: 'Glossary' }),
      h('p', { class: 'lead', text: 'Key terms for the exam, A–Z. Search, or filter by exam domain.' })),
    h('div', { class: 'gl-tools' }, search, chips, count),
    list);
  update();
})();
