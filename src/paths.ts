import { basename, join } from "node:path";
import { homedir } from "node:os";

export function getSessionsDir(): string {
	const envDir = (process.env.PI_CODING_AGENT_DIR ?? "").trim();
	if (envDir) return join(envDir, "sessions");
	return join(homedir(), ".pi", "agent", "sessions");
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
