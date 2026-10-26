import type { MessageEnvelope } from '../types.js';

export type ChannelKind = 'dm' | 'group' | 'channel' | 'thread' | 'email' | 'unknown';

export interface SourceCapabilities {
  observeCompose: boolean;
  observeIncoming: boolean;
  canHoldSend: boolean;
  participants: boolean;
  forwardedFlag: boolean;
  audienceKinds: ChannelKind[];
}

export interface NormalizedMessage extends MessageEnvelope {
  channelKind: ChannelKind;
  /** Local, non-secret participant refs exactly as provided by the adapter (never real identities in fixtures). */
  participantIds?: string[];
  subject?: string;
}

/** A raw event as a platform would deliver it (DOM scrape, notification, API payload). */
export type RawPlatformEvent = Record<string, unknown>;

/**
 * Uniform source adapter. Adding a platform = one new module implementing this
 * interface + one registry registration; the extractor/engine core never changes.
 */
export interface SourceAdapter<TRaw extends RawPlatformEvent = RawPlatformEvent> {
  platformId: string;
  capabilities: SourceCapabilities;
  normalize(raw: TRaw): NormalizedMessage;
}

export type AnySourceAdapter = SourceAdapter<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
