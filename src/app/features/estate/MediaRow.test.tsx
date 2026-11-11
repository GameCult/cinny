import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MediaLink, MediaNote } from './MediaRow';

const text = (html: string) => html.replace(/<[^>]*>/g, '');

describe('Media row', () => {
  it('a Mind without a media room reads "not set up" and links nowhere', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MediaNote note="not set up" />
      </MemoryRouter>
    );
    expect(text(html)).toBe('Media · not set up');
    expect(html).not.toContain('href=');
  });

  it('a joined media room reads "Media" and opens the room', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MediaLink to="/home/%23void-files%3Agamecult.org/" />
      </MemoryRouter>
    );
    expect(text(html)).toBe('Media');
    expect(html).toContain('href="/home/%23void-files%3Agamecult.org/"');
  });
});
