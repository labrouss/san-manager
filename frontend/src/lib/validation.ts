// src/lib/validation.ts
// Shared validation utilities — mirrors the backend isValidWwn() logic

/** Matches XX:XX:XX:XX:XX:XX:XX:XX (case-insensitive) */
export const WWN_REGEX = /^([0-9a-f]{2}:){7}[0-9a-f]{2}$/i;

export function isValidWwn(wwn: string): boolean {
  return WWN_REGEX.test(wwn.trim());
}

/** Normalise to lowercase colon-separated format */
export function normaliseWwn(wwn: string): string {
  return wwn.trim().toLowerCase();
}
