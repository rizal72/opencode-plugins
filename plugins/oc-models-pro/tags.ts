// Two letters per provider, so a row says where its model comes from without spending a column.
//
// The host's own two providers keep a tag chosen by hand, and those two are reserved: they exist in
// every installation, so nobody else may take their letters. Everything else is derived from the
// provider's display name — the only place where a merged name still keeps its seams ("DeepSeek" is
// Deep·Seek; the id `deepseek` no longer says so).
//
// Runnable standalone for its self-check: node plugins/oc-models-pro/tags.ts --self-check

/** Tags that belong to the host's own providers, present or not. */
const RESERVED: Record<string, string> = {
	opencode: "OC",
	"opencode-go": "GO",
}

/**
 * The words of a display name: `OpenCode Go` is two, `OpenRouter` is two as well — but a camelCase
 * split only when the name has no separator, so a brand like `GitHub Copilot` keeps `GitHub` whole.
 */
export function words(name: string): string[] {
	const split = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
	if (split.length > 1) return split
	const camel = (split[0] ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ").filter(Boolean)
	return camel.length > 1 ? camel : split
}

/** What the name asks for: the initials of its words, or two letters of a single one. */
function preferred(name: string): string {
	const parts = words(name)
	const letters = parts.length > 1 ? parts.map((part) => part[0]).join("") : (parts[0] ?? "?")
	return letters.toUpperCase().padEnd(2, "?").slice(0, 2)
}

/**
 * A tag per provider id, unique and order-independent. Derived in alphabetical order of id, so the
 * same catalogue always yields the same tags whatever order the providers arrive in.
 */
export function tagsFor(providers: Array<{ id: string; name: string }>): Map<string, string> {
	const taken = new Set(Object.values(RESERVED))
	const tags = new Map<string, string>()
	const order = [...providers].sort((a, b) => a.id.localeCompare(b.id))

	for (const provider of order) {
		const fixed = RESERVED[provider.id]
		if (fixed) tags.set(provider.id, fixed)
	}

	for (const provider of order) {
		if (tags.has(provider.id)) continue
		const letters = (words(provider.name).join("") || "?").toUpperCase()
		const first = letters[0] ?? "?"
		let tag = preferred(provider.name)
		if (taken.has(tag)) {
			// Walk the name for a free pair, so `Google` steps aside from the reserved GO.
			tag = ""
			for (const letter of letters.slice(1)) {
				// A doubled letter reads as a typo ("GG"): prefer anything else.
				if (letter === first) continue
				const candidate = first + letter
				if (!taken.has(candidate)) {
					tag = candidate
					break
				}
			}
		}
		if (taken.has(tag) || !tag) {
			tag = ""
			for (let digit = 2; digit <= 9; digit++) {
				if (!taken.has(first + digit)) {
					tag = first + digit
					break
				}
			}
		}
		if (!tag) tag = "?" + (tags.size % 10)
		taken.add(tag)
		tags.set(provider.id, tag)
	}
	return tags
}

// Self-check: node plugins/oc-models-pro/tags.ts --self-check
if (process.argv[2] === "--self-check") {
	const fail = (message: string): never => {
		throw new Error("self-check: " + message)
	}
	const at = (providers: Array<{ id: string; name: string }>, id: string): string =>
		tagsFor(providers).get(id) ?? fail("no tag for " + id)

	if (at([{ id: "opencode", name: "anything" }], "opencode") !== "OC") fail("opencode must stay OC")
	if (at([{ id: "opencode-go", name: "whatever" }], "opencode-go") !== "GO") fail("opencode-go must stay GO")
	if (at([{ id: "openrouter", name: "OpenRouter" }], "openrouter") !== "OR") fail("OpenRouter must be OR")
	if (at([{ id: "deepseek", name: "DeepSeek" }], "deepseek") !== "DS") fail("DeepSeek must be DS")
	if (at([{ id: "github-copilot", name: "GitHub Copilot" }], "github-copilot") !== "GC") {
		fail("GitHub Copilot must be GC")
	}
	// Reserved letters are reserved even when the host's provider is not in the list.
	if (at([{ id: "google", name: "Google" }], "google") !== "GL") fail("Google must step aside from GO")

	const twins = tagsFor([
		{ id: "acme-one", name: "Acme" },
		{ id: "acme-two", name: "Acme" },
	])
	if (new Set(twins.values()).size !== 2) fail("two providers share a tag")

	const forward = tagsFor([
		{ id: "beta", name: "Beta" },
		{ id: "alpha", name: "Alpha" },
		{ id: "google", name: "Google" },
	])
	const backward = tagsFor([
		{ id: "google", name: "Google" },
		{ id: "alpha", name: "Alpha" },
		{ id: "beta", name: "Beta" },
	])
	if ([...forward].map(String).sort().join() !== [...backward].map(String).sort().join()) {
		fail("the input order changes the tags")
	}

	console.log(
		"self-check ok: " +
			[...forward].map(([id, tag]) => id + "=" + tag).join(" ") +
			" (" +
			words("OpenCode Go").join("|") +
			")",
	)
}
