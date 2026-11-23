import { describe, expect, it } from "vitest"
import { DEFAULT_ITEM_HEIGHT, DEFAULT_ITEM_WIDTH, SvgCache, calculatePageWidth, clampNotationSize, createRenderCacheKey, decodeBase64Text, escapeHtml, getItemRatioFromStyle, getPageWidthFromStyle, getSheetMusicCustomParts, getSheetMusicData, getSheetMusicDisplayLabel, getSheetMusicLabel, getSheetMusicMeasures, getSheetMusicParts, getSheetMusicSize, getSheetMusicVerses, parseItemHeight, parseItemWidth, prefixSvgIds } from "./helpers"

describe("sheetMusic page width and ratio math", () => {
    it("calculates page width for sizes 50, 100 and 200", () => {
        expect(calculatePageWidth(1920, 50)).toBe(4610)
        expect(calculatePageWidth(1920, 100)).toBe(2300)
        expect(calculatePageWidth(1920, 200)).toBe(1150)
    })

    it("falls back to 1920 and 1080 when width or height is missing or invalid", () => {
        expect(parseItemWidth("")).toBe(DEFAULT_ITEM_WIDTH)
        expect(parseItemWidth(undefined)).toBe(DEFAULT_ITEM_WIDTH)
        expect(parseItemWidth("top: 100px; left: 50px;")).toBe(DEFAULT_ITEM_WIDTH)
        expect(parseItemHeight("")).toBe(DEFAULT_ITEM_HEIGHT)
        expect(parseItemHeight(undefined)).toBe(DEFAULT_ITEM_HEIGHT)
        expect(parseItemHeight("width: 1530px;")).toBe(DEFAULT_ITEM_HEIGHT)
        expect(parseItemHeight("height: -20px;")).toBe(DEFAULT_ITEM_HEIGHT)
        expect(getPageWidthFromStyle("top: 100px;", 100)).toBe(2300)
        expect(calculatePageWidth(undefined, 100)).toBe(2300)
        expect(calculatePageWidth(0, 100)).toBe(2300)
    })

    it("computes the item box ratio rounded to two decimals", () => {
        expect(getItemRatioFromStyle("width: 1530px; height: 480px;")).toBe(0.31)
        expect(getItemRatioFromStyle("width: 1532px; height: 480px;")).toBe(0.31)
        expect(getItemRatioFromStyle("")).toBe(0.56)
        expect(getItemRatioFromStyle(undefined)).toBe(0.56)
        expect(getItemRatioFromStyle("width: 1000px; height: 1px;")).toBe(0.01)
    })

    it("clamps notation size between 50 and 200 and ignores wrong types", () => {
        expect(clampNotationSize(undefined)).toBe(100)
        expect(clampNotationSize("150")).toBe(100)
        expect(clampNotationSize(Number.NaN)).toBe(100)
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
    it("distinguishes different MEI documents, page widths and ratios", () => {
        const keyA = createRenderCacheKey("<mei>A</mei>", 1840)
        const keyB = createRenderCacheKey("<mei>B</mei>", 1840)
        const keyC = createRenderCacheKey("<mei>A</mei>", 2300)
        const keyRatio1 = createRenderCacheKey("<mei>A</mei>", 1840, 0.31)
        const keyRatio2 = createRenderCacheKey("<mei>A</mei>", 1840, 0.56)

        expect(keyA).toBe(createRenderCacheKey("<mei>A</mei>", 1840))
        expect(keyRatio1).toBe(createRenderCacheKey("<mei>A</mei>", 1840, 0.31))
        expect(keyA).not.toBe(keyB)
        expect(keyA).not.toBe(keyC)
        expect(keyA).not.toBe(keyRatio1)
        expect(keyRatio1).not.toBe(keyRatio2)
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

describe("decodeBase64Text", () => {
    const sample = "Hellig, hellig, hellig! Åse & Øyvind"

    it("decodes plain UTF-8 text from base64", () => {
        const base64 = Buffer.from(sample, "utf8").toString("base64")
        expect(decodeBase64Text(base64)).toBe(sample)
    })

    it("decodes UTF-8 with a byte order mark and removes the mark", () => {
        const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample, "utf8")])
        expect(decodeBase64Text(withBom.toString("base64"))).toBe(sample)
    })

    it("decodes UTF-16LE with a byte order mark", () => {
        const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sample, "utf16le")])
        expect(decodeBase64Text(withBom.toString("base64"))).toBe(sample)
    })

    it("decodes UTF-16BE with a byte order mark", () => {
        const le = Buffer.from(sample, "utf16le")
        const be = Buffer.alloc(le.length)
        for (let i = 0; i < le.length; i += 2) {
            be[i] = le[i + 1]
            be[i + 1] = le[i]
        }
        const withBom = Buffer.concat([Buffer.from([0xfe, 0xff]), be])
        expect(decodeBase64Text(withBom.toString("base64"))).toBe(sample)
    })
})

describe("escapeHtml and safe sheet_music field readers", () => {
    it("escapes HTML special characters", () => {
        expect(escapeHtml(`A & B <script>"hi" 'there'</script>`)).toBe("A &amp; B &lt;script&gt;&quot;hi&quot; &#39;there&#39;&lt;/script&gt;")
    })

    it("treats non-string or non-number fields as missing", () => {
        expect(getSheetMusicLabel({ label: 17 })).toBe("")
        expect(getSheetMusicLabel({ label: "Amazing Grace" })).toBe("Amazing Grace")
        expect(getSheetMusicLabel(null)).toBe("")
        expect(getSheetMusicData({ data: 42 })).toBe("")
        expect(getSheetMusicData({ data: "<mei/>" })).toBe("<mei/>")
        expect(getSheetMusicSize({ size: "120" })).toBeUndefined()
        expect(getSheetMusicSize({ size: Number.NaN })).toBeUndefined()
        expect(getSheetMusicSize({ size: 125 })).toBe(125)
        expect(getSheetMusicParts({ parts: "upper" })).toBe("upper")
        expect(getSheetMusicParts({ parts: "invalid" })).toBeUndefined()
        expect(getSheetMusicParts({ parts: 42 })).toBeUndefined()
        expect(getSheetMusicCustomParts({ customParts: ["1.1", "2.1"] })).toEqual(["1.1", "2.1"])
        expect(getSheetMusicCustomParts({ customParts: ["1.1", 42, ""] })).toEqual(["1.1"])
        expect(getSheetMusicCustomParts({ customParts: "1.1" })).toBeUndefined()
        expect(getSheetMusicVerses({ verses: "1,3" })).toBe("1,3")
        expect(getSheetMusicVerses({ verses: 2 })).toBe("")
        expect(getSheetMusicMeasures({ measures: "5-8" })).toBe("5-8")
        expect(getSheetMusicMeasures({ measures: 5 })).toBe("")
        expect(getSheetMusicDisplayLabel({ label: "Joy to the World", measures: "5-8" })).toBe("Joy to the World (5-8)")
        expect(getSheetMusicDisplayLabel({ label: "Joy to the World" })).toBe("Joy to the World")
        expect(getSheetMusicDisplayLabel({ measures: "5-8" })).toBe("")
    })
})
