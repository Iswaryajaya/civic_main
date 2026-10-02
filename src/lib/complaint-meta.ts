/** Client-safe complaint metadata shared across pages. */
export const COMPLAINT_STATUSES = [
  "new",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const SEVERITY_COLORS: Record<string, string> = {
  low: "oklch(0.52 0.07 110)",
  medium: "oklch(0.6 0.08 80)",
  high: "oklch(0.5 0.1 30)",
  critical: "oklch(0.5 0.16 30)",
};

/** Municipal departments (authority login + complaint routing). */
export const DEPARTMENTS = [
  "public_health",
  "water_supply",
  "roads",
  "drainage",
  "revenue",
  "street_lighting",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  public_health: "Public Health & Sanitation",
  water_supply: "Water Supply",
  roads: "Roads & Infrastructure",
  drainage: "Drainage & Storm Water",
  revenue: "Revenue Task",
  street_lighting: "Street Lighting",
};

/** Which department handles each AI-detected issue type. */
export const ISSUE_TYPE_DEPARTMENT: Record<string, Department> = {
  garbage: "public_health",
  stray_animal: "public_health",
  water_leak: "water_supply",
  pothole: "roads",
  road_damage: "roads",
  traffic_signal: "roads",
  drainage: "drainage",
  streetlight: "street_lighting",
  encroachment: "revenue",
  other: "revenue",
};

export function departmentForIssueType(issueType: string): Department {
  return ISSUE_TYPE_DEPARTMENT[issueType] ?? "revenue";
}

export function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && (DEPARTMENTS as readonly string[]).includes(value);
}
