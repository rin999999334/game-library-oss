export const minimumToolVersions: Record<string, number[]>;
export function stableVersionAtLeast(value: unknown, minimum: number[]): boolean;
export function toolchainFindings(lock: { packages?: Record<string, { version?: string }> }, installed: Record<string, string | undefined>, paths?: Record<string, string>): string[];
