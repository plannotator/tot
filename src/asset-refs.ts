import path from "node:path";
import * as parse5 from "parse5";

export type AssetContentType =
	| "image/png"
	| "image/jpeg"
	| "image/gif"
	| "image/webp"
	| "image/svg+xml"
	| "text/css"
	| "application/javascript"
	| "video/mp4";

export interface HtmlAssetRef {
	/** The literal URL-like value from the HTML, before query/hash stripping. */
	ref: string;
	/** Workspace asset path to upload, relative to the HTML file's folder. */
	assetPath: string;
	/** Absolute local file path to read. */
	localPath: string;
	contentType: AssetContentType;
}

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_ASSET_BYTES_LABEL = "10 MiB";

interface HtmlNode {
	nodeName?: string;
	tagName?: string;
	attrs?: Array<{ name: string; value: string }>;
	childNodes?: HtmlNode[];
}

const CONTENT_TYPES_BY_EXT: Record<string, AssetContentType> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".css": "text/css",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".mp4": "video/mp4",
};

export function contentTypeForAssetPath(assetPath: string): AssetContentType | null {
	return CONTENT_TYPES_BY_EXT[path.extname(assetPath).toLowerCase()] ?? null;
}

export function validWorkspacePath(value: string): boolean {
	if (value.length === 0) return false;
	if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false;
	if (/[\\?#%]/u.test(value)) return false;
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) < 0x20) return false;
	}
	for (const segment of value.split("/")) {
		if (segment === "." || segment === "..") return false;
	}
	return true;
}

export function encodeWorkspacePath(value: string): string {
	return value.split("/").map(encodeURIComponent).join("/");
}

export function collectHtmlAssetRefs(html: string, htmlFilePath: string): HtmlAssetRef[] {
	const root = parse5.parse(html) as HtmlNode;
	const baseDir = path.dirname(path.resolve(htmlFilePath));
	const refs: string[] = [];
	visit(root, refs);

	const seen = new Set<string>();
	const assets: HtmlAssetRef[] = [];
	for (const ref of refs) {
		const resolved = resolveLocalAssetRef(ref, baseDir);
		if (resolved === null) continue;
		if (seen.has(resolved.assetPath)) continue;
		seen.add(resolved.assetPath);
		assets.push(resolved);
	}
	return assets;
}

function visit(node: HtmlNode, refs: string[]): void {
	const tagName = node.tagName?.toLowerCase();
	if (tagName !== undefined) collectRefsForNode(tagName, node, refs);
	for (const child of node.childNodes ?? []) visit(child, refs);
}

function collectRefsForNode(tagName: string, node: HtmlNode, refs: string[]): void {
	if (tagName === "base" && attr(node, "href") !== null) {
		throw new Error(
			"unsupported <base href>: tot resolves support files relative to the HTML file",
		);
	}
	if (tagName === "img") {
		pushAttr(node, "src", refs);
		pushSrcset(node, refs);
		return;
	}
	if (tagName === "source") {
		pushAttr(node, "src", refs);
		pushSrcset(node, refs);
		return;
	}
	if (tagName === "video") {
		pushAttr(node, "src", refs);
		pushAttr(node, "poster", refs);
		return;
	}
	if (tagName === "script") {
		pushAttr(node, "src", refs);
		return;
	}
	if (tagName === "link" && isSupportLink(node)) {
		pushAttr(node, "href", refs);
	}
}

function pushAttr(node: HtmlNode, name: string, refs: string[]): void {
	const value = attr(node, name);
	if (value !== null) refs.push(value);
}

function pushSrcset(node: HtmlNode, refs: string[]): void {
	const value = attr(node, "srcset");
	if (value === null) return;
	for (const candidate of parseSrcsetUrls(value)) refs.push(candidate);
}

function attr(node: HtmlNode, name: string): string | null {
	const target = name.toLowerCase();
	for (const a of node.attrs ?? []) {
		if (a.name.toLowerCase() === target) return a.value.trim();
	}
	return null;
}

function isSupportLink(node: HtmlNode): boolean {
	const rel = attr(node, "rel");
	if (rel === null) return false;
	const tokens = new Set(rel.toLowerCase().split(/\s+/).filter(Boolean));
	return (
		tokens.has("stylesheet") ||
		tokens.has("preload") ||
		tokens.has("modulepreload") ||
		tokens.has("icon") ||
		tokens.has("apple-touch-icon") ||
		tokens.has("mask-icon")
	);
}

function parseSrcsetUrls(srcset: string): string[] {
	const urls: string[] = [];
	let i = 0;
	while (i < srcset.length) {
		while (i < srcset.length && /[\s,]/u.test(srcset[i])) i++;
		const start = i;
		while (i < srcset.length && !/\s/u.test(srcset[i]) && srcset[i] !== ",") i++;

		// data: URLs can contain commas; keep reading until the descriptor
		// whitespace. The URL-level scheme skip will discard it later.
		if (srcset.slice(start, i).toLowerCase().startsWith("data:")) {
			while (i < srcset.length && !/\s/u.test(srcset[i])) i++;
		}

		const url = srcset.slice(start, i);
		if (url !== "") urls.push(url);
		while (i < srcset.length && srcset[i] !== ",") i++;
	}
	return urls;
}

function resolveLocalAssetRef(ref: string, baseDir: string): HtmlAssetRef | null {
	const stripped = stripQueryAndHash(ref.trim());
	if (stripped === null) return null;
	const decoded = decodePath(stripped);
	const normalized = decoded.replace(/\\/g, "/");
	const skip = skipReason(normalized);
	if (skip === "external") return null;
	if (skip === "root-relative") {
		throw new Error(`root-relative asset ref is unsupported: ${ref} (use a relative path)`);
	}

	const assetPath = path.posix.normalize(normalized);
	if (!validWorkspacePath(assetPath)) {
		throw new Error(`unsupported local asset ref: ${ref}`);
	}
	const contentType = contentTypeForAssetPath(assetPath);
	if (contentType === null) {
		throw new Error(`unsupported asset type for local ref: ${ref}`);
	}
	return {
		ref,
		assetPath,
		localPath: path.resolve(baseDir, assetPath),
		contentType,
	};
}

function stripQueryAndHash(ref: string): string | null {
	if (ref === "" || ref.startsWith("#")) return null;
	const splitAt = firstIndexOf(ref, ["?", "#"]);
	return splitAt < 0 ? ref : ref.slice(0, splitAt);
}

function firstIndexOf(value: string, needles: string[]): number {
	let idx = -1;
	for (const needle of needles) {
		const found = value.indexOf(needle);
		if (found >= 0 && (idx < 0 || found < idx)) idx = found;
	}
	return idx;
}

function decodePath(ref: string): string {
	try {
		return decodeURIComponent(ref);
	} catch {
		throw new Error(`invalid percent-encoding in local asset ref: ${ref}`);
	}
}

function skipReason(ref: string): "external" | "root-relative" | null {
	if (ref === "" || ref.startsWith("//")) return "external";
	if (ref.startsWith("/")) return "root-relative";
	const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(ref);
	return schemeMatch !== null ? "external" : null;
}
