// Mistakes section: every question answered incorrectly in Exams and Assessments, kept across attempts.
(() => {
  'use strict';

  const { ExamEngine, EXAM_BANK, ASSESSMENT_BANK } = window;
  const root = document.getElementById('view-mistakes');
  if (!ExamEngine || !root) return;

  const { h } = window.DOM;
  const SOURCES = [
    { key: 'exams', label: 'Exams', bank: EXAM_BANK },
    { key: 'assessments', label: 'Assessments', bank: ASSESSMENT_BANK },
  ].filter((s) => s.bank);

  const lookup = new Map(SOURCES.map((s) => [s.key, {
    ...s,
    questions: new Map(s.bank.questions.map((q) => [q.id, q])),
    exams: new Map(s.bank.exams.map((e) => [e.id, e])),
    scenarios: new Map((s.bank.scenarios || []).map((sc) => [sc.id, sc])),
    taskStatements: s.bank.taskStatements || {},
  }]));

  let filter = 'all';

  // Mistakes whose question no longer exists in its bank are skipped, not deleted.
  function entries() {
    const { items } = ExamEngine.loadMistakes();
    return Object.entries(items)
      .map(([key, item]) => {
        const source = lookup.get(item.bank);
        const q = source && source.questions.get(item.id);
        return q ? { key, item, source, q } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.item.lastAt || 0) - (a.item.lastAt || 0));
  }

  function removeAll(list) {
    if (!window.confirm(`Remove all ${list.length} questions from Mistakes?`)) return;
    list.forEach(({ key }) => ExamEngine.removeMistake(key));
  }

  function renderEntry({ key, item, source, q }) {
    const exam = source.exams.get(item.examId);
    const times = item.count === 1 ? 'Failed once' : `Failed ${item.count} times`;
    const when = item.lastAt ? ` · last ${new Date(item.lastAt).toLocaleDateString()}` : '';
    return ExamEngine.renderReview(q, item.chosen || [], {
      meta: `${source.label} · ${exam ? exam.title : item.examId} · ${times}${when}`,
      scenario: source.scenarios.get(q.scenario),
      task: source.taskStatements[q.taskStatement],
      actions: h('button', {
        class: 'btn ghost small review-remove',
        type: 'button',
        text: 'Remove',
        title: 'Remove this question from Mistakes',
        onclick: () => ExamEngine.removeMistake(key),
      }),
    });
  }

  function render() {
    const all = entries();
    const shown = filter === 'all' ? all : all.filter((e) => e.item.bank === filter);
    const filterButton = (value, label, count) => h('button', {
      class: 'btn ghost small',
      type: 'button',
      'aria-pressed': String(filter === value),
      text: `${label} (${count})`,
      onclick: () => { filter = value; render(); },
    });

    root.replaceChildren(
      h('header', { class: 'doc-head' },
        h('h2', { class: 'doc-title', text: 'Mistakes' }),
        h('p', { class: 'lead', text: 'Every question you answered incorrectly in Exams and Assessments, most recent first, with your last answer, the correct one and the explanation. Remove a question once you have it.' })),
      all.length
        ? h('section', { class: 'review' },
          h('a', { class: 'btn primary retry-link', href: '#retry', text: 'Retry them as an exam' }),
          h('div', { class: 'review-head' },
            h('div', { class: 'review-filters' },
              filterButton('all', 'All', all.length),
              SOURCES.map((s) => filterButton(s.key, s.label, all.filter((e) => e.item.bank === s.key).length))),
            h('button', { class: 'btn ghost small', type: 'button', text: 'Remove all', onclick: () => removeAll(shown) })),
          shown.length ? shown.map(renderEntry) : h('p', { class: 'lead', text: 'No mistakes here.' }))
        : h('p', { class: 'lead', text: 'No mistakes yet. Questions you answer incorrectly in Exams and Assessments will appear here.' }),
    );
  }

  window.addEventListener(ExamEngine.MISTAKES_EVENT, render);
  render();
})();
