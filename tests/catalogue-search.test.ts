import { expect, it } from 'vitest';
import { matchesLecture } from '../src/lib/catalogue-search';

it('matches lecture names and aliases locally, including entries beyond the first page', () => {
  const lectures = Array.from({ length: 45 }, (_, index) => ({
    name: `Lecture ${index}`,
    aliases: index === 44 ? ['Künstliche Intelligenz'] : []
  }));
  expect(lectures.filter((lecture) => matchesLecture(lecture, ' KÜNSTLICHE '))).toEqual([
    lectures[44]
  ]);
  expect(lectures.filter((lecture) => matchesLecture(lecture, 'Lecture 44'))).toEqual([
    lectures[44]
  ]);
  expect(lectures.filter((lecture) => matchesLecture(lecture, 'not present'))).toEqual([]);
});
