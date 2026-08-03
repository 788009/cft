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

export type ProvinceAdcodeMap = Record<string, string>;
export type CityAdcodeMap = Record<string, string>;

export interface ProcessedData {
  students: Student[];
  schools: SchoolGroup[];
  domesticSchools: SchoolGroup[];
  foreignSchools: SchoolGroup[];
}
