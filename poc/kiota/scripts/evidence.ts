export type EvidenceContext = Record<
  | "sourceCommit"
  | "runId"
  | "runAttempt"
  | "specSha256"
  | "fixtureSha256"
  | "actionCommit",
  string
>;

export function identityIssues(
  value: Record<string, unknown>,
  context: EvidenceContext,
  target: string,
  variant: string,
): string[] {
  return Object.entries({ ...context, target, inputVariant: variant })
    .filter(([field, expected]) => value[field] !== expected)
    .map(([field]) => `evidence ${field} does not match this run`);
}
