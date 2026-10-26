/**
 * ContextPacket v1 — engine-side types + hardened sanitize/validate.
 * Local pseudonymous refs only: self / p1 / p2 / ... (no names/phones/emails).
 */

export const CONTEXT_PACKET_VERSION = 1 as const;

export type PacketDirection = 'outgoing' | 'incoming';
export type ConversationKind = 'direct' | 'group' | 'channel' | 'email_thread' | 'unknown';
export type FactStatus = 'known' | 'unknown' | 'disputed';
export type MessageDirection = 'outgoing' | 'incoming' | 'unknown';

export interface ContextParticipant {
  ref: string;
  isSelf?: boolean;
  roles?: string[];
}

export interface ContextRecentMessage {
  authorRef: string;
  direction: MessageDirection;
  text: string;
  ageMinutes?: number;
}

export interface ContextFact {
  id: string;
  value: string | number | boolean;
  status: FactStatus;
  provenance: string;
  scope?: string;
}

export interface ContextRelationship {
  subjectRef: string;
  relation: string;
  objectRef: string;
  status: FactStatus;
  provenance: string;
}

export interface ContextEvent {
  kind: string;
  teacherRef?: string;
  participantRefs?: string[];
}

export interface ContextPacket {
  version: 1;
  platform: string;
  direction: PacketDirection;
  conversationRef: string;
  conversationKind: ConversationKind;
  participantCount?: number;
  participants: ContextParticipant[];
  currentAuthorRef: string;
  replyToAuthorRef?: string;
  /** unknown stays undefined — never default to false */
  forwarded?: boolean;
  recentMessages: ContextRecentMessage[];
  facts: ContextFact[];
  relationships: ContextRelationship[];
  event?: ContextEvent;
  contextVersion: string;
}

export interface ContextSnapshot {
  packet: ContextPacket;
  contextVersion: string;
  factIds: string[];
  missingFactIds: string[];
}

/** loose input shape: facts may carry policy hints (sensitive / userConfirmed) */
type LooseRecord = Record<string, unknown>;

const MAX_PARTICIPANTS = 50;
const MAX_RECENT = 5;
const MAX_TEXT = 300;
const MAX_FACTS = 50;
const MAX_RELS = 50;

const REF_RE = /^(self|p[0-9]+)$/;
const FACT_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** sensitive fact ids that may become known ONLY via explicit user confirmation */
const SENSITIVE_FACT_IDS = new Set<string>([
  'family_relation',
  'family-member',
  'marital_status',
  'spouse',
  'is_married',
  'religion',
  'health',
  'location',
]);

const FAMILY_RELATIONS = new Set<string>([
  'father', 'mother', 'brother', 'sister', 'son', 'daughter',
  'spouse', 'husband', 'wife', 'family', 'relative', 'parent', 'child',
]);

function isPlainObject(v: unknown): v is LooseRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function asFactStatus(v: unknown): FactStatus {
  return v === 'known' || v === 'unknown' || v === 'disputed' ? v : 'unknown';
}

function sanitizeRef(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return REF_RE.test(t) ? t : null;
}

function sanitizeRoles(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const r of v) {
    if (typeof r !== 'string') continue;
    const t = r.trim().slice(0, 32);
    if (t) out.push(t);
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

/** stable djb2-based hash -> hex (no node:crypto dependency) */
export function hashContextString(s: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 + c) | 0;
  }
  const u1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const u2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return u1 + u2;
}

