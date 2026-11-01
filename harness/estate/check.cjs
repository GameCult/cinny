// Assertions for the estate drives: every drive states the outcome it exists to show and exits
// non-zero when the page or the fake homeserver's log says otherwise.
const fs = require('fs');
const fails = [];
exports.expect = (label, ok, detail = '') => {
  console.log(`[ASSERT] ${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` :: ${detail}`}`);
  if (!ok) fails.push(label);
};
/** Exit code for the drive: 4 when any assertion failed. */
exports.done = () => (fails.length ? 4 : 0);
/** The fake homeserver's request log (HSLOG is shared with the server process). */
exports.hsLog = () => fs.readFileSync(process.env.HSLOG, 'utf8').split('\n');
/** Bodies of the account-data PUTs for m.direct, in order. */
exports.mDirectPuts = () =>
  exports.hsLog().filter((l) => / PUT .*m\.direct BODY /.test(l)).map((l) => l.split(' BODY ')[1]);
/** Join requests the server saw for a room id. */
exports.joinsOf = (roomId) => exports.hsLog().filter((l) => new RegExp(` JOIN ${roomId}$`).test(l)).length;
const HEADERS = ['GameCult', 'Projects', 'nibu', 'eureka', 'Nibu', 'Eureka', 'Elsewhere', 'Direct Messages'];
/** The tier header above a row, 'absent' when the page does not show the row, 'none-above' when no tier header precedes it. */
const tierOf = (pg, name) =>
  pg.evaluate((n) => {
    const s = document.body.innerText.split('\n').map((x) => x.trim());
    const i = s.indexOf(n);
    if (i < 0) return 'absent';
    for (let j = i; j >= 0; j--) if (/^(elsewhere|direct messages)$/i.test(s[j])) return s[j];
    return 'none-above';
  }, name);
/**
 * The tier a room is listed under, read from a fresh visit to the room list: a collapsed tier is
 * opened only if the row is not already showing, so reading never closes what is open.
 */
exports.revealedTier = async (pg, name) => {
  await pg.goto('http://127.0.0.1:8080/#/home/');
  await pg.waitForTimeout(2500);
  let t = await tierOf(pg, name);
  for (const h of HEADERS) {
    if (t !== 'absent') break;
    const hl = pg.getByText(h, { exact: true });
    if (await hl.count()) { await hl.first().click(); await pg.waitForTimeout(250); t = await tierOf(pg, name); }
  }
  return t;
};
/** True when the page text matches re within ms of now (a message can be replaced by a row change). */
exports.sawText = (pg, re, ms) =>
  pg.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout: ms, polling: 50 }).then(() => true, () => false);
exports.isDm = (tier) => /^direct messages$/i.test(tier);
