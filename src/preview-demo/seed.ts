// Imported first by src/index.tsx: the settings module reads localStorage when it is first
// imported, so a demo build's first-visit defaults must be stored before anything else loads.
// Pose portraits default off; the demo exists to show them. Does nothing without the build flag.
export const seedDemoSettings = (storage: Storage) => {
  if (storage.getItem('settings') === null) {
    storage.setItem('settings', JSON.stringify({ poseBubbles: true }));
  }
};

if (import.meta.env.VITE_PREVIEW_DEMO === '1') seedDemoSettings(localStorage);
