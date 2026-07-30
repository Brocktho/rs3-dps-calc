import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_MESSAGE_LENGTH = 2000;

// Strip control/non-printable characters that have no reason to be in feedback text and could
// otherwise mangle rendering wherever the message is displayed later. D1's bound parameters
// already prevent SQL injection -- this is just storage/display hygiene.
// eslint-disable-next-line no-control-regex -- intentionally matching control chars to strip them
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

function sanitizeMessage(raw: string): string {
	return raw.replace(CONTROL_CHARS, '').trim();
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env?.DB) {
		error(500, 'Feedback storage is not configured');
	}

	const body = await request.json().catch(() => null);
	const rawMessage =
		body && typeof body === 'object' ? (body as { message?: unknown }).message : null;
	if (typeof rawMessage !== 'string') {
		error(400, 'Missing feedback message');
	}

	// Honeypot: a hidden "website" input real users never see or fill. Only a bot blindly filling
	// every field on the form would populate it -- report success without writing anything, so
	// the bot has no signal that it was caught.
	const honeypot = body && typeof body === 'object' ? (body as { website?: unknown }).website : '';
	if (typeof honeypot === 'string' && honeypot.trim() !== '') {
		return json({ ok: true });
	}

	const message = sanitizeMessage(rawMessage);
	if (!message) {
		error(400, 'Feedback message is empty');
	}
	if (message.length > MAX_MESSAGE_LENGTH) {
		error(400, `Feedback message exceeds ${MAX_MESSAGE_LENGTH} characters`);
	}

	await platform.env.DB.prepare('INSERT INTO feedback (message) VALUES (?)').bind(message).run();

	return json({ ok: true });
};

export const GET: RequestHandler = async ({ platform }) => {
	if (!platform?.env?.DB) {
		error(500, 'Feedback storage is not configured');
	}

	const { results } = await platform.env.DB.prepare(
		'SELECT id, message, created_at FROM feedback ORDER BY id DESC LIMIT 200'
	).all<{ id: number; message: string; created_at: string }>();

	return json(results);
};
