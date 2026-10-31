// Renders the study companion (window.COMPANION) into #view-companion, one exam domain at a time.
(() => {
  'use strict';

  const DATA = window.COMPANION;
  const root = document.getElementById('view-companion');
  const { h, storage } = window.DOM;
  if (!DATA || !root || DATA.domains.length === 0) return;

  const STORAGE_KEY = 'cca-f:companion-domain';
  const ids = DATA.domains.map((d) => d.id);
  let current = storage.get(STORAGE_KEY, ids[0]);
  if (!ids.includes(current)) current = ids[0];

  // A topic's "Lessons N and M" are course slide decks N and M, shown in full in the Lessons section.
  function deepDive(topic) {
    const decks = (window.LESSONS || {}).decks || [];
    const nums = (topic.lessons.match(/\d+/g) || []).map(Number);
    const found = nums.map((n) => decks.find((d) => d.id === n)).filter(Boolean);
    if (found.length === 0) return null;
    const slides = found.reduce((n, d) => n + d.slides.length, 0);
    const range = nums.length > 1 ? `Lessons ${nums[0]}–${nums[nums.length - 1]}` : `Lesson ${nums[0]}`;
    return h('a', { class: 'deep-dive', href: `#lessons/${found[0].id}`, text: `Deep dive · ${range} · ${slides} slides →` });
  }

  function renderTopic(topic) {
    return h('details', { class: 'topic' },
      h('summary', {},
        h('span', { class: 'topic-title', text: topic.title }),
        h('span', { class: 'topic-lessons', text: topic.lessons }),
        h('span', { class: 'topic-summary', text: topic.summary })),
      h('ul', { class: 'points' }, topic.points.map((p) =>
        h('li', {},
          p.deprecated ? h('span', { class: 'tag-deprecated', text: 'Deprecated' }) : null,
          p.text))),
      deepDive(topic));
  }

  function renderDomain(domain) {
    const topics = () => body.querySelectorAll('details.topic');
    const toggleAll = h('button', {
      class: 'btn ghost small',
      type: 'button',
      text: 'Expand all',
      onclick: () => {
        const open = toggleAll.textContent === 'Expand all';
        topics().forEach((t) => { t.open = open; });
        toggleAll.textContent = open ? 'Collapse all' : 'Expand all';
      },
    });
    const body = h('div', { class: 'domain-body' },
      h('header', { class: 'domain-head' },
        h('div', {},
          h('p', { class: 'eyebrow', text: `Domain ${domain.id} · ${domain.weight}% of the exam` }),
          h('h2', { text: domain.title })),
        toggleAll),
      domain.sections.map((section) =>
        h('section', { class: 'cmp-section' },
          h('h3', {}, h('span', { class: 'section-id', text: section.id }), section.title),
          section.topics.map(renderTopic))));
    return body;
  }

  const picker = h('div', { class: 'domain-picker', role: 'tablist', 'aria-label': 'Exam domains' });
  const panel = h('div', { class: 'domain-panel', role: 'tabpanel' });

  function select(id) {
    current = id;
    storage.set(STORAGE_KEY, id);
    picker.querySelectorAll('[role="tab"]').forEach((tab) => {
      tab.setAttribute('aria-selected', String(Number(tab.dataset.domain) === id));
    });
    panel.replaceChildren(renderDomain(DATA.domains.find((d) => d.id === id)));
  }

  DATA.domains.forEach((d) => {
    picker.append(h('button', {
      class: 'domain-tab',
      type: 'button',
      role: 'tab',
      'data-domain': d.id,
      title: d.title,
      onclick: () => select(d.id),
    }, h('b', { text: `D${d.id}` }), h('span', { text: `${d.weight}%` })));
  });

  root.append(
    h('header', { class: 'doc-head' },
      h('h2', { class: 'doc-title', text: 'Study Companion' }),
      h('p', { class: 'lead', text: 'What to know for the exam, by domain. Tap a topic to see its key points.' }),
      h('ul', { class: 'stats' }, DATA.examFormat.map((f) => h('li', { text: f })))),
    picker,
    panel);

  select(current);
})();
