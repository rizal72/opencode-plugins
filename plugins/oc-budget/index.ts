// oc-budget — server half: resolves the provider credentials out of OpenCode's own integration store,
// never from a file of ours, reads the four wallets and caches the snapshot so both surfaces are pure
// rendering. The endpoints, the two ways into the Go meters and the absence-versus-fault rule are the
// doc's — docs/oc-budget.md, The four wallets and Credentials.
import { Budget } from "./rpc.ts"
import type { BudgetSnapshot, UsageWindow } from "./rpc.ts"

/** What a Go read says when the console answers without meters: the workspace has no plan — the doc,
 *  The four wallets. */
const NO_GO_PLAN = "no Go plan on this workspace"

/** How long a collected snapshot is reused; the TUI also polls on this cadence. */
const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 10_000
const USER_AGENT = "oc-budget/0.1"

/** A test switch, inert unless set: `scripts/oc-dev-env.sh on OC_BUDGET_DEV=empty` fakes an account with
 *  nothing connected, before the cache and never cached — the doc, No provider connected. */
const DEV = process.env.OC_BUDGET_DEV ?? ""

const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const GO_STATUS_URL = "https://opencode.ai/console/api/go/status"
const DS_BALANCE_URL = "https://api.deepseek.com/user/balance"
const OR_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
const ZEN_CURRENT_URL = "https://opencode.ai/console/api/orgs/current"
const ZEN_STATUS_URL = "https://opencode.ai/console/api/billing/status"

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

interface ResolvedKey {
	key?: string
	error?: string
	/** No connection exists at all: the caller omits the wallet instead of reporting a failure. */
	missing?: boolean
}

