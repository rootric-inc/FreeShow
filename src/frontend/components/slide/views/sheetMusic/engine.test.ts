import { describe, expect, it } from "vitest"
import { DEFAULT_ITEM_WIDTH, SvgCache, calculatePageWidth, clampNotationSize, createRenderCacheKey, decodeBase64ToUtf8, getPageWidthFromStyle, parseItemWidth, prefixSvgIds } from "./helpers"

describe("sheetMusic page width math", () => {
    it("calculates page width for sizes 50, 100 and 200", () => {
        expect(calculatePageWidth(1920, 50)).toBe(4610)
        expect(calculatePageWidth(1920, 100)).toBe(2300)
        expect(calculatePageWidth(1920, 200)).toBe(1150)
    })

    it("falls back to 1920 when width is missing or invalid", () => {
        expect(parseItemWidth("")).toBe(DEFAULT_ITEM_WIDTH)
        expect(parseItemWidth(undefined)).toBe(DEFAULT_ITEM_WIDTH)
        expect(parseItemWidth("top: 100px; left: 50px;")).toBe(DEFAULT_ITEM_WIDTH)
        expect(getPageWidthFromStyle("top: 100px;", 100)).toBe(2300)
        expect(calculatePageWidth(undefined, 100)).toBe(2300)
        expect(calculatePageWidth(0, 100)).toBe(2300)
    })

    it("clamps notation size between 50 and 200", () => {
        expect(clampNotationSize(undefined)).toBe(100)
        expect(clampNotationSize(20)).toBe(50)
        expect(clampNotationSize(400)).toBe(200)
        expect(calculatePageWidth(1920, 10)).toBe(calculatePageWidth(1920, 50))
        expect(calculatePageWidth(1920, 500)).toBe(calculatePageWidth(1920, 200))
    })

    it("rounds page width to the nearest 10 so small width changes share cache entries", () => {
        expect(getPageWidthFromStyle("width: 1530px; height: 480px;", 100)).toBe(1840)
        expect(getPageWidthFromStyle("width: 1532px; height: 480px;", 100)).toBe(1840)
        expect(getPageWidthFromStyle("width: 1529px; height: 480px;", 100)).toBe(1830)
    })
})

describe("createRenderCacheKey", () => {
    it("distinguishes different MEI documents and different page widths", () => {
        const keyA = createRenderCacheKey("<mei>A</mei>", 1840)
        const keyB = createRenderCacheKey("<mei>B</mei>", 1840)
        const keyC = createRenderCacheKey("<mei>A</mei>", 2300)

        expect(keyA).toBe(createRenderCacheKey("<mei>A</mei>", 1840))
        expect(keyA).not.toBe(keyB)
        expect(keyA).not.toBe(keyC)
    })
})

describe("SvgCache", () => {
    it("drops the least recently used entry when the size limit is exceeded", () => {
        const cache = new SvgCache(25)
        cache.set("a", "0123456789")
        cache.set("b", "abcdefghij")
        expect(cache.size).toBe(2)
        expect(cache.bytes).toBe(20)

        // Touch "a" so "b" becomes least recently used
        expect(cache.get("a")).toBe("0123456789")

        cache.set("c", "ABCDEFGHIJ")
        expect(cache.get("b")).toBeUndefined()
        expect(cache.get("a")).toBe("0123456789")
        expect(cache.get("c")).toBe("ABCDEFGHIJ")
        expect(cache.bytes).toBe(20)
    })

    it("updates byte count when overwriting an existing key and skips oversized entries", () => {
        const cache = new SvgCache(15)
        cache.set("a", "12345")
        cache.set("a", "1234567890")
        expect(cache.bytes).toBe(10)
        expect(cache.get("a")).toBe("1234567890")

        cache.set("huge", "01234567890123456789")
        expect(cache.get("huge")).toBeUndefined()
        expect(cache.get("a")).toBe("1234567890")
    })
})

describe("prefixSvgIds", () => {
    it("rewrites id, href, xlink:href and url references with a per-instance prefix", () => {
        const svg = '<svg><defs><g id="E0A4"/><clipPath id="clip1"/></defs><use xlink:href="#E0A4"/><use href="#E0A4"/><g clip-path="url(#clip1)"/><a href="#external"/></svg>'
        const prefixed = prefixSvgIds(svg, "sm7_")

        expect(prefixed).toContain('id="sm7_E0A4"')
        expect(prefixed).toContain('id="sm7_clip1"')
        expect(prefixed).toContain('xlink:href="#sm7_E0A4"')
        expect(prefixed).toContain('href="#sm7_E0A4"')
        expect(prefixed).toContain('clip-path="url(#sm7_clip1)"')
        expect(prefixed).toContain('href="#external"')
    })

    it("rewrites the root id inside the embedded style block and leaves other hashes alone", () => {
        const svg = '<svg id="a1tq0r47"><style type="text/css">#a1tq0r47 path, #a1tq0r47 rect {stroke:currentColor}#a1tq0r47 g.cursor {fill:#1e90ff;}</style><path d="M0 0"/><text>#a1tq0r47</text></svg>'
        const prefixed = prefixSvgIds(svg, "sm7_")

        expect(prefixed).toContain('<svg id="sm7_a1tq0r47">')
        expect(prefixed).toContain("#sm7_a1tq0r47 path, #sm7_a1tq0r47 rect {stroke:currentColor}")
        expect(prefixed).toContain("fill:#1e90ff;")
        expect(prefixed).toContain("<text>#a1tq0r47</text>")
    })
})

describe("decodeBase64ToUtf8", () => {
    it("decodes UTF-8 text including accented characters from base64", () => {
        const text = "Hellig, hellig, hellig! Åse & Øyvind"
        const base64 = Buffer.from(text, "utf8").toString("base64")
        expect(decodeBase64ToUtf8(base64)).toBe(text)
    })
})
