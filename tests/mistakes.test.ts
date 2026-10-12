import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { registerSource, loadExamFile, submitExamAttempt } from '../electron/services/practiceLibraryService';
import { mistakeCardBack, mistakeCardFront } from '../electron/services/mistakesService';
import { listDecks, listFlashcards, listDueFlashcards } from '../electron/database/repositories/study';
import { setSetting } from '../electron/database/repositories/settings';

const tmpRoots: string[] = [];
let db: Database.Database;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function writeExam(dir: string): string {
  const file = path.join(dir, 'Practice Test #1.html');
  fs.writeFileSync(
    file,
    `<html><body><script>const quizData = ${JSON.stringify({
      quiz_title: 'Practice Test #1',
      questions: [
        {
          assessment_type: 'multiple-choice',
          prompt: {
            question: '<p>Which service stores objects?</p>',
            answers: ['<p>Amazon S3</p>', '<p>Amazon EC2</p>'],
            explanation: '<p>Correct option:</p><p><strong>Amazon S3</strong> - object storage.</p>',
          },
          correct_response: ['a'],
        },
        {
          assessment_type: 'multi-select',
          prompt: { question: '<p>Pick two databases.</p>', answers: ['<p>RDS</p>', '<p>S3</p>', '<p>DynamoDB</p>'], explanation: '' },
          correct_response: ['a', 'c'],
        },
        {
          assessment_type: 'multiple-choice',
          prompt: { question: '<p>CDN?</p>', answers: ['<p>CloudFront</p>', '<p>SQS</p>'], explanation: '' },
          correct_response: ['a'],
        },
      ],
    })};</script></body></html>`,
  );
  return file;
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const answer = (file: string, selections: number[][]) =>
  submitExamAttempt(
    db,
    file,
    selections.map((selected, questionIndex) => ({ questionIndex, selected, seconds: 2 })),
    [],
    loadExamFile(db, file).contentHash,
  );

describe('practice-exam mistakes become flashcards', () => {
  it('adds one card per wrong answer to a per-exam deck without a course', () => {
    const root = tmp('ismalearn-mistakes-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');

    // Q1 wrong, Q2 partially right (wrong), Q3 right
    const result = answer(file, [[1], [0], [0]]);
    expect(result.score).toBe(1);
    expect(result.mistakesAdded).toBe(2);

    const decks = listDecks(db);
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ courseId: null, courseTitle: 'Practice exams', title: 'Mistakes · Practice Test #1', cardCount: 2 });
    expect(result.mistakesDeckId).toBe(decks[0].id);

    const cards = listFlashcards(db, decks[0].id);
    expect(cards[0].front).toBe('Which service stores objects?\nA. Amazon S3\nB. Amazon EC2');
    expect(cards[0].back).toBe('Correct answer:\n**A. Amazon S3**\nCorrect option:\n**Amazon S3** - object storage.');
    expect(cards[1].front.endsWith('(Choose 2)')).toBe(true);
    // new cards are due straight away
    expect(listDueFlashcards(db, decks[0].id, new Date(Date.now() + 1000).toISOString())).toHaveLength(2);
  });

  it('does not duplicate cards on a retake, but adds new mistakes', () => {
    const root = tmp('ismalearn-mistakes-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    answer(file, [[1], [0, 2], [0]]); // Q1 wrong
    const retake = answer(file, [[1], [0, 2], [1]]); // Q1 wrong again, Q3 newly wrong
    expect(retake.mistakesAdded).toBe(1);
    const decks = listDecks(db);
    expect(decks).toHaveLength(1);
    expect(decks[0].cardCount).toBe(2);
  });

  it('adds nothing for a perfect run, or when the setting is off', () => {
    const root = tmp('ismalearn-mistakes-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    expect(answer(file, [[0], [0, 2], [0]]).mistakesAdded).toBe(0);
    expect(listDecks(db)).toHaveLength(0);

    setSetting(db, 'examMistakesToFlashcards', false);
    const off = answer(file, [[1], [1], [1]]);
    expect(off.mistakesAdded).toBeUndefined();
    expect(listDecks(db)).toHaveLength(0);
  });
});

describe('mistake card text', () => {
  const q = {
    question: 'Pick two.',
    options: ['RDS', 'S3', 'DynamoDB'],
    correctIndices: [0, 2],
    explanation: '',
    topic: '',
  };

  it('puts the question and lettered options on the front', () => {
    expect(mistakeCardFront(q)).toBe('Pick two.\nA. RDS\nB. S3\nC. DynamoDB\n(Choose 2)');
  });

  it('puts every correct answer on the back', () => {
    expect(mistakeCardBack(q)).toBe('Correct answers:\n**A. RDS**\n**C. DynamoDB**');
  });
});
