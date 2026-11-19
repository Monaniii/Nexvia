import { describe, expect, it } from 'vitest';
import { formatDuration } from './api';

describe('formatDuration', () => {
  it('formats empty, minute, and hour-based lessons', () => {
    expect(formatDuration(0)).toBe('Self-paced');
    expect(formatDuration(59)).toBe('1 min');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3660)).toBe('1h 1m');
  });
});
