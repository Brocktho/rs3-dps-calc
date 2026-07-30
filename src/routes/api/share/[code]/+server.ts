import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CODE_PATTERN = /^[a-z0-9]+$/;

export const GET: RequestHandler = async ({ params, platform }) => {
	if (!platform?.env?.DB) {
		error(500, 'Share storage is not configured');
	}

	const code = params.code;
	if (!CODE_PATTERN.test(code)) {
		error(400, 'Invalid share code');
	}

	const row = await platform.env.DB.prepare(
		'SELECT payload FROM shared_loadouts WHERE code = ?'
	)
		.bind(code)
		.first<{ payload: string }>();

	if (!row) {
		error(404, 'Share link not found or expired');
	}

	return json({ payload: row.payload });
};
