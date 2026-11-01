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
exports.isDm = (tier) => /^direct messages$/i.test(tier);
