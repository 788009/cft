export interface MiddleSchoolLineScale {
  minWidth: number;
  maxWidth: number;
  logarithmicStep: number;
}

export function calculateMiddleSchoolLineWidth(
  studentCount: number,
  scale: MiddleSchoolLineScale,
): number {
  const count = Math.max(1, Math.floor(studentCount));
  return Math.min(
    scale.maxWidth,
    scale.minWidth + Math.log2(count) * scale.logarithmicStep,
  );
}
