import type { HttpBody, HttpClient, HttpMethod, HttpResponse } from "../src/http.js";

export interface RecordedCall {
	method: HttpMethod;
	path: string;
	body?: HttpBody | undefined;
	headers?: Record<string, string>;
}

export type Responder = (call: RecordedCall) => HttpResponse;

/**
 * A recording HttpClient. `responder` returns the canned response for each call;
 * every call is pushed to `.calls` so tests can assert path/body/headers.
 */
export function stubHttp(responder: Responder): HttpClient & { calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	return {
		calls,
		async fetch(method, path, body, headers) {
			const call: RecordedCall = { method, path, body, headers };
			calls.push(call);
			return responder(call);
		},
	};
}

export function jsonResponse(status: number, json: any): HttpResponse {
	return { status, json, text: JSON.stringify(json) };
}

export function emptyResponse(status: number): HttpResponse {
	return { status, json: null, text: "" };
}
