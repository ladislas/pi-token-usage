import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { decodeProjectDir, extractSessionId, getSessionsDir } from "./paths";
import { UsageRecord } from "./types";

let cachedRecords: UsageRecord[] | null = null;

export function refreshCachedRecords(): void {
	cachedRecords = null;
}

function findJsonlFiles(dir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...findJsonlFiles(entryPath));
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
	}
	return files;
}

function getCanonicalSubagentRunId(filePath: string): string | undefined {
	if (basename(filePath) !== "session.jsonl") return undefined;
	const runId = basename(dirname(dirname(filePath)));
	return runId || undefined;
}

function getArtifactSubagentRunId(filePath: string, lines: string[]): string | undefined {
	if (basename(dirname(filePath)) !== "subagent-artifacts" || !basename(filePath).endsWith("_transcript.jsonl")) return undefined;
	for (const line of lines) {
		if (!line.includes('"runId"')) continue;
		try {
			const entry = JSON.parse(line);
			if (typeof entry.runId === "string" && entry.runId.length > 0) return entry.runId;
		} catch {
			// ignore malformed transcript lines
		}
	}
	return undefined;
}

export function scanAllSessions(): UsageRecord[] {
	if (cachedRecords) return cachedRecords;

	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) {
		cachedRecords = [];
		return cachedRecords;
	}

	const records: UsageRecord[] = [];
	const seen = new Set<string>();

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(sessionsDir);
	} catch {
		cachedRecords = [];
		return cachedRecords;
	}

	for (const projDir of projectDirs) {
		const projPath = join(sessionsDir, projDir);
		let stat;
		try {
			stat = statSync(projPath);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) continue;

		const files = findJsonlFiles(projPath);
		const canonicalSubagentRunIds = new Set(files.map(getCanonicalSubagentRunId).filter((id): id is string => id !== undefined));

		for (const filePath of files) {
			let sessionId = extractSessionId(filePath);

			let content: string;
			try {
				content = readFileSync(filePath, "utf-8");
			} catch {
				continue;
			}

			const lines = content.split("\n");
			const artifactRunId = getArtifactSubagentRunId(filePath, lines);
			if (artifactRunId && canonicalSubagentRunIds.has(artifactRunId)) continue;
			let project = decodeProjectDir(projDir);
			for (const line of lines) {
				if (!line.trim()) continue;

				if (!line.includes('"session"') && (!line.includes('"assistant"') || !line.includes('"usage"'))) continue;

				let entry: any;
				try {
					entry = JSON.parse(line);
				} catch {
					continue;
				}

				if (entry.type === "session") {
					if (typeof entry.cwd === "string" && entry.cwd.length > 0) project = entry.cwd;
					if (typeof entry.id === "string" && entry.id.length > 0) sessionId = entry.id;
					continue;
				}

				let msg: any;
				let usage: any;
				if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.usage) {
					msg = entry.message;
					usage = msg.usage;
				} else if (entry.recordType === "message" && entry.role === "assistant" && entry.usage) {
					msg = entry;
					usage = entry.usage;
					if (typeof entry.runId === "string" && entry.runId.length > 0) sessionId = entry.runId;
					if (typeof entry.cwd === "string" && entry.cwd.length > 0) project = entry.cwd;
				} else {
					continue;
				}

				if (typeof usage.input !== "number" || typeof usage.output !== "number") continue;

				const totalTokens = usage.totalTokens ?? usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				const hash = typeof entry.id === "string" && entry.id.length > 0
					? `message:${entry.id}`
					: `fallback:${sessionId}:${entry.timestamp}:${totalTokens}`;
				if (seen.has(hash)) continue;
				seen.add(hash);

				records.push({
					timestamp: msg.timestamp ?? new Date(entry.timestamp).getTime(),
					isoTimestamp: entry.timestamp,
					provider: msg.provider ?? "unknown",
					model: msg.model ?? "unknown",
					project,
					sessionId,
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead ?? 0,
					cacheWrite: usage.cacheWrite ?? 0,
					totalTokens,
					costTotal: typeof usage.cost === "number" ? usage.cost : (usage.cost?.total ?? 0),
				});
			}
		}
	}

	records.sort((a, b) => a.timestamp - b.timestamp);
	cachedRecords = records;
	return records;
}
