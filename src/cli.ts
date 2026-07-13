#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	listCommand,
	loginCommand,
	publishCommand,
	removeCommand,
	updateCommand,
	type CommandDeps,
} from "./commands.js";
import { Config } from "./config.js";
import { createHttpClient } from "./http.js";

interface ParsedArgs {
	_: string[];
	flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = { _: [], flags: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				out.flags[key] = true;
			} else {
				out.flags[key] = next;
				i++;
			}
		} else {
			out._.push(a);
		}
	}
	return out;
}

function flagStr(flags: Record<string, string | true>, name: string): string | undefined {
	const v = flags[name];
	return typeof v === "string" ? v : undefined;
}

const HELP = `tot — publish a page to tot.page

  tot <file>              publish a raw markdown or html file
  tot update <file|url>   push new content to the same living URL
  tot remove <file|url>   delete a page (anyone with the link can; so can you)
  tot list                list pages you've published from this machine
  tot login --key <KEY>   save a pre-minted wsk_live_ key to ~/.tot (optional)

flags
  --endpoint <url>   override the API origin (default https://api.tot.page)
  --key <KEY>        API key for this run (login persists it)
  --help             show this help`;

function makeDeps(cfg: Config): CommandDeps {
	return {
		http: createHttpClient(cfg),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		now: () => Date.now(),
		log: (msg) => console.log(msg),
	};
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const args = parseArgs(argv);
	const cfg = Config.load();

	if (flagStr(args.flags, "endpoint")) {
		cfg.endpoint = flagStr(args.flags, "endpoint")!;
	}
	if (flagStr(args.flags, "key")) {
		cfg.key = flagStr(args.flags, "key")!;
	}

	const cmd = args._[0];

	if (!cmd || cmd === "help" || args.flags.help === true) {
		console.log(HELP);
		return 0;
	}

	const deps = makeDeps(cfg);

	if (cmd === "login") {
		const key = flagStr(args.flags, "key") ?? cfg.key ?? undefined;
		if (!key) {
			console.error("provide a key:  tot login --key <KEY>");
			return 1;
		}
		await loginCommand(key, cfg, deps);
		return 0;
	}

	if (cmd === "list") {
		listCommand(cfg, deps);
		return 0;
	}

	if (cmd === "update") {
		const target = args._[1];
		if (!target) {
			console.error("usage: tot update <file|url>");
			return 1;
		}
		await updateCommand(target, cfg, deps);
		return 0;
	}

	if (cmd === "remove" || cmd === "rm" || cmd === "delete") {
		const target = args._[1];
		if (!target) {
			console.error("usage: tot remove <file|url>");
			return 1;
		}
		await removeCommand(target, cfg, deps);
		return 0;
	}

	// Default: the first positional is a file to publish.
	await publishCommand(cmd, cfg, deps);
	return 0;
}

function realPathForEntrypoint(value: string): string {
	const absolute = path.resolve(value);
	try {
		return fs.realpathSync(absolute);
	} catch {
		return absolute;
	}
}

export function isCliEntrypoint(
	metaUrl: string,
	argv1: string | undefined = process.argv[1],
): boolean {
	if (argv1 === undefined) return false;
	return realPathForEntrypoint(fileURLToPath(metaUrl)) === realPathForEntrypoint(argv1);
}

// Only run when invoked as the CLI, not when imported (e.g. by tests).
if (isCliEntrypoint(import.meta.url)) {
	main().then(
		(code) => process.exit(code),
		(err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("error:", msg);
			process.exit(1);
		},
	);
}
