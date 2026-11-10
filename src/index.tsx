/* eslint-disable import/first */
import './polyfills';
import './preview-demo/seed';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource/inter/variable.css';
import '@fontsource-variable/nunito/index.css';
import '@fontsource/ubuntu/300.css';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import '@fontsource/montserrat/200.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';

import { trimTrailingSlash } from './app/utils/common';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';
import { pushSessionToSW } from './sw-session';
import { getFallbackSession } from './app/state/sessions';

document.body.classList.add(configClass, varsClass);

// Register Service Worker
if ('serviceWorker' in navigator) {
  const swUrl =
    import.meta.env.MODE === 'production'
      ? `${trimTrailingSlash(import.meta.env.BASE_URL)}/sw.js`
      : `/dev-sw.js?dev-sw`;

  const sendSessionToSW = () => {
    const session = getFallbackSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };

  navigator.serviceWorker.register(swUrl).then(sendSessionToSW);
  navigator.serviceWorker.ready.then(sendSessionToSW);

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { type } = ev.data ?? {};

    if (type === 'requestSession') {
      sendSessionToSW();
    }
  });
}

// The pretend homeserver of the dev preview: built in only with VITE_PREVIEW_DEMO=1 (the dev
// workflow) and switched on by `previewDemo: true` in config.json. Any other build drops it.
const installPreviewDemo = async () => {
  if (import.meta.env.VITE_PREVIEW_DEMO !== '1') return;
  const config = await fetch(`${trimTrailingSlash(import.meta.env.BASE_URL)}/config.json`)
    .then((r) => r.json())
    .catch(() => ({}));
  if (config.previewDemo === true) (await import('./preview-demo')).installDemo();
};

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

installPreviewDemo().finally(mountApp);
