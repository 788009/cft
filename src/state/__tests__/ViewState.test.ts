import { describe, expect, it, vi } from 'vitest';
import { ViewState } from '../ViewState';

describe('ViewState', () => {
  it('derives orientation and updates it at the square boundary', () => {
    const state = new ViewState(800, 900);
    expect(state.getSnapshot().viewport.orientation).toBe('portrait');

    state.updateViewport(900, 900);
    expect(state.getSnapshot().viewport.orientation).toBe('landscape');
  });

  it('notifies subscribers only for actual changes', () => {
    const state = new ViewState(900, 600);
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);

    state.updateViewport(900, 600);
    state.updateMap({ x: 0, y: 0, k: 1, level: 'province' });
    expect(listener).not.toHaveBeenCalled();

    state.updateMap({ x: 20, y: 30, k: 2.7, level: 'city' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].map).toEqual({ x: 20, y: 30, k: 2.7, level: 'city' });

    unsubscribe();
    state.updateViewport(1000, 600);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns snapshots that cannot mutate internal state', () => {
    const state = new ViewState(900, 600);
    const snapshot = state.getSnapshot();
    snapshot.viewport.width = 1;

    expect(state.getSnapshot().viewport.width).toBe(900);
  });
});
