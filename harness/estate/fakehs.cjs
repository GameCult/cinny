// Fake Matrix homeserver + static server for the built client (harness/estate/run.sh).
// Scenario: an invitee to the GameCult Space and 6 project rooms (never a member of the
// Space, so the client cannot read its state), joined to #general and to #meeting, a room
// outside the Space, and invited to a DM. The steward of each project room is carried only
// in the m.space.child content of the hierarchy, as the accounts script writes it.
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = process.argv[2], PORT = 8080, ME = '@t:test';
const log = [];
const P = ['aetheria', 'ghostlight', 'huginn', 'idunn', 'bifrost', 'odin'];
const STEWARD = { aetheria: 'nibu', ghostlight: 'nibu', huginn: 'eureka', idunn: 'eureka' };
const DM = '!dm:test', MEETING = '!meeting:test';
const PROJ = P.map((p, i) => ({ id: `!p${i}:test`, alias: `#${p}:test`, name: p[0].toUpperCase() + p.slice(1) }));
const ROOT = '!root:test', PSP = '!proj:test', GEN = '!gen:test', OP = '!op:test';
const pendingJoin = [];
let ev = 0;
const se = (type, content, sk = '', sender = '@admin:test') => ({ type, content, state_key: sk, sender, event_id: `$e${++ev}`, origin_server_ts: Date.now() });
const strip = (id, name, space, dm) => [
  { type: 'm.room.create', state_key: '', sender: '@admin:test', content: space ? { type: 'm.space', room_version: '12' } : { room_version: '12' } },
  ...(name ? [{ type: 'm.room.name', state_key: '', sender: '@admin:test', content: { name } }] : []),
  ...(dm ? [{ type: 'm.room.member', state_key: '@void:test', sender: '@void:test', content: { membership: 'join', displayname: 'Void' } }] : []),
  { type: 'm.room.join_rules', state_key: '', sender: '@admin:test', content: { join_rule: 'invite' } },
  { type: 'm.room.member', state_key: ME, sender: dm ? '@void:test' : '@admin:test', content: dm ? { membership: 'invite', is_direct: true } : { membership: 'invite' } },
];
const joinedRoom = (id, name, extra = [], space = false) => ({
  state: { events: [se('m.room.create', space ? { type: 'm.space', room_version: '12' } : { room_version: '12' }), se('m.room.name', { name }), se('m.room.join_rules', { join_rule: 'invite' }), se('m.room.member', { membership: 'join' }, ME, ME), ...extra] },
  timeline: { events: [{ type: 'm.room.message', sender: '@admin:test', content: { msgtype: 'm.text', body: `welcome to ${name}` }, event_id: `$m${++ev}`, origin_server_ts: Date.now() }], limited: false },
  ephemeral: { events: [] }, account_data: { events: [] }, unread_notifications: {}, summary: {},
});
const invites = () => {
  const o = {};
  o[ROOT] = { invite_state: { events: strip(ROOT, 'GameCult', true) } };
  o[PSP] = { invite_state: { events: strip(PSP, 'Projects', true) } };
  o[OP] = { invite_state: { events: strip(OP, 'Operator') } };
  PROJ.forEach((r) => (o[r.id] = { invite_state: { events: strip(r.id, r.name) } }));
  o[DM] = { invite_state: { events: strip(DM, null, false, true) } };
  return o;
};
const child = (id, alias) => ({ type: 'm.space.child', state_key: id, content: { via: ['test'], ...(STEWARD[alias] ? { 'org.gamecult.steward': { repo: 'GameCult/' + alias, steward: '@' + STEWARD[alias] + ':test', mind: STEWARD[alias], source: 'x' } } : {}) }, sender: '@admin:test', origin_server_ts: 1 });
const hroom = (id, name, alias, extra = {}) => ({ room_id: id, name, canonical_alias: alias, num_joined_members: 1, world_readable: false, guest_can_join: false, join_rule: 'invite', children_state: [], ...extra });
const hierarchy = () => [
  hroom(ROOT, 'GameCult', '#gamecult:test', { room_type: 'm.space', children_state: [child(GEN), child(OP), child(PSP)] }),
  hroom(GEN, 'General', '#general:test'),
  hroom(OP, 'Operator', '#operator:test'),
  hroom(PSP, 'Projects', '#projects:test', { room_type: 'm.space', children_state: PROJ.map((r) => child(r.id, r.alias.slice(1).split(':')[0])) }),
  ...PROJ.map((r) => hroom(r.id, r.name, r.alias)),
];
let syncN = 1;
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(body)); };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const flush = () => fs.writeFileSync(process.env.HSLOG, log.join('\n'));
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (!p.startsWith('/_matrix') && !p.startsWith('/.well-known')) {
    let f = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    return fs.createReadStream(f).pipe(res);
  }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    log.push(`${Date.now()} ${req.method} ${p}`);
    if (p === '/_matrix/client/versions') return json(res, 200, { versions: ['v1.1', 'v1.5', 'v1.11'], unstable_features: {} });
    if (p.endsWith('/sync')) {
      if (!u.searchParams.get('since')) log.push(`${Date.now()} INITIAL SYNC`);
      const since = u.searchParams.get('since');
      if (!since) {
        const join = {}; join[GEN] = joinedRoom(GEN, 'General'); join[MEETING] = joinedRoom(MEETING, 'Meeting');
        const inv = invites();
        return json(res, 200, { next_batch: 's1', rooms: { join, invite: inv, leave: {} }, account_data: { events: [] }, presence: { events: [] }, to_device: { events: [] }, device_one_time_keys_count: { signed_curve25519: 50 } });
      }
      const wait = () => {
        if (pendingJoin.length) {
          const id = pendingJoin.shift(); const r = PROJ.find((x) => x.id === id) || { name: id === DM ? 'Void' : id };
          const join = {}; join[id] = joinedRoom(id, r.name);
          log.push(`${Date.now()} SYNC delivers join ${id}`);
          return json(res, 200, { next_batch: `s${++syncN}`, rooms: { join, invite: {}, leave: {} } });
        }
        return json(res, 200, { next_batch: since, rooms: {} });
      };
      return setTimeout(wait, pendingJoin.length ? 2500 : 1500);
    }
    const jm = p.match(/\/rooms\/([^/]+)\/join$/) || p.match(/\/join\/([^/]+)$/);
    if (req.method === 'POST' && jm) {
      const id = jm[1];
      log.push(`${Date.now()} JOIN ${id}`);
      if (id === PROJ[1].id) return json(res, 403, { errcode: 'M_FORBIDDEN', error: 'You are not invited to this room.' });
      pendingJoin.push(id);
      return json(res, 200, { room_id: id });
    }
    if (p.includes('/hierarchy')) return json(res, 200, { rooms: hierarchy() });
    if (p.includes('/directory/room/')) return json(res, 200, { room_id: ROOT, servers: ['test'] });
    if (p.endsWith('/keys/upload')) return json(res, 200, { one_time_key_counts: { signed_curve25519: 50 } });
    if (p.endsWith('/keys/query')) return json(res, 200, { device_keys: {}, failures: {} });
    if (p.includes('/room_keys/version')) return json(res, 404, { errcode: 'M_NOT_FOUND', error: 'none' });
    if (p.includes('/pushrules')) return json(res, 200, { global: { override: [], underride: [], room: [], sender: [], content: [] } });
    if (p.includes('/filter')) return json(res, 200, { filter_id: '1' });
    if (p.includes('/account_data/')) return req.method === 'GET' ? json(res, 404, { errcode: 'M_NOT_FOUND', error: 'none' }) : json(res, 200, {});
    if (p.includes('/messages')) return json(res, 200, { chunk: [], start: 't0', end: 't0' });
    if (p.includes('/members')) return json(res, 200, { chunk: [] });
    if (p.includes('/profile/')) return json(res, 200, { displayname: 'Tess' });
    if (p.includes('/capabilities')) return json(res, 200, { capabilities: {} });
    if (p.includes('/devices')) return json(res, 200, { devices: [] });
    if (p.includes('summary')) return json(res, 200, { room_id: p.split('/').pop(), name: 'Summary card', num_joined_members: 1, membership: 'invite', join_rule: 'invite' });
    if (p.includes('/login')) return json(res, 200, { flows: [{ type: 'm.login.password' }] });
    return json(res, 200, {});
  });
}).listen(PORT, () => console.log('fakehs up'));
setInterval(flush, 500);
