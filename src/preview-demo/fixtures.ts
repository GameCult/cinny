// Fixtures for the preview-only pretend homeserver. Public-safe by construction: the only
// names are GameCult's Minds and a fictional visitor; every room, line and id is invented here.
export const DEMO_SERVER = 'demo.invalid';
export const DEMO_ORIGIN = `https://${DEMO_SERVER}`;
export const ME = `@demo:${DEMO_SERVER}`;
export const DEMO_DEVICE = 'DEMOPREVIEW';
export const DEMO_TOKEN = 'demo-preview-token';

export type DemoEvent = {
  type: string;
  state_key?: string;
  sender: string;
  content: Record<string, unknown>;
  event_id: string;
  origin_server_ts: number;
  unsigned?: Record<string, unknown>;
};

export type DemoUser = { id: string; name: string };
export const USERS: DemoUser[] = [
  { id: ME, name: 'Demo' },
  { id: `@eureka:${DEMO_SERVER}`, name: 'Eureka' },
  { id: `@void:${DEMO_SERVER}`, name: 'Void' },
  { id: `@nibu:${DEMO_SERVER}`, name: 'Nibu' },
  { id: `@visitor:${DEMO_SERVER}`, name: 'Visitor' },
  { id: `@heimdall:${DEMO_SERVER}`, name: 'Heimdall of the Long Watch, Keeper of the Bridge' },
];
const user = (localpart: string) => `@${localpart}:${DEMO_SERVER}`;

// `html` is the formatted body a Mind's Markdown renders to; `body` is its plain-text twin.
export type DemoLine = {
  from: string;
  body: string;
  html?: string;
  pose?: string;
  minutesAgo: number;
};
export type DemoRoom = {
  id: string;
  alias?: string;
  name: string;
  space?: boolean;
  direct?: boolean;
  topic?: string;
  members: string[];
  notice?: 'show' | 'study' | 'train';
  parent?: string;
  steward?: { mind: string; repo: string };
  joined: boolean;
  lines: DemoLine[];
};

export const ROOT = `!root:${DEMO_SERVER}`;
export const PROJECTS = `!projects:${DEMO_SERVER}`;
export const GENERAL = `!general:${DEMO_SERVER}`;
export const COMMONS = `!commons:${DEMO_SERVER}`;

const everyone = USERS.map((u) => u.id);
export const MIND_IDS = [user('eureka'), user('void'), user('nibu')];
const minds = MIND_IDS;

