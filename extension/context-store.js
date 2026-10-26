(function (global) {
  'use strict';

  // LHG Context Store — local-only persistence (IndexedDB with memory fallback).
  // Real display names stay ONLY in this local store, never leave the device.
  // Plain script, no build step.

  var DB_NAME = 'lhg-context';
  var DB_VERSION = 1;

  var STORES = {
    conversations: 'conversations',
    participants: 'participants',
    messages: 'messages',
    facts: 'facts',
    relationships: 'relationships'
  };

  var MAX_TEXT_LOCAL = 1000;
  var MAX_MESSAGES_PER_CONVERSATION = 30;
  var RETENTION_DAYS = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function nowMs() {
    return Date.now();
  }

  function genId(prefix) {
    return (prefix || 'id') + '_' + nowMs().toString(36) + '_' +
      Math.floor(Math.random() * 0xffffff).toString(36);
  }

  // FNV-1a 32-bit, hex. Hash of FULL text (before local truncation).
  function hashText(text) {
    var s = String(text == null ? '' : text);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function truncateLocalText(text) {
    var s = String(text == null ? '' : text);
    if (s.length > MAX_TEXT_LOCAL) return s.slice(0, MAX_TEXT_LOCAL);
    return s;
  }

  function hasIndexedDB() {
    try {
      return !!(global.indexedDB);
    } catch (e) {
      return false;
    }
  }

  // ---------- memory backend (Node/tests, or no IndexedDB) ----------
  var mem = {
    conversations: new Map(),
    participants: new Map(),
    messages: new Map(),
    facts: new Map(),
    relationships: new Map()
  };

  function memPut(store, obj) {
    mem[store].set(obj.id, obj);
    return Promise.resolve(obj);
  }

  function memGet(store, id) {
    return Promise.resolve(mem[store].has(id) ? mem[store].get(id) : null);
  }

  function memDelete(store, id) {
    mem[store].delete(id);
    return Promise.resolve(true);
  }

  function memAll(store) {
    return Promise.resolve(Array.from(mem[store].values()));
  }

  function memByConversation(store, conversationId) {
    var out = [];
    mem[store].forEach(function (v) {
      if (v && v.conversationId === conversationId) out.push(v);
    });
    return Promise.resolve(out);
  }

  function memClearAll() {
    Object.keys(mem).forEach(function (k) { mem[k].clear(); });
    return Promise.resolve(true);
  }

  // ---------- IndexedDB backend ----------
  var dbPromise = null;

  function openDb() {
    if (!hasIndexedDB()) return Promise.reject(new Error('indexeddb-unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        var conv, part, msg, facts, rels;
        if (!db.objectStoreNames.contains(STORES.conversations)) {
          conv = db.createObjectStore(STORES.conversations, { keyPath: 'id' });
          conv.createIndex('byUpdated', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.participants)) {
          part = db.createObjectStore(STORES.participants, { keyPath: 'id' });
          part.createIndex('byConversation', 'conversationId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.messages)) {
          msg = db.createObjectStore(STORES.messages, { keyPath: 'id' });
          msg.createIndex('byConversation', 'conversationId', { unique: false });
          msg.createIndex('byTime', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.facts)) {
          facts = db.createObjectStore(STORES.facts, { keyPath: 'id' });
          facts.createIndex('byConversation', 'conversationId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.relationships)) {
          rels = db.createObjectStore(STORES.relationships, { keyPath: 'id' });
          rels.createIndex('byConversation', 'conversationId', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        dbPromise = null;
        reject(req.error || new Error('indexeddb-open-failed'));
      };
    });
    return dbPromise;
  }

  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexeddb-request-failed')); };
    });
  }

  function idbPut(store, obj) {
    return openDb().then(function (db) {
      return idbReq(db.transaction(store, 'readwrite').objectStore(store).put(obj));
    });
  }

  function idbGet(store, id) {
    return openDb().then(function (db) {
      return idbReq(db.transaction(store, 'readonly').objectStore(store).get(id));
    }).then(function (v) { return v == null ? null : v; });
  }

  function idbDelete(store, id) {
    return openDb().then(function (db) {
      return idbReq(db.transaction(store, 'readwrite').objectStore(store).delete(id));
    }).then(function () { return true; });
  }

  function idbByConversation(store, conversationId) {
    return openDb().then(function (db) {
      var tx = db.transaction(store, 'readonly');
      var idx = tx.objectStore(store).index('byConversation');
      return idbReq(idx.getAll(conversationId));
    }).then(function (v) { return v || []; });
  }

  function idbAll(store) {
    return openDb().then(function (db) {
      return idbReq(db.transaction(store, 'readonly').objectStore(store).getAll());
    }).then(function (v) { return v || []; });
  }

  function useMemory() {
    return !hasIndexedDB();
  }

  // low-level dispatch
  function lowPut(store, obj) {
    if (useMemory()) return memPut(store, obj);
    return idbPut(store, obj);
  }
  function lowGet(store, id) {
    if (useMemory()) return memGet(store, id);
    return idbGet(store, id);
  }
  function lowDelete(store, id) {
    if (useMemory()) return memDelete(store, id);
    return idbDelete(store, id);
  }
  function lowByConversation(store, conversationId) {
    if (useMemory()) return memByConversation(store, conversationId);
    return idbByConversation(store, conversationId);
  }
  function lowAll(store) {
    if (useMemory()) return memAll(store);
    return idbAll(store);
  }

  function sortByTimeAsc(rows) {
    return rows.slice().sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // ---------- public API ----------
  var api = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    MAX_TEXT_LOCAL: MAX_TEXT_LOCAL,
    MAX_MESSAGES_PER_CONVERSATION: MAX_MESSAGES_PER_CONVERSATION,
    RETENTION_DAYS: RETENTION_DAYS,

    backend: function () { return useMemory() ? 'memory' : 'indexeddb'; },
    open: function () {
      if (useMemory()) return Promise.resolve(null);
      return openDb();
    },

    // conversations
    putConversation: function (conv) {
      if (!conv || !conv.id) return Promise.reject(new Error('conversation-id-required'));
      var c = Object.assign({}, conv);
      if (typeof c.contextVersion !== 'number') c.contextVersion = 0;
      if (!c.createdAt) c.createdAt = nowMs();
      c.updatedAt = nowMs();
      return lowPut(STORES.conversations, c).then(function () { return c; });
    },
    getConversation: function (id) {
      return lowGet(STORES.conversations, id);
    },
    listConversations: function () {
      return lowAll(STORES.conversations);
    },

    // participants — displayName stays LOCAL ONLY, never exported.
    putParticipant: function (p) {
      if (!p || !p.conversationId || !p.ref) {
        return Promise.reject(new Error('participant-conversation-ref-required'));
      }
      var obj = Object.assign({}, p);
      if (!obj.id) obj.id = p.conversationId + '|' + p.ref;
      return lowPut(STORES.participants, obj).then(function () { return obj; });
    },
    getParticipants: function (conversationId) {
      return lowByConversation(STORES.participants, conversationId).then(function (rows) {
        return rows.slice().sort(function (a, b) {
          return String(a.ref) < String(b.ref) ? -1 : 1;
        });
      });
    },

    // messages — local text truncated to 1000 chars + textHash of full text.
    putMessage: function (m) {
      if (!m || !m.conversationId || !m.authorRef) {
        return Promise.reject(new Error('message-conversation-author-required'));
      }
      var full = String(m.text == null ? '' : m.text);
      var obj = Object.assign({}, m);
      if (!obj.id) obj.id = genId('msg');
      obj.textHash = obj.textHash || hashText(full);
      obj.text = truncateLocalText(full);
      if (!obj.createdAt) obj.createdAt = nowMs();
      return lowPut(STORES.messages, obj).then(function () {
        return api.enforceMessageCap(obj.conversationId).then(function () { return obj; });
      });
    },
    getMessages: function (conversationId, opts) {
      var limit = opts && typeof opts.limit === 'number' ? opts.limit : 0;
      var order = (opts && opts.order) || 'asc';
      return lowByConversation(STORES.messages, conversationId).then(function (rows) {
        var sorted = sortByTimeAsc(rows);
        if (order === 'desc') sorted = sorted.reverse();
        if (limit > 0) sorted = sorted.slice(0, limit);
        return sorted;
      });
    },
    getRecentMessages: function (conversationId, limit) {
      var n = typeof limit === 'number' ? limit : 5;
      return api.getMessages(conversationId, { order: 'desc', limit: n }).then(function (rows) {
        return rows.slice().reverse();
      });
    },
    enforceMessageCap: function (conversationId, max) {
      var cap = typeof max === 'number' ? max : MAX_MESSAGES_PER_CONVERSATION;
      return lowByConversation(STORES.messages, conversationId).then(function (rows) {
        if (rows.length <= cap) return 0;
        var sorted = sortByTimeAsc(rows);
        var excess = sorted.slice(0, rows.length - cap);
        var chain = Promise.resolve(0);
        excess.forEach(function (r) {
          chain = chain.then(function (n) {
            return lowDelete(STORES.messages, r.id).then(function () { return n + 1; });
          });
        });
        return chain;
      });
    },
    // delete messages older than retentionDays (default 14)
    pruneMessages: function (conversationId, retentionDays, now) {
      var days = typeof retentionDays === 'number' ? retentionDays : RETENTION_DAYS;
      var t = typeof now === 'number' ? now : nowMs();
      var cutoff = t - days * DAY_MS;
      var getRows = conversationId
        ? lowByConversation(STORES.messages, conversationId)
        : lowAll(STORES.messages);
      return getRows.then(function (rows) {
        var old = rows.filter(function (r) { return (r.createdAt || 0) < cutoff; });
        var chain = Promise.resolve(0);
        old.forEach(function (r) {
          chain = chain.then(function (n) {
            return lowDelete(STORES.messages, r.id).then(function () { return n + 1; });
          });
        });
        return chain;
      });
    },

    // facts
    putFact: function (f) {
      if (!f || !f.conversationId || !f.id) {
        return Promise.reject(new Error('fact-conversation-id-required'));
      }
      var obj = Object.assign({}, f);
      return lowPut(STORES.facts, obj).then(function () { return obj; });
    },
    getFacts: function (conversationId) {
      return lowByConversation(STORES.facts, conversationId);
    },
    deleteFact: function (id) {
      return lowDelete(STORES.facts, id);
    },

    // relationships
    putRelationship: function (r) {
      if (!r || !r.conversationId || !r.id) {
        return Promise.reject(new Error('relationship-conversation-id-required'));
      }
      var obj = Object.assign({}, r);
      return lowPut(STORES.relationships, obj).then(function () { return obj; });
    },
    getRelationships: function (conversationId) {
      return lowByConversation(STORES.relationships, conversationId);
    },
    deleteRelationship: function (id) {
      return lowDelete(STORES.relationships, id);
    },

    // full per-conversation delete (conversation + all derivatives)
    deleteConversation: function (conversationId) {
      var stores = [STORES.participants, STORES.messages, STORES.facts, STORES.relationships];
      var chain = Promise.resolve();
      stores.forEach(function (st) {
        chain = chain.then(function () {
          return lowByConversation(st, conversationId).then(function (rows) {
            var c = Promise.resolve();
            rows.forEach(function (r) {
              c = c.then(function () { return lowDelete(st, r.id); });
            });
            return c;
          });
        });
      });
      return chain.then(function () {
        return lowDelete(STORES.conversations, conversationId);
      }).then(function () { return true; });
    },

    // retention sweep across all conversations' messages
    purgeExpired: function (retentionDays, now) {
      return api.pruneMessages(null, retentionDays, now);
    },

    clearAll: function () {
      if (useMemory()) return memClearAll();
      return openDb().then(function (db) {
        var names = [STORES.conversations, STORES.participants, STORES.messages, STORES.facts, STORES.relationships];
        var tx = db.transaction(names, 'readwrite');
        names.forEach(function (n) { tx.objectStore(n).clear(); });
        return new Promise(function (resolve, reject) {
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error || new Error('clear-failed')); };
        });
      });
    },

    hashText: hashText,

    _mem: mem,
    _resetMemory: memClearAll
  };

  global.LHG_CONTEXT_STORE = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
