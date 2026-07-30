import type { PageServerLoad } from './$types';

interface FeedbackRow {
	id: number;
	message: string;
	created_at: string;
}

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform?.env?.DB) {
		return { feedback: [] as FeedbackRow[] };
	}

	const { results } = await platform.env.DB.prepare(
		'SELECT id, message, created_at FROM feedback ORDER BY id DESC LIMIT 200'
	).all<FeedbackRow>();

	return { feedback: results };
};
