/**
 * JJ-Native Status Bar Extension for pi
 *
 * Upgrades the footer repo indicator to be jj-native when `jj` is present,
 * falling back to git branch display when only git is available.
 *
 * Install: copy to ~/.pi/agent/extensions/jj-status.ts (auto-discovered)
 * Test:    pi -e ~/.pi/agent/extensions/jj-status.ts
 * Toggle:  /jj-status
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.registerCommand("jj-status", {
		description: "Toggle jj-native status bar",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`JJ-native footer ${enabled ? "enabled" : "disabled"}`, "info");
			if (!enabled) {
				ctx.ui.setFooter(undefined);
			} else {
				ctx.ui.notify("Run /reload to re-apply", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!enabled) return;

		// Check if jj CLI is installed
		const jjVersion = await pi
			.exec("jj", ["--version"], { cwd: ctx.cwd, timeout: 3000 })
			.catch(() => undefined);
		const hasJjCli = jjVersion && jjVersion.code === 0;

		ctx.ui.setFooter((tui, theme, footerData) => {
			let isJjRepo = false;
			let jjLine = "";
			let parentBookmarks = "";
			let gitBranch: string | null = null;

			const refresh = async () => {
				gitBranch = footerData.getGitBranch();

				if (!hasJjCli) {
					isJjRepo = false;
					jjLine = "";
					parentBookmarks = "";
					tui.requestRender();
					return;
				}

				const root = await pi
					.exec("jj", ["root"], { cwd: ctx.cwd, timeout: 3000 })
					.catch(() => undefined);

				if (!root || root.code !== 0) {
					isJjRepo = false;
					jjLine = "";
					parentBookmarks = "";
					tui.requestRender();
					return;
				}

				isJjRepo = true;

				// Compact jj status for @ (working copy):
				//   bookmarks | change_id.shortest(8) | desc / conflict / empty
				const logResult = await pi
					.exec(
						"jj",
						[
							"log",
							"--revisions",
							"@",
							"--no-graph",
							"--template",
							'separate(" | ", bookmarks, change_id.shortest(8), if(conflict, "conflict", if(description, description.first_line(), "empty")))',
						],
						{ cwd: ctx.cwd, timeout: 3000 },
					)
					.catch(() => undefined);

				if (logResult && logResult.code === 0) {
					jjLine = logResult.stdout.trim();
				} else {
					jjLine = "";
				}

				// Parent bookmarks so we know what bookmark we're near / on top of
				const parentResult = await pi
					.exec(
						"jj",
						[
							"log",
							"--revisions",
							"@-",
							"--no-graph",
							"--template",
							"bookmarks",
						],
						{ cwd: ctx.cwd, timeout: 3000 },
					)
					.catch(() => undefined);

				if (parentResult && parentResult.code === 0) {
					parentBookmarks = parentResult.stdout.trim();
				} else {
					parentBookmarks = "";
				}

				tui.requestRender();
			};

			refresh();
			const pollTimer = setInterval(refresh, 3000);

			const unsubBranch = footerData.onBranchChange(() => {
				refresh();
				tui.requestRender();
			});

			return {
				dispose() {
					clearInterval(pollTimer);
					unsubBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					// ── PWD line ─────────────────────────────────────────────
					let pwd = ctx.sessionManager.getCwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}

					if (isJjRepo && jjLine) {
						const suffix = parentBookmarks ? ` on ${parentBookmarks}` : "";
						pwd = `${pwd} [jj: ${jjLine}${suffix}]`;
					} else if (gitBranch) {
						pwd = `${pwd} (${gitBranch})`;
					}

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) {
						pwd = `${pwd} • ${sessionName}`;
					}

					// ── Stats line ───────────────────────────────────────────
					let totalInput = 0,
						totalOutput = 0,
						totalCacheRead = 0,
						totalCacheWrite = 0,
						totalCost = 0;

					for (const e of ctx.sessionManager.getEntries()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							totalInput += m.usage.input;
							totalOutput += m.usage.output;
							totalCacheRead += m.usage.cacheRead;
							totalCacheWrite += m.usage.cacheWrite;
							totalCost += m.usage.cost.total;
						}
					}

					const statsParts: string[] = [];
					if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
					if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
					if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
					if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

					const usingSubscription =
						ctx.model && ctx.modelRegistry.isUsingOAuth(ctx.model);
					if (totalCost || usingSubscription) {
						statsParts.push(
							`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
						);
					}

					const contextUsage = ctx.getContextUsage();
					const contextWindow =
						contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent =
						contextUsage?.percent !== null
							? contextPercentValue.toFixed(1)
							: "?";

					let contextPercentStr: string;
					const contextPercentDisplay =
						contextPercent === "?"
							? `?/${formatTokens(contextWindow)}`
							: `${contextPercent}%/${formatTokens(contextWindow)}`;

					if (contextPercentValue > 90) {
						contextPercentStr = theme.fg("error", contextPercentDisplay);
					} else if (contextPercentValue > 70) {
						contextPercentStr = theme.fg("warning", contextPercentDisplay);
					} else {
						contextPercentStr = contextPercentDisplay;
					}
					statsParts.push(contextPercentStr);

					let statsLeft = statsParts.join(" ");
					const statsLeftWidth = visibleWidth(statsLeft);

					// Model / provider on the right
					const modelName = ctx.model?.id || "no-model";
					let rightSideWithoutProvider = modelName;

					if (ctx.model?.reasoning) {
						rightSideWithoutProvider = `${modelName} • reasoning`;
					}

					let rightSide = rightSideWithoutProvider;
					if (
						footerData.getAvailableProviderCount() > 1 &&
						ctx.model
					) {
						rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
						if (statsLeftWidth + 2 + visibleWidth(rightSide) > width) {
							rightSide = rightSideWithoutProvider;
						}
					}

					const rightSideWidth = visibleWidth(rightSide);
					const totalNeeded = statsLeftWidth + 2 + rightSideWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(
							width - statsLeftWidth - rightSideWidth,
						);
						statsLine = statsLeft + padding + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - 2;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(
								rightSide,
								availableForRight,
								"",
							);
							const truncatedRightWidth = visibleWidth(truncatedRight);
							const padding = " ".repeat(
								Math.max(0, width - statsLeftWidth - truncatedRightWidth),
							);
							statsLine = statsLeft + padding + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}

					// Dim separately so inner color codes (context %) aren't wiped
					const dimStatsLeft = theme.fg("dim", statsLeft);
					const remainder = statsLine.slice(statsLeft.length);
					const dimRemainder = theme.fg("dim", remainder);

					const pwdLine = truncateToWidth(
						theme.fg("dim", pwd),
						width,
						theme.fg("dim", "..."),
					);
					const lines = [pwdLine, dimStatsLeft + dimRemainder];

					// Extension statuses
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sortedStatuses = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeStatusText(text));
						const statusLine = sortedStatuses.join(" ");
						lines.push(
							truncateToWidth(statusLine, width, theme.fg("dim", "...")),
						);
					}

					return lines;
				},
			};
		});
	});
}
