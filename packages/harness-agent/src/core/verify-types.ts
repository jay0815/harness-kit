export interface Fact {
  /** File path relative to workspace root */
  file: string;
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed end line (inclusive) */
  endLine: number;
  /** Exact text claimed to be at this location */
  exactText: string;
}

export interface ResultBlock {
  /** What the agent claims it did */
  currentWork: string;
  /** Facts cited to support the work */
  facts: Fact[];
  /** Reasoning / notes */
  reasoning?: string;
  /** Warnings generated during parsing (e.g. dropped facts) */
  warnings?: string[];
}

export interface VerifyReport {
  overall: "PASS" | "FAIL";
  checks: VerifyCheck[];
}

export interface VerifyCheck {
  fact: Fact;
  status: "PASS" | "FAIL";
  /** Actual text found on disk (only present on FAIL) */
  actual?: string;
  /** Error message if file/line could not be read */
  error?: string;
}
