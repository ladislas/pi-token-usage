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
import {
	buildFooterStatus,
	formatFooterConfig,
	loadFooterConfig,
	parseFooterItems,
	resetProjectFooterConfig,
	saveProjectFooterConfig,
} from "./footer";
import { refreshCachedRecords, scanAllSessions } from "./scan";

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
 *   /usage footer       — Show or customize footer status
 *   /usage refresh      — Force rescan
 */
export default function (pi: ExtensionAPI) {
	const updateFooterStatus = (ctx: any) => {
		refreshCachedRecords();
		const config = loadFooterConfig(ctx.cwd);
		const status = buildFooterStatus(scanAllSessions(), ctx.cwd, config);
		ctx.ui.setStatus("token-usage", status);
	};

	pi.on("session_start", async (_event, ctx) => {
		updateFooterStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateFooterStatus(ctx);
	});

	pi.registerCommand("usage", {
		description: "Token usage analytics — lifetime, by model, day, month, session, project",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const parts = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
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
				case "footer": {
					const action = parts[1]?.toLowerCase();
					try {
						switch (action) {
							case undefined:
							case "show":
								output = formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd);
								break;
							case "on":
							case "enable":
								saveProjectFooterConfig(ctx.cwd, { enabled: true });
								output = `Footer enabled.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							case "off":
							case "disable":
								saveProjectFooterConfig(ctx.cwd, { enabled: false });
								output = `Footer disabled.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							case "items": {
								const rawItems = trimmed.split(/\s+/).slice(2).join(" ");
								const items = parseFooterItems(rawItems);
								saveProjectFooterConfig(ctx.cwd, { items });
								output = `Footer items updated.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							}
							case "reset":
								resetProjectFooterConfig(ctx.cwd);
								output = `Project footer config removed.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							default:
								output = [
									"Usage:",
									"  /usage footer",
									"  /usage footer on",
									"  /usage footer off",
									"  /usage footer items projectTodayCost,totalTodayCost",
									"  /usage footer reset",
								].join("\n");
								break;
						}
					} catch (error) {
						output = error instanceof Error ? error.message : String(error);
					}
					updateFooterStatus(ctx);
					break;
				}
				case "refresh":
					output = refreshUsageData();
					ctx.ui.notify("Cache cleared and data rescanned.", "info");
					updateFooterStatus(ctx);
					break;
				default:
					output = cmdUsageSummary();
					break;
			}

			ctx.ui.notify(output, "info");
		},
	});
}
