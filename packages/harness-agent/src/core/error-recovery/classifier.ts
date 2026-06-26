import { ErrorType } from "./types.js";

const TIMEOUT_PATTERNS = [
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /\btimeout\b/i,
  /\btimed?\s*out\b/i,
  /\bsocket hang up\b/i,
  /\bECONNREFUSED\b/i,
];

const RATE_LIMIT_PATTERNS = [
  /\b429\b/,
  /\brate\s*limit\b/i,
  /\btoo many requests\b/i,
  /\bthrottl/i,
  /\bquota exceeded\b/i,
];

const PERMISSION_PATTERNS = [
  /\bpermission\b/i,
  /\bEACCES\b/,
  /\bEPERM\b/,
  /\bforbidden\b/i,
  /\bunauthorized\b/i,
  /\b403\b/,
  /\b401\b/,
];

const PARSE_PATTERNS = [
  /\bJSON\.parse\b/i,
  /\bUnexpected token\b/i,
  /\bSyntaxError\b/i,
  /\binvalid JSON\b/i,
  /\bmalformed\b/i,
];

const NOT_FOUND_PATTERNS = [
  /\bENOENT\b/,
  /\bnot found\b/i,
  /\bno such file\b/i,
  /\bdoes not exist\b/i,
];

const RESOURCE_PATTERNS = [
  /\bOOM\b/i,
  /\bout of memory\b/i,
  /\bresource\b.*\bexhausted\b/i,
  /\b503\b/,
  /\bservice unavailable\b/i,
];

export function classifyError(toolName: string, errorMessage: string): ErrorType {
  const msg = errorMessage || "";

  for (const pattern of TIMEOUT_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.TIMEOUT;
  }

  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.RESOURCE_EXHAUSTED;
  }

  for (const pattern of PERMISSION_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.PERMISSION_DENIED;
  }

  for (const pattern of PARSE_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.PARSE_ERROR;
  }

  for (const pattern of RESOURCE_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.RESOURCE_EXHAUSTED;
  }

  for (const pattern of NOT_FOUND_PATTERNS) {
    if (pattern.test(msg)) return ErrorType.TOOL_ERROR;
  }

  return ErrorType.UNKNOWN;
}