export function computeContextVersion(input: {
  platform: string;
  conversationKind: ConversationKind;
  participants: ContextParticipant[];
  facts: ContextFact[];
  relationships: ContextRelationship[];
}): string {
  const norm = JSON.stringify({
    p: input.platform,
    k: input.conversationKind,
    parts: [...input.participants]
      .map((x) => ({ ref: x.ref, isSelf: x.isSelf === true ? true : undefined }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    facts: [...input.facts]
      .map((f) => ({ id: f.id, v: f.value, s: f.status, pr: f.provenance, sc: f.scope }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rels: [...input.relationships]
      .map((r) => ({ s: r.subjectRef, r: r.relation, o: r.objectRef, st: r.status, pr: r.provenance }))
      .sort((a, b) => {
        const x = s(a);
        const y = s(b);
        return x < y ? -1 : x > y ? 1 : 0;
        function s(z: { s: string; r: string; o: string }): string {
          return z.s + '|' + z.r + '|' + z.o;
        }
      }),
  });
  return 'cv1:' + hashContextString(norm);
}

/**
 * Hardened sanitizer: allowlist only, never throws, returns null on invalid packet.
 * - drops every non-allowlisted key (name/phone/email/realId/... removed by construction)
 * - participants <= 50, recentMessages <= 5 (each text <= 300), facts <= 50, rels <= 50
 * - invalid packet direction => null; invalid message direction/kind => 'unknown'
 * - forwarded non-boolean => undefined (unknown stays unknown, never false)
 * - sensitive fact => known ONLY with provenance=user AND explicit userConfirmed=true,
 *   otherwise downgraded to unknown; model_extraction never confirms family relation.
 */
export function sanitizeContextPacket(input: unknown): ContextPacket | null {
  try {
    if (!isPlainObject(input)) return null;

    if (input['version'] !== 1) return null;

    const platform = asTrimmedString(input['platform'], 64);
    if (!platform) return null;

    const dir = input['direction'];
    if (dir !== 'outgoing' && dir !== 'incoming') return null;

    const conversationRef = asTrimmedString(input['conversationRef'], 200);
    if (!conversationRef) return null;

    const ckRaw = input['conversationKind'];
    const conversationKind: ConversationKind =
      ckRaw === 'direct' || ckRaw === 'group' || ckRaw === 'channel' || ckRaw === 'email_thread' || ckRaw === 'unknown'
        ? ckRaw
        : 'unknown';

    const currentAuthorRef = sanitizeRef(input['currentAuthorRef']);
    if (!currentAuthorRef) return null;

    // participants (allowlist ref/isSelf/roles only)
    const participants: ContextParticipant[] = [];
    if (Array.isArray(input['participants'])) {
      for (const p of (input['participants'] as unknown[]).slice(0, MAX_PARTICIPANTS)) {
        if (!isPlainObject(p)) continue;
        const ref = sanitizeRef(p['ref']);
        if (!ref) continue;
        const out: ContextParticipant = { ref };
        if (p['isSelf'] === true) out.isSelf = true;
        const roles = sanitizeRoles(p['roles']);
        if (roles) out.roles = roles;
        participants.push(out);
      }
    }

    let participantCount: number | undefined;
    const pc = input['participantCount'];
    if (typeof pc === 'number' && Number.isInteger(pc) && pc >= 0 && pc <= 100000) {
      participantCount = pc;
    }

    const replyRaw = input['replyToAuthorRef'];
    const replyToAuthorRef = replyRaw === undefined ? undefined : sanitizeRef(replyRaw) ?? undefined;

    // forwarded: unknown stays undefined, never coerced to false
    const fwd = input['forwarded'];
    const forwarded: boolean | undefined = fwd === true ? true : fwd === false ? false : undefined;

    // recentMessages: <= 5
    const recentMessages: ContextRecentMessage[] = [];
    if (Array.isArray(input['recentMessages'])) {
      for (const m of (input['recentMessages'] as unknown[]).slice(0, MAX_RECENT)) {
        if (!isPlainObject(m)) continue;
        const authorRef = sanitizeRef(m['authorRef']);
        if (!authorRef) continue;
        const text = asTrimmedString(m['text'], MAX_TEXT);
        if (!text) continue;
        const md = m['direction'];
        const direction: MessageDirection = md === 'outgoing' || md === 'incoming' ? md : 'unknown';
        const out: ContextRecentMessage = { authorRef, direction, text };
        const age = m['ageMinutes'];
        if (typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 525600) {
          out.ageMinutes = age;
        }
        recentMessages.push(out);
      }
    }

    // facts: <= 50, sensitive-known only with provenance=user + userConfirmed=true
    const facts: ContextFact[] = [];
    if (Array.isArray(input['facts'])) {
      for (const f of (input['facts'] as unknown[]).slice(0, MAX_FACTS)) {
        if (!isPlainObject(f)) continue;
        if (typeof f['id'] !== 'string' || !FACT_ID_RE.test(f['id'].trim())) continue;
        const id = (f['id'] as string).trim();
        const vv = f['value'];
        if (typeof vv !== 'string' && typeof vv !== 'number' && typeof vv !== 'boolean') continue;
        const value = typeof vv === 'string' ? vv.slice(0, 500) : vv;
        let status = asFactStatus(f['status']);
        const provRaw = typeof f['provenance'] === 'string' ? (f['provenance'] as string).trim().slice(0, 64) : '';
        const provenance = provRaw ? provRaw : 'unknown';
        const scopeRaw = typeof f['scope'] === 'string' ? (f['scope'] as string).trim().slice(0, 64) : '';
        const sensitive = f['sensitive'] === true || SENSITIVE_FACT_IDS.has(id);
        const userConfirmed = f['userConfirmed'] === true || f['confirmedByUser'] === true;
        if (sensitive && status === 'known') {
          if (!(provenance === 'user' && userConfirmed)) {
            status = 'unknown';
          }
        }
        const out: ContextFact = { id, value, status, provenance };
        if (scopeRaw) out.scope = scopeRaw;
        facts.push(out);
      }
    }

    // relationships: <= 50; model_extraction never confirms family relation
    const relationships: ContextRelationship[] = [];
    if (Array.isArray(input['relationships'])) {
      for (const r of (input['relationships'] as unknown[]).slice(0, MAX_RELS)) {
        if (!isPlainObject(r)) continue;
        const subjectRef = sanitizeRef(r['subjectRef']);
        const objectRef = sanitizeRef(r['objectRef']);
        if (!subjectRef || !objectRef) continue;
        const relation = asTrimmedString(r['relation'], 64);
        if (!relation) continue;
        let status = asFactStatus(r['status']);
        const provRaw = typeof r['provenance'] === 'string' ? (r['provenance'] as string).trim().slice(0, 64) : '';
        const provenance = provRaw ? provRaw : 'unknown';
        if (status === 'known' && provenance === 'model_extraction' && FAMILY_RELATIONS.has(relation.toLowerCase())) {
          status = 'unknown';
        }
        relationships.push({ subjectRef, relation, objectRef, status, provenance });
      }
    }

    // event (optional, allowlist only)
    let event: ContextEvent | undefined;
    if (isPlainObject(input['event'])) {
      const ev = input['event'] as LooseRecord;
      const kind = asTrimmedString(ev['kind'], 64);
      if (kind) {
        const e: ContextEvent = { kind };
        const tRef = ev['teacherRef'];
        if (tRef !== undefined) {
          const tr = sanitizeRef(tRef);
          if (tr) e.teacherRef = tr;
        }
        if (Array.isArray(ev['participantRefs'])) {
          const prs: string[] = [];
          for (const pr of (ev['participantRefs'] as unknown[]).slice(0, MAX_PARTICIPANTS)) {
            const s = sanitizeRef(pr);
            if (s) prs.push(s);
          }
          if (prs.length) e.participantRefs = prs;
        }
        event = e;
      }
    }

    const cvRaw = typeof input['contextVersion'] === 'string' ? (input['contextVersion'] as string).trim() : '';
    const contextVersion =
      cvRaw && cvRaw.length <= 128
        ? cvRaw
        : computeContextVersion({ platform, conversationKind, participants, facts, relationships });

    const packet: ContextPacket = {
      version: 1,
      platform,
      direction: dir,
      conversationRef,
      conversationKind,
      participants,
      currentAuthorRef,
      recentMessages,
      facts,
      relationships,
      contextVersion,
    };
    if (participantCount !== undefined) packet.participantCount = participantCount;
    if (replyToAuthorRef !== undefined) packet.replyToAuthorRef = replyToAuthorRef;
    if (forwarded !== undefined) packet.forwarded = forwarded;
    if (event !== undefined) packet.event = event;
    return packet;
  } catch {
    return null;
  }
}
