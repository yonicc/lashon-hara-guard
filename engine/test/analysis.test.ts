// "analysis" (who / about whom / why): explanation only, validated hard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACT_CATALOG, runExtraction, validateExtraction, type MessageEnvelope } from '../src/index.js';

const TEXT = 'למי יש כח לשיעור הזה של הרב, שוב חפר שעה';

test('analysis: refs only from context participants or self; mention must be verbatim', () => {
  const v = validateExtraction({
    directAssessment: 'concern',
    analysis: {
      speakerRef: 'self',
      subjectRef: 'p7',            // not a participant -> dropped
      subjectMention: 'הרב',       // verbatim -> kept
      subjectDescriptionHe: 'מוסר השיעור',
      audience: 'group',
      claimHe: 'שהשיעור שלו משעמם וארוך',
      whyHe: 'לעג לאדם מזוהה בפני הקבוצה',
      questionsHe: ['מה התועלת?', 'האם הוא צריך לשמוע?', 'האם זה מדויק?', 'רביעית נחתכת'],
    },
  }, FACT_CATALOG, TEXT, { participantRefs: ['p1', 'p2'] });
  assert.equal(v.analysis?.speakerRef, 'self');
  assert.equal(v.analysis?.subjectRef, undefined);
  assert.equal(v.analysis?.subjectMention, 'הרב');
  assert.equal(v.analysis?.audience, 'group');
  assert.deepEqual(v.analysis?.questionsHe, ['מה התועלת?']);
});

test('analysis: invented mention, bad audience and non-strings are dropped; nothing left -> absent', () => {
  const v = validateExtraction({
    analysis: { subjectMention: 'יוסי כהן', audience: 'everyone', claimHe: 42, questionsHe: 'x' },
  }, FACT_CATALOG, TEXT, { participantRefs: ['p1'] });
  assert.equal(v.analysis, undefined);
});

test('analysis: a participant ref survives and long text is clipped', () => {
  const v = validateExtraction({
    analysis: { subjectRef: 'p2', whyHe: 'א'.repeat(500) },
  }, FACT_CATALOG, TEXT, { participantRefs: ['p1', 'p2'] });
  assert.equal(v.analysis?.subjectRef, 'p2');
  assert.ok((v.analysis?.whyHe?.length ?? 0) <= 220);
});

test('analysis: runExtraction feeds context participant refs into validation', async () => {
  const message = {
    id: 'm1', revision: 1, direction: 'outgoing', authorRef: 'user', platform: 'google-chat',
    conversationId: 'c', audienceSnapshot: {}, text: TEXT,
  } as MessageEnvelope;
  const provider = {
    id: 'stub', modelVersion: 'stub',
    extract: async () => ({ directAssessment: 'concern', analysis: { speakerRef: 'self', subjectRef: 'p3' } }),
  };
  const out = await runExtraction(message, {
    provider, catalog: FACT_CATALOG, alwaysCallProvider: true,
    context: { version: 1, participants: [{ ref: 'self', isSelf: true }, { ref: 'p3' }] },
  });
  assert.equal(out.extraction?.analysis?.subjectRef, 'p3');
});
