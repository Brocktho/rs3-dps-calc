import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// A full URL carrying the entire gzip+base64url loadout state routinely ran into the
// low-thousands of characters -- far past what's comfortable to paste/share. Storing the payload
// server-side and handing back a short code keeps the shareable link tiny instead.
const MAX_PAYLOAD_LENGTH = 200_000;
const CODE_LENGTH = 8;
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_INSERT_ATTEMPTS = 5;

function generateCode(): string {
	let code = '';
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
	}
	return code;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env?.DB) {
		error(500, 'Share storage is not configured');
	}

	const body = await request.json().catch(() => null);
	const payload = body && typeof body === 'object' ? (body as { payload?: unknown }).payload : null;
	if (typeof payload !== 'string' || !payload) {
		error(400, 'Missing share payload');
	}
	if (payload.length > MAX_PAYLOAD_LENGTH) {
		error(400, `Share payload exceeds ${MAX_PAYLOAD_LENGTH} characters`);
	}

	for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
		const code = generateCode();
		try {
			await platform.env.DB.prepare('INSERT INTO shared_loadouts (code, payload) VALUES (?, ?)')
				.bind(code, payload)
				.run();
			return json({ code });
		} catch {
			// Primary key collision on `code` -- retry with a freshly generated one.
		}
	}

	error(500, 'Failed to generate a unique share code');
};
