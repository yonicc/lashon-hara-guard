(function () {
  'use strict';

  var PACKET_VERSION = 1;
  var MAX_RECENT = 5;
  var MAX_TEXT_OUT = 300;

  var KINDS = { direct: 1, group: 1, channel: 1, email_thread: 1, unknown: 1 };

  function normKind(k) {
    if (k && KINDS[k]) return k;
    return 'unknown';
  }

  function trunc(s, n) {
    s = String(s == null ? '' : s);
    if (s.length > n) return s.slice(0, n);
    return s;
  }

  function isRef(r) {
    return r === 'self' || (/^p\d+$/.test(r || ''));
  }

  function scrubExportText(text, displayNames) {
    var s = String(text == null ? '' : text);
    var names = displayNames || [];
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      if (!nm || nm.length < 2) continue;
      var esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        s = s.replace(new RegExp(esc, 'gi'), '[name]');
      } catch (e) { /* ignore */ }
    }
    // emails never leave
    s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
    // phone-like sequences (7+ digits with optional separators) never leave
    s = s.replace(/\+?[\d][\d\s\-().]{5,}\d/g, function (m) {
      var digits = m.replace(/\D/g, '');
      if (digits.length >= 7) return '[phone]';
      return m;
    });
    return s;
  }

  function nowMs(now) {
    if (typeof now === 'function') {
      try { return now(); } catch (e) { return Date.now(); }
    }
    return Date.now();
  }

  function createContextBuilder(opts) {
    opts = opts || {};
    var extStore = opts.store || globalThis.LHG_CONTEXT_STORE || null;
    var nowFn = opts.now || null;

    var convs = new Map();          // convId -> { kind, platform, direction }
    var parts = new Map();          // convId -> Map(key -> { ref, display, isSelf, roles })
    var refCount = new Map();       // convId -> n
    var messages = new Map();       // convId -> [{ id, authorRef, direction, text, ts }]
    var facts = new Map();          // convId -> Map(id -> fact)
    var rels = new Map();           // convId -> Map(id -> rel)
    var versions = new Map();       // convId -> int
    var msgSeq = 0;

    function bump(convId) {
      var v = (versions.get(convId) || 0) + 1;
      versions.set(convId, v);
      return v;
    }

    function getVersion(convId) {
      return versions.get(convId) || 0;
    }

    function ensureConv(convId) {
      if (!convs.has(convId)) {
        convs.set(convId, { kind: 'unknown', platform: 'unknown', direction: 'unknown' });
        versions.set(convId, 0);
      }
      if (!parts.has(convId)) { parts.set(convId, new Map()); refCount.set(convId, 0); }
      if (!messages.has(convId)) messages.set(convId, []);
      if (!facts.has(convId)) facts.set(convId, new Map());
      if (!rels.has(convId)) rels.set(convId, new Map());
      return convs.get(convId);
    }

    function displayKey(displayName) {
      return 'n:' + String(displayName || '').trim().toLowerCase();
    }

    function allocRef(convId, displayName, isSelf) {
      ensureConv(convId);
      var m = parts.get(convId);
      if (isSelf) {
        var kSelf = displayKey(displayName || '__self__');
        // Only one self ref per conversation.
        for (var e of m.values()) {
          if (e.isSelf) {
            if (displayName && !e.display) e.display = String(displayName);
            return 'self';
          }
        }
        m.set(kSelf, { ref: 'self', display: displayName ? String(displayName) : '', isSelf: true, roles: [] });
        return 'self';
      }
      var k = displayKey(displayName);
      var hit = m.get(k);
      if (hit) return hit.ref;
      var n = (refCount.get(convId) || 0) + 1;
      refCount.set(convId, n);
      var ref = 'p' + n;
      m.set(k, { ref: ref, display: String(displayName || ''), isSelf: false, roles: [] });
      return ref;
    }

    function resolveRef(convId, displayName, ref, isSelf) {
      ensureConv(convId);
      if (ref && isRef(ref)) {
        // Adopt mapping so future display-name lookups hit the same ref.
        if (displayName) {
          var m = parts.get(convId);
          var k = displayKey(displayName);
          if (!m.has(k)) {
            if (ref === 'self') {
              m.set(k, { ref: 'self', display: String(displayName), isSelf: true, roles: [] });
            } else {
              var num = parseInt(ref.slice(1), 10);
              if (num > (refCount.get(convId) || 0)) refCount.set(convId, num);
              m.set(k, { ref: ref, display: String(displayName), isSelf: false, roles: [] });
            }
          }
        }
        return ref;
      }
      if (displayName) return allocRef(convId, displayName, !!isSelf);
      return 'unknown';
    }

    function localDisplayNames(convId) {
      var m = parts.get(convId);
      if (!m) return [];
      var out = [];
      for (var e of m.values()) {
        if (e.display) out.push(e.display);
      }
      return out;
    }

    function persist(op) {
      // Best-effort mirror into LHG_CONTEXT_STORE when it offers a matching method.
      try {
        if (!extStore) return;
        if (typeof extStore[op.fn] === 'function') {
          return Promise.resolve(extStore[op.fn].apply(extStore, op.args || [])).catch(function () {});
        }
      } catch (e) { /* local builder never crashes on persistence */ }
    }

    async function ingestConversation(input) {
      input = input || {};
      var id = String(input.id || input.conversationId || '');
      if (!id) throw new Error('ingestConversation: missing id');
      ensureConv(id);
      var meta = convs.get(id);
      if (input.kind) meta.kind = normKind(input.kind);
      if (input.platform) meta.platform = String(input.platform);
      if (input.direction) meta.direction = String(input.direction);
      bump(id);
      await persist({ fn: 'putConversation', args: [{ id: id, kind: meta.kind, platform: meta.platform }] });
      return { id: id, contextVersion: getVersion(id) };
    }

    async function ingestParticipant(convId, p) {
      p = p || {};
      convId = String(convId || p.conversationId || '');
      if (!convId) throw new Error('ingestParticipant: missing conversationId');
      ensureConv(convId);
      var ref = allocRef(convId, p.displayName || p.name || '', !!p.isSelf);
      var m = parts.get(convId);
      var ent = null;
      for (var e of m.values()) { if (e.ref === ref) { ent = e; break; } }
      if (ent && p.roles && ent) {
        ent.roles = Array.isArray(p.roles) ? p.roles.slice() : ent.roles;
      }
      bump(convId);
      await persist({ fn: 'putParticipant', args: [{ conversationId: convId, ref: ref, displayName: ent ? ent.display : '' }] });
      return ref;
    }

    async function ingestMessage(convId, msg) {
      msg = msg || {};
      convId = String(convId || msg.conversationId || '');
      if (!convId) throw new Error('ingestMessage: missing conversationId');
      ensureConv(convId);
      var authorRef = resolveRef(convId, msg.authorDisplayName || msg.displayName || '', msg.authorRef || '', !!msg.isSelf);
      var ts = (msg.timestamp != null ? msg.timestamp : nowMs(nowFn));
      var entry = {
        id: String(msg.id || ('m' + (++msgSeq))),
        authorRef: authorRef,
        direction: String(msg.direction || 'unknown'),
        text: String(msg.text || ''),
        ts: ts
      };
      var history = messages.get(convId);
      var existing = history.findIndex(function (m) { return m.id === entry.id; });
      if (existing >= 0) history.splice(existing, 1);
      history.push(entry);
      if (history.length > 30) history.splice(0, history.length - 30);
      bump(convId);
      await persist({ fn: 'putMessage', args: [Object.assign({ conversationId: convId }, entry)] });
      return entry.id;
    }

    async function proposeFact(convId, f) {
      f = f || {};
      convId = String(convId || f.conversationId || '');
      if (!convId) throw new Error('proposeFact: missing conversationId');
      ensureConv(convId);
      var id = String(f.id || ('f' + (facts.get(convId).size + 1)));
      var rec = {
        id: id,
        value: typeof f.value === 'boolean' || typeof f.value === 'number' ? f.value : String(f.value || ''),
        sensitive: !!f.sensitive,
        // A model/content proposal is NEVER known.
        status: 'candidate',
        provenance: String(f.provenance || 'content'),
        scope: f.scope ? String(f.scope) : undefined
      };
      facts.get(convId).set(id, rec);
      bump(convId);
      return id;
    }

    async function proposeRelationship(convId, r) {
      r = r || {};
      convId = String(convId || r.conversationId || '');
      if (!convId) throw new Error('proposeRelationship: missing conversationId');
      ensureConv(convId);
      var id = String(r.id || ('r' + (rels.get(convId).size + 1)));
      var rec = {
        id: id,
        subjectRef: isRef(r.subjectRef) ? r.subjectRef : 'unknown',
        relation: String(r.relation || ''),
        objectRef: isRef(r.objectRef) ? r.objectRef : 'unknown',
        status: 'candidate',
        provenance: String(r.provenance || 'content')
      };
      rels.get(convId).set(id, rec);
      bump(convId);
      return id;
    }

    // Only explicit user confirmation turns a (sensitive or not) fact/relationship known.
    async function confirmFact(convId, factId) {
      ensureConv(convId);
      var m = facts.get(convId);
      var rec = m.get(String(factId));
      if (!rec) throw new Error('confirmFact: unknown fact ' + factId);
      rec.status = 'known';
      rec.provenance = 'user_confirmed';
      bump(convId);
      return true;
    }

    async function confirmRelationship(convId, relId) {
      ensureConv(convId);
      var m = rels.get(convId);
      var rec = m.get(String(relId));
      if (!rec) throw new Error('confirmRelationship: unknown relationship ' + relId);
      rec.status = 'known';
      rec.provenance = 'user_confirmed';
      bump(convId);
      return true;
    }

    async function markUnknown(convId, kind, id) {
      ensureConv(convId);
      var m = (kind === 'relationship') ? rels.get(convId) : facts.get(convId);
      var rec = m.get(String(id));
      if (!rec) throw new Error('markUnknown: unknown ' + kind + ' ' + id);
      rec.status = 'unknown';
      bump(convId);
      return true;
    }

    async function deleteConversation(convId) {
      convId = String(convId);
      convs.delete(convId);
      parts.delete(convId);
      refCount.delete(convId);
      messages.delete(convId);
      facts.delete(convId);
      rels.delete(convId);
      versions.delete(convId);
      await persist({ fn: 'deleteConversation', args: [convId] });
      return true;
    }

    function exportFacts(convId, names) {
      var m = facts.get(convId);
      if (!m) return [];
      var out = [];
      for (var rec of m.values()) {
        var status = rec.status;
        // Sensitive facts are known ONLY with explicit user provenance.
        if (rec.sensitive && !(status === 'known' && rec.provenance === 'user_confirmed')) {
          status = (status === 'candidate') ? 'candidate' : 'unknown';
          if (status !== 'candidate') status = 'unknown';
        }
        var f = { id: rec.id, value: typeof rec.value === 'string' ? scrubExportText(rec.value, names) : rec.value, status: status, provenance: rec.provenance };
        if (rec.scope) f.scope = rec.scope;
        out.push(f);
      }
      return out;
    }

    function exportRels(convId) {
      var m = rels.get(convId);
      if (!m) return [];
      var out = [];
      for (var rec of m.values()) {
        out.push({
          subjectRef: rec.subjectRef,
          relation: rec.relation,
          objectRef: rec.objectRef,
          status: rec.status,
          provenance: rec.provenance
        });
      }
      return out;
    }

    // Build the outgoing v1 packet. Never includes real names/phones/emails.
    async function buildPacket(convId, current) {
      current = current || {};
      convId = String(convId || current.conversationId || '');
      if (!convId) throw new Error('buildPacket: missing conversationId');
      ensureConv(convId);
      var meta = convs.get(convId);

      var currentAuthorRef = resolveRef(
        convId,
        current.authorDisplayName || current.displayName || '',
        current.authorRef || '',
        !!current.isSelf
      );
      var replyToAuthorRef;
      if (current.replyToAuthorDisplayName || current.replyToAuthorRef) {
        var r = resolveRef(convId, current.replyToAuthorDisplayName || '', current.replyToAuthorRef || '', false);
        if (isRef(r)) replyToAuthorRef = r;
      }

      // Recent window: up to MAX_RECENT messages BEFORE the current one, chronological.
      var names = localDisplayNames(convId);
      var hist = (messages.get(convId) || []).slice();
      hist.sort(function (a, b) { return (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0); });
      // Exclude the current message itself if it was already ingested (duplicate guard).
      var curText = String(current.text || '');
      var curTs = (current.timestamp != null ? current.timestamp : nowMs(nowFn));
      var filtered = hist.filter(function (m) {
        if (m.ts > curTs) return false;
        if (current.id && m.id === String(current.id)) return false;
        if (curText && m.text === curText && m.authorRef === currentAuthorRef && Math.abs((m.ts || 0) - (curTs || 0)) < 1000) return false;
        return true;
      });
      // Only messages at/before now-ish; then take the last MAX_RECENT.
      var tail = filtered.slice(-MAX_RECENT);
      var nowT = nowMs(nowFn);
      var recentMessages = tail.map(function (m) {
        var age = null;
        try {
          if (typeof m.ts === 'number' && typeof nowT === 'number' && nowT >= m.ts) {
            age = Math.max(0, Math.round((nowT - m.ts) / 60000));
          }
        } catch (e) { age = null; }
        var rm = {
          authorRef: m.authorRef,
          direction: m.direction,
          text: trunc(scrubExportText(m.text, names), MAX_TEXT_OUT)
        };
        if (age != null) rm.ageMinutes = age;
        return rm;
      });

      var plist = [];
      var m2 = parts.get(convId);
      if (m2) {
        for (var e of m2.values()) {
          var p = { ref: e.ref };
          if (e.isSelf) p.isSelf = true;
          if (e.roles && e.roles.length) p.roles = e.roles.slice();
          plist.push(p);
        }
        plist.sort(function (a, b) {
          if (a.ref === 'self' && b.ref !== 'self') return -1;
          if (b.ref === 'self' && a.ref !== 'self') return 1;
          return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
        });
      }
      // The current author must appear in participants even if never ingested before.
      if (isRef(currentAuthorRef) && currentAuthorRef !== 'unknown') {
        var found = false;
        for (var i = 0; i < plist.length; i++) { if (plist[i].ref === currentAuthorRef) { found = true; break; } }
        if (!found) {
          var np = { ref: currentAuthorRef };
          if (currentAuthorRef === 'self' || !!current.isSelf) np.isSelf = true;
          plist.push(np);
        }
      }

      var packet = {
        version: 1,
        platform: String(meta.platform || current.platform || 'unknown'),
        direction: String(current.direction || meta.direction || 'unknown'),
        conversationRef: convId,
        conversationKind: normKind(meta.kind || current.conversationKind),
        participants: plist,
        currentAuthorRef: currentAuthorRef,
        recentMessages: recentMessages,
        facts: exportFacts(convId, names),
        relationships: exportRels(convId),
        contextVersion: String(getVersion(convId))
      };
      // Visible authors are not the total audience; do not invent a count.
      if (replyToAuthorRef) packet.replyToAuthorRef = replyToAuthorRef;
      if (typeof current.forwarded === 'boolean') packet.forwarded = current.forwarded;
      if (current.event != null) packet.event = current.event;
      return packet;
    }

    // Optional DOM-assisted entry: uses LHG_CONTEXT_DOM only when present.
    function readDomHints(root) {
      var hints = {};
      try {
        var D = (typeof globalThis !== 'undefined') ? globalThis.LHG_CONTEXT_DOM : null;
        if (!D) return hints;
        if (root != null && typeof D.parsePrePlainText === 'function') {
          try { hints.pre = D.parsePrePlainText(root); } catch (e) {}
        }
        if (root != null && typeof D.detectForwarded === 'function') {
          try { hints.forwarded = D.detectForwarded(root); } catch (e) {}
        }
        if (root != null && typeof D.detectQuoted === 'function') {
          try { hints.quoted = D.detectQuoted(root); } catch (e) {}
        }
        if (root != null && typeof D.extractAuthorFromBubble === 'function') {
          try { hints.author = D.extractAuthorFromBubble(root); } catch (e) {}
        }
        if (typeof D.extractVisibleParticipants === 'function') {
          try { hints.visible = D.extractVisibleParticipants(root != null ? root : null); } catch (e) {}
        }
      } catch (e) { /* never crash without DOM helpers */ }
      return hints;
    }

    return {
      createContextBuilder: createContextBuilder,
      ingestConversation: ingestConversation,
      ingestParticipant: ingestParticipant,
      ingestMessage: ingestMessage,
      proposeFact: proposeFact,
      proposeRelationship: proposeRelationship,
      confirmFact: confirmFact,
      confirmRelationship: confirmRelationship,
      markUnknown: markUnknown,
      deleteConversation: deleteConversation,
      buildPacket: buildPacket,
      readDomHints: readDomHints,
      getContextVersion: function (convId) { return getVersion(String(convId)); },
      PACKET_VERSION: PACKET_VERSION,
      MAX_RECENT: MAX_RECENT
    };
  }

  var api = {
    createContextBuilder: createContextBuilder,
    PACKET_VERSION: PACKET_VERSION,
    MAX_RECENT: MAX_RECENT
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.LHG_CONTEXT_BUILDER = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
