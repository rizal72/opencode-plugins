// oc-budget — server half.
//
// Owns the one thing the TUI cannot do: resolving a provider's credential out of
// OpenCode's own integration store (`ctx.integration.connection.resolve`), never
// from a file of ours. With a key (or the Console account token) in hand it reads
// the four wallets and caches the result, so the TUI's slots and its `/budget`
// command are pure rendering.
//
//   opencode-go  -> GET console/api/go/status             (5h / weekly / monthly meters)
//                   GET opencode.ai/zen/go/v1/usage        (fallback: a machine with no console session)
//   deepseek     -> GET api.deepseek.com/user/balance      (native wallet)
//   openrouter   -> GET openrouter.ai/api/v1/credits (+ /key for the month)
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
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"

/** How long a collected snapshot is reused; the TUI also polls on this cadence. */
const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 10_000
const USER_AGENT = "oc-budget/0.1"

const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const GO_STATUS_URL = "https://opencode.ai/console/api/go/status"
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

/** How many console connections exist: with one, naming the workspace is noise. */
async function consolePeers(ctx: any): Promise<number | undefined> {
	try {
		const listed: any = await ctx.integration.list()
		const list: any[] = Array.isArray(listed) ? listed : listed?.data ?? []
		const connections: any[] = list.find((item: any) => item?.id === "opencode")?.connections ?? []
		return connections.length || undefined
	} catch {
		// A name is a convenience: never let it cost the balance.
		return undefined
	}
}

/** One Go window, from the console's own meter. The rule is the console's, copied from its bundle
 *  (`(used*200 + limit) / (limit*2)`): round the percent, and cap it at 99 until the window is truly
 *  spent, because the console says `>99% used` there and the wallet must not fall back to ZEN before
 *  the limit is reached. The public endpoint rounds **down** instead: 0.98% reads 0 there and 1 here. */
function goMeter(meter: any): UsageWindow | undefined {
	const used = Number(meter?.usedMicroCents)
	const limit = Number(meter?.limitMicroCents)
	if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return undefined
	const spent = used >= limit
	return {
		status: spent ? "rate-limited" : "ok",
		percent: spent ? 100 : Math.min(99, Math.round((used * 100) / limit)),
		resetsAt: typeof meter?.resetsAt === "string" ? meter.resetsAt : undefined,
	}
}

/** The fallback endpoint's window, clamped to the three fields the contract allows: an extra field
 *  fails the strict schema and takes the whole snapshot down with it, and its shape is documented
 *  nowhere. `status` is derived from the percent when the endpoint does not name it, because an
 *  exhausted window must still flip the paying wallet. */
function goWindow(raw: any): UsageWindow | undefined {
	const percent = typeof raw?.percent === "number" && Number.isFinite(raw.percent) ? raw.percent : undefined
	if (percent === undefined) return undefined
	const reported = typeof raw?.status === "string" ? raw.status : undefined
	return {
		status: percent >= 100 || reported === "rate-limited" ? "rate-limited" : (reported ?? "ok"),
		percent,
		resetsAt: typeof raw?.resetsAt === "string" ? raw.resetsAt : undefined,
	}
}

