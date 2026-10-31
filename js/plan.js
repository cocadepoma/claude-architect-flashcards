// Renders the 30-day study plan (window.PLAN) into #view-plan.
(() => {
  'use strict';

  const PLAN = window.PLAN;
  const root = document.getElementById('view-plan');
  const { h, domainChip } = window.DOM;
  if (!PLAN || !root) return;

  function renderDay(day) {
    const isStudyDay = day.domains.length > 0;
    return h('article', { class: 'day', id: `day-${day.day}` },
      h('header', { class: 'day-head' },
        h('span', { class: 'day-num', text: `Day ${day.day}` }),
        isStudyDay
          ? h('span', { class: 'chips' }, day.domains.map((d) => domainChip(d, false)))
          : h('span', { class: 'day-title', text: day.title })),
      isStudyDay ? h('p', { class: 'day-domains', text: day.title }) : null,
      day.lectures.length
        ? h('ul', { class: 'lectures', 'aria-label': 'Lectures' }, day.lectures.map((l) => h('li', { text: l })))
        : null,
      day.notes.length
        ? h('ul', { class: 'notes' }, day.notes.map((n) =>
          h('li', { class: n.milestone ? 'milestone' : null, text: n.text })))
        : null);
  }

  function renderPhase(phase) {
    return h('section', { class: 'phase' },
      h('h2', { text: phase.title }),
      phase.intro.map((p) => h('p', { class: 'lead', text: p })),
      phase.bullets.length ? h('ul', { class: 'points' }, phase.bullets.map((b) => h('li', { text: b }))) : null,
      phase.days.length ? h('div', { class: 'days' }, phase.days.map(renderDay)) : null);
  }

  root.append(
    h('header', { class: 'doc-head' },
      h('h2', { class: 'doc-title', text: PLAN.title }),
      h('ul', { class: 'stats' }, PLAN.glance.map((g) => h('li', { text: g }))),
      PLAN.intro.map((p) => h('p', { class: 'lead', text: p }))),
    ...PLAN.phases.map(renderPhase));
})();
