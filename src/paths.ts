import { readFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const CODEX_SUBAGENT_DIR_NAME = "pi-codex-subagents";

function getAgentDir(): string {
	const envDir = (process.env.PI_CODING_AGENT_DIR ?? "").trim();
	return envDir || join(homedir(), ".pi", "agent");
}

function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return value;
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

export function getCodexSubagentRunsDirs(): string[] {
	const packageDir = join(getAgentDir(), CODEX_SUBAGENT_DIR_NAME);
	const directories: string[] = [];

	try {
		const config = JSON.parse(readFileSync(join(packageDir, "config.json"), "utf-8"));
		if (typeof config?.storageDir === "string" && config.storageDir.trim()) {
			const expanded = expandHome(config.storageDir.trim());
			directories.push(isAbsolute(expanded) ? expanded : resolve(packageDir, expanded));
		}
	} catch {
		// Missing or malformed optional config falls back to the package default.
	}

	directories.push(join(tmpdir(), CODEX_SUBAGENT_DIR_NAME, userInfo().username, "runs"));
	return [...new Set(directories.map((directory) => resolve(directory)))];
}

export function decodeProjectDir(dirName: string): string {
	// Session dir names are lossy (/ becomes -), so this is only a fallback.
	return dirName;
}

export function projectShortName(project: string): string {
	const parts = project.split("/").filter(Boolean);
	if (parts.length <= 2) return project;
	return parts.slice(-2).join("/");
}

export function extractSessionId(filename: string): string {
	const base = basename(filename, ".jsonl");
	const idx = base.indexOf("_");
	return idx !== -1 ? base.slice(idx + 1) : base;
}
