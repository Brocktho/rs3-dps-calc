// Encodes/decodes arbitrary JSON-serializable state into a URL-safe string for the
// "share loadout" feature. Uses native CompressionStream (gzip) rather than pulling in a
// compression dependency -- supported in all current browsers this app targets.
function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
	const binary = atob(withPadding);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShareState(state: unknown): Promise<string> {
	const json = JSON.stringify(state);
	const compressed = await gzip(new TextEncoder().encode(json));
	return base64UrlEncode(compressed);
}

export async function decodeShareState<T>(encoded: string): Promise<T> {
	const compressed = base64UrlDecode(encoded);
	const json = new TextDecoder().decode(await gunzip(compressed));
	return JSON.parse(json) as T;
}
