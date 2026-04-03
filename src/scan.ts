import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { decodeProjectDir, extractSessionId, getSessionsDir } from "./paths";
import { UsageRecord } from "./types";

let cachedRecords: UsageRecord[] | null = null;

export function refreshCachedRecords(): void {
	cachedRecords = null;
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

		let files: string[];
		try {
			files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}

		for (const file of files) {
			const sessionId = extractSessionId(file);
			const filePath = join(projPath, file);

			let content: string;
			try {
				content = readFileSync(filePath, "utf-8");
			} catch {
				continue;
			}

			const lines = content.split("\n");
			let project = decodeProjectDir(projDir);
			for (const line of lines) {
				if (!line.trim()) continue;

				if (line.includes('"type":"session"') && line.includes('"cwd"')) {
					try {
						const header = JSON.parse(line);
						if (typeof header.cwd === "string" && header.cwd.length > 0) {
							project = header.cwd;
						}
					} catch {
						// ignore invalid header lines
					}
					continue;
				}

				if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;

				let entry: any;
				try {
					entry = JSON.parse(line);
				} catch {
					continue;
				}

				if (entry.type !== "message") continue;
				const msg = entry.message;
				if (!msg || msg.role !== "assistant" || !msg.usage) continue;

				const usage = msg.usage;
				if (typeof usage.input !== "number" || typeof usage.output !== "number") continue;

				const totalTokens = usage.totalTokens ?? usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				const hash = `${entry.timestamp}:${totalTokens}`;
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
					costTotal: usage.cost?.total ?? 0,
				});
			}
		}
	}

	records.sort((a, b) => a.timestamp - b.timestamp);
	cachedRecords = records;
	return records;
}
