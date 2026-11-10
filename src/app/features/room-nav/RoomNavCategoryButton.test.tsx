import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoomNavCategoryButton } from './RoomNavCategoryButton';

const html = (closed?: boolean) =>
  renderToStaticMarkup(<RoomNavCategoryButton closed={closed}>Browse</RoomNavCategoryButton>);

describe('RoomNavCategoryButton', () => {
  it('says it is collapsed when closed, so assistive tech does not rely on the chevron', () => {
    expect(html(true)).toContain('aria-expanded="false"');
  });

  it('says it is expanded when open', () => {
    expect(html(false)).toContain('aria-expanded="true"');
  });

  it('claims neither when the section does not toggle', () => {
    expect(html(undefined)).not.toContain('aria-expanded');
  });
});
