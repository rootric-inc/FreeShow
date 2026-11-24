import { describe, expect, it } from "vitest"
import {
    applyInitialMeter,
    chooseRowStarts,
    chooseTransposeInterval,
    countMeasures,
    extractHeaderMetadata,
    extractKeySignatures,
    extractTitle,
    findFittingLayout,
    getActiveMeterAtMeasure,
    hasMeterChangeAtMeasure,
    hideInitialMeter,
    hideMeasureNumbers,
    insertSlicePageBreaks,
    insertSystemBreaks,
    measureSvgWidth,
    normalizeMei,
    parseKeySigFifths,
    parseSvgViewBox,
    readSvgMeasureWidths,
    readSvgRowStarts,
    sanitizeSvg,
    scaleLyricOption,
    svgFitsWidth
} from "../../../../../../public/assets/sheet-music/mei.mjs"

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

    it("extracts title, composer, lyricist and copyright from meiHead", () => {
        const mei = `<mei><meiHead><fileDesc><titleStmt><title>Abide With Me</title><respStmt><persName role="composer">William H. Monk</persName><persName role="lyricist">Henry F. Lyte</persName></respStmt></titleStmt><pubStmt><availability><distributor>Public Domain &amp; Free</distributor></availability></pubStmt></fileDesc></meiHead></mei>`
        expect(extractHeaderMetadata(mei)).toEqual({
            title: "Abide With Me",
            composer: "William H. Monk",
            lyricist: "Henry F. Lyte",
            copyright: "Public Domain & Free"
        })
        expect(extractHeaderMetadata("<mei><music/></mei>")).toEqual({
            title: "",
            composer: "",
            lyricist: "",
            copyright: ""
        })
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

    it("hides meter attributes and meterSig only on the initial scoreDef while keeping the meter", () => {
        const mei = '<mei><scoreDef keysig="2f" meter.count="4" meter.unit="4" meter.sym="common"><staffGrp><staffDef n="1" meter.count="4" meter.unit="4"><clef shape="G" line="2"/><meterSig count="4" unit="4"/></staffDef></staffGrp></scoreDef><section><scoreDef meter.count="3" meter.unit="4"><staffGrp><staffDef n="1"><meterSig count="3" unit="4"/></staffDef></staffGrp></scoreDef></section></mei>'
        const hidden = hideInitialMeter(mei)

        expect(hidden).toContain('<scoreDef keysig="2f" meter.count="4" meter.unit="4" meter.sym="common" meter.visible="false">')
        expect(hidden).toContain('<staffDef n="1" meter.count="4" meter.unit="4" meter.visible="false">')
        expect(hidden).toContain('<meterSig count="4" unit="4" visible="false"/>')
        expect(hidden).toContain('<scoreDef meter.count="3" meter.unit="4">')
        expect(hidden).toContain('<meterSig count="3" unit="4"/>')
    })

    it("detects when the time signature changes right before a target measure", () => {
        const mei = '<mei><scoreDef><staffGrp><staffDef n="1"><meterSig count="4" unit="4"/></staffDef></staffGrp></scoreDef><section>' + '<measure n="1"/><measure n="2"/>' + '<scoreDef><keySig sig="2s"/></scoreDef><measure n="3"/>' + '<scoreDef><meterSig count="3" unit="4"/></scoreDef><measure n="4"/>' + '<measure n="5"/>' + '<scoreDef meter.count="6" meter.unit="8"/><measure n="6"/>' + '<scoreDef meter.count="6" meter.unit="8"/><measure n="7"/>' + "</section></mei>"

        expect(hasMeterChangeAtMeasure(mei, 1)).toBe(false)
        expect(hasMeterChangeAtMeasure(mei, 2)).toBe(false)
        expect(hasMeterChangeAtMeasure(mei, 3)).toBe(false)
        expect(hasMeterChangeAtMeasure(mei, 4)).toBe(true)
        expect(hasMeterChangeAtMeasure(mei, 5)).toBe(false)
        expect(hasMeterChangeAtMeasure(mei, 6)).toBe(true)
        expect(hasMeterChangeAtMeasure(mei, 7)).toBe(false)

        expect(getActiveMeterAtMeasure(mei, 1)).toEqual({ count: "4", unit: "4", sym: null })
        expect(getActiveMeterAtMeasure(mei, 3)).toEqual({ count: "4", unit: "4", sym: null })
        expect(getActiveMeterAtMeasure(mei, 4)).toEqual({ count: "3", unit: "4", sym: null })
        expect(getActiveMeterAtMeasure(mei, 5)).toEqual({ count: "3", unit: "4", sym: null })
        expect(getActiveMeterAtMeasure(mei, 7)).toEqual({ count: "6", unit: "8", sym: null })
    })

    it("replaces the initial meter on scoreDef, staffDef and meterSig and drops stale sym attributes", () => {
        const slice = '<mei><scoreDef meter.count="4" meter.unit="4" meter.sym="common"><staffGrp><staffDef n="1" meter.count="4" meter.unit="4"><meterSig count="4" unit="4" sym="common"/></staffDef></staffGrp></scoreDef><section><scoreDef><meterSig count="2" unit="4"/></scoreDef></section></mei>'
        const updated = applyInitialMeter(slice, { count: "6", unit: "8", sym: null })

        expect(updated).toContain('<scoreDef meter.count="6" meter.unit="8">')
        expect(updated).toContain('<staffDef n="1" meter.count="6" meter.unit="8">')
        expect(updated).toContain('<meterSig count="6" unit="8"/>')
        expect(updated).toContain('<scoreDef><meterSig count="2" unit="4"/></scoreDef>')
    })

    it("hides measure numbers on scoreDef and removes explicit mNum elements", () => {
        const mei = '<mei><scoreDef keysig="0"><staffGrp><staffDef n="1"/></staffGrp></scoreDef><section><measure n="13"><mNum>13</mNum><staff n="1"/></measure><scoreDef mnum.visible="true"/><measure n="14"><mNum /></measure></section></mei>'
        const hidden = hideMeasureNumbers(mei)

        expect(hidden).toContain('<scoreDef keysig="0" mnum.visible="false">')
        expect(hidden).toContain('<scoreDef mnum.visible="false"/>')
        expect(hidden).not.toContain("<mNum")
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

        // With a left margin of 10 and a right margin of 30 the staff may be 3600 wide. A note 100 past its end does not fit,
        // which a check that takes both margins as 10 would miss
        const unevenSvg = (noteX: number) => `<svg viewBox="0 0 400 280"><svg class="definition-scale" viewBox="0 0 4000 2800"><g class="page-margin" transform="translate(100, 100)"><g class="staff"><path d="M0 540 L3600 540"/><g class="note"><use transform="translate(${noteX}, 1170)"/></g></g></g></svg></svg>`
        expect(svgFitsWidth(unevenSvg(3500), 30)).toBe(true)
        expect(svgFitsWidth(unevenSvg(3700), 30)).toBe(false)
        expect(svgFitsWidth(unevenSvg(3700))).toBe(true)
        expect(measureSvgWidth(unevenSvg(3500), 30).neededWidth).toBe(400)
        expect(measureSvgWidth(unevenSvg(3500)).neededWidth).toBe(380)
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

    it("extracts key signatures from scoreDef, staffDef and keySig elements", () => {
        expect(parseKeySigFifths("0")).toBe(0)
        expect(parseKeySigFifths("2s")).toBe(2)
        expect(parseKeySigFifths("3f")).toBe(-3)
        expect(parseKeySigFifths("mixed")).toBeNull()

        const mei = '<mei><scoreDef keysig="1s"><staffGrp><staffDef n="1" key.sig="2f"><keySig sig="3f"/></staffDef></staffGrp></scoreDef><section><scoreDef key.sig="0"/></section></mei>'
        expect(extractKeySignatures(mei)).toEqual([1, -2, -3, 0])
    })

    it("picks transpose intervals that minimize max accidentals across key changes and stay consistent at +/-6", () => {
        const gToEb = '<mei><scoreDef keysig="1s"/><section><measure n="1"/><scoreDef keysig="3f"/><measure n="2"/></section></mei>'
        // -m2 (+5 fifths) turns G (1s) -> F# (6s) and Eb (3f) -> D (2s), max 6, vs -A1 (-7) giving 6f and 10f
        expect(chooseTransposeInterval(gToEb, -1)).toBe("-m2")
        // +1: m2 (-5) gives Ab (4f) -> Fb (8f), A1 (+7) gives G# (8s) -> E (4s); both max 8, first key 4 < 8 picks m2
        expect(chooseTransposeInterval(gToEb, 1)).toBe("m2")

        // Eb (3f) up 3: m3 (-3 -> 6f Gb) vs A2 (+9 -> 6s F#); tie on max and first key picks first column m3
        const eb = '<mei><scoreDef keysig="3f"/></mei>'
        expect(chooseTransposeInterval(eb, 3)).toBe("m3")
        expect(chooseTransposeInterval(eb, -9)).toBe("-M6")

        // C (0) at +6 and -6 both choose the flatward 6-accidental spelling (d5 and -A4)
        const cMajor = '<mei><scoreDef keysig="0"/></mei>'
        expect(chooseTransposeInterval(cMajor, 6)).toBe("d5")
        expect(chooseTransposeInterval(cMajor, -6)).toBe("-A4")
        expect(chooseTransposeInterval("<mei><section/></mei>", 2)).toBe("M2")
        expect(chooseTransposeInterval(cMajor, 0)).toBe("")
        expect(chooseTransposeInterval(cMajor, 12)).toBe("")
    })

    it("scales lyric spacing options linearly from 100 to 150 and clamps outside the range", () => {
        expect(scaleLyricOption(100, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(125, 1.2, 3.2)).toBe(2.2)
        expect(scaleLyricOption(150, 1.2, 3.2)).toBe(3.2)
        expect(scaleLyricOption(175, 1.2, 3.2)).toBe(3.2)
        expect(scaleLyricOption(99, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(50, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(0, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(-25, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(250, 1.2, 3.2)).toBe(3.2)
        expect(scaleLyricOption(Number.NaN, 1.2, 3.2)).toBe(1.2)
        expect(scaleLyricOption(undefined, 1.2, 3.2)).toBe(1.2)

        expect(scaleLyricOption(100, 2, 6)).toBe(2)
        expect(scaleLyricOption(125, 2, 6)).toBe(4)
        expect(scaleLyricOption(150, 2, 6)).toBe(6)
        expect(scaleLyricOption(175, 2, 6)).toBe(6)
    })

    it("chooses row starts that minimize the widest row, break ties by widest narrowest row, then earliest break", () => {
        const plus = (widths: number[], add: number) => widths.map((w) => w + add)

        expect(chooseRowStarts([677, 283, 507, 178, 421], plus([677, 283, 507, 178, 421], 130), 2)).toEqual([3])
        expect(chooseRowStarts([340, 319, 410, 346, 353], plus([340, 319, 410, 346, 353], 130), 2)).toEqual([4])
        expect(chooseRowStarts([100, 100, 100, 100], [100, 100, 100, 100], 2)).toEqual([3])
        expect(chooseRowStarts([100, 100, 100], [100, 100, 100], 2)).toEqual([2])
        expect(chooseRowStarts([100, 100, 100, 100], [100, 100, 100, 100], 1)).toEqual([])
        expect(chooseRowStarts([100, 200, 300], [100, 200, 300], 5)).toEqual([2, 3])
        // Tie on widest row (120) breaks by maximizing the narrowest row (30 over 20)
        expect(chooseRowStarts([10, 10, 10, 30], [20, 80, 100, 120], 3)).toEqual([3, 4])
    })

    it("reads bar widths and row starts from an SVG", () => {
        const svg =
            `<svg viewBox="0 0 1000 500"><g class="page-margin">` +
            `<g class="system">` +
            `<g class="measure"><g class="staff"><path d="M0 100 L300 100"/><path d="M0 120 L300 120"/></g></g>` +
            `<g class="measure"><g class="staff"><path d="M300 100 L550 100"/></g></g>` +
            `</g>` +
            `<g class="system">` +
            `<g class="measure"><g class="staff"><path d="M0 300 L420 300"/></g></g>` +
            `<g class="measure"><g class="staff"><path d="M420 300 L700 300"/></g></g>` +
            `<g class="measure"><g class="staff"><path d="M700 300 L950 300"/></g></g>` +
            `</g>` +
            `</g></svg>`

        expect(readSvgMeasureWidths(svg)).toEqual([300, 250, 420, 280, 250])
        expect(readSvgRowStarts(svg)).toEqual([3])
        expect(readSvgRowStarts('<svg><g class="system"><g class="measure"/></g></svg>')).toEqual([])
    })

    it("strips existing system and page breaks and inserts sb tags before chosen measures", () => {
        const plain = '<mei><section><measure n="1"><staff/></measure><measure n="2"><staff/></measure><measure n="3"><staff/></measure></section></mei>'
        const withOldBreaks = '<mei><section><pb/><measure n="1"><staff/></measure><sb n="1"/><measure n="2"><staff/></measure><pb n="2"></pb><sb></sb><measure n="3"><staff/></measure></section></mei>'

        const expected = '<mei><section><measure n="1"><staff/></measure><measure n="2"><staff/></measure><sb/><measure n="3"><staff/></measure></section></mei>'
        expect(insertSystemBreaks(plain, [3])).toBe(expected)
        expect(insertSystemBreaks(withOldBreaks, [3])).toBe(expected)
        expect(insertSystemBreaks(withOldBreaks, [1, 2, 3])).toBe('<mei><section><measure n="1"><staff/></measure><sb/><measure n="2"><staff/></measure><sb/><measure n="3"><staff/></measure></section></mei>')
    })
})
