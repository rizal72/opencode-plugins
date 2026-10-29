// One home for the two facts both halves must agree on: which wallet pays, and where a figure stops
// being comfortable. How a line is drawn belongs to each surface — the TUI colours spans, the desktop
// gives a row a tone — but the rule behind the colour is this.
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"

export type Wallet = "go" | "zen" | "ds" | "or" | "none"

export interface ModelRef {
	providerID?: string
	modelID?: string
	variant?: string
}

// Thresholds, unchanged from pi-budget: the point at which the colour turns is a decision about
// consequence, not an estimate. Go alerts at 90% of the month; the Zen wallet at the console's own $5
// auto-recharge threshold; DeepSeek at $2 and OpenRouter at $5 (its credits are bought in blocks and
// expire, so the useful warning is "time to top up" and $2 would fire too late to act on).
export const GO_WARN_PERCENT = 90
export const DS_WARN_USD = 2
export const OR_WARN_USD = 5
export const ZEN_WARN_USD = 5

/** Which wallet pays, read from the model first: a Zen selection never uses the Go subscription however
 *  much of the quota is left, and a Go model falls back to the Zen balance once the month is exhausted. */
export function payingWallet(model: ModelRef | undefined, snapshot: BudgetSnapshot | null): Wallet {
	const provider = model?.providerID ?? ""
	if (provider === "deepseek") return "ds"
	if (provider === "openrouter") return "or"
	if (provider === "opencode" || provider === "opencode-zen") return "zen"
	if (provider === "opencode-go") return snapshot?.go?.monthly?.status === "rate-limited" ? "zen" : "go"
	return "none"
}

/** How old a reading is, in the shortest form that still says something — both surfaces say it. */
export function ageText(ms: number): string {
	const minutes = Math.floor(ms / 60_000)
	if (minutes < 60) return `${minutes}m`
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function windowPercent(window: UsageWindow | undefined): number | null {
	return typeof window?.percent === "number" ? window.percent : null
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

