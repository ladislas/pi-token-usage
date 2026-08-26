import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	applyFooterTheme,
	buildFooterStatus,
	FOOTER_PRESETS,
	formatFooterConfig,
	formatFooterTemplateVars,
	loadFooterConfig,
	parseFooterItems,
	parseFooterPreset,
	parseFooterStyle,
	resetProjectFooterConfig,
	saveProjectFooterConfig,
	writeProjectFooterConfig,
} from "./footer";
import { refreshCachedRecords, scanAllSessions } from "./scan";

const FOOTER_UPDATE_ACTIONS = new Set([
	"on",
	"enable",
	"off",
	"disable",
	"items",
	"preset",
	"separator",
	"style",
	"template",
	"untemplate",
	"reset",
]);

const NON_SCANNING_USAGE_COMMANDS = new Set(["help", "?", "--help"]);

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
	const updateFooterStatus = (ctx: any, refresh = true) => {
		const config = loadFooterConfig(ctx.cwd);
		if (!config.enabled) {
			ctx.ui.setStatus("token-usage", undefined);
			return;
		}
		if (refresh) refreshCachedRecords();
		const status = buildFooterStatus(scanAllSessions(), ctx.cwd, config);
		ctx.ui.setStatus("token-usage", status ? applyFooterTheme(status, config.style, ctx.ui.theme) : undefined);
	};

	pi.on("session_start", async (_event, ctx) => {
		updateFooterStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		refreshCachedRecords();
		updateFooterStatus(ctx, false);
	});

	pi.registerCommand("usage", {
		description: "Token usage analytics — lifetime, by model, day, month, session, project",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const parts = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
			const sub = parts[0]?.toLowerCase();

			const footerAction = sub === "footer" ? parts[1]?.toLowerCase() : undefined;
			const footerUpdatesStatus = FOOTER_UPDATE_ACTIONS.has(footerAction ?? "");
			const footerCurrentlyEnabled = sub === "footer" && loadFooterConfig(ctx.cwd).enabled;
			const scansUsageHistory =
				!NON_SCANNING_USAGE_COMMANDS.has(sub ?? "") &&
				(sub !== "footer" ||
					["on", "enable", "reset"].includes(footerAction ?? "") ||
					(footerUpdatesStatus && footerCurrentlyEnabled && !["off", "disable"].includes(footerAction ?? "")));
			let scanStatusActive = scansUsageHistory;
			if (scanStatusActive) {
				ctx.ui.setWidget("token-usage-scan", ["Scanning usage history…"]);
				await new Promise<void>((resolve) => setTimeout(resolve, 50));
			}
			const finishUsageScan = () => {
				if (!scanStatusActive) return;
				scanStatusActive = false;
				ctx.ui.setWidget("token-usage-scan", undefined);
			};
			const runUsageScan = <T>(operation: () => T): T => {
				try {
					return operation();
				} finally {
					finishUsageScan();
				}
			};

			let output: string;

			switch (sub) {
				case "help":
				case "?":
				case "--help":
					output = cmdUsageHelp();
					break;
				case "models":
					output = runUsageScan(cmdUsageModels);
					break;
				case "days": {
					const n = parseInt(parts[1]) || 7;
					output = runUsageScan(() => cmdUsageDays(n));
					break;
				}
				case "months":
					output = runUsageScan(cmdUsageMonths);
					break;
				case "sessions": {
					const n = parseInt(parts[1]) || 20;
					output = runUsageScan(() => cmdUsageSessions(n));
					break;
				}
				case "projects":
					output = runUsageScan(cmdUsageProjects);
					break;
				case "footer": {
					const action = parts[1]?.toLowerCase();
					try {
						switch (action) {
							case undefined:
							case "show":
								output = formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd);
								break;
							case "vars":
								output = formatFooterTemplateVars();
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
							case "preset": {
								const preset = parseFooterPreset(parts[2] ?? "");
								saveProjectFooterConfig(ctx.cwd, { items: FOOTER_PRESETS[preset] });
								output = `Footer preset '${preset}' applied.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							}
							case "separator": {
								const separator = trimmed.split(/\s+/).slice(2).join(" ");
								if (separator.length === 0) throw new Error("No separator provided.");
								saveProjectFooterConfig(ctx.cwd, { separator });
								output = `Footer separator updated.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							}
							case "style": {
								const style = parseFooterStyle(parts[2] ?? "");
								saveProjectFooterConfig(ctx.cwd, { style });
								output = `Footer style updated.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							}
							case "template": {
								const template = trimmed.split(/\s+/).slice(2).join(" ");
								if (template.length === 0) throw new Error("No template provided.");
								saveProjectFooterConfig(ctx.cwd, { template });
								output = `Footer template updated.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
								break;
							}
							case "untemplate": {
								const config = loadFooterConfig(ctx.cwd);
								writeProjectFooterConfig(ctx.cwd, { ...config, template: undefined });
								output = `Footer template removed.\n${formatFooterConfig(loadFooterConfig(ctx.cwd), ctx.cwd)}`;
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
									"  /usage footer vars",
									"  /usage footer on",
									"  /usage footer off",
									"  /usage footer items projectTodayCost,totalTodayCost",
									"  /usage footer preset minimal|costs|tokens|summary|full",
									"  /usage footer separator |",
									"  /usage footer style plain|muted|cost",
									"  /usage footer template [project: {projectToday.cost} · {projectToday.tokens} tok]   [total: {totalToday.cost} · {totalToday.tokens} tok]",
									"  /usage footer untemplate",
									"  /usage footer reset",
								].join("\n");
								break;
						}
					} catch (error) {
						output = error instanceof Error ? error.message : String(error);
					}
					if (footerUpdatesStatus) runUsageScan(() => updateFooterStatus(ctx));
					break;
				}
				case "refresh":
					output = runUsageScan(refreshUsageData);
					ctx.ui.notify("Cache cleared and data rescanned.", "info");
					updateFooterStatus(ctx, false);
					break;
				default:
					output = runUsageScan(cmdUsageSummary);
					break;
			}

			ctx.ui.notify(output, "info");
			finishUsageScan();
		},
	});
}
