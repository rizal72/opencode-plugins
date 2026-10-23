// oc-budget — server half.
//
// Owns the one thing the TUI cannot do: resolving a provider's credential out of
// OpenCode's own integration store (`ctx.integration.connection.resolve`), never
// from a file of ours. With a key (or the Console account token) in hand it reads
// the four wallets and caches the result, so the TUI's slots and its `/budget`
// command are pure rendering.
//
//   opencode-go  -> GET opencode.ai/zen/go/v1/usage        (5h / weekly / monthly windows)
//   deepseek     -> GET api.deepseek.com/user/balance      (native wallet)
//   openrouter   -> GET openrouter.ai/api/v1/credits (+ /key for the month and regions)
//   opencode     -> GET console/api/orgs -> /console/api/billing/status  (Zen balance)
//
// The Zen balance is the reason the Console integration exists: no API key opens
// the console (it answers 401 to an `oc_sk_` key), only the account session does.
// That is exactly what `opencode auth login opencode` stores, so there is no token
// file here and no device flow to reimplement.
//
// Nothing rejects outward: a missing connection or a dead endpoint becomes an
// `error` string on that wallet's branch, and the others still report.
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot } from "./rpc.ts"

/** How long a collected snapshot is reused; the TUI also polls on this cadence. */
const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 10_000
const USER_AGENT = "oc-budget/0.1"

const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const DS_BALANCE_URL = "https://api.deepseek.com/user/balance"
const OR_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
const OR_KEY_URL = "https://openrouter.ai/api/v1/key"
const ZEN_CURRENT_URL = "https://opencode.ai/console/api/orgs/current"
const ZEN_STATUS_URL = "https://opencode.ai/console/api/billing/status"

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

interface ResolvedKey {
	key?: string
	error?: string
}

/** The API key of an integration, out of OpenCode's own credential store. */
async function resolveKey(ctx: any, integrationID: string): Promise<ResolvedKey> {
	try {
		const connection = await ctx.integration.connection.active(integrationID)
		if (!connection) return { error: `${integrationID} is not connected (see: opencode auth list)` }
		const value = await ctx.integration.connection.resolve(connection)
		if (!value) return { error: `${integrationID} credential could not be resolved` }
		if (value.type === "key") return { key: value.key }
		return { error: `${integrationID} uses an unexpected credential type (${value.type})` }
	} catch (error) {
		return { error: message(error) }
	}
}

