import { describe, expect, it } from 'vitest';
import { calculateMiddleSchoolLineWidth } from '@/map/MiddleSchool';

describe('middle school connection width', () => {
  const scale = { minWidth: 1.5, maxWidth: 6, logarithmicStep: 1.1 };

  it('grows with student count and respects the configured maximum', () => {
    expect(calculateMiddleSchoolLineWidth(1, scale)).toBe(1.5);
    expect(calculateMiddleSchoolLineWidth(4, scale))
      .toBeGreaterThan(calculateMiddleSchoolLineWidth(2, scale));
    expect(calculateMiddleSchoolLineWidth(1_000, scale)).toBe(6);
  });
});
