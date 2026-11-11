import { describe, expect, it } from 'vitest';
import { registrationEntry } from './registrationEntry';
import type { ClientConfig } from '../../hooks/useClientConfig';
import {
  PREVIEW_NOTICE_TEXT,
  TRAINING_NOTICE_TEXT,
  TRAINING_NOTICE_VERSION,
} from '../../utils/trainingNotice';
import config from '../../../../config.json';

const url = 'https://accounts.example/register';

describe('registration entry', () => {
  it('is hidden when the switch is absent or off', () => {
    expect(registrationEntry({})).toBeUndefined();
    expect(registrationEntry({ registration: { url } })).toBeUndefined();
    expect(registrationEntry({ registration: { enabled: false, url } })).toBeUndefined();
  });

  it('ships off in config.json', () => {
    expect(registrationEntry(config as ClientConfig)).toBeUndefined();
    expect(config.registration.enabled).toBe(false);
  });

  it('is hidden when the switch is on but the url is no web address', () => {
    expect(registrationEntry({ registration: { enabled: true } })).toBeUndefined();
    expect(registrationEntry({ registration: { enabled: true, url: '' } })).toBeUndefined();
    expect(
      registrationEntry({ registration: { enabled: true, url: '/register' } })
    ).toBeUndefined();
    expect(
      registrationEntry({ registration: { enabled: true, url: 'data:text/html,x' } })
    ).toBeUndefined();
  });

  it('reads the consent text and version from trainingNotice.ts', () => {
    expect(registrationEntry({ registration: { enabled: true, url } })).toEqual({
      url,
      notice: TRAINING_NOTICE_TEXT,
      noticeVersion: TRAINING_NOTICE_VERSION,
    });
  });

  it('says the pretend sentence on the pretend server', () => {
    const entry = registrationEntry({ previewDemo: true, registration: { enabled: true, url } });
    expect(entry?.notice).toBe(PREVIEW_NOTICE_TEXT);
  });

  it('accepts http only for a local development host', () => {
    const on = (u: string) => registrationEntry({ registration: { enabled: true, url: u } });
    expect(on('http://localhost:8080/register')?.url).toBe('http://localhost:8080/register');
    expect(on('http://127.0.0.1:8080/register')).toBeDefined();
    expect(on('http://accounts.example/register')).toBeUndefined();
    expect(on('http://localhost.evil.example/register')).toBeUndefined();
    expect(on('https://accounts.example/register')).toBeDefined();
  });
});
