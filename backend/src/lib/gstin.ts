export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// GST state codes (the first two digits of a GSTIN), per the official CBIC list.
export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  Punjab: "03",
  Chandigarh: "04",
  Uttarakhand: "05",
  Haryana: "06",
  Delhi: "07",
  Rajasthan: "08",
  "Uttar Pradesh": "09",
  Bihar: "10",
  Sikkim: "11",
  "Arunachal Pradesh": "12",
  Nagaland: "13",
  Manipur: "14",
  Mizoram: "15",
  Tripura: "16",
  Meghalaya: "17",
  Assam: "18",
  "West Bengal": "19",
  Jharkhand: "20",
  Odisha: "21",
  Chhattisgarh: "22",
  "Madhya Pradesh": "23",
  Gujarat: "24",
  Maharashtra: "27",
  "Andhra Pradesh": "28",
  Karnataka: "29",
  Goa: "30",
  Kerala: "32",
  "Tamil Nadu": "33",
  Puducherry: "34",
  Telangana: "36",
};

// Returns an error message if invalid, or null if the GSTIN is well-formed
// and its embedded state code matches the given state.
export function validateGstin(gstin: string, state: string): string | null {
  if (!GSTIN_REGEX.test(gstin)) {
    return "GSTIN is not a valid 15-character GSTIN";
  }
  const expectedCode = GST_STATE_CODES[state];
  if (expectedCode && gstin.slice(0, 2) !== expectedCode) {
    return `GSTIN state code ${gstin.slice(0, 2)} does not match ${state} (${expectedCode})`;
  }
  return null;
}
