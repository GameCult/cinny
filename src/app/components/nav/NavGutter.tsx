import React, { ReactNode } from 'react';
import * as css from './styles.css';

/** The fixed-width first column of a navigator row or section header; its content is centred in it. */
export function NavGutter({ children }: { children: ReactNode }) {
  return <span className={css.NavGutter}>{children}</span>;
}

/** One nesting step: everything inside is indented by the same constant. */
export function NavLevel({ children }: { children: ReactNode }) {
  return <div className={css.NavLevel}>{children}</div>;
}
