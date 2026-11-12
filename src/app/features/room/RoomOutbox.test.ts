import { describe, expect, it } from 'vitest';
import { SLOW_SEND_MS, outboxView } from './RoomOutbox';

describe('outboxView', () => {
  it('walks sending -> still sending (resendable) -> failed', () => {
    expect(outboxView({ status: 'pending', ts: 100 }, 100, 0)).toMatchObject({
      label: 'Sending…',
      canResend: false,
    });
    expect(outboxView({ status: 'pending', ts: 100 }, 100 + SLOW_SEND_MS, 0)).toMatchObject({
      label: 'Still sending: slow connection',
      canResend: true,
    });
    expect(outboxView({ status: 'failed', ts: 100, error: 'x' }, 100, 0)).toMatchObject({
      failed: true,
      canResend: true,
    });
  });

  it('an entry older than this page load reads as interrupted', () => {
    expect(outboxView({ status: 'pending', ts: 5 }, 6, 10).label).toMatch(/Interrupted/);
  });
});

