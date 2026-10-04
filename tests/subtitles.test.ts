import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { srtToVtt, findSubtitleFiles } from '../electron/services/subtitles';

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('srtToVtt', () => {
  it('converts cue timings from comma to dot notation', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,500 --> 00:00:07,000\nSecond line\n';
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000');
    expect(vtt).toContain('Hello world');
    expect(vtt).not.toContain('00:00:01,000');
  });

  it('drops cue numbers and handles CRLF + BOM', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
    const vtt = srtToVtt(srt);
    expect(vtt).toContain('Hi');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('skips blocks without timings', () => {
    expect(srtToVtt('just some text\nno timing here\n')).toBe('WEBVTT\n\n\n');
  });
});

describe('findSubtitleFiles', () => {
  it('finds exact and language-variant sidecars, preferring VTT', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-subs-'));
    tmpRoots.push(dir);
    const video = path.join(dir, 'Lesson 01.mp4');
    fs.writeFileSync(video, '');
    fs.writeFileSync(path.join(dir, 'Lesson 01.srt'), '');
    fs.writeFileSync(path.join(dir, 'Lesson 01.vtt'), '');
    fs.writeFileSync(path.join(dir, 'Lesson 01.en.vtt'), '');
    fs.writeFileSync(path.join(dir, 'Other.en.vtt'), '');

    const found = findSubtitleFiles(video);
    expect(found.map((f) => path.basename(f.filePath))).toEqual([
      'Lesson 01.vtt',
      'Lesson 01.en.vtt',
    ]);
    expect(found[1].label).toBe('EN');
  });

  it('returns an empty list when nothing matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-subs-'));
    tmpRoots.push(dir);
    const video = path.join(dir, 'Lesson.mp4');
    fs.writeFileSync(video, '');
    expect(findSubtitleFiles(video)).toEqual([]);
    expect(findSubtitleFiles(path.join(dir, 'missing.mp4'))).toEqual([]);
  });
});