async function collectGo(ctx: any): Promise<BudgetSnapshot["go"]> {
	// Two ways in, one answer. A console session is preferred: it reports the spend in micro-cents and
	// it is the credential the provider actually bills, so the counters and the payer cannot disagree.
	// A Go API key alone still works, through the public endpoint. Both are enough on their own, and
	// neither is required if the other is there.
	const console = await resolveConsoleToken(ctx)
	let consoleError: string | undefined
	if (console.key) {
		try {
			const body = await getJson(GO_STATUS_URL, { Authorization: `Bearer ${console.key}` })
			const meters = body?.access?.meters
			if (!meters) throw new Error("unexpected go status shape")
			return {
				rolling: goMeter(meters.fiveHour),
				weekly: goMeter(meters.week),
				monthly: goMeter(meters.month),
			}
		} catch (error) {
			// A session that cannot read the meters — a workspace without the subscription — must not
			// hide a key that can. Fall through, and report both failures if it also fails.
			consoleError = message(error)
		}
	}
	const credential = await resolveKey(ctx, "opencode-go")
	if (credential.error) return { error: consoleError ? `${consoleError}; ${credential.error}` : credential.error }
	try {
		const body = await getJson(GO_USAGE_URL, { Authorization: `Bearer ${credential.key}` })
		const usage = body?.usage
		if (!usage) return { error: "unexpected usage response shape" }
		return {
			rolling: goWindow(usage.rolling),
			weekly: goWindow(usage.weekly),
			monthly: goWindow(usage.monthly),
		}
	} catch (error) {
		return { error: consoleError ? `${consoleError}; ${message(error)}` : message(error) }
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
		// Best effort: /key enriches the report (month spend) and
		// must never blank a balance already read.
		try {
			const keyBody = await getJson(OR_KEY_URL, headers)
			const monthly = keyBody?.data?.usage_monthly
			if (typeof monthly === "number") result.usageMonthly = monthly
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
		const microOf = (value: unknown) => {
			const n = typeof value === "string" ? Number(value) : value
			return typeof n === "number" && Number.isFinite(n) ? n : undefined
		}
		// Two numbers, and the difference is the point. `balanceMicroCents` is the ledger: prepaid,
		// so it goes a few cents under when the request that crosses the end costs more than what is
		// left (measured 2026-10-26: -5076149, i.e. -$0.05). `availableMicroCents` is what the console
		// prints as *available credit*: the balance clamped at 0, and raised by a credit limit when the
		// account has one. Clamping the ledger in our code would lose the debt; reading this field
		// keeps both, and stays right the day a limit is set.
		const balance = microOf(body?.balanceMicroCents)
		if (balance === undefined) return { error: "unexpected billing status shape", org: org.name }
		const available = microOf(body?.availableMicroCents) ?? Math.max(0, balance)
		return {
			balance: microCentsToDollars(balance),
			available: microCentsToDollars(available),
			...(typeof org.name === "string" ? { org: org.name } : {}),
			...(await consolePeers(ctx).then((peers) => (peers === undefined ? {} : { peers }))),
		}
	} catch (error) {
		return { error: message(error) }
	}
}

/** A snapshot that says why the read failed, in every wallet. A rejected handler answered HTTP 500 and
 *  left the panel blank with nothing to read; this one is visible where the numbers would be. */
function failedSnapshot(error: unknown): BudgetSnapshot {
	const text = message(error)
	return {
		at: Date.now(),
		go: { error: text },
		ds: { error: text },
		or: { error: text },
		zen: { error: text },
	}
}

/** The shape that crosses the wire, which is JSON: `goMeter` and `goWindow` leave fields `undefined` when
 *  the endpoint omits them, and the output schema is strict — a present `undefined` is not a `string` and
 *  not a missing key, so the whole answer is rejected **after** the handler ran (a 500 with `http.span=1`,
 *  measured 2026-10-28: every poll failed from 07:00 to 12:26 and the pill vanished). `JSON.stringify`
 *  drops them, which is exactly what the transport would do, only before validation instead of after. */
const wire = (snapshot: BudgetSnapshot): BudgetSnapshot => JSON.parse(JSON.stringify(snapshot))

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
				// A forced read must not join a collection that started before it: a credential switch
				// would receive the old account's numbers and cache them for five minutes.
				if (force) await inFlight?.catch(() => {})
				if (inFlight) return inFlight
				inFlight = collect()
					.catch(failedSnapshot)
					.then((snapshot) => {
						cache = wire(snapshot)
						cacheAt = Date.now()
						return cache
					})
					.finally(() => {
						inFlight = null
					})
				return inFlight
			},
		})
	},
}
