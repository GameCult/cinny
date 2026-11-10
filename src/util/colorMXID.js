// https://github.com/cloudrac3r/cadencegq/blob/master/pug/mxid.pug

function hashCode(str) {
  let hash = 0;
  let i;
  let chr;
  if (str.length === 0) {
    return hash;
  }
  for (i = 0; i < str.length; i += 1) {
    chr = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + chr;
    // eslint-disable-next-line no-bitwise
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Which of the eight user colours (1..8) a user id takes. */
export function indexColorMXID(userId) {
  return (hashCode(userId) % 8) + 1;
}

export function cssColorMXID(userId) {
  return `--mx-uc-${indexColorMXID(userId)}`;
}

export default function colorMXID(userId) {
  return `var(${cssColorMXID(userId)})`;
}
