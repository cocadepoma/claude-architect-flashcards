// Shared exam engine: exam list, timed attempt, results with per-domain breakdown and answer review.
// Used by the Exams and Assessments sections. Questions come only from the bank passed in,
// where each question carries its source.
window.ExamEngine = (() => {
  'use strict';

  const { h, domainChip, storage } = window.DOM;
  const LOW_TIME_MS = 5 * 60 * 1000;

  // An item scores only when the selection matches the answer key exactly.
  const isCorrect = (q, chosen = []) =>
    chosen.length === q.answer.length && q.answer.every((key) => chosen.includes(key));

  const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
  }

  function sourceLink(source) {
    return source.url
      ? h('a', { href: source.url, target: '_blank', rel: 'noopener', text: source.label })
      : h('span', { text: source.label });
  }

  // Presentation only: `backtick` spans in the source text render as inline code.
  function richText(text) {
    return String(text).split(/(`[^`]+`)/g).filter(Boolean).map((part) =>
      (part.startsWith('`') && part.endsWith('`') ? h('code', { text: part.slice(1, -1) }) : part));
  }

  const scenarioLabel = (s) => s.label || `Scenario ${s.id}`;

  /**
   * @param {HTMLElement} root   section element to render into
   * @param {object} bank        { questions, exams, scenarios?, taskStatements? }
   * @param {object} config      { storagePrefix, title, lead, stats?, formatSource?, passNote }
   */
  function mount(root, bank, config) {
    if (!root || !bank) return;

    const ATTEMPT_KEY = `${config.storagePrefix}:attempt`;
    const HISTORY_KEY = `${config.storagePrefix}:history`;
    const DOMAINS = window.DOMAINS || {};
    const questionById = new Map(bank.questions.map((q) => [q.id, q]));
    const scenarioById = new Map((bank.scenarios || []).map((s) => [s.id, s]));
    const examById = new Map(bank.exams.map((e) => [e.id, e]));
    const taskStatements = bank.taskStatements || {};

    const questionsOf = (exam) => exam.questions.map((id) => questionById.get(id)).filter(Boolean);
    const attemptQuestions = (att) => att.questionIds.map((id) => questionById.get(id)).filter(Boolean);

    function shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }

    // Exams with `draw` pick that many questions at random from their pool on every attempt,
    // then group them by scenario (in random scenario order), as the real exam presents them.
    function drawQuestions(exam) {
      const picked = shuffle(exam.questions).slice(0, exam.draw);
      const scenarioKey = (id) => String(questionById.get(id).scenario ?? '');
      const rank = new Map();
      for (const id of picked) {
        if (!rank.has(scenarioKey(id))) rank.set(scenarioKey(id), rank.size);
      }
      return picked.sort((a, b) => rank.get(scenarioKey(a)) - rank.get(scenarioKey(b)));
    }

    // ---------- State ----------
    function loadAttempt() {
      const saved = storage.get(ATTEMPT_KEY, null);
      if (!saved || !examById.has(saved.examId)) return null;
      if (typeof saved.deadline !== 'number' || typeof saved.answers !== 'object' || !saved.answers) return null;
      const exam = examById.get(saved.examId);
      const questionIds = Array.isArray(saved.questionIds) && saved.questionIds.length
        && saved.questionIds.every((id) => questionById.has(id))
        ? saved.questionIds
        : exam.questions.slice(0, exam.draw || exam.questions.length);
      return {
        questionIds,
        examId: saved.examId,
        startedAt: saved.startedAt,
        deadline: saved.deadline,
        index: Number.isInteger(saved.index) ? saved.index : 0,
        answers: saved.answers,
        flagged: Array.isArray(saved.flagged) ? saved.flagged : [],
        finishedAt: saved.finishedAt || null,
      };
    }

    let attempt = loadAttempt();
    let reviewFilter = 'all';
    let timerId = null;

    const saveAttempt = () => storage.set(ATTEMPT_KEY, attempt);

    function score(att) {
      const byDomain = {};
      let correct = 0;
      const qs = attemptQuestions(att);
      for (const q of qs) {
        const ok = isCorrect(q, att.answers[q.id]);
        if (ok) correct += 1;
        byDomain[q.domain] = byDomain[q.domain] || { correct: 0, total: 0 };
        byDomain[q.domain].total += 1;
        if (ok) byDomain[q.domain].correct += 1;
      }
      return { correct, total: qs.length, byDomain };
    }

    function recordHistory(exam, result) {
      const history = storage.get(HISTORY_KEY, {});
      const entry = history[exam.id] || {};
      const last = { correct: result.correct, total: result.total, date: Date.now() };
      const best = !entry.best || result.correct > entry.best.correct ? last : entry.best;
      history[exam.id] = { last, best };
      storage.set(HISTORY_KEY, history);
    }

    // ---------- Actions ----------
    function start(exam) {
      if (attempt && !attempt.finishedAt && attempt.examId !== exam.id) {
        const current = examById.get(attempt.examId);
        if (!window.confirm(`Abandon "${current.title}" in progress and start "${exam.title}"?`)) return;
      }
      const now = Date.now();
      attempt = {
        questionIds: exam.draw ? drawQuestions(exam) : exam.questions.slice(),
        examId: exam.id,
        startedAt: now,
        deadline: now + exam.minutes * 60 * 1000,
        index: 0,
        answers: {},
        flagged: [],
        finishedAt: null,
      };
      reviewFilter = 'all';
      saveAttempt();
      render({ scrollTop: true });
    }

    function finish() {
      if (!attempt || attempt.finishedAt) return;
      const exam = examById.get(attempt.examId);
      attempt.finishedAt = Math.min(Date.now(), attempt.deadline);
      saveAttempt();
      recordHistory(exam, score(attempt));
      render({ scrollTop: true });
    }

    function confirmFinish() {
      const unanswered = attempt.questionIds.filter((id) => !(attempt.answers[id] || []).length).length;
      const message = unanswered
        ? `${unanswered} question${unanswered === 1 ? '' : 's'} unanswered. Finish the exam anyway?`
        : 'Finish the exam and see your results?';
      if (window.confirm(message)) finish();
    }

    function backToList() {
      if (attempt && !attempt.finishedAt && !window.confirm('Leave this exam? Your progress will be lost.')) return;
      attempt = null;
      storage.set(ATTEMPT_KEY, null);
      render({ scrollTop: true });
    }

    function goTo(index) {
      attempt.index = index;
      saveAttempt();
      render({ scrollTop: true });
    }

    function choose(q, key) {
      let chosen = attempt.answers[q.id] || [];
      if (q.select === 1) chosen = [key];
      else if (chosen.includes(key)) chosen = chosen.filter((k) => k !== key);
      else if (chosen.length < q.select) chosen = [...chosen, key];
      attempt.answers[q.id] = chosen;
      saveAttempt();
      render();
      const input = root.querySelector(`input[value="${key}"]`);
      if (input) input.focus();
    }

    function toggleFlag(q) {
      const flagged = attempt.flagged.includes(q.id);
      attempt.flagged = flagged ? attempt.flagged.filter((id) => id !== q.id) : [...attempt.flagged, q.id];
      saveAttempt();
      render();
    }

    // ---------- Timer (deadline-based, so it survives reloads) ----------
    function stopTimer() {
      clearInterval(timerId);
      timerId = null;
    }

    function tick() {
      if (!attempt || attempt.finishedAt) {
        stopTimer();
        return;
      }
      const remaining = attempt.deadline - Date.now();
      const clock = root.querySelector('[data-timer]');
      if (clock) {
        clock.textContent = formatClock(remaining);
        clock.classList.toggle('is-low', remaining <= LOW_TIME_MS);
      }
      if (remaining <= 0) {
        stopTimer();
        finish();
      }
    }

    function startTimer() {
      if (!timerId) timerId = setInterval(tick, 1000);
      tick();
    }

    // ---------- Screens ----------
    function renderList() {
      const history = storage.get(HISTORY_KEY, {});
      return [
        h('header', { class: 'doc-head' },
          h('h2', { class: 'doc-title', text: config.title }),
          h('p', { class: 'lead', text: config.lead }),
          config.stats ? h('ul', { class: 'stats' }, config.stats.map((s) => h('li', { text: s }))) : null,
          config.formatSource ? h('p', { class: 'fine' }, 'Format: ', sourceLink(config.formatSource), '.') : null),
        h('div', { class: 'exam-list' }, bank.exams.map((exam) => renderExamCard(exam, history[exam.id]))),
      ];
    }

    function renderExamCard(exam, hist) {
      const qs = questionsOf(exam);
      const scenarios = new Set(qs.map((q) => q.scenario).filter(Boolean)).size;
      const inProgress = attempt && !attempt.finishedAt && attempt.examId === exam.id;
      const meta = exam.draw
        ? [`${exam.draw} questions`, `${exam.minutes} minutes`, `random from ${qs.length}`]
        : [`${qs.length} questions`, `${exam.minutes} minutes`];
      if (scenarios && !exam.draw) meta.push(`${scenarios} scenarios`);
      return h('article', { class: 'exam-card' },
        h('div', { class: 'exam-card-head' },
          h('h3', { text: exam.title }),
          exam.badge ? h('span', { class: `badge badge-${exam.badgeKind || 'plain'}`, text: exam.badge }) : null),
        h('p', { class: 'exam-meta', text: meta.join(' · ') }),
        h('p', { class: 'exam-desc', text: exam.description }),
        exam.attribution ? h('p', { class: 'fine' }, 'Source: ', sourceLink(exam.attribution)) : null,
        hist ? h('p', { class: 'exam-history', text:
          `Last: ${hist.last.correct}/${hist.last.total} (${percent(hist.last.correct, hist.last.total)}%) · `
          + `Best: ${hist.best.correct}/${hist.best.total} (${percent(hist.best.correct, hist.best.total)}%)` }) : null,
        h('button', {
          class: 'btn primary',
          type: 'button',
          text: inProgress ? 'Resume exam' : 'Start exam',
          onclick: () => (inProgress ? render({ scrollTop: true }) : start(exam)),
        }));
    }

    function renderRunning() {
      const exam = examById.get(attempt.examId);
      const qs = attemptQuestions(attempt);
      attempt.index = Math.min(Math.max(attempt.index, 0), qs.length - 1);
      const q = qs[attempt.index];
      const scenario = scenarioById.get(q.scenario);
      const chosen = attempt.answers[q.id] || [];
      const flagged = attempt.flagged.includes(q.id);
      const answered = qs.filter((x) => (attempt.answers[x.id] || []).length).length;
      const isLast = attempt.index === qs.length - 1;
      const inputType = q.select > 1 ? 'checkbox' : 'radio';

      return [
        h('div', { class: 'exam-top' },
          h('div', {},
            h('p', { class: 'eyebrow', text: exam.title }),
            h('p', { class: 'exam-progress', text: `Question ${attempt.index + 1} of ${qs.length}` })),
          h('div', { class: 'exam-top-actions' },
            h('button', { class: 'btn ghost small', type: 'button', text: 'Exit', onclick: backToList }),
            h('button', { class: 'btn small', type: 'button', text: 'Finish', onclick: confirmFinish }))),

        scenario
          ? h('details', { class: 'scenario', open: true },
            h('summary', {},
              h('span', { class: 'eyebrow', text: scenarioLabel(scenario) }),
              h('span', { class: 'scenario-title', text: scenario.title })),
            h('p', {}, richText(scenario.description)))
          : null,

        h('p', { class: 'q-prompt' }, richText(q.prompt)),

        h('fieldset', { class: 'options' },
          h('legend', { class: 'choose', text: `Choose ${q.select}` }),
          q.options.map((o) => h('label', { class: chosen.includes(o.key) ? 'option is-selected' : 'option' },
            h('input', {
              type: inputType,
              name: `q-${q.id}`,
              value: o.key,
              checked: chosen.includes(o.key),
              onchange: () => choose(q, o.key),
            }),
            h('span', { class: 'option-key', text: o.key }),
            h('span', { class: 'option-text' }, richText(o.text))))),

        h('details', { class: 'palette' },
          h('summary', { text: `All questions · ${answered}/${qs.length} answered` }),
          h('div', { class: 'palette-grid' }, qs.map((x, i) => {
            const classes = ['pal'];
            if ((attempt.answers[x.id] || []).length) classes.push('is-answered');
            if (attempt.flagged.includes(x.id)) classes.push('is-flagged');
            if (i === attempt.index) classes.push('is-current');
            return h('button', {
              class: classes.join(' '),
              type: 'button',
              'aria-label': `Question ${i + 1}`,
              'aria-current': i === attempt.index ? 'step' : null,
              text: String(i + 1),
              onclick: () => goTo(i),
            });
          }))),

        h('div', { class: 'exam-nav' },
          h('button', {
            class: 'btn',
            type: 'button',
            'aria-label': 'Previous question',
            text: '←',
            disabled: attempt.index === 0,
            onclick: () => goTo(attempt.index - 1),
          }),
          h('div', { class: 'exam-nav-mid' },
            h('span', { class: 'timer', 'data-timer': true, role: 'timer', 'aria-label': 'Time remaining' }),
            h('button', {
              class: flagged ? 'flag is-flagged' : 'flag',
              type: 'button',
              'aria-pressed': String(flagged),
              text: flagged ? '⚑ Flagged' : '⚐ Flag',
              onclick: () => toggleFlag(q),
            })),
          isLast
            ? h('button', { class: 'btn primary', type: 'button', text: 'Finish', onclick: confirmFinish })
            : h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Next question', text: '→', onclick: () => goTo(attempt.index + 1) })),
      ];
    }

    function renderResults() {
      const exam = examById.get(attempt.examId);
      const result = score(attempt);
      const qs = attemptQuestions(attempt);
      const used = formatClock(attempt.finishedAt - attempt.startedAt);
      const domainIds = Object.keys(result.byDomain).map(Number).sort();

      const items = qs
        .map((q, i) => ({ q, i, chosen: attempt.answers[q.id] || [] }))
        .filter(({ q, chosen }) => reviewFilter === 'all' || !isCorrect(q, chosen));

      const filterButton = (value, label) => h('button', {
        class: 'btn ghost small',
        type: 'button',
        'aria-pressed': String(reviewFilter === value),
        text: label,
        onclick: () => { reviewFilter = value; render(); },
      });

      return [
        h('header', { class: 'doc-head' },
          h('p', { class: 'eyebrow', text: exam.title }),
          h('h2', { class: 'doc-title', text: 'Results' }),
          h('div', { class: 'score' },
            h('span', { class: 'score-big', text: `${percent(result.correct, result.total)}%` }),
            h('span', { class: 'score-detail', text: `${result.correct} of ${result.total} correct · time used ${used}` })),
          config.passNote ? h('p', { class: 'fine', text: config.passNote }) : null),

        h('section', { class: 'by-domain', 'aria-label': 'Percent correct by domain' },
          h('h3', { text: 'By domain' }),
          domainIds.map((d) => {
            const r = result.byDomain[d];
            const p = percent(r.correct, r.total);
            return h('div', { class: 'domain-row' },
              h('div', { class: 'domain-row-head' },
                h('span', { class: 'domain-row-name' }, domainChip(d, false), DOMAINS[d] || ''),
                h('span', { class: 'domain-row-score', text: `${r.correct}/${r.total} · ${p}%` })),
              h('div', { class: 'meter', role: 'img', 'aria-label': `${p}% correct` },
                h('div', { class: 'meter-fill', style: `width:${p}%` })));
          })),

        h('div', { class: 'results-actions' },
          h('button', { class: 'btn primary', type: 'button', text: 'Retake exam', onclick: () => start(exam) }),
          h('button', { class: 'btn', type: 'button', text: 'All exams', onclick: backToList })),

        h('section', { class: 'review' },
          h('div', { class: 'review-head' },
            h('h3', { text: 'Review' }),
            h('div', { class: 'review-filters' }, filterButton('all', 'All'), filterButton('incorrect', 'Incorrect'))),
          items.length
            ? items.map(renderReviewItem)
            : h('p', { class: 'lead', text: 'No incorrect answers. Well done.' })),
      ];
    }

    function renderReviewItem({ q, i, chosen }) {
      const ok = isCorrect(q, chosen);
      const status = !chosen.length ? 'Unanswered' : ok ? 'Correct' : 'Incorrect';
      const scenario = scenarioById.get(q.scenario);
      const task = taskStatements[q.taskStatement];
      return h('article', { class: `review-item ${ok ? 'is-ok' : 'is-bad'}` },
        h('header', { class: 'review-item-head' },
          h('span', { class: 'review-num', text: `Q${i + 1}` }),
          h('span', { class: `status ${ok ? 'status-ok' : 'status-bad'}`, text: `${ok ? '✓' : '✗'} ${status}` }),
          domainChip(q.domain, false)),
        scenario ? h('p', { class: 'review-meta', text: `${scenarioLabel(scenario)}: ${scenario.title}` }) : null,
        h('p', { class: 'q-prompt' }, richText(q.prompt)),
        h('ul', { class: 'review-options' }, q.options.map((o) => {
          const isAnswer = q.answer.includes(o.key);
          const picked = chosen.includes(o.key);
          const cls = ['review-option'];
          if (isAnswer) cls.push('is-answer');
          if (picked && !isAnswer) cls.push('is-wrong');
          return h('li', { class: cls.join(' ') },
            h('span', { class: 'option-key', text: o.key }),
            h('span', { class: 'option-text' }, richText(o.text)),
            isAnswer ? h('span', { class: 'tag tag-ok', text: 'Correct answer' }) : null,
            picked ? h('span', { class: isAnswer ? 'tag tag-ok' : 'tag tag-bad', text: 'Your answer' }) : null);
        })),
        q.explanation
          ? h('div', { class: 'explanation' },
            h('p', { class: 'eyebrow', text: 'Explanation (from the source)' }),
            h('p', { class: 'explanation-text' }, richText(q.explanation)))
          : null,
        q.verification
          ? h('div', { class: 'verification' },
            h('p', { class: 'eyebrow', text: 'Answer checked against' }),
            h('p', {}, q.verification.url
              ? h('a', { href: q.verification.url, target: '_blank', rel: 'noopener', text: q.verification.label })
              : q.verification.label),
            h('blockquote', { text: q.verification.quote }))
          : null,
        h('p', { class: 'fine' },
          task ? `Task statement ${q.taskStatement}: ${task}. ` : '',
          'Source: ', sourceLink(q.source), '.'));
    }

    // ---------- Render ----------
    function render({ scrollTop = false } = {}) {
      if (attempt && !attempt.finishedAt && Date.now() >= attempt.deadline) {
        finish();
        return;
      }
      let children;
      if (!attempt) children = renderList();
      else if (attempt.finishedAt) children = renderResults();
      else children = renderRunning();
      root.replaceChildren(...children.flat().filter(Boolean));
      if (attempt && !attempt.finishedAt) startTimer();
      else stopTimer();
      if (scrollTop && root.closest('.view') && !root.closest('.view').hidden) window.scrollTo(0, 0);
    }

    render();
  }

  return { mount, isCorrect };
})();
