import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectHtmlAssetRefs, contentTypeForAssetPath } from "../src/asset-refs.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = path.join(
		os.tmpdir(),
		`tot-refs-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
});

afterEach(() => {
	tmpDir = "";
});

describe("HTML asset refs", () => {
	it("collects direct local browser dependencies and skips non-local/navigation refs", () => {
		const htmlFile = path.join(tmpDir, "page.html");
		const refs = collectHtmlAssetRefs(
			`
			<!doctype html>
			<img src="img/logo.webp?cache=1" srcset="img/logo-small.webp 400w, img/logo-large.webp 800w">
				<picture><source srcset="hero.jpg 1x, hero@2x.jpg 2x"></picture>
				<video src="media/demo.mp4" poster="poster.jpg"></video>
				<link rel="stylesheet" href="./style.css">
				<link rel="preload" href="preload.webp">
				<link rel="modulepreload" href="bootstrap.mjs">
				<link rel="icon" href="favicon.svg">
				<script src="app.js"></script>
				<img src="https://example.com/external.png">
				<img src="data:image/png;base64,abc">
				<img srcset="data:image/png;base64,abc 1x, img/fallback.png 2x">
				<a href="other.html">navigation is not a support asset</a>
			`,
			htmlFile,
		);

		expect(refs.map((ref) => [ref.assetPath, ref.contentType])).toEqual([
			["img/logo.webp", "image/webp"],
			["img/logo-small.webp", "image/webp"],
			["img/logo-large.webp", "image/webp"],
			["hero.jpg", "image/jpeg"],
			["hero@2x.jpg", "image/jpeg"],
			["media/demo.mp4", "video/mp4"],
			["poster.jpg", "image/jpeg"],
			["style.css", "text/css"],
			["preload.webp", "image/webp"],
			["bootstrap.mjs", "application/javascript"],
			["favicon.svg", "image/svg+xml"],
			["app.js", "application/javascript"],
			["img/fallback.png", "image/png"],
		]);
		expect(refs[0].localPath).toBe(path.join(tmpDir, "img/logo.webp"));
	});

	it("dedupes by normalized upload path", () => {
		const refs = collectHtmlAssetRefs(
			`<img src="./img/logo.webp"><source srcset="img/logo.webp?v=2 1x">`,
			path.join(tmpDir, "page.html"),
		);
		expect(refs.map((ref) => ref.assetPath)).toEqual(["img/logo.webp"]);
	});

	it("rejects unsupported local asset types and refs outside the workspace path", () => {
		expect(() =>
			collectHtmlAssetRefs(`<img src="photo.avif">`, path.join(tmpDir, "page.html")),
		).toThrow(/unsupported asset type/);

		expect(() =>
			collectHtmlAssetRefs(`<img src="../secret.png">`, path.join(tmpDir, "page.html")),
		).toThrow(/unsupported local asset ref/);
	});

	it("rejects root-relative refs and base href instead of guessing a project root", () => {
		expect(() =>
			collectHtmlAssetRefs(`<img src="/hero.webp">`, path.join(tmpDir, "page.html")),
		).toThrow(/root-relative asset ref is unsupported/);

		expect(() =>
			collectHtmlAssetRefs(
				`<base href="assets/"><img src="hero.webp">`,
				path.join(tmpDir, "page.html"),
			),
		).toThrow(/unsupported <base href>/);
	});

	it("maps asset extensions to the documented content types", () => {
		expect(contentTypeForAssetPath("style.css")).toBe("text/css");
		expect(contentTypeForAssetPath("app.mjs")).toBe("application/javascript");
		expect(contentTypeForAssetPath("clip.mp4")).toBe("video/mp4");
		expect(contentTypeForAssetPath("notes.txt")).toBeNull();
	});
});
