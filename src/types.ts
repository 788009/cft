export interface RawStudent {
  no: string;
  name: string;
  short: string;
  university: string;
  province: string;
  city: string;
  contact: string;
  lat: string;
  lng: string;
}

export interface Student {
  no: number;
  rawNo: string;
  name: string;
  short: string;
  university: string;
  province: string;
  city: string;
  contact: string | null;
  lat: number | null;
  lng: number | null;
  originalIndex: number;
}

export interface SchoolGroup {
  university: string;
  province: string;
  city: string;
  provinceAdcode: string | null;
  cityAdcode: string | null;
  lat: number | null;
  lng: number | null;
  isForeign: boolean;
  students: Student[];
}

export interface MiddleSchoolInfo {
  name: string;
  province: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  titleImg?: string;
  titleImgDark?: string;
}

export interface TeacherEntry {
  role: string;
  names: string[];
}

export type ProvinceAdcodeMap = Record<string, string>;
export type CityAdcodeMap = Record<string, string>;

export interface ProcessedData {
  middleSchool: MiddleSchoolInfo | null;
  teachers: TeacherEntry[];
  students: Student[];
  schools: SchoolGroup[];
  domesticSchools: SchoolGroup[];
  foreignSchools: SchoolGroup[];
  indexes: {
    schoolByUniversity: Map<string, SchoolGroup>;
    schoolByStudent: Map<Student, SchoolGroup>;
    schoolsByProvinceAdcode: Map<string, SchoolGroup[]>;
    schoolsByCityAdcode: Map<string, SchoolGroup[]>;
  };
}
