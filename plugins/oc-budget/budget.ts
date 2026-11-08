// The two facts both halves must agree on: which wallet pays, and where a figure stops being comfortable.
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"

export type Wallet = "go" | "zen" | "ds" | "or" | "none"

export interface ModelRef {
	providerID?: string
	modelID?: string
	variant?: string
}

// The alert thresholds, one set for both halves. Why each figure is that figure: the doc, The four wallets.
export const GO_WARN_PERCENT = 90
export const DS_WARN_USD = 2
export const OR_WARN_USD = 5
export const ZEN_WARN_USD = 5

/** The three money wallets in two forms: the sigla where a name *is* the row, the full name where there is a
 *  column to spare. */
export const WALLET_NAME: Record<Exclude<Wallet, "go" | "none">, { short: string; long: string }> = {
	ds: { short: "DS", long: "DeepSeek" },
	or: { short: "OR", long: "OpenRouter" },
	zen: { short: "OC", long: "OC credits" },
}

/** The model decides who pays. A Go model stays Go once a window is spent: the fallback to the credits is a
 *  Console toggle the snapshot cannot see — the doc, The four wallets. */
export function payingWallet(model: ModelRef | undefined): Wallet {
	const provider = model?.providerID ?? ""
	if (provider === "deepseek") return "ds"
	if (provider === "openrouter") return "or"
	if (provider === "opencode" || provider === "opencode-zen") return "zen"
	if (provider === "opencode-go") return "go"
	return "none"
}

/** Any wallet at all: absent is a state, an error is still a wallet — the doc, No provider connected. */
export function connected(snapshot: BudgetSnapshot | null | undefined): boolean {
	return !!(snapshot?.go || snapshot?.zen || snapshot?.ds || snapshot?.or)
}

/** How old a reading is, in the shortest form that still says something — both surfaces say it. */
export function ageText(ms: number): string {
	const minutes = Math.floor(ms / 60_000)
	if (minutes < 60) return `${minutes}m`
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function windowPercent(window: UsageWindow | undefined): number | null {
	if (typeof window?.percent !== "number") return null
	// A stopped window reads 100 whatever number came with it — the doc, The four wallets, on the endpoint
	// that rounds down and can name rate-limited below 100.
	return window.status === "rate-limited" ? 100 : window.percent
}

export const WINDOW_ORDER = ["rolling", "weekly", "monthly"] as const
export type GoWindowKey = (typeof WINDOW_ORDER)[number]

/** The sidebar's and the alarm hint's short labels; the report spells them out. */
export const WINDOW_LABEL: Record<GoWindowKey, string> = { rolling: "5h", weekly: "wk", monthly: "mo" }

/** Which window stops the subscription first: the highest, and on a tie the longest, which blocks for longer.
 *  The three are not comparable and the printed figure stays the month — the doc, The four wallets. */
export function bindingWindow(
	go: NonNullable<BudgetSnapshot["go"]> | undefined,
): { key: GoWindowKey; percent: number } | null {
	let best: { key: GoWindowKey; percent: number } | null = null
	for (const key of WINDOW_ORDER) {
		const percent = windowPercent(go?.[key])
		if (percent === null) continue
		// `>=`, and the order runs shortest to longest: on a tie the later key wins.
		if (!best || percent >= best.percent) best = { key, percent }
	}
	return best
}

/** How long until a quota window resets, in the shortest form that still says something. */
export function countdown(iso: string | undefined): string {
	if (!iso) return ""
	const target = Date.parse(iso)
	if (!Number.isFinite(target)) return ""
	const ms = target - Date.now()
	if (ms <= 0) return "now"
	const minutes = Math.floor(ms / 60_000)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 48) return `${hours}h ${minutes % 60}m`
	return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

