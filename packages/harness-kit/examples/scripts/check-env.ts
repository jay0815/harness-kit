export default async function checkEnv(
  args: string[],
  context: { cwd: string; env?: Record<string, string> },
): Promise<{ success: boolean; output: string }> {
  const checks: string[] = [];

  // Check Node.js version
  checks.push(`Node.js: ${process.version}`);

  // Check cwd
  checks.push(`Working directory: ${context.cwd}`);

  // Check args
  if (args.length > 0) {
    checks.push(`Args: ${args.join(", ")}`);
  }

  // Check env vars
  const envVars = args.filter((a) => a.startsWith("--env=")).map((a) => a.slice(6));
  for (const key of envVars) {
    const value = context.env?.[key] ?? process.env[key] ?? "(not set)";
    checks.push(`${key}: ${value}`);
  }

  return {
    success: true,
    output: checks.join("\n"),
  };
}
