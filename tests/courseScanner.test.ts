import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  scanCourseDirectory,
  titleFromFileName,
  isVideoFile,
  isPracticeFile,
  isResourceFile,
} from '../electron/services/courseScanner';

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempCourse(structure: Record<string, string[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-scan-'));
  tmpRoots.push(root);
  for (const [dir, files] of Object.entries(structure)) {
    const dirPath = path.join(root, dir);
    fs.mkdirSync(dirPath, { recursive: true });
    for (const file of files) {
      fs.writeFileSync(path.join(dirPath, file), '');
    }
  }
  return root;
}

describe('course folder scanning', () => {
  it('interprets subfolders as sections and videos as lessons, sorted naturally', () => {
    const root = makeTempCourse({
      '01 - Introduction': ['01 - Welcome.mp4', '02 - AWS Overview.mp4', '10 - Wrap up.mp4'],
      '02 - EC2': ['02 - Instance Types.mp4', '01 - Introduction to EC2.mp4'],
      '02 - EC2/Resources': ['aws-notes.pdf'],
    });

    const scanned = scanCourseDirectory(root);
    expect(scanned.sections.map((s) => s.title)).toEqual([
      '01 - Introduction',
      '02 - EC2',
    ]);
    const intro = scanned.sections[0];
    expect(intro.lessons.map((l) => l.title)).toEqual([
      '01 - Welcome',
      '02 - AWS Overview',
      '10 - Wrap up',
    ]);
    const ec2 = scanned.sections[1];
    expect(ec2.lessons.map((l) => l.title)).toEqual([
      '01 - Introduction to EC2',
      '02 - Instance Types',
    ]);
    expect(scanned.lessonCount).toBe(5);
  });

  it('creates a default section when all videos are in the root folder', () => {
    const root = makeTempCourse({
      '.': ['02 - Second.mp4', '01 - First.mp4'],
    });
    const scanned = scanCourseDirectory(root);
    expect(scanned.sections).toHaveLength(1);
    expect(scanned.sections[0].title).toBe('Course Content');
    expect(scanned.sections[0].lessons.map((l) => l.title)).toEqual([
      '01 - First',
      '02 - Second',
    ]);
  });

  it('attaches resources to their section and detects the course title from the folder', () => {
    const root = makeTempCourse({
      'Section A': ['lesson.mp4', 'notes.pdf', 'slides.pptx', 'readme.txt'],
    });
    const scanned = scanCourseDirectory(root);
    expect(scanned.title).toBe(path.basename(root));
    const resources = scanned.sections[0].resources.map((r) => r.fileName);
    // pptx is unsupported and must be ignored
    expect(resources.sort()).toEqual(['notes.pdf', 'readme.txt']);
  });

  it('picks a thumbnail from course images, preferring root-level images', () => {
    const root = makeTempCourse({
      '.': ['cover.jpg'],
      'Section A': ['lesson.mp4', 'diagram.png'],
    });
    const scanned = scanCourseDirectory(root);
    expect(scanned.thumbnailPath).toBe(path.join(root, 'cover.jpg'));
  });

  it('detects HTML practice tests as lessons, including practice-only folders', () => {
    const root = makeTempCourse({
      '01. practice-test': [
        '1.1 Practice Test #1 (DVA-C02).html',
        '1.2 Practice Test #2 (DVA-C02).html',
      ],
      '02 - Videos': ['01 - Intro.mp4', '2.1 Practice Test #3.htm'],
    });

    const scanned = scanCourseDirectory(root);
    expect(scanned.sections.map((s) => s.title)).toEqual(['01 practice-test', '02 - Videos']);

    const practiceSection = scanned.sections[0];
    expect(practiceSection.lessons).toHaveLength(2);
    expect(practiceSection.lessons.every((l) => l.kind === 'practice')).toBe(true);

    // videos and practice files merge into one naturally-sorted lesson list
    const mixed = scanned.sections[1].lessons;
    expect(mixed.map((l) => l.kind)).toEqual(['video', 'practice']);
    expect(scanned.lessonCount).toBe(4);
  });

  it('throws a clear error for a missing directory', () => {
    expect(() => scanCourseDirectory(path.join(os.tmpdir(), 'does-not-exist-xyz'))).toThrow(
      /not found/i,
    );
  });

  it('ignores hidden files and folders', () => {
    const root = makeTempCourse({
      '.': ['.DS_Store', 'lesson.mp4'],
      '.hidden': ['secret.mp4'],
    });
    const scanned = scanCourseDirectory(root);
    expect(scanned.lessonCount).toBe(1);
  });
});

describe('file type helpers', () => {
  it('recognizes supported formats', () => {
    expect(isVideoFile('lesson.MP4')).toBe(true);
    expect(isVideoFile('lesson.webm')).toBe(true);
    expect(isVideoFile('lesson.mkv')).toBe(true);
    expect(isVideoFile('lesson.avi')).toBe(false);
    expect(isPracticeFile('test.html')).toBe(true);
    expect(isPracticeFile('test.HTM')).toBe(true);
    expect(isPracticeFile('notes.pdf')).toBe(false);
    expect(isResourceFile('notes.pdf')).toBe(true);
    expect(isResourceFile('subs.srt')).toBe(true);
    expect(isResourceFile('readme.md')).toBe(true);
    expect(isResourceFile('photo.png')).toBe(true);
    expect(isResourceFile('video.mp4')).toBe(false);
  });

  it('cleans filenames into display titles', () => {
    expect(titleFromFileName('01_-_Welcome_to_AWS.mp4')).toBe('01 - Welcome to AWS');
    expect(titleFromFileName('lesson.webm')).toBe('lesson');
  });
});
