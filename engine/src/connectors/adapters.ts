import type { MessageEnvelope } from '../types.js';
import type { NormalizedMessage, SourceAdapter } from './types.js';

function str(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
function dir(v: unknown): MessageEnvelope['direction'] { return v === 'incoming' ? 'incoming' : 'outgoing'; }

function base(raw: Record<string, unknown>, platform: string): NormalizedMessage {
  return {
    id: str(raw.id, 'unknown-id'),
    revision: typeof raw.revision === 'number' ? raw.revision : 1,
    direction: dir(raw.direction),
    authorRef: str(raw.authorRef, 'unknown'),
    platform,
    conversationId: str(raw.conversationId, 'unknown-conversation'),
    audienceSnapshot: {},
    text: str(raw.text),
    channelKind: 'unknown',
  };
}

// --- WhatsApp Web (DOM-event shaped fixture; no live scraping in this phase) ---
export interface WhatsAppRaw {
  id?: string; revision?: number; direction?: string; authorRef?: string;
  conversationId?: string; conversationKind?: string; text?: string;
  forwarded?: boolean; participantRefs?: string[];
}
export const WhatsAppWebAdapter: SourceAdapter<WhatsAppRaw & Record<string, unknown>> = {
  platformId: 'whatsapp-web',
  capabilities: { observeCompose: true, observeIncoming: true, canHoldSend: false, participants: true, forwardedFlag: true, audienceKinds: ['dm', 'group'] },
  normalize(raw) {
    const m = base(raw, 'whatsapp-web');
    const participants = strArr(raw.participantRefs);
    m.channelKind = raw.conversationKind === 'group' ? 'group' : 'dm';
    m.participantIds = participants;
    m.audienceSnapshot = { participantCount: participants.length || undefined, participantRefs: participants };
    m.forwarded = raw.forwarded === true;
    return m;
  },
};

// --- Google: Chat + Gmail share one adapter family; mail carries To/CC/BCC + subject ---
export interface GoogleRaw {
  id?: string; revision?: number; direction?: string; authorRef?: string;
  conversationId?: string; kind?: string; text?: string; subject?: string;
  forwarded?: boolean; to?: string[]; cc?: string[]; bccCount?: number; participantRefs?: string[];
}
export const GoogleAdapter: SourceAdapter<GoogleRaw & Record<string, unknown>> = {
  platformId: 'google',
  capabilities: { observeCompose: true, observeIncoming: true, canHoldSend: false, participants: true, forwardedFlag: true, audienceKinds: ['dm', 'group', 'thread', 'email'] },
  normalize(raw) {
    const m = base(raw, 'google');
    if (raw.kind === 'mail') {
      m.channelKind = 'email';
      const to = strArr(raw.to); const cc = strArr(raw.cc);
      m.audienceSnapshot = { to, cc, bccCount: typeof raw.bccCount === 'number' ? raw.bccCount : undefined, participantRefs: [...to, ...cc] };
      m.participantIds = [...to, ...cc];
      if (raw.subject) m.subject = str(raw.subject);
    } else {
      m.channelKind = raw.kind === 'space' ? 'group' : raw.kind === 'thread' ? 'thread' : 'dm';
      const participants = strArr(raw.participantRefs);
      m.participantIds = participants;
      m.audienceSnapshot = { participantCount: participants.length || undefined, participantRefs: participants };
    }
    m.forwarded = raw.forwarded === true;
    return m;
  },
};

// --- Facebook / Messenger ---
export interface FacebookRaw {
  id?: string; revision?: number; direction?: string; authorRef?: string;
  conversationId?: string; conversationKind?: string; text?: string;
  forwarded?: boolean; participantRefs?: string[];
}
export const FacebookMessengerAdapter: SourceAdapter<FacebookRaw & Record<string, unknown>> = {
  platformId: 'facebook-messenger',
  capabilities: { observeCompose: true, observeIncoming: true, canHoldSend: false, participants: true, forwardedFlag: false, audienceKinds: ['dm', 'group'] },
  normalize(raw) {
    const m = base(raw, 'facebook-messenger');
    const participants = strArr(raw.participantRefs);
    m.channelKind = raw.conversationKind === 'group' ? 'group' : 'dm';
    m.participantIds = participants;
    m.audienceSnapshot = { participantCount: participants.length || undefined, participantRefs: participants };
    // Messenger fixtures do not reliably expose a forwarded flag — stay undefined (unknown, not false).
    m.forwarded = raw.forwarded === true ? true : undefined;
    return m;
  },
};

// --- Android (notification/accessibility shaped; cannot hold send, participants often partial) ---
export interface AndroidRaw {
  id?: string; revision?: number; direction?: string; authorRef?: string;
  conversationId?: string; packageName?: string; text?: string;
  forwarded?: boolean; participantRefs?: string[]; source?: string;
}
export const AndroidAdapter: SourceAdapter<AndroidRaw & Record<string, unknown>> = {
  platformId: 'android',
  capabilities: { observeCompose: false, observeIncoming: true, canHoldSend: false, participants: false, forwardedFlag: false, audienceKinds: ['dm', 'group', 'unknown'] },
  normalize(raw) {
    const m = base(raw, 'android');
    const participants = strArr(raw.participantRefs);
    m.channelKind = participants.length > 2 ? 'group' : participants.length ? 'dm' : 'unknown';
    m.participantIds = participants.length ? participants : undefined;
    m.audienceSnapshot = participants.length
      ? { participantCount: participants.length, participantRefs: participants }
      : {};
    m.forwarded = undefined; // notifications do not expose this reliably
    return m;
  },
};

export const ALL_ADAPTERS = [WhatsAppWebAdapter, GoogleAdapter, FacebookMessengerAdapter, AndroidAdapter];
