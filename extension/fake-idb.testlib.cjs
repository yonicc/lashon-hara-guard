// Minimal in-memory IndexedDB for node tests of memory.mjs (no dependency).
// Covers exactly what LocalMemory uses: open/upgrade, one object store with a
// keyPath and one index, get/getAll/put/delete/clear, auto-committing
// transactions (oncomplete once no request is pending after a macrotask).
const clone = (v) => structuredClone(v);
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  function open(name) {
    const req = {};
    later(() => {
      let db = dbs.get(name);
      const fresh = !db;
      if (fresh) { db = { stores: new Map() }; dbs.set(name, db); }
      const handle = {
        onversionchange: null,
        close() {},
        createObjectStore(sname, { keyPath }) {
          const s = { keyPath, rows: new Map(), indexes: new Map() };
          db.stores.set(sname, s);
          return { createIndex(iname, path) { s.indexes.set(iname, path); } };
        },
        transaction(sname, _mode) {
          const s = db.stores.get(sname);
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
          let pending = 0, done = false;
          const check = () => later(() => {
            if (!done && pending === 0) { done = true; if (tx.oncomplete) tx.oncomplete(); }
          });
          const request = (fn) => {
            const r = {};
            pending++;
            later(() => { pending--; r.result = fn(); if (r.onsuccess) r.onsuccess(); check(); });
            return r;
          };
          tx.objectStore = () => ({
            get: (k) => request(() => (s.rows.has(k) ? clone(s.rows.get(k)) : undefined)),
            getAll: () => request(() => [...s.rows.values()].map(clone)),
            put: (row) => { s.rows.set(row[s.keyPath], clone(row)); return request(() => row[s.keyPath]); },
            delete: (k) => { s.rows.delete(k); return request(() => undefined); },
            clear: () => { s.rows.clear(); return request(() => undefined); },
            index: (iname) => ({
              getAll: (v) => request(() => [...s.rows.values()].filter((r) => r[s.indexes.get(iname)] === v).map(clone)),
            }),
          });
          check();
          return tx;
        },
      };
      req.result = handle;
      if (fresh && req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    });
    return req;
  }
  return { open, dbs };
}
module.exports = { fakeIndexedDB };
