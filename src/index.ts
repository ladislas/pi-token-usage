import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
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
import { cmdUsageHeatmap } from "./heatmap";
import {
	applyFooterTheme,
	buildFooterStatus,
	FOOTER_ITEM_IDS,
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
 *   /usage heatmap [N]  — GitHub-style heatmap of daily cost (default: 365)
 *   /usage footer       — Show or customize footer status
 *   /usage refresh      — Force rescan
 */
export default function (pi: ExtensionAPI) {
	const updateFooterStatus = (ctx: any) => {
		refreshCachedRecords();
		const config = loadFooterConfig(ctx.cwd);
		const status = buildFooterStatus(scanAllSessions(), ctx.cwd, config);
		ctx.ui.setStatus("token-usage", status ? applyFooterTheme(status, config.style, ctx.ui.theme) : undefined);
	};

	pi.on("session_start", async (_event, ctx) => {
		updateFooterStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateFooterStatus(ctx);
	});

	pi.registerCommand("usage", {
		description: "Token usage analytics — lifetime, by model, day, month, session, project, heatmap",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const trimmed = prefix.trim();
			const parts = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
			const hasTrailingSpace = trimmed.length > 0 && prefix.endsWith(" ");

			// Top-level subcommands
			const topLevel: AutocompleteItem[] = [
				{ value: "heatmap", label: "heatmap", description: "GitHub-style contribution heatmap of daily tokens" },
				{ value: "models", label: "models", description: "Breakdown by provider/model" },
				{ value: "days", label: "days", description: "Daily rollup for last N days (default: 7)" },
				{ value: "months", label: "months", description: "Monthly rollup" },
				{ value: "sessions", label: "sessions", description: "Top N sessions by cost (default: 20)" },
				{ value: "projects", label: "projects", description: "Breakdown by project" },
				{ value: "footer", label: "footer", description: "Show or customize footer status" },
				{ value: "refresh", label: "refresh", description: "Clear cache and rescan session files" },
				{ value: "help", label: "help", description: "Show command help" },
			];

			// Still typing the first word
			if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
				const current = parts[0] ?? "";
				const filtered = topLevel.filter((i) => i.value.startsWith(current));
				return filtered.length > 0 ? filtered : null;
			}

			const first = parts[0];

			// /usage heatmap <N>
			if (first === "heatmap") {
				if (!hasTrailingSpace && parts.length === 1) return null;
				const current = parts[1] ?? "";
				const nums = ["30", "90", "180", "365"];
				const filtered = nums
					.filter((n) => n.startsWith(current))
					.map((n) => ({ value: n, label: n }));
				return filtered.length > 0 ? filtered : null;
			}

			// Footer subcommands
			if (first === "footer") {
				const footerSubs: AutocompleteItem[] = [
					{ value: "show", label: "show", description: "Show footer config" },
					{ value: "on", label: "on", description: "Enable footer" },
					{ value: "enable", label: "enable", description: "Enable footer" },
					{ value: "off", label: "off", description: "Disable footer" },
					{ value: "disable", label: "disable", description: "Disable footer" },
					{ value: "items", label: "items", description: "Set footer items (comma/space separated)" },
					{ value: "preset", label: "preset", description: "Apply a footer preset" },
					{ value: "separator", label: "separator", description: "Set footer separator text" },
					{ value: "style", label: "style", description: "Set footer styling: plain, muted, cost" },
					{ value: "template", label: "template", description: "Override footer with a custom template" },
					{ value: "untemplate", label: "untemplate", description: "Remove footer template override" },
					{ value: "vars", label: "vars", description: "Show available template variables" },
					{ value: "reset", label: "reset", description: "Remove project footer config" },
				];

				if (parts.length === 2 && !hasTrailingSpace) {
					const current = parts[1] ?? "";
					const filtered = footerSubs.filter((i) => i.value.startsWith(current));
					return filtered.length > 0 ? filtered : null;
				}

				if (parts.length >= 2) {
					const second = parts[1];

					if (second === "preset") {
						const current = parts[2] ?? "";
						const presets = Object.keys(FOOTER_PRESETS);
						const filtered = presets
							.filter((p) => p.startsWith(current))
							.map((p) => ({ value: p, label: p }));
						return filtered.length > 0 ? filtered : null;
					}

					if (second === "style") {
						const current = parts[2] ?? "";
						const styles = ["plain", "muted", "cost"];
						const filtered = styles
							.filter((s) => s.startsWith(current))
							.map((s) => ({ value: s, label: s }));
						return filtered.length > 0 ? filtered : null;
					}

					if (second === "items") {
						const current = parts[2] ?? "";
						const filtered = [...FOOTER_ITEM_IDS]
							.filter((i) => i.startsWith(current))
							.map((i) => ({ value: i, label: i }));
						return filtered.length > 0 ? filtered : null;
					}
				}

				return null;
			}

			// /usage days <N>
			if (first === "days") {
				const current = parts[1] ?? "";
				const nums = ["7", "14", "30"];
				const filtered = nums
					.filter((n) => n.startsWith(current))
					.map((n) => ({ value: n, label: n }));
				return filtered.length > 0 ? filtered : null;
			}

			// /usage sessions <N>
			if (first === "sessions") {
				const current = parts[1] ?? "";
				const nums = ["10", "20", "50"];
				const filtered = nums
					.filter((n) => n.startsWith(current))
					.map((n) => ({ value: n, label: n }));
				return filtered.length > 0 ? filtered : null;
			}

			return null;
		},
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
				case "heatmap": {
					const n = parseInt(parts[1]) || 365;
					output = cmdUsageHeatmap(n);
					break;
				}
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
