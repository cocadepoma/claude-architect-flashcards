// Retry section: one exam made of every question currently in Mistakes, in random order.
// Runs on the shared exam engine; a question failed again counts against its original in Mistakes.
(() => {
  'use strict';

  const { ExamEngine, EXAM_BANK, ASSESSMENT_BANK } = window;
  const root = document.getElementById('view-retry');
  if (!ExamEngine || !root) return;

  const { h, storage } = window.DOM;
  const STORAGE_PREFIX = 'cca-f:retry';
  const ATTEMPT_KEY = `${STORAGE_PREFIX}:attempt`;
  const EXAM_ID = 'all-mistakes';
  const MINUTES_PER_QUESTION = 2;
  const MIN_MINUTES = 5;

  const SOURCES = [
    { key: 'exams', bank: EXAM_BANK },
    { key: 'assessments', bank: ASSESSMENT_BANK },
  ].filter((s) => s.bank);

  // Every question of both banks under its Mistakes key ("<bank>:<questionId>"), so ids never collide.
  const byKey = new Map();
  for (const { key: bankKey, bank } of SOURCES) {
    const scenarios = new Map((bank.scenarios || []).map((s) => [s.id, s]));
    for (const q of bank.questions) byKey.set(`${bankKey}:${q.id}`, { bankKey, q, scenario: scenarios.get(q.scenario) });
  }
  const taskStatements = Object.assign({}, ...SOURCES.map((s) => s.bank.taskStatements || {}));

  // The bank holds the current mistakes plus the questions of a saved attempt, so an attempt (or its results)
  // stays readable after its questions are removed from Mistakes. The exam itself uses only current mistakes.
  function buildBank() {
    const { items } = ExamEngine.loadMistakes();
    const mistakeKeys = Object.keys(items).filter((key) => byKey.has(key));
    const saved = storage.get(ATTEMPT_KEY, null);
    const savedKeys = saved && Array.isArray(saved.questionIds) ? saved.questionIds.filter((key) => byKey.has(key)) : [];

    const questions = [];
    const scenarios = new Map();
    for (const key of new Set([...mistakeKeys, ...savedKeys])) {
      const { bankKey, q, scenario } = byKey.get(key);
      const item = items[key];
      let scenarioId;
      if (scenario) {
        scenarioId = `${bankKey}:${scenario.id}`;
        scenarios.set(scenarioId, { ...scenario, id: scenarioId, label: scenario.label || `Scenario ${scenario.id}` });
      }
      questions.push({
        ...q,
        id: key,
        scenario: scenarioId,
        mistakeRef: { bank: bankKey, id: q.id, examId: item ? item.examId : null },
      });
    }

    const count = mistakeKeys.length;
    return {
      count,
      bank: {
        questions,
        scenarios: [...scenarios.values()],
        taskStatements,
        exams: [{
          id: EXAM_ID,
          title: 'All mistakes',
          description: 'Every question currently in Mistakes, shuffled and grouped by scenario. Questions you fail again count as failed once more in Mistakes; remove the ones you have mastered there.',
          questions: mistakeKeys,
          draw: count,
          minutes: Math.max(MIN_MINUTES, count * MINUTES_PER_QUESTION),
        }],
      },
    };
  }

  function renderEmpty() {
    root.replaceChildren(
      h('header', { class: 'doc-head' },
        h('h2', { class: 'doc-title', text: 'Retry mistakes' }),
        h('p', { class: 'lead', text: 'No mistakes yet. Questions you answer incorrectly in Exams and Assessments will be collected here as one exam.' })));
  }

  function mount() {
    const { count, bank } = buildBank();
    if (!count) {
      renderEmpty();
      return;
    }
    ExamEngine.mount(root, bank, {
      storagePrefix: STORAGE_PREFIX,
      mistakeBank: 'retry',
      title: 'Retry mistakes',
      lead: `Practise every question you have failed in Exams and Assessments as a single timed exam, ${MINUTES_PER_QUESTION} minutes per question.`,
    });
  }

  // Rebuild when Mistakes changes, except during an attempt in progress. Deferred so the engine finishes
  // its own render (finishing an attempt itself updates Mistakes) before the view is replaced.
  window.addEventListener(ExamEngine.MISTAKES_EVENT, () => setTimeout(() => {
    const saved = storage.get(ATTEMPT_KEY, null);
    if (saved && !saved.finishedAt && Date.now() < saved.deadline) return;
    mount();
  }, 0));

  mount();
})();
