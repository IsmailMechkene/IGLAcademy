import React from 'react';
import { formatTime } from './format';

/**
 * Minimal, safe Markdown renderer (no dangerouslySetInnerHTML).
 * Supports: headings, bold, italic, inline code, code blocks, links,
 * unordered/ordered lists, paragraphs, and IsmaLearn timestamps [mm:ss](t=seconds).
 */

export interface MarkdownRenderOptions {
  onTimestampClick?: (seconds: number) => void;
}

// Inline parsing: **bold**, *italic*, `code`, [text](t=seconds), [text](url)
function renderInline(text: string, options: MarkdownRenderOptions, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Order matters: code first, then links, bold, italic
  const pattern = /(`[^`]+`)|(\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined) {
      nodes.push(
        <code key={key} style={{
          background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 4,
          fontSize: '0.88em', fontFamily: 'var(--font-mono, monospace)',
        }}>
          {match[1].slice(1, -1)}
        </code>,
      );
    } else if (match[2] !== undefined) {
      const label = match[3];
      const target = match[4];
      if (/^t=\d+(\.\d+)?$/.test(target)) {
        const seconds = parseFloat(target.slice(2));
        nodes.push(
          <button
            key={key}
            onClick={() => options.onTimestampClick?.(seconds)}
            style={{
              background: 'var(--accent-soft)', color: 'var(--accent)', border: 'none',
              padding: '0 5px', borderRadius: 4, cursor: 'pointer', fontSize: 'inherit',
              fontFamily: 'inherit', fontWeight: 600,
            }}
            title={`Jump to ${formatTime(seconds)}`}
          >
            {label}
          </button>,
        );
      } else if (/^https?:\/\//.test(target)) {
        nodes.push(
          <a key={key} href={target} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            {label}
          </a>,
        );
      } else {
        nodes.push(match[2]);
      }
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={key}>{match[6]}</strong>);
    } else if (match[7] !== undefined) {
      nodes.push(<em key={key}>{match[8]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): React.ReactNode[] {
  const lines = source.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(
        <pre key={key++} style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', overflowX: 'auto', fontSize: 12.5, lineHeight: 1.55,
        }}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = (`h${Math.min(level + 1, 4)}`) as 'h2' | 'h3' | 'h4';
      blocks.push(
        <Tag key={key++} style={{ margin: '10px 0 4px', fontSize: level <= 2 ? 15 : 13.5 }}>
          {renderInline(headingMatch[2], options, `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} style={{ margin: '6px 0', paddingLeft: 20 }}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, options, `li${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} style={{ margin: '6px 0', paddingLeft: 22 }}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, options, `ol${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    blocks.push(<p key={key++} style={{ margin: '6px 0' }}>{renderInline(line, options, `p${key}`)}</p>);
    i++;
  }

  return blocks;
}
