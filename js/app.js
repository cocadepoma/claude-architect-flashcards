// Section switching driven by the URL hash (#cards, #glossary, #plan, ...).
(() => {
  'use strict';

  const VIEWS = ['cards', 'glossary', 'plan', 'companion', 'lessons', 'exams', 'assessments'];
  const STORAGE_KEY = 'cca-f:view';
  const { storage } = window.DOM;

  function viewFromHash() {
    const [name, ...rest] = location.hash.replace('#', '').split('/');
    // Only Lessons has sub-routes (#lessons/<lesson>/<slide>); other sections take no path.
    if (rest.length && name !== 'lessons') return null;
    return VIEWS.includes(name) ? name : null;
  }

  function show(name) {
    document.body.dataset.view = name;
    document.querySelectorAll('.view').forEach((view) => {
      view.hidden = view.dataset.view !== name;
    });
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    storage.set(STORAGE_KEY, name);
  }

  window.addEventListener('hashchange', () => {
    const name = viewFromHash();
    if (!name) return;
    show(name);
    window.scrollTo(0, 0);
  });

  // Unknown hashes fall back to the last section used.
  const saved = storage.get(STORAGE_KEY, 'cards');
  show(viewFromHash() || (VIEWS.includes(saved) ? saved : 'cards'));
})();
