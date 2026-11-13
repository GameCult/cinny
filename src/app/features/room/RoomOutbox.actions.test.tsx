import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOutbox, failOutbox, loadOutbox } from '../../state/room/composerStore';
import { RoomOutbox } from './RoomOutbox';

// The component's hooks are held still (state is its initial value, effects do not run) so the element tree
// it returns can be read and its click handlers called without a DOM.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    () => undefined,
  ];
  return {
    ...actual,
    default: { ...actual, useState, useEffect: () => undefined },
    useState,
    useEffect: () => undefined,
  };
});

type El = { props?: { children?: unknown; onClick?: () => void } };
const flatten = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node && typeof node === 'object') {
    const el = node as El;
    return [el, ...flatten(el.props?.children)];
  }
  return [];
};
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') return textOf((node as El).props?.children);
  return '';
};
/** The onClick of the chip whose label is `label`. */
const clickOf = (tree: unknown, label: string) => {
  const chip = flatten(tree).find((e) => e.props?.onClick && textOf(e) === label);
  if (!chip?.props?.onClick) throw new Error(`no ${label} chip`);
  return chip.props.onClick;
};

describe('RoomOutbox actions', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    });
    enqueueOutbox('@a:x', { txnId: 'keep', roomId: '!r:x', content: { body: 'stay' } });
    enqueueOutbox('@a:x', { txnId: 'bad', roomId: '!r:x', content: { body: 'did not go' } });
    failOutbox('@a:x', 'bad', 'ECONNRESET');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mount = () => {
    const mx = {
      getUserId: () => '@a:x',
      makeTxnId: () => 'txn-new',
      getRoom: () => undefined,
      sendEvent: vi.fn().mockResolvedValue({ event_id: '$e' }),
    };
    const tree = (RoomOutbox as unknown as (p: unknown) => unknown)({ mx, roomId: '!r:x' });
    return { mx, tree };
  };

  it('Discard removes that message from the outbox and no other', () => {
    const { mx, tree } = mount();
    // both entries are shown; the failed one is the one with Discard
    clickOf(tree, 'Discard')();
    expect(loadOutbox('@a:x').map((e) => e.txnId)).toEqual(['keep']);
    expect(mx.sendEvent).not.toHaveBeenCalled();
  });

  it('Resend sends that message again and does not discard it first', async () => {
    const { mx, tree } = mount();
    clickOf(tree, 'Resend')();
    await Promise.resolve();
    expect(mx.sendEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendEvent).toHaveBeenCalledWith(
      '!r:x',
      'm.room.message',
      { body: 'did not go' },
      'bad'
    );
  });
});
