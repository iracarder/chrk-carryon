/* Минимальный DOM-шим для прогона index.html в node. Только для тестов, в деплой не идёт. */

function parseSelectors(sel) {
  return sel.split(",").map(s => s.trim()).filter(Boolean).map(part => {
    const m = part.match(/^([a-zA-Z0-9-]*)((?:[.#][^.#]+)*)(\[[^\]]+\])?$/);
    if (!m) return null;
    const out = { tag: (m[1] || "").toLowerCase(), classes: [], attrs: null };
    const rest = (m[2] || "") + (m[3] || "");
    for (const tok of rest.match(/[.#][^.#\[]+|\[[^\]]+\]/g) || []) {
      if (tok[0] === ".") out.classes.push(tok.slice(1));
      else if (tok[0] === "#") out.classes.push(tok.slice(1));
      else {
        const a = tok.slice(1, -1).split("=");
        out.attrs = out.attrs || [];
        out.attrs.push([a[0], a[1] === undefined ? null : a[1].replace(/^["']|["']$/g, "")]);
      }
    }
    return out;
  }).filter(Boolean);
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.style = new Proxy({ setProperty(){}, getPropertyValue(){ return ""; }, removeProperty(){} }, {
      get: (t, k) => (k in t ? t[k] : ""),
      set: (t, k, v) => { t[k] = v; return true; }
    });
    this.dataset = {};
    this._text = "";
    this._html = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.handlers = {};
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.scrollHeight = 2400;   // имитация длинной страницы
    this.clientWidth = 1200;
    this.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 });
  }
  get children() { return this.childNodes.filter(n => n instanceof El); }
  get childElementCount() { return this.childNodes.length; }
  set dataset(v){ /* noop */ }
  get dataset() { return this._dataset || (this._dataset = new Proxy({}, {
    get: (t, k) => this.getAttribute("data-" + String(k).replace(/[A-Z]/g, m => "-" + m.toLowerCase())),
    set: (t, k, v) => { this.setAttribute("data-" + String(k), v); return true; },
    has: (t, k) => this.getAttribute("data-" + String(k)) != null
  })); }
  get id() { return this.attributes.id || ""; }
  get className() { return this.attributes["class"] || ""; }
  set className(v) { this.attributes["class"] = v; }
  get classList() {
    const self = this;
    return {
      add(...c) { const s = new Set((self.className || "").split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); self.className = [...s].join(" "); },
      remove(...c) { const s = new Set((self.className || "").split(/\s+/).filter(Boolean)); c.forEach(x => s.delete(x)); self.className = [...s].join(" "); },
      contains(c) { return (self.className || "").split(/\s+/).includes(c); },
      toggle(c, on) { on ? this.classList.add(c) : this.classList.remove(c); }
    };
  }
  set textContent(v) { this._text = String(v); this.childNodes = []; this._html = ""; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map(n => n.textContent).join("");
    return this._text;
  }
set innerHTML(v) {
    this.childNodes = [];
    this._html = String(v);
    this._text = "";
    parseInto(this, this._html);
  }
  get innerHTML() { return this._html + this.textContent; }
appendChild(n) {
    if (n && n.__frag) { n.childNodes.forEach(c => { c._parent = this; this.childNodes.push(c); }); n.childNodes = []; return n; }
    n._parent = this;
    this.childNodes.push(n);
    return n;
  }
  insertBefore(n) { return this.appendChild(n); }
  removeChild(n) { this.childNodes = this.childNodes.filter(c => c !== n); return n; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  fire(type, ev) { (this.handlers[type] || []).forEach(fn => fn(ev)); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  cloneNode() { const c = new El(this.tagName); c.className = this.className; c.value = this.value; return c; }
  matches(sel) {
    return parseSelectors(sel).some(s => {
      if (s.tag && s.tag !== this.tagName.toLowerCase()) return false;
      for (const cl of s.classes) if (!this.classList.contains(cl)) return false;
      for (const [k, v] of s.attrs || []) {
        const have = this.getAttribute(k);
        if (have == null) return false;
        if (v !== null && have !== v) return false;
      }
      return true;
    });
  }
  closest(sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; }
  findAll(sel, out = []) { for (const c of this.childNodes) { if (c.matches && c.matches(sel)) out.push(c); c.findAll(sel, out); } return out; }
  find(sel) { return this.findAll(sel)[0] || null; }
  get parentNode() { return this._parent || null; }
}

class Frag extends El {
  constructor() { super("#fragment"); this.__frag = true; }
}

/* Минимальный парсер HTML: достаточен для разметки этой страницы
   (вложенные теги, атрибуты в кавычках, самозакрывающиеся теги, текст между тегами). */
const VOID = new Set(["input", "br", "img", "meta", "hr", "link", "source", "path", "rect", "circle", "line", "polyline", "polygon", "use", "ellipse", "stop"]);

function parseInto(root, html) {
  const stack = [root];
  const re = /<\/?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const txt = m[4];
      if (txt.trim()) { const t = new El("#text"); t._text = txt; stack[stack.length - 1].appendChild(t); }
      continue;
    }
    const closing = m[0][1] === "/";
    const tag = m[1].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(tag);
    const attrRe = /([a-zA-Z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let a;
    while ((a = attrRe.exec(m[2] || ""))) {
      const val = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      el.setAttribute(a[1], val);
      if (a[1] === "class") el.className = val;
      if (a[1] === "value") el.value = val;
      if (a[1] === "checked") el.checked = true;
      if (a[1] === "disabled") el.disabled = true;
      if (a[1] === "selected") el.selected = true;
    }
    if (VOID.has(tag) && m[3] !== "/") {
      /* одиночный тег: не остаётся в стеке, но закрывающий тег найдёт ближайшего предка */
    }
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(tag) && m[3] !== "/") stack.push(el);
  }
}

function buildContext(html) {
  const doc = new El("html");

  /* Разбираем настоящую разметку, иначе статические атрибуты (data-i18n,
     aria-label, placeholder) не существовали бы и перевод не проверялся бы.
     <style>/<script> вырезаем: мини-парсеру они не нужны. */
  let src = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  parseInto(doc, src);

  const body = doc.find("body") || doc.appendChild(new El("body"));

  const byId = new Map();
  for (const el of doc.findAll("[id]")) {
    const id = el.getAttribute("id");
    if (id && !byId.has(id)) byId.set(id, el);
  }

  const titleEl = doc.find("title");
  const document = {
    documentElement: doc,
    body,
    /* как в браузере: document.title — это текст элемента <title> */
    get title() { return titleEl ? titleEl.textContent : ""; },
    set title(v) { if (titleEl) titleEl.textContent = v; },
    getElementById: id => byId.get(id) || null,
    querySelector: sel => doc.find(sel),
    querySelectorAll: sel => doc.findAll(sel),
    createElement: t => new El(t),
    createElementNS: (ns, t) => new El(t),
    createDocumentFragment: () => new Frag(),
    execCommand: () => true,
    addEventListener: (t, fn) => body.addEventListener(t, fn)
  };
  const store = new Map();
const context = {
    console,
    document,
    location: { origin: "https://example.net", pathname: "/tool", hash: "", href: "https://example.net/tool" },
    history: { replaceState(_s, _t, url) { const h = String(url).indexOf("#"); context.location.hash = h >= 0 ? String(url).slice(h) : ""; } },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    navigator: { clipboard: { writeText: async () => {} } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: fn => setTimeout(fn, 0),
    setTimeout: (fn, ms) => setTimeout(fn, 0),
    clearTimeout: id => clearTimeout(id),
    URLSearchParams,
    __byId: byId
  };
  context.window = context;
  context.globalThis = context;
  context.addEventListener = (t, fn) => body.addEventListener(t, fn);
  context.removeEventListener = () => {};
  context.dispatchEvent = () => true;
  return context;
}

module.exports = { El, Frag, buildContext };