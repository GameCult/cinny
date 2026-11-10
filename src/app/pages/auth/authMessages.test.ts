import { describe, expect, it } from 'vitest';
import {
  loginErrorMessage,
  noSignInMethodMessage,
  registerTroubleMessage,
  serverTroubleMessage,
  type RegisterTrouble,
  type ServerTrouble,
} from './authMessages';
import { LoginError } from './login/loginUtil';

const stock = [
  'Invalid Username or Password.',
  'Failed to find homeserver.',
  'Failed to connect',
  'Failed to login',
];
const troubles: ServerTrouble[] = [
  'not-found',
  'unusable-setup',
  'bad-address',
  'unreachable',
  'no-sign-in-info',
];
const registerTroubles: RegisterTrouble[] = ['closed', 'rate-limited', 'invalid', 'unsupported'];

describe('sign-in and sign-up messages', () => {
  it('has a message for every sign-in error, each different, none the stock wording', () => {
    const messages = Object.values(LoginError).map((e) => loginErrorMessage(e));
    expect(new Set(messages).size).toBe(messages.length);
    messages.forEach((m) => stock.forEach((s) => expect(m).not.toContain(s)));
  });

  it('keeps wrong credentials apart from a missing server', () => {
    expect(loginErrorMessage(LoginError.Forbidden)).toContain('username and password');
    expect(loginErrorMessage(LoginError.InvalidServer)).toContain('@name:server');
  });

  it('names the server in every server message and says what to do', () => {
    troubles.forEach((t) => {
      const m = serverTroubleMessage(t, 'chat.example', 'bad.host');
      expect(m).toContain('chat.example');
      stock.forEach((s) => expect(m).not.toContain(s));
    });
    expect(serverTroubleMessage('unusable-setup', 'chat.example', 'bad.host')).toContain(
      'bad.host'
    );
    expect(serverTroubleMessage('unreachable', 'chat.example')).toContain('reload');
  });

  it('tells a person who cannot fix a broken server setup to tell its owner', () => {
    expect(serverTroubleMessage('bad-address', 'chat.example')).toContain(
      'whoever runs the server'
    );
    expect(noSignInMethodMessage('chat.example')).toContain('chat.example');
  });

  it('says closed sign-up is closed and points to sign in or the inviter, without a Register link to nowhere', () => {
    const m = registerTroubleMessage('closed', 'chat.example');
    expect(m).toContain('chat.example');
    expect(m).toContain('sign in');
    expect(m).toContain('invited you');
    expect(m).not.toContain('disabled');
    registerTroubles.forEach((t) =>
      expect(registerTroubleMessage(t, 'chat.example').length).toBeGreaterThan(20)
    );
  });
});
