// oc-budget/peak.ts — DeepSeek's two tariffs, one definition for both surfaces.
//
// The terminal draws the glyph next to a bar, the desktop puts it on a pill and on the rows of its
// menu. What "peak" means is neither of their business: the windows are DeepSeek's, published as
// "01:00-04:00 and 06:00-10:00 UTC, Monday through Friday, excluding Chinese public holidays"
// (read 2026-10-27).
//
// Runnable standalone for its self-check: node plugins/oc-budget/peak.ts --self-check

/** Peak hours, in UTC. The arithmetic is DST-proof on purpose. A Chinese public holiday is not encoded,
 *  so it reads as peak — over-warning, which is the safe direction. */
const WINDOWS: ReadonlyArray<readonly [number, number]> = [
	[1, 4],
	[6, 10],
]
const EDGES = [1, 4, 6, 10]

const at = (now: number) => new Date(now)

/** A dev switch shared by both surfaces: set it to an instant inside a peak window and the peak marks
 *  appear at any hour, so the look can be judged — or filmed — without waiting for 01:00 UTC. A Tuesday at
 *  02:00 UTC: `Date.UTC(2026, 9, 27, 2, 0)`. Ships `undefined`, and this plugin is local, so nothing else
 *  guards it. Both halves read it from here: one value, or the badge and the pill would disagree. */
export const SIMULATE: number | undefined = undefined
/** The clock the peak is judged by: the simulated instant when one is set, the real time otherwise. */
export const clock = (): number => SIMULATE ?? Date.now()

export function isPeak(now = Date.now()): boolean {
	const date = at(now)
	const day = date.getUTCDay()
	if (day === 0 || day === 6) return false
	const hour = date.getUTCHours() + date.getUTCMinutes() / 60
	return WINDOWS.some(([from, to]) => hour >= from && hour < to)
}

/** The next instant the regime flips, and what it flips to. Candidates are the window edges over the
 *  next ten days; the first that changes the state wins, which skips the weekend edges that open and
 *  close nothing. */
export function nextChange(now = Date.now()): { peak: boolean; at: number } {
	const peak = isPeak(now)
	const midnight = at(now)
	midnight.setUTCHours(0, 0, 0, 0)
	const edges: number[] = []
	for (let offset = 0; offset <= 10; offset++) {
		for (const hour of EDGES) {
			const time = midnight.getTime() + offset * 86_400_000 + hour * 3_600_000
			if (time > now) edges.push(time)
		}
	}
	edges.sort((a, b) => a - b)
	for (const time of edges) if (isPeak(time) !== peak) return { peak: !peak, at: time }
	return { peak: !peak, at: edges[edges.length - 1] }
}

/**
 * True when the price of *this model* doubles inside a peak window: native DeepSeek, and the DeepSeek
 * ids on Go while the subscription pays. Zen never does — its DeepSeek price is flat at the peak
 * figure, a constant and not a doubling.
 */
export function doubles(model: { providerID?: string; modelID?: string } | undefined, wallet: string, now = Date.now()): boolean {
	if (!isPeak(now)) return false
	const provider = model?.providerID ?? ""
	if (provider === "deepseek") return true
	if (provider === "opencode-go" && wallet === "go") return /^deepseek/.test(model?.modelID ?? "")
	return false
}

// Self-check: node plugins/oc-budget/peak.ts --self-check
// Guarded: this module is also bundled into the desktop window, where `process` does not exist.
if (typeof process !== "undefined" && process.argv?.[2] === "--self-check") {
	const check = (ok: boolean, message: string) => {
		if (!ok) throw new Error("self-check: " + message)
	}
	// 2026-10-27 is a Tuesday: 02:00 UTC is peak, 04:30 is not, 06:00 is again.
	const tue = (h: number, m = 0) => Date.UTC(2026, 9, 27, h, m)
	const sat = (h: number) => Date.UTC(2026, 9, 31, h)

	check(isPeak(tue(2)), "02:00 UTC on a weekday is peak")
	check(!isPeak(tue(0, 30)), "00:30 UTC is off-peak")
	check(!isPeak(tue(4)), "04:00 is the first off-peak minute")
	check(isPeak(tue(6)), "06:00 is peak again")
	check(!isPeak(tue(10)), "10:00 ends it")
	check(!isPeak(sat(2)), "a weekend is never peak")

	const deepseek = { providerID: "deepseek", modelID: "deepseek-chat" }
	const goDeepseek = { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" }
	const goOther = { providerID: "opencode-go", modelID: "glm-5.3" }
	const zenDeepseek = { providerID: "opencode", modelID: "deepseek-v4.1-flash" }

	check(doubles(deepseek, "ds", tue(2)), "native DeepSeek doubles at peak")
	check(!doubles(deepseek, "ds", tue(4)), "and not off-peak")
	check(doubles(goDeepseek, "go", tue(2)), "a Go DeepSeek doubles while Go pays")
	check(!doubles(goDeepseek, "ds", tue(2)), "but not while another wallet pays")
	check(!doubles(goOther, "go", tue(2)), "a Go model that is not DeepSeek never doubles")
	check(!doubles(zenDeepseek, "zen", tue(2)), "Zen's DeepSeek price is flat")
	check(!doubles(undefined, "go", tue(2)), "no model, no doubling")

	const soon = nextChange(tue(2))
	check(!soon.peak && soon.at === tue(4), "the next change from 02:00 is off-peak at 04:00")
	const friday = nextChange(Date.UTC(2026, 9, 30, 23))
	check(friday.peak && friday.at === Date.UTC(2026, 10, 2, 1), "Friday night flips to peak on Monday at 01:00")

	console.log("self-check ok: " + WINDOWS.length + " windows, Zen flat, the weekend never peak")
}
