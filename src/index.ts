import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	cmdUsageDays,
	cmdUsageHelp,
	cmdUsageModels,
	cmdUsageMonths,
	cmdUsageProjects,
	cmdUsageSessions,
	cmdUsageSummary,
	refreshUsageData,
} from "./commands";

/**
 * pi-token-usage — Lifetime token usage tracking and cost analytics
 *
 * Commands:
 *   /usage              — Summary: lifetime, this month, last 30d, last 7d, today + today's model breakdown
 *   /usage models       — Full breakdown by provider/model
 *   /usage sessions [N] — Top N sessions by cost (default: 20)
 *   /usage days [N]     — Daily rollup for last N days (default: 7)
 *   /usage months       — Monthly rollup
 *   /usage projects     — Breakdown by project
 *   /usage refresh      — Force rescan
 */
export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Token usage analytics — lifetime, by model, day, month, session, project",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/);
			const sub = parts[0]?.toLowerCase();

			let output: string;

			switch (sub) {
				case "help":
				case "?":
				case "--help":
					output = cmdUsageHelp();
					break;
				case "models":
					output = cmdUsageModels();
					break;
				case "days": {
					const n = parseInt(parts[1]) || 7;
					output = cmdUsageDays(n);
					break;
				}
				case "months":
					output = cmdUsageMonths();
					break;
				case "sessions": {
					const n = parseInt(parts[1]) || 20;
					output = cmdUsageSessions(n);
					break;
				}
				case "projects":
					output = cmdUsageProjects();
					break;
				case "refresh":
					output = refreshUsageData();
					ctx.ui.notify("Cache cleared and data rescanned.", "info");
					break;
				default:
					output = cmdUsageSummary();
					break;
			}

			ctx.ui.notify(output, "info");
		},
	});
}
