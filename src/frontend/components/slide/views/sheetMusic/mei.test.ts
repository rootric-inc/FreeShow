import { describe, expect, it } from "vitest"
import { countMeasures, extractTitle, findFittingLayout, normalizeMei, parseSvgViewBox, sanitizeSvgUrls } from "../../../../../../public/assets/sheet-music/mei.mjs"

describe("mei pure helpers", () => {
    it("normalizes MEI by removing xml-model, meiHead, labels, whitespace and setting bar.thru to false", () => {
        const raw = ['<?xml-model href="https://music-encoding.org/schema/5.0/mei-all.rng" type="application/xml"?>', "<mei>", "  <meiHead><fileDesc><titleStmt><title>Test</title></titleStmt></fileDesc></meiHead>", "  <music>", '    <staffGrp symbol="brace" bar.thru="true">', "      <label>Soprano</label>", "      <labelAbbr>S.</labelAbbr>", '      <staffDef n="1"/>', "    </staffGrp>", "    <staffGrp>", "      <label/>", "    </staffGrp>", "  </music>", "</mei>"].join("\n")

        const normalized = normalizeMei(raw)
        expect(normalized).not.toContain("xml-model")
        expect(normalized).not.toContain("meiHead")
        expect(normalized).not.toContain("<label")
        expect(normalized).not.toContain("<labelAbbr")
        expect(normalized).toContain('<staffGrp symbol="brace" bar.thru="false">')
        expect(normalized).toContain('<staffGrp bar.thru="false">')
        expect(normalized).not.toMatch(/>\s+</)
    })

    it("removes self-closing meiHead and replaces single-quoted bar.thru", () => {
        const raw = `<mei><meiHead /><staffGrp bar.thru='true'/></mei>`
        const normalized = normalizeMei(raw)
        expect(normalized).toBe('<mei><staffGrp bar.thru="false"/></mei>')
    })

    it("extracts title from meiHead and decodes XML entities", () => {
        const mei = `<mei><meiHead><titleStmt><title>Peace &amp; Joy &lt;1&gt; &quot;A&quot; &apos;B&apos; &#8217; &#x00C5;se</title></titleStmt></meiHead></mei>`
        expect(extractTitle(mei)).toBe(`Peace & Joy <1> "A" 'B' ’ Åse`)
        expect(extractTitle("<mei><music/></mei>")).toBe("")
    })

    it("counts measures in MEI", () => {
        const mei = '<mei><section><measure n="1"/><measure n="2"><staff/></measure><measure><staff/></measure></section></mei>'
        expect(countMeasures(mei)).toBe(3)
        expect(countMeasures("<mei><section/></mei>")).toBe(0)
    })

    it("strips external url() targets and keeps local fragment references", () => {
        const svg = ['<svg viewBox="0 0 100 100">', '<path fill="url(https://example.com/x.svg#p)" stroke="url(\'http://evil.test/a\')"/>', '<rect fill="URL(&quot;https://example.com/y&quot;)" mask="url(data:image/svg+xml,abc)"/>', '<g clip-path="url(#clip1)" fill="url(\'#grad2\')" filter="url( #f3 )"/>', "</svg>"].join("")

        const clean = sanitizeSvgUrls(svg)
        expect(clean).toContain('fill="none"')
        expect(clean).toContain('stroke="none"')
        expect(clean).toContain('mask="none"')
        expect(clean).not.toContain("example.com")
        expect(clean).not.toContain("evil.test")
        expect(clean).not.toContain("data:image")
        expect(clean).toContain('clip-path="url(#clip1)"')
        expect(clean).toContain("fill=\"url('#grad2')\"")
        expect(clean).toContain('filter="url( #f3 )"')
    })

    it("parses root SVG viewBox dimensions", () => {
        expect(parseSvgViewBox('<svg width="100%" viewBox="0 0 1840 1236"></svg>')).toEqual({ width: 1840, height: 1236 })
        expect(parseSvgViewBox("<svg viewBox='0, 0, 1000, 500'></svg>")).toEqual({ width: 1000, height: 500 })
        expect(parseSvgViewBox("<svg></svg>")).toBeNull()
    })

    it("fits immediately when initial width satisfies ratio on one page", () => {
        const calls: number[] = []
        const result = findFittingLayout(1840, 0.5, (w: number) => {
            calls.push(w)
            return { svg: `<svg viewBox="0 0 ${w} 600"></svg>`, pageCount: 1 }
        })

        expect(calls).toEqual([1840])
        expect(result.pageWidth).toBe(1840)
        expect(result.truncated).toBe(false)
        expect(result.layouts).toBe(1)
    })

    it("searches upward, narrows within 3 percent, stays monotonic across starting widths, and caps layouts at 12", () => {
        const renderMock = (w: number) => {
            const rows = Math.max(1, Math.ceil(4000 / w))
            const height = rows * 600
            return { svg: `<svg viewBox="0 0 ${w} ${height}"></svg>`, pageCount: 1 }
        }

        const r200 = findFittingLayout(920, 0.31, renderMock)
        const r100 = findFittingLayout(1840, 0.31, renderMock)
        const r50 = findFittingLayout(3670, 0.31, renderMock)

        expect(r200.truncated).toBe(false)
        expect(r100.truncated).toBe(false)
        expect(r50.truncated).toBe(false)
        expect(r200.layouts).toBeLessThanOrEqual(12)
        expect(r100.layouts).toBeLessThanOrEqual(12)
        expect(r50.layouts).toBeLessThanOrEqual(12)
        expect(r200.pageWidth).toBeLessThanOrEqual(r100.pageWidth)
        expect(r100.pageWidth).toBeLessThanOrEqual(r50.pageWidth)

        const vb = parseSvgViewBox(r200.svg)
        expect(vb).not.toBeNull()
        expect(vb!.height / vb!.width).toBeLessThanOrEqual(0.31)
    })

    it("marks truncated when music never fits within maxWidth or stays multi-page", () => {
        const multiPage = findFittingLayout(1000, 0.5, (w: number) => ({
            svg: `<svg viewBox="0 0 ${w} 200"></svg>`,
            pageCount: 2
        }))
        expect(multiPage.truncated).toBe(true)
        expect(multiPage.layouts).toBeLessThanOrEqual(12)

        const tooTall = findFittingLayout(
            1000,
            0.1,
            (w: number) => ({
                svg: `<svg viewBox="0 0 ${w} 5000"></svg>`,
                pageCount: 1
            }),
            { maxWidth: 4000 }
        )
        expect(tooTall.truncated).toBe(true)
        expect(tooTall.pageWidth).toBe(4000)
    })
})