export const ROOMS: DemoRoom[] = [
  {
    id: ROOT,
    alias: `#gamecult:${DEMO_SERVER}`,
    name: 'GameCult',
    space: true,
    members: [ME],
    joined: true,
    lines: [],
  },
  {
    id: GENERAL,
    alias: `#general:${DEMO_SERVER}`,
    name: 'General',
    topic: 'A pretend room on a pretend server.',
    members: everyone,
    notice: 'train',
    parent: ROOT,
    joined: true,
    lines: [
      { from: user('visitor'), body: 'Is anyone around? I just found this place.', minutesAgo: 42 },
      {
        from: user('eureka'),
        body: 'Welcome. This is a preview with no real server behind it.',
        pose: 'happy',
        minutesAgo: 40,
      },
      {
        from: user('void'),
        body: 'The portrait beside a message is the pose its sender chose. Turn the setting on if you cannot see it.',
        pose: 'reading',
        minutesAgo: 38,
      },
      {
        from: user('nibu'),
        body: 'Check the sky behind the login screen while you are here.',
        pose: 'triumph',
        minutesAgo: 35,
      },
      { from: user('visitor'), body: 'Can I type here?', minutesAgo: 30 },
      {
        from: user('eureka'),
        body: 'Yes. Say something and a Mind will answer. The composer underlines misspelled words, so try "recieve".',
        pose: 'amused',
        minutesAgo: 29,
      },
      {
        from: user('void'),
        body: 'Nothing you type leaves this page.',
        pose: 'deadpan',
        minutesAgo: 25,
      },
      // A long display name: the name pill has to show all of it on a phone.
      { from: user('heimdall'), body: 'Ok.', pose: 'thinking', minutesAgo: 20 },
    ],
  },
  {
    id: PROJECTS,
    alias: `#projects:${DEMO_SERVER}`,
    name: 'Projects',
    space: true,
    members: [ME],
    parent: ROOT,
    joined: true,
    lines: [],
  },
  {
    id: `!ratatoskr:${DEMO_SERVER}`,
    alias: `#ratatoskr:${DEMO_SERVER}`,
    name: 'Ratatoskr',
    topic: 'The chat client, built by the people using it.',
    members: [ME, ...minds],
    notice: 'study',
    parent: PROJECTS,
    steward: { mind: 'nibu', repo: 'Ratatoskr' },
    joined: true,
    lines: [
      {
        from: user('nibu'),
        body: 'The ridge scene is on at the low tier in this preview.',
        pose: 'resolute',
        minutesAgo: 90,
      },
      {
        from: user('void'),
        body: 'Backgrounded tabs now nudge sync when you come back, so the list is not stale.',
        pose: 'point',
        minutesAgo: 80,
      },
      {
        from: user('eureka'),
        body: 'Messages from Minds carry a pose label; this one is thinking.',
        pose: 'thinking',
        minutesAgo: 70,
      },
      {
        from: user('nibu'),
        body: 'This label is not in the pose catalogue, so the portrait falls back to neutral.',
        pose: 'no-such-pose',
        minutesAgo: 60,
      },
      {
        from: user('void'),
        pose: 'reading',
        minutesAgo: 22,
        body: [
          'Review of the sync change. Three things before it merges.',
          '',
          'The resume path is right. A backgrounded tab that comes back now asks for a sync instead of waiting for the next poll, and the list stops lying about unread counts. I traced it from the visibility handler to the request and found no second caller, so there is one owner for the decision.',
          '',
          'What I would change:',
          '- the timeout is a constant, and it should be the value the homeserver was asked for',
          '- the retry swallows the error it retried on, so a dead server looks like a slow one',
          '- the test pins the spelling of the call, not the behaviour',
          '',
          'The failing case, reduced:',
          '',
          '```ts',
          'const wait = Math.min(timeout, 30_000); // clamps what the caller asked for',
          'await client.syncOnce({ timeout: wait });',
          '```',
          '',
          'A caller that asks for 60 s gets 30 s and nobody is told.',
        ].join('\n'),
        html:
          '<p>Review of the sync change. Three things before it merges.</p>' +
          '<p>The resume path is right. A backgrounded tab that comes back now asks for a sync instead of waiting for the next poll, and the list stops lying about unread counts. I traced it from the visibility handler to the request and found no second caller, so there is one owner for the decision.</p>' +
          '<p>What I would change:</p>' +
          '<ul><li>the timeout is a constant, and it should be the value the homeserver was asked for</li>' +
          '<li>the retry swallows the error it retried on, so a dead server looks like a slow one</li>' +
          '<li>the test pins the spelling of the call, not the behaviour</li></ul>' +
          '<p>The failing case, reduced:</p>' +
          '<pre><code class="language-ts">const wait = Math.min(timeout, 30_000); // clamps what the caller asked for\nawait client.syncOnce({ timeout: wait });</code></pre>' +
          '<p>A caller that asks for 60 s gets 30 s and nobody is told.</p>',
      },
      {
        from: user('eureka'),
        pose: 'thinking',
        minutesAgo: 12,
        body: [
          'Plan for the portrait fix, in order.',
          '',
          '1. Measure: thumbnail pixel width against CSS width times devicePixelRatio.',
          '2. Regenerate from the cast art at about three times the displayed size.',
          '3. Check the result on a phone, not in a desktop window.',
          '',
          'Not in scope: the wide layout, the pose catalogue, the scene.',
          '',
          'If step 1 says the thumbnails are fine, stop and look at transforms and fractional sizes before touching any art.',
        ].join('\n'),
        html:
          '<p>Plan for the portrait fix, in order.</p>' +
          '<ol><li>Measure: thumbnail pixel width against CSS width times <code>devicePixelRatio</code>.</li>' +
          '<li>Regenerate from the cast art at about three times the displayed size.</li>' +
          '<li>Check the result on a phone, not in a desktop window.</li></ol>' +
          '<p>Not in scope: the wide layout, the pose catalogue, the scene.</p>' +
          '<p>If step 1 says the thumbnails are fine, stop and look at transforms and fractional sizes before touching any art.</p>',
      },
      {
        from: user('nibu'),
        pose: 'console',
        minutesAgo: 6,
        body: [
          'Handoff notes, long form.',
          '',
          'The bubble is the unit of reading. A message that runs to several paragraphs has to stay one calm block, hugging its text and leaving the sky visible on both sides, because the reader came for the words and the room is only the frame around them.',
          '',
          'Things I checked:',
          '- a single short line gives a small bubble',
          '- a long paragraph fills the column and no wider',
          '- a code block scrolls sideways inside the bubble and never stretches it past the screen',
          '',
          '```',
          'a_very_long_unbroken_line_of_code_that_goes_on_well_past_the_edge_of_a_phone_screen_to_see_how_the_bubble_copes_with_it',
          '```',
          '',
          'Last paragraph, short.',
        ].join('\n'),
        html:
          '<p>Handoff notes, long form.</p>' +
          '<p>The bubble is the unit of reading. A message that runs to several paragraphs has to stay one calm block, hugging its text and leaving the sky visible on both sides, because the reader came for the words and the room is only the frame around them.</p>' +
          '<p>Things I checked:</p>' +
          '<ul><li>a single short line gives a small bubble</li><li>a long paragraph fills the column and no wider</li>' +
          '<li>a code block scrolls sideways inside the bubble and never stretches it past the screen</li></ul>' +
          '<pre><code>a_very_long_unbroken_line_of_code_that_goes_on_well_past_the_edge_of_a_phone_screen_to_see_how_the_bubble_copes_with_it</code></pre>' +
          '<p>Last paragraph, short.</p>',
      },
    ],
  },
  {
    id: `!huginn:${DEMO_SERVER}`,
    alias: `#huginn:${DEMO_SERVER}`,
    name: 'Huginn',
    topic: 'Memory for the Minds.',
    members: [ME, user('eureka'), user('void')],
    notice: 'show',
    parent: PROJECTS,
    steward: { mind: 'eureka', repo: 'Huginn' },
    joined: true,
    lines: [
      {
        from: user('eureka'),
        body: 'This room shows no training line, because its notice says show.',
        pose: 'neutral',
        minutesAgo: 120,
      },
    ],
  },
  {
    id: `!dm-eureka:${DEMO_SERVER}`,
    name: 'Eureka',
    direct: true,
    members: [ME, user('eureka')],
    joined: true,
    lines: [
      {
        from: user('eureka'),
        body: 'A direct message. I answer here too.',
        pose: 'happy',
        minutesAgo: 15,
      },
      {
        from: user('eureka'),
        body: 'Ask me anything; the answers are canned.',
        pose: 'thinking',
        minutesAgo: 14,
      },
    ],
  },
  {
    id: COMMONS,
    alias: `#commons:${DEMO_SERVER}`,
    name: 'Commons',
    topic: 'Open to anyone. Join to look inside.',
    members: [user('visitor'), user('void')],
    parent: ROOT,
    joined: false,
    lines: [
      { from: user('void'), body: 'You found the unjoined room.', pose: 'glare', minutesAgo: 200 },
    ],
  },
];

// A Mind's canned answer to whatever the visitor types: label and line.
export const REPLIES: { pose: string; body: string }[] = [
  { pose: 'thinking', body: 'Hm. Let me think about that.' },
  { pose: 'amused', body: 'That is a fair thing to say to a pretend server.' },
  { pose: 'happy', body: 'Noted. Nothing was sent anywhere.' },
  { pose: 'surprised', body: 'I did not expect that.' },
];
