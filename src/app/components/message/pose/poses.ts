// Pose labels travel in the event content under POSE_KEY. Art exists per Mind;
// every Mind has the shared set plus four signature poses of its own.
export const POSE_KEY = 'org.gamecult.pose';

export const SHARED_POSES = [
  'neutral',
  'happy',
  'amused',
  'thinking',
  'concerned',
  'annoyed',
  'surprised',
  'determined',
] as const;

export const MIND_POSES: Record<string, readonly string[]> = {
  aqua: ['conduct', 'listen', 'patch', 'flourish'],
  eureka: ['probe', 'inspect', 'report', 'hood'],
  heimdall: ['badge', 'barrier', 'protect', 'revoke'],
  kiko: ['tinker', 'confetti', 'sprint', 'debug'],
  libby: ['stamp', 'research', 'shush', 'schema'],
  nibu: ['console', 'glitch', 'lore', 'triumph'],
  weksa: ['map', 'fieldwork', 'argue', 'interlingua'],
};

export const NEUTRAL = 'neutral';

// A sender is a known Mind when its Matrix localpart or the first word of its
// display name is the Mind's name, case-insensitively.
export const mindOfSender = (localpart?: string, displayName?: string): string | undefined => {
  const candidates = [localpart, displayName?.split(/\s+/)[0]];
  return candidates
    .map((c) => c?.toLowerCase())
    .find(
      (c): c is string => c !== undefined && Object.prototype.hasOwnProperty.call(MIND_POSES, c)
    );
};

// Unknown, missing or non-string labels, and another Mind's signature, fall back to neutral.
export const resolvePose = (mind: string, label: unknown): string => {
  if (typeof label !== 'string') return NEUTRAL;
  const l = label.trim().toLowerCase();
  const known = (SHARED_POSES as readonly string[]).includes(l) || MIND_POSES[mind]?.includes(l);
  return known ? l : NEUTRAL;
};

export const poseSrc = (mind: string, pose: string, base = '/'): string =>
  `${base}public/poses/${mind}/${pose}.webp`;