/** The Console account token, which is what opens the Zen balance. */
async function resolveConsoleToken(ctx: any): Promise<ResolvedKey> {
	try {
		const connection = await ctx.integration.connection.active("opencode")
		if (!connection) {
			return { error: "OpenCode Console not connected (run: opencode auth login opencode)" }
		}
		const value = await ctx.integration.connection.resolve(connection)
		if (!value) return { error: "OpenCode Console credential could not be resolved" }
		if (value.type === "oauth") return { key: value.access }
		if (value.type === "key") return { key: value.key }
		return { error: `OpenCode Console uses an unexpected credential type (${value.type})` }
	} catch (error) {
		return { error: message(error) }
	}
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
	const response = await fetch(url, {
		headers: { ...headers, "User-Agent": USER_AGENT },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	return (await response.json()) as any
}

/** Micro-cents (1e-8 USD) to a dollar amount, rounded on the integer: the console's
 *  own scale, fixed by its invoices. `(micro / 1e8).toFixed(2)` is a cent low on
 *  values like 100500000, so cents are rounded before the division. */
function microCentsToDollars(micro: number): number {
	return Math.round(micro / 1e6) / 100
}

async function collectGo(ctx: any): Promise<BudgetSnapshot["go"]> {
	const credential = await resolveKey(ctx, "opencode-go")
	if (credential.error) return { error: credential.error }
	try {
		const body = await getJson(GO_USAGE_URL, { Authorization: `Bearer ${credential.key}` })
		const usage = body?.usage
		if (!usage) return { error: "unexpected usage response shape" }
		return { rolling: usage.rolling, weekly: usage.weekly, monthly: usage.monthly }
	} catch (error) {
		return { error: message(error) }
	}
}

async function collectDeepSeek(ctx: any): Promise<BudgetSnapshot["ds"]> {
	const credential = await resolveKey(ctx, "deepseek")
	if (credential.error) return { error: credential.error }
	try {
		const body = await getJson(DS_BALANCE_URL, { Authorization: `Bearer ${credential.key}` })
		const info = body?.balance_infos?.[0]
		const balance = info?.total_balance === undefined ? Number.NaN : Number(info.total_balance)
		if (!Number.isFinite(balance)) return { error: "unexpected balance response shape" }
		return { balance, currency: info?.currency ?? "USD" }
	} catch (error) {
		return { error: message(error) }
	}
}

async function collectOpenRouter(ctx: any): Promise<BudgetSnapshot["or"]> {
	const credential = await resolveKey(ctx, "openrouter")
	if (credential.error) return { error: credential.error }
	const headers = { Authorization: `Bearer ${credential.key}` }
	try {
		const body = await getJson(OR_CREDITS_URL, headers)
		const totalCredits = body?.data?.total_credits
		const totalUsage = body?.data?.total_usage
		if (typeof totalCredits !== "number" || typeof totalUsage !== "number") {
			return { error: "unexpected credits response shape" }
		}
		const result: NonNullable<BudgetSnapshot["or"]> = {
			totalCredits,
			totalUsage,
			balance: totalCredits - totalUsage,
		}
		// Best effort: /key enriches the report (month spend, region guardrail) and
		// must never blank a balance already read.
		try {
			const keyBody = await getJson(OR_KEY_URL, headers)
			const monthly = keyBody?.data?.usage_monthly
			if (typeof monthly === "number") result.usageMonthly = monthly
			const regions = keyBody?.data?.allowed_data_regions
			if (Array.isArray(regions)) result.regions = regions
		} catch {
			// keep the balance
		}
		return result
	} catch (error) {
		return { error: message(error) }
	}
}

async function collectZen(ctx: any): Promise<BudgetSnapshot["zen"]> {
	const token = await resolveConsoleToken(ctx)
	if (token.error) return { error: token.error }
	const headers = { Authorization: `Bearer ${token.key}` }
	try {
		// The Console session is bound to exactly one workspace — the one selected when the
		// account was connected — and billing answers 403 for every other one (verified: a
		// `go` login reads `go` and is refused `go-2` and `Personal`). So the workspace is
		// read from the session, never guessed from a name: switching the Console account is
		// the only way to switch which wallet the balance describes.
		const current = await getJson(ZEN_CURRENT_URL, headers)
		const org = current?.org
		if (!org?.id) return { error: "Console session reports no current workspace" }
		const body = await getJson(ZEN_STATUS_URL, { ...headers, "x-org-id": org.id })
		const micro =
			typeof body?.balanceMicroCents === "string" ? Number(body.balanceMicroCents) : body?.balanceMicroCents
		if (typeof micro !== "number" || !Number.isFinite(micro)) {
			return { error: "unexpected billing status shape", org: org.name }
		}
		return { balance: microCentsToDollars(micro), org: org.name }
	} catch (error) {
		return { error: message(error) }
	}
}

export default {
	id: "oc-budget",
	async setup(ctx: any) {
		let cache: BudgetSnapshot | null = null
		let cacheAt = 0
		/** One collection at a time: several TUIs, or a model switch racing the poll,
		 *  join the same promise instead of issuing four redundant request sets. */
		let inFlight: Promise<BudgetSnapshot> | null = null

		function collect(): Promise<BudgetSnapshot> {
			return (async () => {
				const [go, ds, or, zen] = await Promise.all([
					collectGo(ctx),
					collectDeepSeek(ctx),
					collectOpenRouter(ctx),
					collectZen(ctx),
				])
				return { at: Date.now(), go, ds, or, zen }
			})()
		}

		await ctx.rpc.register(Budget, {
			snapshot: async (input: any) => {
				const force = input?.force === true
				if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache
				if (inFlight) return inFlight
				inFlight = collect()
					.then((snapshot) => {
						cache = snapshot
						cacheAt = Date.now()
						return snapshot
					})
					.finally(() => {
						inFlight = null
					})
				return inFlight
			},
		})
	},
}
