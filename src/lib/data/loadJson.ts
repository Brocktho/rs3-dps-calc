import type { z } from 'zod';

/**
 * Validates a JSON data file against its Zod schema at import time, so a malformed entry
 * (typo'd enum value, missing field, wrong type) fails fast with a clear error instead of
 * surfacing as a subtle bug somewhere downstream in the UI or formulas.
 */
export function loadJson<Schema extends z.ZodType>(
	data: unknown,
	schema: Schema,
	sourceName: string
): z.infer<Schema> {
	const result = schema.safeParse(data);
	if (!result.success) {
		throw new Error(`Invalid data in ${sourceName}: ${result.error.message}`);
	}
	return result.data;
}
