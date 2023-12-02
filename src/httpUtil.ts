export function createJsonHeaders(): Headers {
	const headers = new Headers();
	headers.set("Content-Type", "application/json");
	return headers;
}
