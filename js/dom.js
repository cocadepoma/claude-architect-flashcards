// Tiny DOM helpers shared by the views. Text is always set with textContent (no HTML injection).
window.DOM = (() => {
  'use strict';

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function domainChip(id, withName) {
    const name = (window.DOMAINS || {})[id];
    return h('span', { class: 'domain', title: name ? `Domain ${id}: ${name}` : null },
      h('b', { class: 'domain-id', text: `D${id}` }),
      withName && name ? h('span', { class: 'domain-name-inline', text: `· ${name}` }) : null);
  }

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore: storage unavailable */
      }
    },
  };

  return { h, domainChip, storage };
})();
