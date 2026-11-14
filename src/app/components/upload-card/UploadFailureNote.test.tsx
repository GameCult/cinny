import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { uploadFailure } from '../../utils/matrix';
import { UploadFailureNote } from './UploadFailureNote';

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the failed upload card', () => {
  it('leads with the reason and the next step, and keeps the diagnostics behind Details', async () => {
    const error = await uploadFailure(new DOMException('', 'AbortError'), new Blob(['abcd']), {
      startedAt: Date.now(),
    });
    const html = renderToStaticMarkup(<UploadFailureNote error={error} />);
    const before = html.slice(0, html.indexOf('<details'));
    expect(text(before)).toBe(
      'Upload failed: the connection dropped before the file started. Send again.'
    );
    expect(before).not.toContain('bytes');
    expect(html).toMatch(/<details>.*Details.*<\/details>/s);
    expect(text(html.slice(html.indexOf('<details')))).toContain('4 bytes');
  });

  it('an error nobody classified still shows a sentence, not a blank card', () => {
    const html = renderToStaticMarkup(<UploadFailureNote error={new Error('boom')} />);
    expect(text(html)).toContain('Upload failed. Send again');
    expect(text(html)).toContain('boom');
  });
});
