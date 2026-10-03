/** JJ status alongside Pi's native footer, without snapshotting the working copy. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const POLL_INTERVAL_MS = 30_000;
const ERROR_BACKOFF_MS = 120_000;

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let timer: ReturnType<typeof setInterval> | undefined;
	let generation = 0;
	let context: ExtensionContext | undefined;
	let refreshCurrent: (() => Promise<void>) | undefined;

	function stop() {
		generation++;
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		refreshCurrent = undefined;
	}
	async function start(ctx: ExtensionContext) {
		stop();
		context = ctx;
		if (!enabled || ctx.mode !== "tui") return;
		const ownGeneration = generation;
		let inFlight = false;
		let backoffUntil = 0;
		const refresh = async () => {
			if (inFlight || ownGeneration !== generation || Date.now() < backoffUntil) return;
			inFlight = true;
			try {
				const result = await pi.exec("jj", ["--ignore-working-copy", "log", "--revisions", "@", "--no-graph", "--template",
					'separate(" | ", bookmarks, change_id.shortest(8), if(conflict, "conflict", if(description, description.first_line(), "empty")))'],
					{ cwd: ctx.cwd, timeout: 1000 });
				if (ownGeneration !== generation) return;
				if (result.code !== 0) {
					backoffUntil = Date.now() + ERROR_BACKOFF_MS;
					ctx.ui.setStatus("jj-status", undefined);
					return;
				}
				const text = result.stdout.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
				ctx.ui.setStatus("jj-status", `jj: ${text}`);
			} catch {
				if (ownGeneration === generation) {
					backoffUntil = Date.now() + ERROR_BACKOFF_MS;
					ctx.ui.setStatus("jj-status", undefined);
				}
			} finally { inFlight = false; }
		};
		refreshCurrent = refresh;
		await refresh();
		if (ownGeneration !== generation) return;
		timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
		timer.unref();
	}

	pi.on("session_start", (_event, ctx) => start(ctx));
	pi.on("session_tree", (_event, ctx) => start(ctx));
	pi.on("agent_settled", () => refreshCurrent?.());
	pi.on("session_shutdown", () => { stop(); context?.ui.setStatus("jj-status", undefined); context = undefined; });
	pi.registerCommand("jj-status", {
		description: "Toggle jj-native status",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			stop();
			ctx.ui.setStatus("jj-status", undefined);
			if (enabled) await start(ctx);
			ctx.ui.notify(`JJ status ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
