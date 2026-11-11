import { describe, expect, it } from 'vitest';
import { registerTroubleMessage } from '../authMessages';
import { RegisterError, registerErrorTrouble } from './registerUtil';

// What the form shows for a failed registration, from the error code the server answered with.
const shown = (errcode: string) => {
  const trouble = registerErrorTrouble(errcode);
  return trouble && registerTroubleMessage(trouble, 'chat.example');
};

describe('registration failures as the form shows them', () => {
  it('say what to do next for every failure that is not a username field error', () => {
    [
      RegisterError.PasswordWeak,
      RegisterError.PasswordShort,
      RegisterError.RateLimited,
      RegisterError.Forbidden,
      RegisterError.InvalidRequest,
      RegisterError.Unknown,
    ].forEach((e) => expect(shown(e)?.length).toBeGreaterThan(20));
  });

  it('never carry the server text or a Matrix error code', () => {
    Object.values(RegisterError).forEach((e) => {
      expect(shown(e) ?? '').not.toMatch(/M_[A-Z_]+|errcode|homeserver does not/i);
    });
  });

  it('leave the username errors to their own field messages', () => {
    [RegisterError.UserTaken, RegisterError.UserInvalid, RegisterError.UserExclusive].forEach((e) =>
      expect(shown(e)).toBeUndefined()
    );
  });

  it('tell a closed server from a rate limit', () => {
    expect(shown(RegisterError.Forbidden)).toContain('chat.example');
    expect(shown(RegisterError.RateLimited)).not.toBe(shown(RegisterError.Forbidden));
  });
});
