import type { RawPlatformEvent } from './types.js';

/** Synthetic raw platform events only — no real identities, messages or tokens. */
export const FIXTURES: Record<string, RawPlatformEvent[]> = {
  'whatsapp-web': [
    {
      id: 'wa-1', direction: 'outgoing', authorRef: 'user', conversationId: 'wa-group-lesson',
      conversationKind: 'group', text: 'השיעור הזה מבזבז לנו את הזמן',
      participantRefs: ['user', 'p-a', 'p-b', 'p-c', 'p-d'], forwarded: false,
    },
    {
      id: 'wa-2', direction: 'incoming', authorRef: 'p-a', conversationId: 'wa-dm-1',
      conversationKind: 'dm', text: 'הוא באמת יודע להסביר...', participantRefs: ['user', 'p-a'], forwarded: true,
    },
  ],
  google: [
    {
      id: 'g-chat-1', direction: 'outgoing', authorRef: 'user', conversationId: 'g-space-1',
      kind: 'space', text: 'איזה יופי שהוא שוב איחר', participantRefs: ['user', 'p-a', 'p-b'],
    },
    {
      id: 'g-mail-1', direction: 'outgoing', authorRef: 'user', conversationId: 'g-mail-thread-1',
      kind: 'mail', subject: 'סיכום שיעור (סינתטי)', text: 'מגיע ב־8, נתראה שם',
      to: ['p-a@example.invalid'], cc: ['p-b@example.invalid'], bccCount: 1,
    },
  ],
  'facebook-messenger': [
    {
      id: 'fb-1', direction: 'incoming', authorRef: 'p-a', conversationId: 'fb-group-1',
      conversationKind: 'group', text: 'ההוא מהשיעור של אתמול, אתם יודעים מי',
      participantRefs: ['user', 'p-a', 'p-b'],
    },
  ],
  android: [
    {
      id: 'and-1', direction: 'incoming', authorRef: 'notification', conversationId: 'and-conv-1',
      packageName: 'com.example.messaging', source: 'notification', text: 'מגיע ב־8',
      participantRefs: ['user', 'p-a'],
    },
    {
      id: 'and-2', direction: 'incoming', authorRef: 'accessibility', conversationId: 'and-conv-2',
      packageName: 'com.example.messaging', source: 'accessibility', text: 'הוא באמת יודע להסביר...',
    },
  ],
};
