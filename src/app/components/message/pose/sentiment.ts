import { POSE_KEY, NEUTRAL, resolvePose } from './poses';

// catalogue.json beside this file is a vendored copy of /opt/commons/cast-art/poses/catalogue.json
// (npm run sync:poses); nothing else publishes it to the browser.
// Local sentiment -> pose label. A lexicon over the message text, no network, no model: the
// same text always gives the same pose. Rules are tried in order and the first hit wins, so a
// message that says "wow" and "thanks" reads as surprised. Only the shared labels (identical art
// for all eight Minds, catalogue.json) are ever output; signature labels are explicit-only.
const RULES: [string, RegExp][] = [
  ['annoyed', /\b(annoy\w*|ugh+|argh+|frustrat\w*|again\?|why won'?t|stop it)\b/i],
  ['surprised', /\b(wow|whoa|woah|omg|no way|unexpected\w*|surpris\w*|wait,? what)\b|[?!]{2,}/i],
  [
    'determined',
    /\b(let'?s (go|do|fix|ship)|on it|i'?ll (fix|do|handle)|will do|fixing|resolved?)\b/i,
  ],
  ['amused', /\b(ha(ha)+|lol|lmao|rofl|funny|hilarious)\b|😂|🤣/i],
  [
    'happy',
    /\b(thanks?|thank you|thx|great|awesome|nice|love|perfect|excellent|yay|congrats)\b|🎉|😊/i,
  ],
  ['thinking', /\?\s*$|\b(hmm+|maybe|perhaps|i wonder|not sure|how (do|does|about)|what if)\b/i],
];

export const classifyPose = (text: unknown): string => {
  if (typeof text !== 'string') return NEUTRAL;
  const hit = RULES.find(([, re]) => re.test(text));
  return hit ? hit[0] : NEUTRAL;
};

// An explicit org.gamecult.pose label always wins, even when it is unknown (then neutral).
// Only events with no label are read for sentiment.
export const messagePose = (mind: string, content: Record<string, unknown>): string =>
  content[POSE_KEY] !== undefined
    ? resolvePose(mind, content[POSE_KEY])
    : resolvePose(mind, classifyPose(content.body));
