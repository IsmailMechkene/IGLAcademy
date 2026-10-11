import { describe, expect, it } from 'vitest';
import { linkLabel, parseExplanation, tokenizeInline } from '../src/utils/explanation';

const UDEMY_STYLE = [
  'Correct option:',
  '**Use DAX and CloudFront**',
  'DAX is an in-memory cache for DynamoDB.',
  'CloudFront caches static content.',
  'Incorrect options:',
  '**Use Redis** - Redis works, but DAX is a better fit.',
  '**Use Memcached for S3**',
  '**Use Redis and Memcached**',
  'Both these options are incorrect as Memcached cannot front S3.',
  'References:',
  '[https://aws.amazon.com/dax/](https://aws.amazon.com/dax/)',
].join('\n');

describe('parseExplanation', () => {
  it('splits a structured explanation into correct, incorrect and reference sections', () => {
    const sections = parseExplanation(UDEMY_STYLE);
    expect(sections.map((s) => s.kind)).toEqual(['correct', 'incorrect', 'references']);

    const [correct, incorrect, refs] = sections;
    expect(correct.options).toEqual([
      {
        names: ['Use DAX and CloudFront'],
        paragraphs: ['DAX is an in-memory cache for DynamoDB.', 'CloudFront caches static content.'],
      },
    ]);
    expect(incorrect.options).toEqual([
      { names: ['Use Redis'], paragraphs: ['Redis works, but DAX is a better fit.'] },
      // two names sharing one explanation
      {
        names: ['Use Memcached for S3', 'Use Redis and Memcached'],
        paragraphs: ['Both these options are incorrect as Memcached cannot front S3.'],
      },
    ]);
    expect(refs.paragraphs).toHaveLength(1);
  });

  it('treats unstructured text as one general section', () => {
    expect(parseExplanation('Because S3 is object storage.\nIt scales.')).toEqual([
      { kind: 'general', paragraphs: ['Because S3 is object storage.', 'It scales.'], options: [] },
    ]);
    expect(parseExplanation('')).toEqual([]);
  });
});

describe('tokenizeInline', () => {
  it('finds bold, code, links and images', () => {
    expect(tokenizeInline('Use `DelaySeconds`, see [docs](https://a.b/c) and **this** ![d](https://a.b/i.png)')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'DelaySeconds' },
      { type: 'text', text: ', see ' },
      { type: 'link', text: 'docs', url: 'https://a.b/c' },
      { type: 'text', text: ' and ' },
      { type: 'bold', text: 'this' },
      { type: 'text', text: ' ' },
      { type: 'image', url: 'https://a.b/i.png' },
    ]);
  });

  it('ignores non-http links', () => {
    expect(tokenizeInline('[x](javascript:alert(1))')).toEqual([{ type: 'text', text: '[x](javascript:alert(1))' }]);
  });
});

describe('linkLabel', () => {
  it('summarises bare URLs', () => {
    expect(linkLabel('https://docs.aws.amazon.com/sqs/latest/API_CreateQueue.html', 'https://docs.aws.amazon.com/sqs/latest/API_CreateQueue.html'))
      .toBe('docs.aws.amazon.com · API CreateQueue');
    expect(linkLabel('AWS docs', 'https://aws.amazon.com/')).toBe('AWS docs');
  });
});
