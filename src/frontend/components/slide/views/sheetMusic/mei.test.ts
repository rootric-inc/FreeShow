import { describe, expect, it } from "vitest"
import { countMeasures, extractTitle, findFittingLayout, insertSlicePageBreaks, normalizeMei, parseSvgViewBox, sanitizeSvg, stripInitialMeter, svgFitsWidth } from "../../../../../../public/assets/sheet-music/mei.mjs"

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

    it("inserts slice page breaks around chosen measure positions and clears existing pb tags", () => {
        const mei = '<mei><section><pb /><measure n="0"><staff/></measure><measure n="1"><staff/></measure><measure n="2"><staff/></measure><measure n="3"><staff/></measure></section></mei>'
        expect(insertSlicePageBreaks(mei, 2, 3)).toBe('<mei><section><measure n="0"><staff/></measure><pb/><measure n="1"><staff/></measure><measure n="2"><staff/></measure><pb/><measure n="3"><staff/></measure></section></mei>')
        expect(insertSlicePageBreaks(mei, 1, 2)).toBe('<mei><section><measure n="0"><staff/></measure><measure n="1"><staff/></measure><pb/><measure n="2"><staff/></measure><measure n="3"><staff/></measure></section></mei>')
        expect(insertSlicePageBreaks(mei, 1, 4)).toBe('<mei><section><measure n="0"><staff/></measure><measure n="1"><staff/></measure><measure n="2"><staff/></measure><measure n="3"><staff/></measure></section></mei>')
    })

    it("strips meter attributes and meterSig only from the initial scoreDef", () => {
        const mei = '<mei><scoreDef keysig="2f" meter.count="4" meter.unit="4" meter.sym="common"><staffGrp><staffDef n="1" meter.count="4" meter.unit="4"><clef shape="G" line="2"/><meterSig count="4" unit="4" visible="false"/></staffDef></staffGrp></scoreDef><section><scoreDef meter.count="3" meter.unit="4"><staffGrp><staffDef n="1"><meterSig count="3" unit="4"/></staffDef></staffGrp></scoreDef></section></mei>'
        const stripped = stripInitialMeter(mei)

        expect(stripped).toContain('<scoreDef keysig="2f"><staffGrp><staffDef n="1"><clef shape="G" line="2"/></staffDef></staffGrp></scoreDef>')
        expect(stripped).toContain('<scoreDef meter.count="3" meter.unit="4">')
        expect(stripped).toContain('<meterSig count="3" unit="4"/>')
    })

    it("removes attributes with external urls, CSS escapes or entity backslashes while keeping local urls and plain colors", () => {
        const svg = ['<svg viewBox="0 0 100 100">', '<path fill="url(https://example.com/x.svg#p)" stroke="#336699"/>', '<path color="u\\rl(https://example.com/esc1.svg#p)" fill="red"/>', '<path color="u\\72l(https://example.com/esc2.svg#p)"/>', '<path color="u&#92;72l(https://example.com/ent.svg#p)"/>', '<rect fill="URL(&quot;https://example.com/upper&quot;)" mask="url( https://example.com/ws )"/>', '<g clip-path="url(#clip1)" fill="url(\'#grad2\')" filter="url( #f3 )"/>', "</svg>"].join("")

        const clean = sanitizeSvg(svg)
        expect(clean).not.toContain("example.com")
        expect(clean).not.toContain("u\\rl")
        expect(clean).not.toContain("u\\72l")
        expect(clean).not.toContain("&#92;")
        expect(clean).toContain('stroke="#336699"')
        expect(clean).toContain('fill="red"')
        expect(clean).toContain('clip-path="url(#clip1)"')
        expect(clean).toContain("fill=\"url('#grad2')\"")
        expect(clean).toContain('filter="url( #f3 )"')
    })

    it("keeps Verovio style blocks without urls or backslashes and empties unsafe style blocks", () => {
        const safeSvg = '<svg id="v1"><style type="text/css">#v1 path {stroke:currentColor}</style><path d="M0 0"/></svg>'
        expect(sanitizeSvg(safeSvg)).toBe(safeSvg)

        const urlStyle = '<svg id="v1"><style type="text/css">#v1 path {fill: url(https://example.com/a)}</style></svg>'
        expect(sanitizeSvg(urlStyle)).toBe('<svg id="v1"><style type="text/css"></style></svg>')

        const escapedStyle = '<svg id="v1"><style type="text/css">#v1 path {fill: u\\72l(https://example.com/b)}</style></svg>'
        expect(sanitizeSvg(escapedStyle)).toBe('<svg id="v1"><style type="text/css"></style></svg>')

        const entityStyle = '<svg id="v1"><style type="text/css">#v1 path {fill: u&#92;rl(https://example.com/c)}</style></svg>'
        expect(sanitizeSvg(entityStyle)).toBe('<svg id="v1"><style type="text/css"></style></svg>')
    })

    it("parses root SVG viewBox dimensions", () => {
        expect(parseSvgViewBox('<svg width="100%" viewBox="0 0 1840 1236"></svg>')).toEqual({ width: 1840, height: 1236 })
        expect(parseSvgViewBox("<svg viewBox='0, 0, 1000, 500'></svg>")).toEqual({ width: 1000, height: 500 })
        expect(parseSvgViewBox("<svg></svg>")).toBeNull()
    })

    it("detects horizontal content overflow in Verovio SVGs and says unknown SVGs fit", () => {
        const fitsSvg = '<svg viewBox="0 0 400 280"><svg class="definition-scale" viewBox="0 0 4000 2800"><g class="page-margin" transform="translate(500, 500)"><g class="staff"><path d="M0 540 L3000 540"/><g class="note"><use transform="translate(2552, 1170)"/><path d="M2769 1142 L2769 540"/></g></g></g></svg></svg>'
        const overflowSvg = '<svg viewBox="0 0 200 280"><svg class="definition-scale" viewBox="0 0 2000 2800"><g class="page-margin" transform="translate(500, 500)"><g class="staff"><path d="M0 540 L1000 540"/><g class="note"><use transform="translate(1095, 1440)"/><path d="M1312 1412 L1312 810"/></g></g></g></svg></svg>'
        const zeroUsableSvg = '<svg viewBox="0 0 100 280"><svg class="definition-scale" viewBox="0 0 1000 2800"><g class="page-margin" transform="translate(500, 500)"><g class="staff"><path d="M0 540 L0 540"/><g class="note"><use transform="translate(1019, 1440)"/></g></g></g></svg></svg>'

        expect(svgFitsWidth(fitsSvg)).toBe(true)
        expect(svgFitsWidth(overflowSvg)).toBe(false)
        expect(svgFitsWidth(zeroUsableSvg)).toBe(false)
        expect(svgFitsWidth('<svg viewBox="0 0 400 280"></svg>')).toBe(true)
    })

    it("fits immediately when preferred width satisfies ratio on one page", () => {
        const calls: number[] = []
        const result = findFittingLayout(1840, 0.5, (w: number) => {
            calls.push(w)
            return { svg: `<svg viewBox="0 0 ${w} 600"></svg>`, pages: 1 }
        })

        expect(calls).toEqual([1840])
        expect(result.pageWidth).toBe(1840)
        expect(result.fits).toBe(true)
        expect(result.pages).toBe(1)
        expect(result.layouts).toBe(1)
    })

    it("gives the same canonical width for overflowing preferred widths within 8 layouts", () => {
        const renderMock = (w: number) => {
            const rows = Math.max(1, Math.ceil(6000 / w))
            const height = rows * 600
            return { svg: `<svg viewBox="0 0 ${w} ${height}"></svg>`, pages: 1 }
        }

        const r200 = findFittingLayout(920, 0.31, renderMock)
        const r100 = findFittingLayout(1840, 0.31, renderMock)
        const r50 = findFittingLayout(4600, 0.31, renderMock)

        expect(r200.fits).toBe(true)
        expect(r100.fits).toBe(true)
        expect(r50.fits).toBe(true)
        expect(r200.layouts).toBeLessThanOrEqual(8)
        expect(r100.layouts).toBeLessThanOrEqual(8)
        expect(r50.layouts).toBe(1)
        expect(r200.pageWidth).toBe(r100.pageWidth)
        expect(r200.pageWidth).toBeLessThanOrEqual(r50.pageWidth)

        const vb = parseSvgViewBox(r200.svg)
        expect(vb).not.toBeNull()
        expect(vb!.height / vb!.width).toBeLessThanOrEqual(0.31)
    })

    it("steps up by 5 percent when preferred width is wider than canonical width yet overflows", () => {
        const renderMock = (w: number) => {
            const overflows = w < 1500 || (w >= 2500 && w < 2600)
            const height = overflows ? Math.round(w * 0.8) : Math.round(w * 0.25)
            return { svg: `<svg viewBox="0 0 ${w} ${height}"></svg>`, pages: 1 }
        }

        const result = findFittingLayout(2500, 0.31, renderMock)
        expect(result.fits).toBe(true)
        expect(result.pageWidth).toBe(2625)
        expect(result.layouts).toBeLessThanOrEqual(8)
    })

    it("stops starting new layouts after the time cap or when nothing up to maxWidth fits", () => {
        let clock = 0
        const timedOut = findFittingLayout(
            1000,
            0.1,
            (w: number) => {
                clock += 3000
                return { svg: `<svg viewBox="0 0 ${w} 5000"></svg>`, pages: 1 }
            },
            { now: () => clock, maxTimeMs: 8000 }
        )
        expect(timedOut.fits).toBe(false)
        expect(timedOut.layouts).toBeLessThanOrEqual(3)

        const multiPage = findFittingLayout(1000, 0.5, (w: number) => ({
            svg: `<svg viewBox="0 0 ${w} 200"></svg>`,
            pages: 2
        }))
        expect(multiPage.fits).toBe(false)
        expect(multiPage.pages).toBe(2)
        expect(multiPage.layouts).toBeLessThanOrEqual(8)

        const tooTall = findFittingLayout(
            1000,
            0.1,
            (w: number) => ({
                svg: `<svg viewBox="0 0 ${w} 5000"></svg>`,
                pages: 1
            }),
            { maxWidth: 4000 }
        )
        expect(tooTall.fits).toBe(false)
        expect(tooTall.pageWidth).toBe(4000)
    })
})
