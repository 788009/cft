import type { Student } from '@/types';

export interface PersonDetailRow {
  key: 'university' | 'province' | 'city' | 'contact';
  label: string;
  value: string;
}

export function getPersonDetailRows(student: Student): PersonDetailRow[] {
  const rows: PersonDetailRow[] = [
    { key: 'university', label: '大学', value: student.university },
    { key: 'province', label: '省份', value: student.province },
    { key: 'city', label: '城市', value: student.city },
  ];
  if (student.contact !== null) {
    rows.push({ key: 'contact', label: '联系方式', value: student.contact });
  }
  return rows;
}
