import type {
    RawStudent,
    Student,
    SchoolGroup,
    ProvinceAdcodeMap,
    CityAdcodeMap,
    ProcessedData,
} from '@/types';

export function parseCsv(csvText: string): RawStudent[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const records: RawStudent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) {
      continue;
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ? values[index].trim() : '';
    });
    records.push(record as unknown as RawStudent);
  }

  return records;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function processStudentData(
  rawStudents: RawStudent[],
  provinceAdcodeMap: ProvinceAdcodeMap,
  cityAdcodeMap: CityAdcodeMap
): ProcessedData {
  const students: Student[] = rawStudents.map((raw, index) => {
    const parsedNo = parseInt(raw.no, 10);
    const latNum = parseFloat(raw.lat);
    const lngNum = parseFloat(raw.lng);

    return {
      no: isNaN(parsedNo) ? Number.MAX_SAFE_INTEGER : parsedNo,
      rawNo: raw.no,
      name: raw.name,
      short: raw.short,
      university: raw.university,
      province: raw.province,
      city: raw.city,
      contact: raw.contact && raw.contact.trim() !== '' ? raw.contact.trim() : null,
      lat: isNaN(latNum) ? null : latNum,
      lng: isNaN(lngNum) ? null : lngNum,
      originalIndex: index,
    };
  });

  const schoolMap = new Map<string, Student[]>();
  for (const student of students) {
    if (!schoolMap.has(student.university)) {
      schoolMap.set(student.university, []);
    }
    schoolMap.get(student.university)!.push(student);
  }

  const schools: SchoolGroup[] = [];

  for (const [university, studentList] of schoolMap.entries()) {
    const sortedStudents = [...studentList].sort((a, b) => {
      if (a.no !== b.no) {
        return a.no - b.no;
      }
      return a.originalIndex - b.originalIndex;
    });

    const sample = sortedStudents[0];
    const provinceAdcode = provinceAdcodeMap[sample.province] || null;
    const isForeign = provinceAdcode === null;

    let cityAdcode: string | null = null;
    if (!isForeign) {
      cityAdcode = cityAdcodeMap[sample.city] || provinceAdcode;
    }

    schools.push({
      university,
      province: sample.province,
      city: sample.city,
      provinceAdcode,
      cityAdcode,
      lat: sample.lat,
      lng: sample.lng,
      isForeign,
      students: sortedStudents,
    });
  }

  const domesticSchools = schools.filter((s) => !s.isForeign);
  const foreignSchools = schools.filter((s) => s.isForeign);

  return {
    students,
    schools,
    domesticSchools,
    foreignSchools,
  };
}
