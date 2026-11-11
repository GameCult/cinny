// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

// The product rule is one join path: a join is joinEstateRoom, which files the DM before it sends the join.
// This pins that the lint config enforces it, not just that the code happens to comply today.
const lint = async (filePath: string, code: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), useEslintrc: true });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
};
const JOIN = 'export const f = (mx: { joinRoom: (id: string) => void }) => mx.joinRoom("!a:b");\n';

describe('the one join path is enforced by lint', () => {
  it('rejects a joinRoom call anywhere but joinEstateRoom.ts', async () => {
    const found = await lint('src/app/features/estate/EstateNavigator.tsx', JOIN);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('joinEstateRoom');
  });

  it('allows the call inside joinEstateRoom.ts itself', async () => {
    expect(await lint('src/app/features/estate/joinEstateRoom.ts', JOIN)).toHaveLength(0);
  });

  it('still applies the Airbnb syntax bans in the same files', async () => {
    const found = await lint(
      'src/app/foo.ts',
      'export const g = (o: object) => { for (const k in o) { return k; } return 0; };\n'
    );
    expect(found.some((m) => m.message.includes('for..in'))).toBe(true);
  });
});