/** The API key of an integration, out of OpenCode's own credential store. */
async function resolveKey(ctx: any, integrationID: string): Promise<ResolvedKey> {
	try {
		const connection = await ctx.integration.connection.active(integrationID)
		if (!connection) {
			return { missing: true, error: `${integrationID} is not connected (see: opencode auth list)` }
		}
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
			return { missing: true, error: "OpenCode Console not connected (run: opencode auth login opencode)" }
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

/** Micro-cents (1e-8 USD) to dollars, rounded on the integer before the division: rounding after it is a
 *  cent low on values like 100500000 — the doc, The four wallets. */
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

/** One Go window from the console's meter: the console's own rule, capped at 99 until the limit is reached
 *  — the doc, The four wallets, has the formula and the two rounding directions. */
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

/** The fallback endpoint's window, clamped to the three fields the contract allows — one stray field fails
 *  the strict schema and takes the whole snapshot down (the doc, The four wallets). A stopped window reads
 *  as spent in either of the two ways the endpoint names it. */
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
	// Console first, key second — the doc, Two ways in, one answer.
	const console = await resolveConsoleToken(ctx)
	let consoleError: string | undefined
	if (console.key) {
		try {
			const body = await getJson(GO_STATUS_URL, { Authorization: `Bearer ${console.key}` })
			const meters = body?.access?.meters
			if (!meters) throw new Error(NO_GO_PLAN)
			const reading = {
				rolling: goMeter(meters.fiveHour),
				weekly: goMeter(meters.week),
				monthly: goMeter(meters.month),
			}
			if (!reading.rolling && !reading.weekly && !reading.monthly) {
				throw new Error(NO_GO_PLAN)
			}
			return reading
		} catch (error) {
			// A session that cannot read the meters must not hide a key that can; both failures are kept.
			consoleError = message(error)
		}
	}
	if (!console.missing && console.error) consoleError ??= console.error
	const credential = await resolveKey(ctx, "opencode-go")
	// No Go key and no plan read: GO is left out rather than reported, so a free account carries no permanent
	// error line — the doc, The four wallets.
	if (credential.missing) {
		return consoleError && !console.missing ? { error: consoleError } : undefined
	}
	if (credential.error) return { error: consoleError ? `${consoleError}; ${credential.error}` : credential.error }
	try {
		const body = await getJson(GO_USAGE_URL, { Authorization: `Bearer ${credential.key}` })
		const usage = body?.usage
		if (!usage) return { error: NO_GO_PLAN }
		const reading = {
			rolling: goWindow(usage.rolling),
			weekly: goWindow(usage.weekly),
			monthly: goWindow(usage.monthly),
		}
		if (!reading.rolling && !reading.weekly && !reading.monthly) {
			return { error: NO_GO_PLAN }
		}
		return reading
	} catch (error) {
		return { error: consoleError ? `${consoleError}; ${message(error)}` : message(error) }
	}
}

async function collectDeepSeek(ctx: any): Promise<BudgetSnapshot["ds"]> {
	const credential = await resolveKey(ctx, "deepseek")
	if (credential.missing) return undefined
	if (credential.error) return { error: credential.error }
	try {
		const body = await getJson(DS_BALANCE_URL, { Authorization: `Bearer ${credential.key}` })
		const info = body?.balance_infos?.[0]
		const balance = info?.total_balance === undefined ? Number.NaN : Number(info.total_balance)
		if (!Number.isFinite(balance)) return { error: "could not read the balance" }
		return { balance, currency: info?.currency ?? "USD" }
	} catch (error) {
		return { error: message(error) }
	}
}

async function collectOpenRouter(ctx: any): Promise<BudgetSnapshot["or"]> {
	const credential = await resolveKey(ctx, "openrouter")
	if (credential.missing) return undefined
	if (credential.error) return { error: credential.error }
	const headers = { Authorization: `Bearer ${credential.key}` }
	try {
		const body = await getJson(OR_CREDITS_URL, headers)
		const totalCredits = body?.data?.total_credits
		const totalUsage = body?.data?.total_usage
		if (typeof totalCredits !== "number" || typeof totalUsage !== "number") {
			return { error: "could not read the credits" }
		}
		const result: NonNullable<BudgetSnapshot["or"]> = {
			totalCredits,
			totalUsage,
			balance: totalCredits - totalUsage,
		}
		return result
	} catch (error) {
		return { error: message(error) }
	}
}

async function collectZen(ctx: any): Promise<BudgetSnapshot["zen"]> {
	const token = await resolveConsoleToken(ctx)
	// Absent Console is an absence, like the other three; one that exists and cannot read keeps its error.
	if (token.missing) return undefined
	if (token.error) return { error: token.error }
	const headers = { Authorization: `Bearer ${token.key}` }
	try {
		// The session is bound to one workspace, so the workspace is read from it and never guessed — the
		// doc, The Console session is scoped to one workspace.
		const current = await getJson(ZEN_CURRENT_URL, headers)
		const org = current?.org
		if (!org?.id) return { error: "the console session has no workspace" }
		const body = await getJson(ZEN_STATUS_URL, { ...headers, "x-org-id": org.id })
		const microOf = (value: unknown) => {
			const n = typeof value === "string" ? Number(value) : value
			return typeof n === "number" && Number.isFinite(n) ? n : undefined
		}
		// Two numbers: the ledger, which can go under, and the spendable credit the console prints — the
		// doc, The four wallets.
		const balance = microOf(body?.balanceMicroCents)
		if (balance === undefined) return { error: "could not read the Zen balance", org: org.name }
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

/** A snapshot that says why the read failed, on every wallet: visible where the numbers would be, so an
 *  account with one connection does not lose its only line. No collector reaches it today. */
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

/** What crosses the wire is JSON: a field left `undefined` is not a string and not a missing key, so the
 *  strict output schema rejects the whole answer after the handler ran. `JSON.stringify` drops them first —
 *  the doc, Gotchas and the blank night. */
const wire = (snapshot: BudgetSnapshot): BudgetSnapshot => JSON.parse(JSON.stringify(snapshot))

export default {
	id: "oc-budget",
	async setup(ctx: any) {
		let cache: BudgetSnapshot | null = null
		let cacheAt = 0
		/** One collection at a time: several TUIs, or a model switch racing the poll, join one promise. */
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
				if (DEV === "empty") return { at: Date.now() }
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
