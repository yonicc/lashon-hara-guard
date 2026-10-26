import type { ExtractorProvider, ExtractorRequest, RawExtraction } from './types.js';
import { normalizeHebrewText } from './normalize.js';

/**
 * Deterministic offline provider for tests/demo. No network, no real model.
 * It is intentionally simple and conservative; it never returns user-only facts
 * and never returns a verdict — only proposed facts + a meaning assessment.
 */
export class MockExtractorProvider implements ExtractorProvider {
  id = 'mock-extractor';
  modelVersion: string;
  constructor(modelVersion = 'mock-1') { this.modelVersion = modelVersion; }

  async extract(req: ExtractorRequest): Promise<RawExtraction> {
    const text = normalizeHebrewText(req.text);
    const cues = new Set(req.gateCues);
    const facts: RawExtraction['proposedFacts'] = [];

    const criticizesLesson = /שיעור|לימד/.test(text) && /(מבזבז|משעמם|גרוע|נורא|לא מובן|קשה לעקוב)/.test(text);
    if (criticizesLesson) {
      const m = text.match(/.{0,18}(מבזבז|משעמם|גרוע|נורא|לא מובן|קשה לעקוב).{0,18}/);
      facts.push({
        id: 'message.criticizes_lesson_content', value: true, confidence: 0.85,
        evidenceExcerpt: (m?.[0] ?? text.slice(0, 40)).trim(), provenance: 'model_extraction',
      });
    }

    let meaning: RawExtraction['meaning'];
    let directAssessment: RawExtraction['directAssessment'] = 'unsure';

    if (cues.has('cue:possible_irony') && /(באמת|יופי|נהדר|מצוין)/.test(text) && /(שוב איחר|שוב לא|מאחר|מבזבז|לא הגיע)/.test(text)) {
      meaning = {
        mayBeUnderstoodAsDisparagement: true, mechanism: 'irony',
        evidenceExcerpt: text.slice(0, 60), identifiable: cues.has('cue:hint_reference') || cues.has('cue:third_person'),
        extractorConfidence: 0.85,
      };
      directAssessment = 'concern';
    } else if (cues.has('cue:possible_irony') && /באמת/.test(text) && /(יודע להסביר|מבין עניין)/.test(text)) {
      meaning = {
        mayBeUnderstoodAsDisparagement: true, mechanism: 'irony',
        evidenceExcerpt: text.slice(0, 60), identifiable: true, extractorConfidence: 0.8,
      };
      directAssessment = 'concern';
    } else if (cues.has('cue:hint_reference') && cues.has('cue:third_person')) {
      meaning = {
        mayBeUnderstoodAsDisparagement: true, mechanism: 'hint',
        evidenceExcerpt: text.slice(0, 60), identifiable: true, extractorConfidence: 0.8,
      };
      directAssessment = 'concern';
    } else if ([...cues].some((c) => c.startsWith('cue:') && !['cue:lesson_context', 'cue:quoted'].includes(c)) && /(טיפש|אידיוט|גרוע|מבזבז|משעמם|עלוב)/.test(text)) {
      meaning = {
        mayBeUnderstoodAsDisparagement: true, mechanism: 'direct',
        evidenceExcerpt: text.slice(0, 60), identifiable: cues.has('cue:third_person'), extractorConfidence: 0.9,
      };
      directAssessment = 'concern';
    } else {
      // Explicit quiet case only for clearly benign logistics/praise with no cues.
      const benign = /(מגיע ב־?8|מגיע ב-8|נתראה|תודה רבה|שיעור מעולה, תודה|היה שיעור טוב)/.test(text);
      if (benign && cues.size === 0) {
        meaning = {
          mayBeUnderstoodAsDisparagement: false, interpretationUncertain: false,
          evidenceExcerpt: text.slice(0, 60), identifiable: false, extractorConfidence: 0.95,
        };
        directAssessment = 'no_concern';
      }
    }

    return { proposedFacts: facts, ...(meaning ? { meaning } : {}), directAssessment };
  }
}

/** Placeholder for a future fetch-based provider. Not wired to any vendor by default. */
export interface HttpExtractorOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
  modelVersion?: string;
  fetchImpl?: typeof fetch;
}

export class HttpExtractorProvider implements ExtractorProvider {
  id = 'http-extractor';
  modelVersion: string;
  constructor(private opts: HttpExtractorOptions) { this.modelVersion = opts.modelVersion ?? 'http-unknown'; }

  async extract(req: ExtractorRequest): Promise<unknown> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetchImpl(this.opts.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`extractor_http_${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
