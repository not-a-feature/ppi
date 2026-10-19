import { describe, expect, it } from 'vitest';
import de from '../src/lib/locales/de.json';
import en from '../src/lib/locales/en.json';
import { feedbackText, t } from '../src/lib/i18n';

describe('language files', () => {
  it('contains the same keys and interpolation fields in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      const fields = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(fields(en[key]), key).toEqual(fields(de[key]));
    }
  });

  it('formats check thresholds from the selected language file', () => {
    const values = {
      minWords: 100,
      similarityPercent: 85,
      minSimilarityWords: 50,
      repetitionPercent: 60
    };
    expect(t('de', 'checks.rules', values)).toContain('Inhalt: < 100 Wörter.');
    expect(t('en', 'checks.rules', values)).toContain('Content: < 100 words.');
    expect(t('en', 'checks.rules', values)).not.toContain('{');
  });

  it('translates known feedback while retaining user-authored text', () => {
    expect(feedbackText('en', 'Die Veranstaltung wurde aktualisiert.')).toBe('Lecture updated.');
    expect(feedbackText('de', 'Lecture updated.')).toBe('Die Veranstaltung wurde aktualisiert.');
    expect(feedbackText('en', 'User-authored review note.')).toBe('User-authored review note.');
  });
});
