// oc-budget — GUI half.
//
// The TUI puts the paying wallet in the footer and the four wallets in the sidebar. The desktop has a
// pill where the footer would be and one menu behind it, so: the paying wallet is the capsule, and the
// menu carries the Go block, the workspace, a rule, then the three pay-per-use wallets.
//
// No bars and no per-figure colours: a row is one line of text, and `tone` colours its icon only. The
// thresholds still decide the icon, so a wallet close to empty is yellow at a glance.
import { ComposerPill, Plugin } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup } from "solid-js"

import {
	DS_WARN_USD,
	GO_WARN_PERCENT,
	OR_WARN_USD,
	ZEN_WARN_USD,
	ageText,
	payingWallet,
	windowPercent,
} from "./budget.ts"
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot } from "./rpc.ts"
import { clock, doubles as peakDoubles, isPeak } from "./peak.ts"

/** The mark and the word together: the arrow says it at a glance, the word says what it means — on a
 *  row nothing else explains it, and the terminal's panel spells it out while the window did not. */
const PEAK_MARK = "↗"
const PEAK_TEXT = `peak ${PEAK_MARK}`

const REFRESH_MS = 5 * 60 * 1000
/** A failed poll is not a slow poll: ask again in half a minute, before the five-minute tick. */
const RETRY_MS = 30_000
/** Two missed polls: from here the numbers on screen are history, and the pill says so. */
const STALE_MS = 2 * REFRESH_MS
const RPC_TIMEOUT_MS = 15_000
const RULE = "─".repeat(18)

type Tone = "success" | "warning" | "danger"

/** A stalled call must not leave the pill frozen: the guard resets only when the promise settles. */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("rpc timeout")), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})

