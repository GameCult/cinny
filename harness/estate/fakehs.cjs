// Soul s2 fake homeserver. Invitee with no root state; stewards only in m.space.child content.
// Rooms: GEN joined; OP invited; 6 project rooms invited (odin slow: join arrives at +24 s);
// PUB public joinable, not in store; STRAY joined outside hierarchy; DM1 invited direct (fast);
// DM2 invited direct (slow, +24 s). NOROOT=1: the root alias does not resolve.
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = process.argv[2], PORT = 8080, ME = '@t:test';
const NOROOT = process.env.NOROOT === '1';
const log = [];
const P = ['aetheria', 'ghostlight', 'huginn', 'idunn', 'bifrost', 'odin'];
const STEWARD = { aetheria: 'nibu', ghostlight: 'nibu', huginn: 'eureka', idunn: 'eureka' };
const PROJ = P.map((p, i) => ({ id: `!p${i}:test`, alias: `#${p}:test`, name: p[0].toUpperCase() + p.slice(1), key: p }));
const ROOT = '!root:test', PSP = '!proj:test', GEN = '!gen:test', OP = '!op:test', PUB = '!pub:test', STRAY = '!stray:test', DM1 = '!dm1:test', DM2 = '!dm2:test', DM3 = '!dm3:test';
const SLOW = new Set([PROJ[5].id, DM2, DM3]);
const NAMES = { [PUB]: 'Commons', [DM1]: 'Friend DM', [DM2]: 'Slow DM', [DM3]: 'Late DM', [STRAY]: 'Adhoc' };
PROJ.forEach((r) => (NAMES[r.id] = r.name));
const held = []; const pendingState = []; const pending = []; const pendingAD = []; let ev = 0;
const se = (type, content, sk = '', sender = '@admin:test') => ({ type, content, state_key: sk, sender, event_id: `$e${++ev}`, origin_server_ts: Date.now() });
const strip = (id, name, space, direct) => [
  { type: 'm.room.create', state_key: '', sender: direct ? '@friend:test' : '@admin:test', content: space ? { type: 'm.space', room_version: '12' } : { room_version: '12' } },
  { type: 'm.room.name', state_key: '', sender: '@admin:test', content: { name } },
  { type: 'm.room.join_rules', state_key: '', sender: '@admin:test', content: { join_rule: 'invite' } },
  ...(direct ? [{ type: 'm.room.member', state_key: '@friend:test', sender: '@friend:test', content: { membership: 'join', displayname: 'Friend' } }] : []),
  { type: 'm.room.member', state_key: ME, sender: direct ? '@friend:test' : '@admin:test', content: direct ? { membership: 'invite', is_direct: true } : { membership: 'invite' } },
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
  o[DM1] = { invite_state: { events: strip(DM1, NAMES[DM1], false, true) } };
  o[DM2] = { invite_state: { events: strip(DM2, NAMES[DM2], false, true) } };
  o[DM3] = { invite_state: { events: strip(DM3, NAMES[DM3], false, true) } };
  return o;
};
const child = (id, steward) => ({ type: 'm.space.child', state_key: id, content: { via: ['test'], ...(steward ? { 'org.gamecult.steward': { mind: steward, repo: 'x', source: 'y', steward: 'z' } } : {}) }, sender: '@admin:test', origin_server_ts: 1 });
const hroom = (id, name, alias, extra = {}) => ({ room_id: id, name, canonical_alias: alias, num_joined_members: 1, world_readable: false, guest_can_join: false, join_rule: 'invite', children_state: [], ...extra });
const hierarchy = () => [
  hroom(ROOT, 'GameCult', '#gamecult:test', { room_type: 'm.space', children_state: [child(GEN), child(OP), child(PUB), child(PSP)] }),
  hroom(GEN, 'General', '#general:test'),
  hroom(OP, 'Operator', '#operator:test'),
  hroom(PUB, 'Commons', '#commons:test', { join_rule: 'public' }),
  hroom(PSP, 'Projects', '#projects:test', { room_type: 'm.space', children_state: PROJ.map((r) => child(r.id, STEWARD[r.key])) }),
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
    if (req.method === 'PUT' && p.includes('m.direct')) console.log('MDIRECT_PUT ' + (Date.now()) + ' ' + body);
    log.push(`${Date.now()} ${req.method} ${p}${req.method === 'PUT' && p.includes('account_data') ? ' BODY ' + body : ''}`);
    if (p === '/_matrix/client/versions') return json(res, 200, { versions: ['v1.1', 'v1.5', 'v1.11'], unstable_features: {} });
    if (p.endsWith('/sync')) {
      const since = u.searchParams.get('since');
      if (!since) {
        const join = {}; join[GEN] = joinedRoom(GEN, 'General'); join[STRAY] = joinedRoom(STRAY, 'Adhoc');
        return json(res, 200, { next_batch: 's1', rooms: { join, invite: invites(), leave: {} }, account_data: { events: held.slice() }, presence: { events: [] }, to_device: { events: [] }, device_one_time_keys_count: { signed_curve25519: 50 } });
      }
      const respond = () => {
        const now = Date.now(); const join = {};
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= now) {
          const id = pending[i].id; pending.splice(i, 1);
          const extra = id === DM1 || id === DM2 || id === DM3 ? [se('m.room.member', { membership: 'join', displayname: 'Friend' }, '@friend:test', '@friend:test')] : [];
          join[id] = joinedRoom(id, NAMES[id] || id, extra); if (extra.length) { const me = join[id].state.events.find((e) => e.type === 'm.room.member' && e.state_key === ME); me.unsigned = { prev_content: { membership: 'invite', is_direct: true } }; } log.push(`${now} SYNC delivers join ${id}`); console.log('DELIVER ' + now + ' ' + id);
        }
        for (const s of pendingState.splice(0)) { join[s.id] = join[s.id] || { state: { events: [] }, timeline: { events: [], limited: false, prev_batch: 'p' }, ephemeral: { events: [] }, account_data: { events: [] }, unread_notifications: {}, summary: {} }; join[s.id].timeline.events.push(s.ev); console.log('STATE_ECHO ' + now + ' ' + s.id + ' ' + JSON.stringify(s.ev.content)); }
        const ad = pendingAD.splice(0);
        if (Object.keys(join).length || ad.length) return json(res, 200, { next_batch: `s${++syncN}`, rooms: { join, invite: {}, leave: {} }, account_data: { events: ad } });
        return json(res, 200, { next_batch: since, rooms: {} });
      };
      return setTimeout(respond, 300);
    }
    const jm = p.match(/\/rooms\/([^/]+)\/join$/) || p.match(/\/join\/([^/]+)$/);
    if (req.method === 'POST' && jm) {
      const id = jm[1]; log.push(`${Date.now()} JOIN ${id}`);
      if (id === PROJ[1].id) return json(res, 403, { errcode: 'M_FORBIDDEN', error: 'You are not invited to this room.' });
      const prior = pending.find((q) => q.id === DM2 || q.id === DM3);
      pending.push({ id, at: (id === DM3 || id === DM2) && prior ? prior.at : Date.now() + (SLOW.has(id) ? 24000 : 1000) });
      return json(res, 200, { room_id: id });
    }
    const sm = p.match(/\/rooms\/([^/]+)\/state\/m\.room\.member\/(.+)$/);
    if (req.method === 'PUT' && sm) { console.log('STATE_PUT ' + Date.now() + ' ' + sm[1] + ' ' + body); const e = se('m.room.member', JSON.parse(body), sm[2], sm[2]); e.unsigned = { prev_content: { membership: 'join' } }; setTimeout(() => pendingState.push({ id: sm[1], ev: e }), 400); return json(res, 200, { event_id: e.event_id }); }
    if (p.includes('/account_data/') && req.method === 'PUT') {
      const type = decodeURIComponent(p.split('/account_data/')[1]);
      try { const c = JSON.parse(body); pendingAD.push({ type, content: c }); const i = held.findIndex((h) => h.type === type); if (i >= 0) held.splice(i, 1); held.push({ type, content: c }); } catch (e) {}
      return json(res, 200, {});
    }
    if (p.includes('/hierarchy')) return json(res, 200, { rooms: hierarchy() });
    if (p.includes('/directory/room/')) return NOROOT ? json(res, 404, { errcode: 'M_NOT_FOUND', error: 'Room alias not found' }) : json(res, 200, { room_id: ROOT, servers: ['test'] });
    if (p.endsWith('/keys/upload')) return json(res, 200, { one_time_key_counts: { signed_curve25519: 50 } });
    if (p.endsWith('/keys/query')) return json(res, 200, { device_keys: {}, failures: {} });
    if (p.includes('/room_keys/version')) return json(res, 404, { errcode: 'M_NOT_FOUND', error: 'none' });
    if (p.includes('/pushrules')) return json(res, 200, { global: { override: [], underride: [], room: [], sender: [], content: [] } });
    if (p.includes('/filter')) return json(res, 200, { filter_id: '1' });
    if (p.includes('/account_data/')) return json(res, 404, { errcode: 'M_NOT_FOUND', error: 'none' });
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
setInterval(flush, 300);
