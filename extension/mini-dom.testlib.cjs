// Minimal DOM for extension tests (no jsdom in this repo). Supports what the
// content scripts use: an HTML fixture parser, Element/Text nodes,
// querySelector(All)/matches/closest with tag, #id, .class, [attr], [attr="v"],
// [attr*=|^=|$=|~="v"], :scope, descendant and child (>) combinators, and
// comma lists. Unsupported syntax throws (like an invalid selector).
// Test-only helper: never loaded by the extension.
'use strict';

const VOID = new Set(['BR', 'IMG', 'INPUT', 'HR', 'META', 'LINK', 'WBR']);
const BLOCK = /^(?:DIV|P|LI|TR|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE|C-WIZ|FOOTER|HEADER|MAIN|SECTION|FORM)$/;

class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentNode = null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get textContent() { return this.nodeValue; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(list) { this.el.setAttribute('class', list.join(' ')); }
  contains(c) { return this._get().includes(c); }
  add(...cs) { const l = this._get(); for (const c of cs) if (!l.includes(c)) l.push(c); this._set(l); }
  remove(...cs) { this._set(this._get().filter((c) => !cs.includes(c))); }
  get length() { return this._get().length; }
}

class Element {
  constructor(tag, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = new Map();
    this.ownerDocument = ownerDocument || null;
    this.classList = new ClassList(this);
    this.style = {};
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get attributes() { return Array.from(this._attrs, ([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  hasAttribute(k) { return this._attrs.has(k); }
  removeAttribute(k) { this._attrs.delete(k); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) { this.childNodes = this.childNodes.filter((n) => n !== c); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let c = n; c; c = c.parentNode) if (c === this) return true; return false; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
  get isContentEditable() {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) {
      const v = n.getAttribute('contenteditable');
      if (v === null) continue;
      return v === '' || v === 'true' || v === 'plaintext-only';
    }
    return false;
  }
  get offsetWidth() { return 1; }
  get offsetHeight() { return 1; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new TextNode(String(v)));
  }
  get innerText() {
    const walk = (n) => {
      let out = '';
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { out += c.nodeValue; continue; }
        if (c.tagName === 'BR') { out += '\n'; continue; }
        const inner = walk(c);
        if (BLOCK.test(c.tagName) && out && !out.endsWith('\n')) out += '\n';
        out += inner;
        if (BLOCK.test(c.tagName) && inner && !out.endsWith('\n')) out += '\n';
      }
      return out;
    };
    return walk(this).replace(/\n+$/, '');
  }
  set innerHTML(html) {
    this.textContent = '';
    for (const n of parseHTML(html, this.ownerDocument)) this.appendChild(n);
  }
  matches(sel) { return matchesList(this, parseList(sel), null); }
  closest(sel) {
    const list = parseList(sel);
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesList(n, list, null)) return n;
    return null;
  }
  querySelectorAll(sel) {
    const list = parseList(sel);
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (matchesList(c, list, this)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

class Document extends Element {
  constructor() {
    super('#document', null);
    this.nodeType = 9;
    this.ownerDocument = this;
    this.body = new Element('body', this);
    const html = new Element('html', this);
    html.appendChild(this.body);
    this.appendChild(html);
    this.documentElement = html;
    this.activeElement = this.body;
    this.listeners = {};
  }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(t) { return new TextNode(t); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, target) { for (const fn of this.listeners[type] || []) fn({ type, target }); }
  hasFocus() { return true; }
}

// --- selectors -------------------------------------------------------------
const cache = new Map();
function parseList(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const parts = [];
  let depth = 0; let quote = ''; let cur = '';
  for (const ch of sel) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  const list = parts.map((p) => parseComplex(p.trim()));
  cache.set(sel, list);
  return list;
}

function parseComplex(s) {
  if (!s) throw new SyntaxError('empty selector');
  const steps = []; // { comb: ' ' | '>' | null, compound }
  let i = 0; let comb = null;
  while (i < s.length) {
    let ws = false;
    while (i < s.length && /\s/.test(s[i])) { i++; ws = true; }
    if (s[i] === '>') { comb = '>'; i++; while (/\s/.test(s[i] || '')) i++; } else if (ws && steps.length) comb = comb || ' ';
    if (i >= s.length) break;
    let j = i; let inBr = false; let q = '';
    while (j < s.length) {
      const ch = s[j];
      if (q) { if (ch === q) q = ''; j++; continue; }
      if (inBr && (ch === '"' || ch === "'")) { q = ch; j++; continue; }
      if (ch === '[') inBr = true;
      if (ch === ']') inBr = false;
      if (!inBr && (/\s/.test(ch) || ch === '>')) break;
      j++;
    }
    steps.push({ comb: steps.length ? (comb || ' ') : null, compound: parseCompound(s.slice(i, j)) });
    comb = null;
    i = j;
  }
  return steps;
}

function parseCompound(s) {
  const c = { tag: null, ids: [], classes: [], attrs: [], scope: false };
  let rest = s;
  const take = (re) => { const m = rest.match(re); if (m) rest = rest.slice(m[0].length); return m; };
  let m;
  if ((m = take(/^\*/))) { /* any */ } else if ((m = take(/^[a-zA-Z][\w-]*/))) c.tag = m[0].toUpperCase();
  while (rest) {
    if ((m = take(/^#([\w-]+)/))) c.ids.push(m[1]);
    else if ((m = take(/^\.([\w-]+)/))) c.classes.push(m[1]);
    else if ((m = take(/^\[\s*([\w:-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/))) {
      c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? '' });
    } else if ((m = take(/^:scope/))) c.scope = true;
    else throw new SyntaxError('unsupported selector: ' + s);
  }
  return c;
}

function matchCompound(el, c, scope) {
  if (!el || el.nodeType !== 1) return false;
  if (c.scope && el !== scope) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  for (const id of c.ids) if (el.id !== id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (!a.op) continue;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && !(a.value && v.includes(a.value))) return false;
    if (a.op === '^=' && !(a.value && v.startsWith(a.value))) return false;
    if (a.op === '$=' && !(a.value && v.endsWith(a.value))) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === '|=' && !(v === a.value || v.startsWith(a.value + '-'))) return false;
  }
  return true;
}

function matchFrom(el, steps, idx, scope) {
  if (!matchCompound(el, steps[idx].compound, scope)) return false;
  if (idx === 0) return true;
  if (steps[idx].comb === '>') return matchFrom(el.parentNode, steps, idx - 1, scope);
  for (let a = el.parentNode; a && a.nodeType === 1; a = a.parentNode) {
    if (matchFrom(a, steps, idx - 1, scope)) return true;
  }
  return false;
}

function matchesList(el, list, scope) {
  return list.some((steps) => matchFrom(el, steps, steps.length - 1, scope));
}

// --- HTML fixtures ---------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t) => t.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, e) => ENT[e]);

function parseHTML(html, doc) {
  const root = new Element('#fragment', doc);
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const el = new Element(m[2], doc);
      const are = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = are.exec(m[3] || ''))) el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top.appendChild(el);
      if (!m[4] && !VOID.has(el.tagName)) stack.push(el);
    } else if (m[5]) {
      // Formatting whitespace (contains a newline) is not content.
      if (/^\s*$/.test(m[5]) && m[5].includes('\n')) continue;
      top.appendChild(new TextNode(decode(m[5])));
    }
  }
  return root.childNodes.slice();
}

function createDocument(bodyHtml = '') {
  const doc = new Document();
  doc.body.innerHTML = bodyHtml;
  return doc;
}

// Append HTML to `parent` and return the first element added.
function append(parent, html) {
  const nodes = parseHTML(html, parent.ownerDocument);
  for (const n of nodes) parent.appendChild(n);
  return nodes.find((n) => n.nodeType === 1) || null;
}

module.exports = { createDocument, append, parseHTML, Element, TextNode };