const usd = (value: number | undefined) =>
	typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—"

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value)}%`)

/** Red at the wall, yellow past the threshold, green elsewhere — the answer is the same for a percent
 *  and for a balance, only the wall differs. */
const tone = (value: number | null, warn: number, empty: number): Tone | undefined => {
	if (value === null) return undefined
	if (value <= empty) return "danger"
	return value <= warn ? "warning" : "success"
}

export default Plugin.define({
	setup(ctx) {
		const [snapshot, setSnapshot] = createSignal<{ server: string; value: BudgetSnapshot } | undefined>(
			undefined,
		)
		/** Why the last read failed, and nothing else: cleared by the next good one. */
		const [failure, setFailure] = createSignal<string | undefined>(undefined)
		let timer: ReturnType<typeof setInterval> | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let reading: string | undefined

		// One poll per server, on that server's own client: the credential lives where the plugin runs, and a
		// server that does not run it has nothing to answer.
		createEffect(() => {
			const session = ctx.sessions.current()
			const server = session?.server.id

			if (timer) clearInterval(timer)
			if (retry) clearTimeout(retry)
			timer = undefined
			retry = undefined
			// Another server's failure is not this session's: the effect re-runs when the routing moves.
			setFailure(undefined)
			if (!server) {
				setSnapshot(undefined)
				return
			}

			const refresh = () => {
				if (reading === server) return
				reading = server
				void withTimeout(session!.server.client.rpc(Budget).snapshot({}), RPC_TIMEOUT_MS)
					.then((value) => {
						// A slow answer from the server that was polled before must not overwrite this one.
						if (ctx.sessions.current()?.server.id !== server) return
						setSnapshot({ server, value: value as BudgetSnapshot })
						setFailure(undefined)
					})
					.catch((error: unknown) => {
						// Keep the last good reading: a failed poll says nothing about the balance, and
						// blanking the pill for five minutes cost a whole night (measured 2026-10-28, the
						// pill gone from 07:00 to 12:26, every poll a fast 500). Ask again sooner instead.
						if (ctx.sessions.current()?.server.id !== server) return
						setFailure(error instanceof Error ? error.message : String(error))
						if (retry) clearTimeout(retry)
						retry = setTimeout(refresh, RETRY_MS)
					})
					.finally(() => {
						if (reading === server) reading = undefined
					})
			}

			refresh()
			timer = setInterval(refresh, REFRESH_MS)
		})

		onCleanup(() => {
			if (timer) clearInterval(timer)
			if (retry) clearTimeout(retry)
		})

		ctx.add(ComposerPill, {
			id: "budget",
			order: 15,
			show: (input) => {
				const current = snapshot()

				if (!current || current.server !== input.session.server.id) {
					// Nothing read yet is not an error — a fresh window starts here. But a failure with no
					// reading behind it is one, and hiding it is what cost a whole night: three states,
					// never two. `docs/gui-plugins.md`, *a pill never shows a stale value as fresh*.
					const error = failure()
					if (!error) return undefined
					return {
						label: "budget",
						icon: "circle-exclamation" as const,
						tone: "danger" as const,
						title: error,
						rows: [{ id: "error", label: error, icon: "circle-exclamation" as const, tone: "danger" as const }],
					}
				}
				const value = current.value
				const go = value.go
				const rolling = windowPercent(go?.rolling)
				const weekly = windowPercent(go?.weekly)
				const monthly = windowPercent(go?.monthly)
				const zen = value.zen?.available ?? value.zen?.balance
				const model = input.screen.composer.model()
				const wallet = payingWallet(model, value)
				const now = clock()
				// The clock that decides staleness is the real one: `SIMULATE` moves the *peak* window,
				// and judging freshness by a faked instant would call every reading stale at once.
				const readAge = Date.now() - value.at
				const stale = readAge > STALE_MS
				// The pill is about *this* model: the mark appears only when what you are paying doubles.
				const marked = peakDoubles(model, wallet, now)
				// The menu is about choosing: both DeepSeek tariffs are marked at peak whether or not
				// they are the ones paying, so the warning is there before the choice.
				const atPeak = isPeak(now)

				const label =
					wallet === "go"
						? `GO · ${percent(monthly)}`
						: wallet === "zen"
							? `ZEN · ${usd(zen)}`
							: wallet === "ds"
								? `DS · ${usd(value.ds?.balance)}`
								: wallet === "or"
									? `OR · ${usd(value.or?.balance)}`
									: undefined

				// Nothing pays: a pill that says nothing is worse than no pill.
				if (!label) return undefined

				const goTone = [rolling, weekly, monthly].some((figure) => figure !== null && figure >= 100)
					? "danger"
					: [rolling, weekly, monthly].some((figure) => figure !== null && figure >= GO_WARN_PERCENT)
						? "warning"
						: "success"
				const pillTone =
					wallet === "go"
						? goTone
						: wallet === "zen"
							? tone(zen ?? null, ZEN_WARN_USD, 0)
							: wallet === "ds"
								? tone(value.ds?.balance ?? null, DS_WARN_USD, 0)
								: tone(value.or?.balance ?? null, OR_WARN_USD, 0)

				const text = marked ? `${label} ${PEAK_MARK}` : label
				return {
					label: stale ? `~${text}` : text,
					icon: "providers",
					tone: stale ? "warning" : pillTone,
					title: stale ? `Budget · last read ${ageText(readAge)} ago` : "Budget",
					rows: [
						{
							id: "go",
							label: `5h ${percent(rolling)} · wk ${percent(weekly)} · mo ${percent(monthly)}`,
							icon: "refresh",
							tone: goTone,
							detail: atPeak ? PEAK_TEXT : undefined,
						},
						...(value.zen?.org
							? [{ id: "workspace", label: `workspace · ${value.zen.org}`, icon: "workspace" as const }]
							: []),
						{ id: "rule", label: RULE },
						{
							id: "zen",
							label: `ZEN · ${usd(zen)}`,
							icon: "providers",
							tone: tone(zen ?? null, ZEN_WARN_USD, 0),
							detail: value.zen?.error,
						},
						{
							id: "ds",
							label: `DS · ${usd(value.ds?.balance)}`,
							icon: "providers",
							tone: tone(value.ds?.balance ?? null, DS_WARN_USD, 0),
							// An error outranks the mark: one says the figure is missing, the other that it costs more.
							detail: value.ds?.error ?? (atPeak ? PEAK_TEXT : undefined),
						},
						{
							id: "or",
							label: `OR · ${usd(value.or?.balance)}`,
							icon: "providers",
							tone: tone(value.or?.balance ?? null, OR_WARN_USD, 0),
							detail: value.or?.error,
						},
					],
				}
			},
		})
	},
})
