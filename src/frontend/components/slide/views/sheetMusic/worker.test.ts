import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import abcjs from "abcjs"
import { beforeAll, describe, expect, it } from "vitest"
import { parseSvgViewBox, readSvgRowStarts, svgFitsWidth } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { convertAndCheckAbc } from "./abcToMei"
import { calculatePageWidth, getItemRatioFromStyle } from "./helpers"
import { filterMei, getMeasureNumbers, summarizeMei } from "./meiParts"
import { resolveMeasureRange, resolvePartsSelection } from "./parts"

const verovioModulePath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio-module.mjs", import.meta.url))
const verovioPath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio.mjs", import.meta.url))
const workerModuleHref = new URL("../../../../../../public/assets/sheet-music/worker.mjs", import.meta.url).href
const hasVerovio = existsSync(verovioModulePath) && existsSync(verovioPath)

const SAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Short &amp; Sweet</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

const ONE_MEASURE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

function hasVisibleMeterSig(svg: string): boolean {
    const matches = svg.match(/<g\b[^>]*class="[^"]*\bmeterSig\b[^"]*"[^>]*>/g) || []
    return matches.some((tag) => !tag.includes('visibility="hidden"'))
}

function getDistinctVerseYs(svg: string): number[] {
    const ys = new Set<number>()
    const pattern = /class="verse"[\s\S]*?<text[^>]*y="(\d+)"/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(svg)) !== null) {
        ys.add(Number(match[1]))
    }
    return Array.from(ys).sort((a, b) => a - b)
}

function getFilteredLogLines(rawLog: string): string[] {
    return rawLog
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.includes("No header"))
}

describe.skipIf(!hasVerovio)("sheet music worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    let handleMessage: (message: Record<string, unknown>) => Promise<any>
    let getLastRenderLog: () => string
    let getLastRenderLayouts: () => number
    let getLyricRenderOptions: (lyricSize: unknown, hasGroupSymbol?: boolean) => Record<string, number>

    beforeAll(async () => {
        const mod = await import(/* @vite-ignore */ workerModuleHref)
        handleMessage = mod.handleMessage
        getLastRenderLog = mod.getLastRenderLog
        getLastRenderLayouts = mod.getLastRenderLayouts
        getLyricRenderOptions = mod.getLyricRenderOptions
    })

    it("loads MusicXML into normalized MEI without meiHead and with bar.thru set to false", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        expect(loaded.title).toBe("Short & Sweet")
        expect(loaded.composer).toBe("")
        expect(loaded.lyricist).toBe("")
        expect(loaded.copyright).toBe("")
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")
    })

    it("returns composer, lyricist and copyright from MusicXML metadata when present", async () => {
        const withMetaXml = SAMPLE_MUSICXML.replace("<work><work-title>Short &amp; Sweet</work-title></work>", '<work><work-title>Abide With Me</work-title></work><identification><creator type="composer">William H. Monk</creator><creator type="lyricist">Henry F. Lyte</creator><rights>Public domain &amp; free</rights></identification>')

        const loaded = await handleMessage({ type: "load", text: withMetaXml })
        expect(loaded.title).toBe("Abide With Me")
        expect(loaded.composer).toBe("William H. Monk")
        expect(loaded.lyricist).toBe("Henry F. Lyte")
        expect(loaded.copyright).toBe("Public domain & free")
    })

    it("renders MEI to SVG with the reply shape engine.ts reads and fits within a requested box ratio", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const basic = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 1840 })
        expect(Object.keys(basic).sort()).toEqual(["fits", "pageWidth", "pages", "scale", "svg"])
        expect(basic.svg).toContain("<svg")
        expect(basic.pageWidth).toBe(1840)
        expect(basic.scale).toBe(1)
        expect(basic.fits).toBe(true)
        expect(basic.pages).toBe(1)

        const targetRatio = 0.25
        const fitted = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: targetRatio })
        expect(Object.keys(fitted).sort()).toEqual(["fits", "pageWidth", "pages", "scale", "svg"])
        expect(fitted.svg).toContain("<svg")
        expect(fitted.pageWidth).toBeGreaterThanOrEqual(500)
        expect(fitted.scale).toBeCloseTo(Math.min(1, 500 / fitted.pageWidth), 6)
        expect(fitted.fits).toBe(true)
        expect(fitted.pages).toBe(1)

        const vb = parseSvgViewBox(fitted.svg)
        expect(vb).not.toBeNull()
        expect(vb!.height / vb!.width).toBeLessThanOrEqual(targetRatio)
    })

    it("is pure across repeated calls and with a different request in between", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const first = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })
        const second = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })
        await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 270, ratio: 2.0 })
        const third = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })

        expect(second.pageWidth).toBe(first.pageWidth)
        expect(second.svg).toBe(first.svg)
        expect(third.pageWidth).toBe(first.pageWidth)
        expect(third.svg).toBe(first.svg)
    })

    it("gives the same canonical pageWidth for two different preferred widths that both overflow the same box", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const narrow = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 400, ratio: 0.2 })
        const wider = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 700, ratio: 0.2 })

        expect(narrow.fits).toBe(true)
        expect(wider.fits).toBe(true)
        expect(narrow.pageWidth).toBe(wider.pageWidth)
        expect(narrow.svg).toBe(wider.svg)
    })

    it("widens a one-measure score in a narrow 100 by 2000 box so all notes stay inside the page", async () => {
        const loaded = await handleMessage({ type: "load", text: ONE_MEASURE_MUSICXML })

        const rawNarrow = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 100 })
        expect(svgFitsWidth(rawNarrow.svg)).toBe(false)

        const preferredWidth = calculatePageWidth(100, 200)
        const ratio = getItemRatioFromStyle("width: 100px; height: 2000px;")
        const fitted = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: preferredWidth, ratio })

        expect(fitted.fits).toBe(true)
        expect(fitted.pageWidth).toBeGreaterThan(preferredWidth)
        expect(svgFitsWidth(fitted.svg)).toBe(true)
    })

    it("strips external url and CSS-escaped url attributes from rendered SVG", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const literalMei = loaded.mei.replace("<note ", '<note color="url(https://example.com/x.svg#p)" ')
        const literalRendered = await handleMessage({ type: "render", mei: literalMei, pageWidth: 1840 })
        expect(literalRendered.svg).not.toContain("example.com")

        const hexEscapedMei = loaded.mei.replace("<note ", '<note color="u\\72l(https://example.com/x.svg#p)" ')
        const hexRendered = await handleMessage({ type: "render", mei: hexEscapedMei, pageWidth: 1840 })
        expect(hexRendered.svg).not.toContain("example.com")

        const slashEscapedMei = loaded.mei.replace("<note ", '<note color="u\\rl(https://example.com/x.svg#p)" ')
        const slashRendered = await handleMessage({ type: "render", mei: slashEscapedMei, pageWidth: 1840 })
        expect(slashRendered.svg).not.toContain("example.com")
    })

    it("returns load_failed for non-music text and keeps answering valid requests afterward", async () => {
        let caught: any = null
        try {
            await handleMessage({ type: "load", text: "this is definitely not music xml" })
        } catch (err) {
            caught = err
        }

        expect(caught).toBeInstanceOf(Error)
        expect(caught.code).toBe("load_failed")

        const recovered = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })
        expect(recovered.measures).toBe(4)
    })

    it("renders filtered MEI for every parts preset without Verovio warnings, checks verse rows, and keeps refrain words", async () => {
        const abc = [
            "T: Four-Part Hymn",
            "M: 4/4",
            "L: 1/4",
            "K: Bb",
            "%%score (S A) (T B)",
            "V: S",
            "V: A",
            "V: T clef=bass octave=-1",
            "V: B clef=bass octave=-1",
            "[V:S] d e d c | d c B c |",
            "w: 1.~Praise God from whom | all bless-ings flow,",
            "w: 2.~Praise him a-bove, | ye heav'n-ly host,",
            "[V:A] B G F F | F F G A |",
            "[V:T] f e d c | B A d c |",
            "[V:B] D C B, F | B, F G F |",
            "[V:S] d e d c | d4 |",
            "w: Yes, Je-sus loves | me!",
            "[V:A] B G F F | F4 |",
            "[V:T] f e d c | B4 |",
            "[V:B] D C B, F | B,4 |"
        ].join("\n")

        const fullMei = convertAndCheckAbc(abc, abcjs.parseOnly).mei
        const summary = summarizeMei(fullMei)
        expect(summary.measures).toBe(4)

        const allRendered = await handleMessage({ type: "render", mei: fullMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getDistinctVerseYs(allRendered.svg)).toHaveLength(2)

        const cases: { preset: "all" | "upper" | "lower" | "melody" | "custom"; custom?: string[]; expectedStavesPerMeasure: number }[] = [
            { preset: "all", expectedStavesPerMeasure: 2 },
            { preset: "upper", expectedStavesPerMeasure: 1 },
            { preset: "lower", expectedStavesPerMeasure: 1 },
            { preset: "melody", expectedStavesPerMeasure: 1 },
            { preset: "custom", custom: ["1.1", "2.1"], expectedStavesPerMeasure: 2 },
            { preset: "custom", custom: ["2.2"], expectedStavesPerMeasure: 1 }
        ]

        for (const testCase of cases) {
            const resolved = resolvePartsSelection(testCase.preset, testCase.custom, summary)
            const filtered = filterMei(fullMei, { parts: resolved.parts, verses: [2], highestNoteOnly: resolved.highestNoteOnly })
            const rendered = await handleMessage({ type: "render", mei: filtered, pageWidth: 1840 })

            expect(rendered.svg).toContain("<svg")
            expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
            const staffGroups = rendered.svg.match(/class="staff"/g) || []
            expect(staffGroups).toHaveLength(summary.measures * testCase.expectedStavesPerMeasure)
        }

        // Verse 2 alone has 1 verse row (same height as verse 1, no blank row above) and keeps the refrain words
        const verse1Mei = filterMei(fullMei, { parts: "all", verses: [1] })
        const verse2Mei = filterMei(fullMei, { parts: "all", verses: [2] })
        const verse1Rendered = await handleMessage({ type: "render", mei: verse1Mei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        const verse2Rendered = await handleMessage({ type: "render", mei: verse2Mei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])

        expect(getDistinctVerseYs(verse1Rendered.svg)).toHaveLength(1)
        expect(getDistinctVerseYs(verse2Rendered.svg)).toHaveLength(1)
        expect(parseSvgViewBox(verse2Rendered.svg)!.height).toBe(parseSvgViewBox(verse1Rendered.svg)!.height)
        expect(verse2Rendered.svg).toContain("heav'n")
        expect(verse2Rendered.svg).toContain("Yes,")
        expect(verse2Rendered.svg).toContain("me!")
        expect(verse2Rendered.svg).not.toContain("bless")

        // Nested two-staff choir + two-staff piano renders cleanly when emptying one group or leaving one staff in a group
        const note = (step: string, oct: number, staff: number) => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>4</duration><voice>${staff}</voice><type>whole</type><staff>${staff}</staff></note>`
        const part = (id: string, top: string, bottom: string) => `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${note(top, 4, 1)}<backup><duration>4</duration></backup>${note(bottom, 3, 2)}</measure></part>`
        const choirPianoXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Choir</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>${part("P1", "C", "E")}${part("P2", "G", "C")}</score-partwise>`
        const loadedChoirPiano = await handleMessage({ type: "load", text: choirPianoXml })

        for (const custom of [
            ["1.1", "2.2"],
            ["3.1", "4.2"],
            ["1.1", "2.2", "3.1"]
        ]) {
            const filtered = filterMei(loadedChoirPiano.mei, { parts: custom, verses: "all" })
            const rendered = await handleMessage({ type: "render", mei: filtered, pageWidth: 1840 })
            expect(rendered.svg).toContain("<svg")
            expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
            expect(rendered.svg.match(/class="staff"/g) || []).toHaveLength(custom.length)
            expect(rendered.svg.match(/class="grpSym"/g) || []).toHaveLength(1)
        }

        // Melody preset on a two-staff chorded hymn collapses chords to the top note on staff 1
        const chordedAbc = ["M: 4/4", "L: 1/4", "K: C", "%%score S B", "V: S", "V: B clef=bass", "[V:S] [ce]2 [df]2 | [eg]4 |", "w: Joy to world", "[V:B] [C,G,]2 [D,A,]2 | [C,G,]4 |"].join("\n")
        const chordedMei = convertAndCheckAbc(chordedAbc, abcjs.parseOnly).mei
        const chordedSummary = summarizeMei(chordedMei)
        const melodyResolved = resolvePartsSelection("melody", undefined, chordedSummary)
        expect(melodyResolved.highestNoteOnly).toBe(true)

        const melodyMei = filterMei(chordedMei, { parts: melodyResolved.parts, verses: "all", highestNoteOnly: true })
        const melodyRendered = await handleMessage({ type: "render", mei: melodyMei, pageWidth: 1840 })
        expect(melodyRendered.svg).toContain("<svg")
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(melodyRendered.svg.match(/class="staff"/g) || []).toHaveLength(2)
    })

    it("slices a 16-bar hymn with hidden meter on middle slices, visible meter from bar 1, and no measure numbers drawn", async () => {
        const makeBar = (n: number) =>
            `<measure n="${n}"><staff n="1"><layer n="1"><note xml:id="s${n}" dur.ppq="1" dur="1" oct="5" pname="d" stem.dir="up" /></layer><layer n="2"><note xml:id="a${n}" dur.ppq="1" dur="1" oct="4" pname="f" stem.dir="down" /></layer></staff><staff n="2"><layer n="5"><note xml:id="t${n}" dur.ppq="1" dur="1" oct="3" pname="b" stem.dir="up" accid.ges="f" /></layer><layer n="6"><note xml:id="b${n}" dur.ppq="1" dur="1" oct="2" pname="b" stem.dir="down" accid.ges="f" /></layer></staff>${n === 4 ? `<tie startid="#s4" endid="#s5" />` : ""}${n === 8 ? `<tie startid="#s8" endid="#s9" />` : ""}</measure>`
        const bars = Array.from({ length: 16 }, (_, i) => makeBar(i + 1)).join("")
        const hymn16Mei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="6.0-dev"><music><body><mdiv><score><scoreDef><staffGrp bar.thru="false"><grpSym symbol="brace" /><staffDef n="1" lines="5" ppq="1"><clef shape="G" line="2" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef><staffDef n="2" lines="5" ppq="1"><clef shape="F" line="4" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef></staffGrp></scoreDef><section>${bars}</section></score></mdiv></body></music></mei>`

        // Middle slice (5-8): 4 measures, keeps key, clefs and hidden meter, no measure numbers in SVG
        const middle = await handleMessage({ type: "slice", mei: hymn16Mei, first: 5, last: 8 })
        expect(middle.measures).toBe(4)
        expect(middle.mei).toContain('sig="2f"')
        expect(middle.mei).toContain('shape="G"')
        expect(middle.mei).toContain('shape="F"')
        expect(middle.mei).toContain('visible="false"')
        expect(middle.mei).not.toContain('mnum.visible="false"')

        const middleRendered = await handleMessage({ type: "render", mei: middle.mei, pageWidth: 1840 })
        expect(middleRendered.svg).toContain("<svg")
        expect(middleRendered.svg).toContain('class="clef"')
        expect(middleRendered.svg).toContain('class="keySig"')
        expect(hasVisibleMeterSig(middleRendered.svg)).toBe(false)
        expect(middleRendered.svg).not.toMatch(/class="[^"]*\bmNum\b[^"]*"/)
        expect(middleRendered.svg.match(/class="staff"/g) || []).toHaveLength(8)

        // Slice starting at bar 13 and a narrow multi-line render both draw no measure numbers
        const late = await handleMessage({ type: "slice", mei: hymn16Mei, first: 13, last: 16 })
        const lateRendered = await handleMessage({ type: "render", mei: late.mei, pageWidth: 1840 })
        expect(lateRendered.svg).not.toMatch(/class="[^"]*\bmNum\b[^"]*"/)

        const multiLine = await handleMessage({ type: "render", mei: hymn16Mei, pageWidth: 700 })
        expect((multiLine.svg.match(/class="system"/g) || []).length).toBeGreaterThan(1)
        expect(multiLine.svg).not.toMatch(/class="[^"]*\bmNum\b[^"]*"/)

        // Slice from measure 1 keeps the time signature visible
        const opening = await handleMessage({ type: "slice", mei: hymn16Mei, first: 1, last: 4 })
        expect(opening.measures).toBe(4)
        const openingRendered = await handleMessage({ type: "render", mei: opening.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(openingRendered.svg)).toBe(true)
        expect(openingRendered.svg.match(/class="staff"/g) || []).toHaveLength(8)
    })

    it("keeps an earlier key signature change in force and hides the unchanged meter for a later slice", async () => {
        const keyChangeMei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="1s" meter.count="4" meter.unit="4"><staffGrp symbol="brace" bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2" /><staffDef n="2" lines="5" clef.shape="F" clef.line="4" /></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note dur="1" pname="g" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="g" oct="3" /></layer></staff></measure><measure n="2"><staff n="1"><layer n="1"><note dur="1" pname="a" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="a" oct="3" /></layer></staff></measure><scoreDef keysig="3f" /><measure n="3"><staff n="1"><layer n="1"><note dur="1" pname="e" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="e" oct="3" /></layer></staff></measure><measure n="4"><staff n="1"><layer n="1"><note dur="1" pname="g" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="g" oct="3" /></layer></staff></measure></section></score></mdiv></body></music></mei>`

        const laterSlice = await handleMessage({ type: "slice", mei: keyChangeMei, first: 4, last: 4 })
        expect(laterSlice.measures).toBe(1)
        expect(laterSlice.mei).toContain('keysig="3f"')
        expect(laterSlice.mei).toContain('meter.visible="false"')

        const rendered = await handleMessage({ type: "render", mei: laterSlice.mei, pageWidth: 1840 })
        expect(rendered.svg).toContain("<svg")
        expect(rendered.svg).toContain('class="keySig"')
        expect(hasVisibleMeterSig(rendered.svg)).toBe(false)
    })

    it("slices by printed bar numbers on a pickup-bar file and keeps a time signature change at the slice's first bar visible", async () => {
        const makeNote = (step: string, oct: number, dur: number, type: string, extra = "") => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`
        const xml =
            `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">` +
            `<measure number="0" implicit="yes"><attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${makeNote("C", 5, 1, "quarter")}</measure>` +
            `<measure number="1">${makeNote("F", 4, 4, "whole")}</measure>` +
            `<measure number="2">${makeNote("G", 4, 4, "whole")}</measure>` +
            `<measure number="3">${makeNote("A", 4, 4, "whole")}</measure>` +
            `<measure number="4">${makeNote("B", 4, 4, "whole")}</measure>` +
            `<measure number="5"><attributes><key><fifths>2</fifths></key></attributes>${makeNote("E", 5, 4, "whole")}</measure>` +
            `<measure number="6"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${makeNote("D", 5, 3, "half", "<dot/>")}</measure>` +
            `<measure number="7">${makeNote("C", 5, 3, "half", "<dot/>")}</measure>` +
            `</part></score-partwise>`

        const loaded = await handleMessage({ type: "load", text: xml })
        const numbers = getMeasureNumbers(loaded.mei)
        expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

        // Typing "2-3" resolves to positions 3..4 and slices bars n="2" and n="3"
        const range23 = resolveMeasureRange("2-3", numbers)!
        expect(range23).toEqual({ first: 3, last: 4, firstNumber: 2, lastNumber: 3 })
        const slice23 = await handleMessage({ type: "slice", mei: loaded.mei, first: range23.first, last: range23.last })
        expect(getMeasureNumbers(slice23.mei)).toEqual([2, 3])
        const rendered23 = await handleMessage({ type: "render", mei: slice23.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(rendered23.svg)).toBe(false)

        // Slicing from bar 5 (key change only, meter unchanged) hides the meter
        const range5 = resolveMeasureRange("5", numbers)!
        const slice5 = await handleMessage({ type: "slice", mei: loaded.mei, first: range5.first, last: range5.last })
        const rendered5 = await handleMessage({ type: "render", mei: slice5.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(rendered5.svg)).toBe(false)

        // Slicing from bar 6 (4/4 -> 3/4 time change right at bar 6) keeps 3/4 visible
        const range67 = resolveMeasureRange("6-7", numbers)!
        const slice67 = await handleMessage({ type: "slice", mei: loaded.mei, first: range67.first, last: range67.last })
        expect(getMeasureNumbers(slice67.mei)).toEqual([6, 7])
        const rendered67 = await handleMessage({ type: "render", mei: slice67.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(rendered67.svg)).toBe(true)
    })

    it("keeps a 6/8 tstamp chord symbol aligned on its note in a slice from bar 2", async () => {
        const makeBar = (n: number) => `<measure n="${n}"><staff n="1"><layer n="1"><note xml:id="a${n}" dur="4" dots="1" oct="4" pname="c"/><note xml:id="b${n}" dur="4" dots="1" oct="4" pname="g"/></layer></staff><harm staff="1" tstamp="4">G${n}</harm><dynam staff="1" tstamp="4">p</dynam></measure>`
        const mei68 = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="0" meter.count="6" meter.unit="8"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>${makeBar(1)}${makeBar(2)}${makeBar(3)}</section></score></mdiv></body></music></mei>`

        const sliced = await handleMessage({ type: "slice", mei: mei68, first: 2, last: 2 })
        expect(sliced.mei).toContain('meter.count="6"')
        expect(sliced.mei).toContain('meter.unit="8"')
        expect(sliced.mei).toContain('meter.visible="false"')

        const rendered = await handleMessage({ type: "render", mei: sliced.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(rendered.svg)).toBe(false)
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])

        const noteheadXs = [...rendered.svg.matchAll(/class="notehead"[^>]*>\s*<use[^>]*transform="translate\((\d+)/g)].map((m) => Number(m[1]))
        const harmXs = [...rendered.svg.matchAll(/class="harm"[\s\S]*?<text[^>]*x="(\d+)"/g)].map((m) => Number(m[1]))
        expect(noteheadXs).toHaveLength(2)
        expect(harmXs).toHaveLength(1)
        expect(Math.abs(harmXs[0] - noteheadXs[1])).toBeLessThan(100)
    })

    it("stores the active 6/8 meter after a 4/4 to 6/8 change when sliced from bar 3 and keeps tstamp marks on their note", async () => {
        const dottedQuarter = (step: string) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type><dot/></note>`
        const xml =
            `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">` +
            `<measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>whole</type></note></measure>` +
            `<measure number="2"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>${dottedQuarter("C")}${dottedQuarter("G")}</measure>` +
            `<measure number="3">${dottedQuarter("C")}${dottedQuarter("G")}</measure>` +
            `</part></score-partwise>`

        const loaded = await handleMessage({ type: "load", text: xml })
        let barCount = 0
        const meiWithHarm = loaded.mei.replace(/<\/measure>/g, (match: string) => (++barCount === 3 ? `<harm staff="1" tstamp="4">G3</harm>${match}` : match))

        const sliceFrom3 = await handleMessage({ type: "slice", mei: meiWithHarm, first: 3, last: 3 })
        expect(sliceFrom3.mei).toContain('count="6"')
        expect(sliceFrom3.mei).toContain('unit="8"')
        expect(sliceFrom3.mei).toContain('visible="false"')
        expect(sliceFrom3.mei).not.toContain('count="4"')

        const rendered = await handleMessage({ type: "render", mei: sliceFrom3.mei, pageWidth: 1840 })
        expect(hasVisibleMeterSig(rendered.svg)).toBe(false)
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])

        const noteheadXs = [...rendered.svg.matchAll(/class="notehead"[^>]*>\s*<use[^>]*transform="translate\((\d+)/g)].map((m) => Number(m[1]))
        const harmXs = [...rendered.svg.matchAll(/class="harm"[\s\S]*?<text[^>]*x="(\d+)"/g)].map((m) => Number(m[1]))
        expect(noteheadXs).toHaveLength(2)
        expect(harmXs).toHaveLength(1)
        expect(Math.abs(harmXs[0] - noteheadXs[1])).toBeLessThan(100)
    })

    it("draws a measure number on every bar of a 16-bar score when showMeasureNumbers is true and none by default", async () => {
        const bars = Array.from({ length: 16 }, (_, i) => `<measure n="${i + 1}"><staff n="1"><layer n="1"><note dur="1" oct="4" pname="c" /></layer></staff></measure>`).join("")
        const sixteenBarsMei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="0" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2" /></staffGrp></scoreDef><section>${bars}</section></score></mdiv></body></music></mei>`

        const defaultRender = await handleMessage({ type: "render", mei: sixteenBarsMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(defaultRender.svg).not.toMatch(/class="[^"]*\bmNum\b[^"]*"/)

        const numberedRender = await handleMessage({ type: "render", mei: sixteenBarsMei, pageWidth: 1840, showMeasureNumbers: true })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        const drawnNumbers = [...numberedRender.svg.matchAll(/<g[^>]*class="[^"]*\bmNum\b[^"]*"[^>]*>[\s\S]*?<\/g>/g)].map((match) => match[0].replace(/<[^>]+>/g, "").trim())
        expect(drawnNumbers).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1)))
    })

    it("fills the full width on a one-row drawing and spreads the bars of a two-row drawing evenly (F1)", async () => {
        const makeBar = (n: number) => `<measure n="${n}"><staff n="1"><layer n="1"><note dur="4" oct="4" pname="c"/><note dur="4" oct="4" pname="d"/><note dur="4" oct="4" pname="e"/><note dur="4" oct="4" pname="f"/></layer></staff></measure>`
        const makeMei = (barCount: number) => `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="0" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>${Array.from({ length: barCount }, (_, i) => makeBar(i + 1)).join("")}</section></score></mdiv></body></music></mei>`

        const getLastSystemBarlineRight = (svg: string) => {
            const systems = svg.split(/<g\b[^>]*\bclass="[^"]*\bsystem\b[^"]*"[^>]*>/)
            const lastSystem = systems[systems.length - 1]
            const innerVb = svg.match(/class="definition-scale"[^>]*viewBox="0 0 (\d+)/)
            const marginMatch = svg.match(/class="page-margin"[^>]*transform="translate\((\d+)/)
            const innerWidth = innerVb ? Number(innerVb[1]) : 0
            const marginX = marginMatch ? Number(marginMatch[1]) : 0
            const usableRight = innerWidth - 2 * marginX
            let maxX = 0
            for (const match of lastSystem.matchAll(/d="M(\d+)\s+\d+\s+L(\d+)\s+\d+"/g)) {
                maxX = Math.max(maxX, Number(match[1]), Number(match[2]))
            }
            return { systemCount: systems.length - 1, maxX, usableRight }
        }

        // One-row drawing (2 bars at wide pageWidth) fills the full usable width
        const oneRow = await handleMessage({ type: "render", mei: makeMei(2), pageWidth: 1840 })
        const oneRowStats = getLastSystemBarlineRight(oneRow.svg)
        expect(oneRowStats.systemCount).toBe(1)
        expect(oneRowStats.maxX).toBeGreaterThan(oneRowStats.usableRight * 0.95)

        // Two-row drawing (5 bars at width 1200) spreads evenly into 2 and 3 bars and justifies the last row
        const twoRows = await handleMessage({ type: "render", mei: makeMei(5), pageWidth: 1200 })
        const twoRowStats = getLastSystemBarlineRight(twoRows.svg)
        expect(twoRowStats.systemCount).toBe(2)
        expect(readSvgRowStarts(twoRows.svg)).toEqual([3])
        expect(twoRowStats.maxX).toBeGreaterThan(twoRowStats.usableRight * 0.95)
        // The search's drawing, the one with a short last row, two that measure the bars, two that measure the rows,
        // and the even rows
        expect(getLastRenderLayouts()).toBe(7)

        // Fitted one-row drawing fills full width in 1 layout
        const fittedOneRow = await handleMessage({ type: "render", mei: makeMei(2), pageWidth: 1840, ratio: 0.4 })
        const fittedOneRowStats = getLastSystemBarlineRight(fittedOneRow.svg)
        expect(fittedOneRowStats.systemCount).toBe(1)
        expect(fittedOneRowStats.maxX).toBeGreaterThan(fittedOneRowStats.usableRight * 0.95)
        expect(getLastRenderLayouts()).toBe(1)

        // Fitted multi-row drawing balances rows once on the chosen layout, not at every search step
        const multiRowMei = makeMei(13)
        const fittedMulti = await handleMessage({ type: "render", mei: multiRowMei, pageWidth: 1200, ratio: 0.4 })
        const fittedMultiLayouts = getLastRenderLayouts()
        const fittedMultiStats = getLastSystemBarlineRight(fittedMulti.svg)
        expect(fittedMulti.fits).toBe(true)
        expect(fittedMultiStats.systemCount).toBeGreaterThan(1)
        expect(fittedMultiStats.maxX).toBeGreaterThan(fittedMultiStats.usableRight * 0.95)
        // the search's drawings and the six of the even rows
        expect(fittedMultiLayouts).toBeLessThanOrEqual(10)

        // Repeating the same fit request or a narrower preferred width reuses the finalized canonical drawing identically
        const repeatedMulti = await handleMessage({ type: "render", mei: multiRowMei, pageWidth: 1200, ratio: 0.4 })
        expect(repeatedMulti.pageWidth).toBe(fittedMulti.pageWidth)
        expect(repeatedMulti.svg).toBe(fittedMulti.svg)
        expect(getLastRenderLayouts()).toBe(1)

        const narrowerMulti = await handleMessage({ type: "render", mei: multiRowMei, pageWidth: 900, ratio: 0.4 })
        expect(narrowerMulti.pageWidth).toBe(fittedMulti.pageWidth)
        expect(narrowerMulti.svg).toBe(fittedMulti.svg)
        expect(getLastRenderLayouts()).toBe(1)
    })

    it("transposes key signature, notes and accidentals in Verovio and resets transpose on subsequent renders", async () => {
        const makeSingleStaffMei = (keysig: string, notes: string) => `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="${keysig}" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1">${notes}</layer></staff></measure></section></score></mdiv></body></music></mei>`

        const getKeyAccidGlyphs = (svg: string): string[] => {
            const keyAccidBlocks = svg.match(/<g[^>]*class="keyAccid"[^>]*>[\s\S]*?<\/g>/g) || []
            return keyAccidBlocks.map((block) => block.match(/href="#(E[0-9A-F]{3})/)?.[1] || "")
        }

        const getNoteheadYs = (svg: string): number[] => [...svg.matchAll(/class="notehead"[^>]*>\s*<use[^>]*transform="translate\(-?\d+,\s*(-?\d+)\)/g)].map((m) => Number(m[1]))

        const getNoteAccidGlyphs = (svg: string): (string | null)[] => {
            const accidBlocks = svg.match(/<g[^>]*class="accid"[^>]*>(?:[\s\S]*?<\/g>)?|<g[^>]*class="accid"[^>]*\/>/g) || []
            return accidBlocks.map((block) => block.match(/href="#(E[0-9A-F]{3})/)?.[1] || null)
        }

        const ebMajorMei = makeSingleStaffMei("3f", '<note dur="4" oct="4" pname="e" accid.ges="f"/><note dur="4" oct="4" pname="g"/><note dur="4" oct="4" pname="b" accid.ges="f"/><note dur="4" oct="5" pname="e" accid.ges="f"/>')
        const fMajorMei = makeSingleStaffMei("1f", '<note dur="4" oct="4" pname="f"/><note dur="4" oct="4" pname="a"/><note dur="4" oct="5" pname="c"/><note dur="4" oct="5" pname="f"/>')

        const ebBefore = await handleMessage({ type: "render", mei: ebMajorMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(ebBefore.svg)).toEqual(["E260", "E260", "E260"])

        const ebUp2 = await handleMessage({ type: "render", mei: ebMajorMei, pageWidth: 1840, transpose: 2 })
        const fDirect = await handleMessage({ type: "render", mei: fMajorMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        // Eb major up 2 semitones gives F major (1 flat, E260) and every notehead sits higher on the staff, matching F4-A4-C5-F5
        expect(getKeyAccidGlyphs(ebUp2.svg)).toEqual(["E260"])
        expect(getNoteheadYs(ebUp2.svg)).toEqual(getNoteheadYs(fDirect.svg))
        expect(getNoteheadYs(ebUp2.svg).every((y, i) => y < getNoteheadYs(ebBefore.svg)[i])).toBe(true)

        // Rendering again without transpose resets the toolkit and matches the pre-transpose SVG identically
        const ebAfter = await handleMessage({ type: "render", mei: ebMajorMei, pageWidth: 1840 })
        expect(ebAfter.svg).toBe(ebBefore.svg)

        // C major down 3 semitones gives A major (3 sharps, E262) and matches A3-B3-C#4-D4
        const cMajorMei = makeSingleStaffMei("0", '<note dur="4" oct="4" pname="c"/><note dur="4" oct="4" pname="d"/><note dur="4" oct="4" pname="e"/><note dur="4" oct="4" pname="f"/>')
        const aMajorMei = makeSingleStaffMei("3s", '<note dur="4" oct="3" pname="a"/><note dur="4" oct="3" pname="b"/><note dur="4" oct="4" pname="c" accid.ges="s"/><note dur="4" oct="4" pname="d"/>')
        const cDown3 = await handleMessage({ type: "render", mei: cMajorMei, pageWidth: 1840, transpose: -3 })
        const aDirect = await handleMessage({ type: "render", mei: aMajorMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(cDown3.svg)).toEqual(["E262", "E262", "E262"])
        expect(getNoteheadYs(cDown3.svg)).toEqual(getNoteheadYs(aDirect.svg))

        // F# in C major transposed up 2 semitones gives D major (2 sharps) with G# (sharp E262 on the G4 position, not Ab)
        const cWithFSharpMei = makeSingleStaffMei("0", '<note dur="4" oct="4" pname="c"/><note dur="4" oct="4" pname="f" accid="s"/><note dur="4" oct="4" pname="g"/><note dur="4" oct="5" pname="c"/>')
        const dWithGSharpMei = makeSingleStaffMei("2s", '<note dur="4" oct="4" pname="d"/><note dur="4" oct="4" pname="g" accid="s"/><note dur="4" oct="4" pname="a"/><note dur="4" oct="5" pname="d"/>')
        const fSharpUp2 = await handleMessage({ type: "render", mei: cWithFSharpMei, pageWidth: 1840, transpose: 2 })
        const gSharpDirect = await handleMessage({ type: "render", mei: dWithGSharpMei, pageWidth: 1840 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(fSharpUp2.svg)).toEqual(["E262", "E262"])
        expect(getNoteheadYs(fSharpUp2.svg)).toEqual(getNoteheadYs(gSharpDirect.svg))
        expect(getNoteAccidGlyphs(fSharpUp2.svg)).toEqual([null, "E262", null, null])

        // Fitted layouts (with ratio) keep distinct canonical memo entries per transpose value
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })
        const fittedOriginal = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25 })
        const fittedUp2 = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: 0.25, transpose: 2 })
        expect(fittedUp2.svg).not.toBe(fittedOriginal.svg)
        expect(getKeyAccidGlyphs(fittedOriginal.svg)).toEqual([])
        expect(getKeyAccidGlyphs(fittedUp2.svg)).toEqual(["E262", "E262"])
    })

    it("chooses clean key spellings for key changes, six-accidental keys, +/-6, minor keys and every semitone -11..11", async () => {
        const getKeySigGlyphGroups = (svg: string): string[][] => {
            const keySigBlocks = svg.match(/<g[^>]*class="keySig"[^>]*>[\s\S]*?(?=<g[^>]*class="(?:meterSig|clef|layer|staff|measure)"|<\/g>\s*<\/g>)/g) || []
            return keySigBlocks.map((block) => [...block.matchAll(/<g[^>]*class="keyAccid"[^>]*>[\s\S]*?href="#(E[0-9A-F]{3})/g)].map((m) => m[1]))
        }

        const getKeyAccidGlyphs = (svg: string): string[] => {
            const keyAccidBlocks = svg.match(/<g[^>]*class="keyAccid"[^>]*>[\s\S]*?<\/g>/g) || []
            return keyAccidBlocks.map((block) => block.match(/href="#(E[0-9A-F]{3})/)?.[1] || "")
        }

        // G major -> Eb major at -1 draws F# major (6 sharps) then D major (2 sharps), with no double flats
        const gToEbMei =
            `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score>` +
            `<scoreDef keysig="1s" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>` +
            `<section><measure n="1"><staff n="1"><layer n="1"><note dur="1" oct="4" pname="g"/></layer></staff></measure>` +
            `<scoreDef keysig="3f"/><measure n="2"><staff n="1"><layer n="1"><note dur="1" oct="4" pname="e" accid.ges="f"/></layer></staff></measure>` +
            `</section></score></mdiv></body></music></mei>`
        const gToEbDown1 = await handleMessage({ type: "render", mei: gToEbMei, pageWidth: 1840, transpose: -1 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        const gToEbGroups = getKeySigGlyphGroups(gToEbDown1.svg)
        expect(gToEbGroups).toEqual([
            ["E262", "E262", "E262", "E262", "E262", "E262"],
            ["E262", "E262"]
        ])
        expect(gToEbDown1.svg).not.toContain("#E264")

        // Eb major at +3 draws Gb major (6 flats), with no double sharps
        const ebMei =
            `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score>` +
            `<scoreDef keysig="3f" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>` +
            `<section><measure n="1"><staff n="1"><layer n="1"><note dur="4" oct="4" pname="e" accid.ges="f"/><note dur="4" oct="4" pname="a"/><note dur="4" oct="4" pname="b" accid.ges="f"/><note dur="4" oct="5" pname="e" accid.ges="f"/></layer></staff></measure></section>` +
            `</score></mdiv></body></music></mei>`
        const ebUp3 = await handleMessage({ type: "render", mei: ebMei, pageWidth: 1840, transpose: 3 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(ebUp3.svg)).toEqual(["E260", "E260", "E260", "E260", "E260", "E260"])
        expect(ebUp3.svg).not.toContain("#E263")

        // C major at +6 and at -6 draw the same key signature (6 flats, Gb)
        const cMei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score>` + `<scoreDef keysig="0" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>` + `<section><measure n="1"><staff n="1"><layer n="1"><note dur="1" oct="4" pname="c"/></layer></staff></measure></section>` + `</score></mdiv></body></music></mei>`
        const cPlus6 = await handleMessage({ type: "render", mei: cMei, pageWidth: 1840, transpose: 6 })
        const cMinus6 = await handleMessage({ type: "render", mei: cMei, pageWidth: 1840, transpose: -6 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(cPlus6.svg)).toEqual(["E260", "E260", "E260", "E260", "E260", "E260"])
        expect(getKeyAccidGlyphs(cMinus6.svg)).toEqual(getKeyAccidGlyphs(cPlus6.svg))

        // Minor key (D minor, 1 flat) up 1 draws Eb minor (6 flats) and up 2 draws E minor (1 sharp)
        const dMinorMei =
            `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score>` +
            `<scoreDef keysig="1f" key.mode="minor" meter.count="4" meter.unit="4"><staffGrp bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>` +
            `<section><measure n="1"><staff n="1"><layer n="1"><note dur="4" oct="4" pname="d"/><note dur="4" oct="4" pname="f"/><note dur="4" oct="4" pname="a"/><note dur="4" oct="5" pname="c" accid="s"/></layer></staff></measure></section>` +
            `</score></mdiv></body></music></mei>`
        const dMinorUp1 = await handleMessage({ type: "render", mei: dMinorMei, pageWidth: 1840, transpose: 1 })
        const dMinorUp2 = await handleMessage({ type: "render", mei: dMinorMei, pageWidth: 1840, transpose: 2 })
        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(getKeyAccidGlyphs(dMinorUp1.svg)).toEqual(["E260", "E260", "E260", "E260", "E260", "E260"])
        expect(getKeyAccidGlyphs(dMinorUp2.svg)).toEqual(["E262"])

        // A single-key hymn (Eb major) at every value from -11 to 11 never gets more than six accidentals
        for (let step = -11; step <= 11; step++) {
            const rendered = await handleMessage({ type: "render", mei: ebMei, pageWidth: 1840, transpose: step })
            expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
            const keyAccids = getKeyAccidGlyphs(rendered.svg)
            expect(keyAccids.length).toBeLessThanOrEqual(6)
        }
    })

    it("draws larger words with lyricSize, keeps 100 identical to omitted, resets after 175, and fits a box", async () => {
        // A brace or bracket hangs left of the staves, so music that draws one keeps the full left margin
        expect(getLyricRenderOptions(175, true).pageMarginLeft).toBe(50)
        expect(getLyricRenderOptions(175, false).pageMarginLeft).toBe(10)

        const twoStaves = (groupStart: string) =>
            `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="0" meter.count="4" meter.unit="4">${groupStart}<staffDef n="1" lines="5" clef.shape="G" clef.line="2" /><staffDef n="2" lines="5" clef.shape="F" clef.line="4" /></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note dur="1" pname="g" oct="4"><verse n="1"><syl>Praise</syl></verse></note></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="g" oct="3" /></layer></staff></measure></section></score></mdiv></body></music></mei>`
        const getLeftMargin = async (groupStart: string) => {
            const rendered = await handleMessage({ type: "render", mei: twoStaves(groupStart), pageWidth: 1840, lyricSize: 175 })
            return Number(rendered.svg.match(/class="page-margin" transform="translate\((\d+)/)?.[1])
        }
        expect(await getLeftMargin('<staffGrp symbol="brace" bar.thru="false">')).toBe(500)
        expect(await getLeftMargin('<staffGrp bar.thru="false"><grpSym symbol="brace" />')).toBe(500)
        expect(await getLeftMargin('<staffGrp symbol="bracket" bar.thru="false">')).toBe(500)
        expect(await getLeftMargin('<staffGrp symbol="none" bar.thru="false">')).toBe(100)
        expect(await getLeftMargin('<staffGrp bar.thru="false"><grpSym />')).toBe(100)
        expect(await getLeftMargin('<staffGrp bar.thru="false">')).toBe(100)

        const hymnLineAbc = ["T: Doxology", "M: 4/4", "L: 1/4", "K: G", "[V:S] G2 G F | E2 D2 | G2 A2 | B4 |", "w: Praise God, from whom all bless-ings flow;"].join("\n")

        const mei = convertAndCheckAbc(hymnLineAbc, abcjs.parseOnly).mei

        const getSyllableFontSizes = (svg: string): number[] => {
            const sizes: number[] = []
            const sylBlocks = svg.match(/<g[^>]*class="[^"]*\bsyl\b[^"]*"[^>]*>[\s\S]*?<\/g>/g) || []
            for (const block of sylBlocks) {
                const match = block.match(/<tspan[^>]*font-size="([\d.]+)(?:px)?"/)
                if (match) sizes.push(Number(match[1]))
            }
            return sizes
        }

        const countSystems = (svg: string): number => (svg.match(/\bclass="[^"]*\bsystem\b[^"]*"/g) || []).length

        const omittedBefore = await handleMessage({ type: "render", mei, pageWidth: 1840 })
        const at100 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 100 })
        const at175 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 175 })
        const omittedAfter = await handleMessage({ type: "render", mei, pageWidth: 1840 })

        expect(getFilteredLogLines(getLastRenderLog())).toEqual([])
        expect(at100.svg).toBe(omittedBefore.svg)
        expect(omittedAfter.svg).toBe(omittedBefore.svg)

        const sizesAt100 = getSyllableFontSizes(at100.svg)
        const sizesAt175 = getSyllableFontSizes(at175.svg)
        expect(sizesAt100.length).toBeGreaterThan(0)
        expect(sizesAt175.length).toBe(sizesAt100.length)
        expect(sizesAt175[0]).toBeGreaterThan(sizesAt100[0])

        // Fitted render in the import slide box (1820x800, max size 200 -> pageWidth 1090, ratio 0.44)
        const boxWidth = calculatePageWidth(1820, 200)
        const boxRatio = getItemRatioFromStyle("width: 1820px; height: 800px;")
        const fitted100 = await handleMessage({ type: "render", mei, pageWidth: boxWidth, ratio: boxRatio, lyricSize: 100 })
        const fitted175 = await handleMessage({ type: "render", mei, pageWidth: boxWidth, ratio: boxRatio, lyricSize: 175 })

        expect(fitted175.fits).toBe(true)
        expect(fitted175.pages).toBe(1)
        expect(svgFitsWidth(fitted175.svg)).toBe(true)
        const vb175 = parseSvgViewBox(fitted175.svg)
        expect(vb175).not.toBeNull()
        expect(vb175!.height / vb175!.width).toBeLessThanOrEqual(boxRatio)
        expect(fitted175.svg).not.toBe(fitted100.svg)
        expect(getSyllableFontSizes(fitted175.svg)[0]).toBeGreaterThan(getSyllableFontSizes(fitted100.svg)[0])
        expect(countSystems(fitted175.svg)).toBeGreaterThanOrEqual(countSystems(fitted100.svg))
    })

    it("keeps neighbouring words apart when the words are drawn larger", async () => {
        // Each case is a melody line whose two words came out touching: the first word, its width in the
        // drawing's font in units of the font size, and the word after it
        const cases = [
            { abc: ["E | F A B A | ^G F/E/ A d | c d B B | A3", "w: Hark! How the heav'n-ly an-them * drowns all mu-sic but its own."], word: "drowns", width: 2.94, next: "all" },
            { abc: ["D | G G B B | A G A B | A G B A | G3", "w: All hail the pow'r of Je-sus' Name! Let an-gels pros-trate fall;"], word: "Name!", width: 2.71, next: "Let" }
        ]
        const boxWidth = calculatePageWidth(1820, 200)
        const boxRatio = getItemRatioFromStyle("width: 1820px; height: 800px;")

        const getSyllables = (svg: string) => [...svg.matchAll(/<g[^>]*class="[^"]*\bsyl\b[^"]*"[^>]*>\s*<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>[\s\S]*?<tspan font-size="([\d.]+)px">([^<]*)<\/tspan>/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), size: Number(match[3]), text: match[4] }))

        for (const { abc, word, width, next } of cases) {
            const mei = convertAndCheckAbc(["T: Words", "M: 4/4", "L: 1/4", "K: D", ...abc].join("\n"), abcjs.parseOnly).mei
            for (const lyricSize of [125, 150, 175]) {
                const rendered = await handleMessage({ type: "render", mei, pageWidth: boxWidth, ratio: boxRatio, lyricSize })
                const syllables = getSyllables(rendered.svg)
                const index = syllables.findIndex((syllable) => syllable.text === word)
                expect(index).toBeGreaterThanOrEqual(0)
                expect(syllables[index + 1].text).toBe(next)
                // Both words are on one row, and the gap after the first is at least a fifth of the font size
                expect(syllables[index + 1].y).toBe(syllables[index].y)
                expect((syllables[index + 1].x - syllables[index].x) / syllables[index].size).toBeGreaterThanOrEqual(width + 0.2)
            }
        }
    })

    it("tightens margins and sets lyric word space and staff spacing above 100, leaves 100 identical to omitted, logs nothing at 175, and clamps bad lyricSize values", async () => {
        expect(getLyricRenderOptions(100)).toEqual({})
        expect(getLyricRenderOptions(137.5)).toEqual({
            lyricSize: 6.1875,
            lyricWordSpace: 2.7,
            pageMarginTop: 10,
            pageMarginBottom: 10,
            pageMarginLeft: 10,
            pageMarginRight: 30,
            spacingStaff: 4,
            spacingBraceGroup: 4
        })
        expect(getLyricRenderOptions(175)).toEqual({
            lyricSize: 7.875,
            lyricWordSpace: 3.2,
            pageMarginTop: 10,
            pageMarginBottom: 10,
            pageMarginLeft: 10,
            pageMarginRight: 30,
            spacingStaff: 4,
            spacingBraceGroup: 4
        })

        const hymnLineAbc = ["T: Doxology", "M: 4/4", "L: 1/4", "K: G", "[V:S] G2 G F | E2 D2 | G2 A2 | B4 |", "w: Praise God, from whom all bless-ings flow;"].join("\n")
        const mei = convertAndCheckAbc(hymnLineAbc, abcjs.parseOnly).mei

        const getFirstStaffLineLeftShare = (svg: string): number => {
            const innerSvgMatch = svg.match(/<svg\b[^>]*\bclass="[^"]*\bdefinition-scale\b[^"]*"[^>]*>/)
            const vbMatch = innerSvgMatch?.[0].match(/\bviewBox="([^"]+)"/)
            const marginTagMatch = svg.match(/<g\b[^>]*\bclass="[^"]*\bpage-margin\b[^"]*"[^>]*>/)
            const translateMatch = marginTagMatch?.[0].match(/\btransform="[^"]*translate\(\s*(-?\d+(?:\.\d+)?)/)
            const staffMatch = svg.match(/<g\b[^>]*\bclass="[^"]*\bstaff\b[^"]*"[^>]*>([\s\S]*?)<g\b/)
            const lineMatch = staffMatch?.[1].match(/\bd="M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L\s*(-?\d+(?:\.\d+)?)\s+\2"/)
            expect(vbMatch).not.toBeNull()
            expect(translateMatch).not.toBeNull()
            expect(lineMatch).not.toBeNull()
            const innerWidth = Number(vbMatch![1].trim().split(/[\s,]+/)[2])
            const marginX = Number(translateMatch![1])
            const staffLeftX = Math.min(Number(lineMatch![1]), Number(lineMatch![3]))
            return (marginX + staffLeftX) / innerWidth
        }

        const omitted = await handleMessage({ type: "render", mei, pageWidth: 1840 })
        const at100 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 100 })
        const at175 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 175 })
        expect(getLastRenderLog()).toBe("")

        expect(at100.svg).toBe(omitted.svg)
        expect(getFirstStaffLineLeftShare(at175.svg)).toBeLessThan(getFirstStaffLineLeftShare(at100.svg))

        const at250 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 250 })
        const at50 = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: 50 })
        const asString = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: "175" })
        const asNaN = await handleMessage({ type: "render", mei, pageWidth: 1840, lyricSize: Number.NaN })

        expect(at250.svg).toBe(at175.svg)
        expect(at50.svg).toBe(at100.svg)
        expect(asString.svg).toBe(at100.svg)
        expect(asNaN.svg).toBe(at100.svg)
    })

    it("keeps the rows of a drawing when even rows would make a row fuller or the last row is already full", async () => {
        const bar = (n: number, notes: string) => `<measure n="${n}"><staff n="1"><layer n="1">${notes}</layer></staff></measure>`
        const whole = (pname: string) => `<note dur="1" oct="4" pname="${pname}"><verse n="1"><syl>Holy</syl></verse></note>`
        const halves = (first: string, second: string) => `<note dur="2" oct="4" pname="${first}"><verse n="1"><syl>Holy</syl></verse></note><note dur="2" oct="4" pname="${second}"><verse n="1"><syl>Holy</syl></verse></note>`
        const piece = (bars: string) => `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="0" meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>${bars}</section></score></mdiv></body></music></mei>`

        // Five equal bars, the last one in a key with seven sharps, drawn as three bars over two with a short last row.
        // Two bars over three looks more even by the bars' own widths, but the second row would also carry the new key
        // signature and be fuller than any row is now. The rows stay.
        const keyChangeMei = piece(`${[1, 2, 3, 4].map((n) => bar(n, whole("e"))).join("")}<scoreDef keysig="7s" meter.count="4" meter.unit="4"/>${bar(5, whole("f"))}`)
        const kept = await handleMessage({ type: "render", mei: keyChangeMei, pageWidth: 880 })
        expect(getLastRenderLog()).toBe("")
        expect(kept.fits).toBe(true)
        expect(readSvgRowStarts(kept.svg)).toEqual([4])
        // The search's drawing, the one with a short last row, two that measure the bars and two that measure the rows
        expect(getLastRenderLayouts()).toBe(6)

        // Without the key change the same bars are spread two over three
        const spread = await handleMessage({ type: "render", mei: piece([1, 2, 3, 4, 5].map((n) => bar(n, whole("e"))).join("")), pageWidth: 880 })
        expect(readSvgRowStarts(spread.svg)).toEqual([3])

        // A line of five bars with five verses, where the last two bars hold one long note without words. Four bars over
        // one leaves a short last row, but three over two puts five rows of words under the second row too. That is too
        // tall for the box, and a page wide enough for it would make the words much smaller. The rows stay.
        const fiveVerses = ["T: Were You There", "M: none", "L: 1/4", "K: E", "B2 B B | c B B3/2 G/ | F4 | (B2 e3/2 c/ | B4) |", "w: there when they cru-ci-fied my Lord? * * * *", "w: there when they nailed Him to the tree? * * * *", "w: there when they pierced Him in the side? Oh! * * *", "w: there when the sun re-fused to shine? * * * *", "w: there when they laid Him in the tomb? * * * *"].join("\n")
        const fiveVersesMei = convertAndCheckAbc(fiveVerses, abcjs.parseOnly).mei
        const tall = await handleMessage({ type: "render", mei: fiveVersesMei, pageWidth: 1170, ratio: 800 / 1820, lyricSize: 150 })
        expect(getLastRenderLog()).toBe("")
        expect(tall.fits).toBe(true)
        expect(readSvgRowStarts(tall.svg)).toEqual([5])

        // Eight equal bars that fill two rows are not measured, and the rows stay as they are
        const equalBars = piece([1, 2, 3, 4, 5, 6, 7, 8].map((n) => bar(n, halves("e", "g"))).join(""))
        let fullWidth = 0
        for (const pageWidth of [1000, 1100, 1200, 1300, 1400, 1500, 1600]) {
            const drawn = await handleMessage({ type: "render", mei: equalBars, pageWidth })
            if (readSvgRowStarts(drawn.svg).join() === "5") {
                fullWidth = pageWidth
                // the search's drawing and the one that would leave a short last row
                expect(getLastRenderLayouts()).toBe(2)
                break
            }
        }
        expect(fullWidth).toBeGreaterThan(0)
    })

    it("spreads multi-row drawings evenly, stays deterministic with empty log, ignores existing breaks, and skips measuring one-row drawings", async () => {
        const abideAbc = ["T: Abide With Me", "M: 4/4", "L: 1/4", "K: Eb", "%%score (S A) (T B)", "V: S", "V: A", "V: T clef=bass octave=-1", "V: B clef=bass octave=-1", "[V:S] G2 G F | E2 B2 | c B B A | G4 | G2 A B |", "w: 1.~A-bide with me; fast falls the e-ven-tide; The dark-ness", "[V:A] E2 D D | E2 E2 | E D E F | E4 | E2 E E |", "[V:T] B2 B A | G2 E2 | E B B B | B4 | B2 c B |", "[V:B] E2 B, B, | C2 G,2 | A, B, C D | E4 | E2 E E |"].join("\n")

        const mei = convertAndCheckAbc(abideAbc, abcjs.parseOnly).mei
        const boxWidth = calculatePageWidth(1820, 153)
        const boxRatio = getItemRatioFromStyle("width: 1820px; height: 800px;")

        const getRowStaffLineEnds = (svg: string): number[] => {
            const systems = svg.split(/<g\b[^>]*\bclass="[^"]*\bsystem\b[^"]*"[^>]*>/).slice(1)
            return systems.map((sys) => {
                let lastEnd = 0
                for (const match of sys.matchAll(/<g\b[^>]*\bclass="[^"]*\bstaff\b[^"]*"[^>]*>([\s\S]*?)<g\b/g)) {
                    for (const line of match[1].matchAll(/\bd="M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)"/g)) {
                        if (Number(line[2]) === Number(line[4])) {
                            lastEnd = Math.max(Number(line[1]), Number(line[3]))
                        }
                    }
                }
                return lastEnd
            })
        }

        const first = await handleMessage({ type: "render", mei, pageWidth: boxWidth, ratio: boxRatio, lyricSize: 160 })
        expect(getLastRenderLog()).toBe("")
        expect(first.pages).toBe(1)
        expect(first.fits).toBe(true)
        expect(readSvgRowStarts(first.svg)).toEqual([3])
        expect((first.svg.match(/<g\b[^>]*\bclass="measure"/g) || []).length).toBe(5)
        const rowEnds = getRowStaffLineEnds(first.svg)
        expect(rowEnds).toHaveLength(2)
        expect(Math.abs(rowEnds[1] - rowEnds[0])).toBeLessThanOrEqual(5)

        const vb = parseSvgViewBox(first.svg)
        expect(vb).not.toBeNull()
        expect(vb!.width).toBe(first.pageWidth)
        expect(first.scale).toBeCloseTo(Math.min(1, boxWidth / first.pageWidth), 6)

        // Same render twice gives the exact same drawing byte for byte with empty Verovio log
        const second = await handleMessage({ type: "render", mei, pageWidth: boxWidth, ratio: boxRatio, lyricSize: 160 })
        expect(getLastRenderLog()).toBe("")
        expect(second.svg).toBe(first.svg)
        expect(second.pageWidth).toBe(first.pageWidth)
        expect(second.scale).toBe(first.scale)

        // Existing <sb/> and <pb/> elements in the MEI give the same rows as without them
        let seen = 0
        const meiWithBreaks = mei.replace(/<measure\b/g, (tag) => {
            seen++
            if (seen === 2) return `<pb/>${tag}`
            if (seen === 4) return `<sb/>${tag}`
            return tag
        })
        const withBreaks = await handleMessage({ type: "render", mei: meiWithBreaks, pageWidth: boxWidth, ratio: boxRatio, lyricSize: 160 })
        expect(readSvgRowStarts(withBreaks.svg)).toEqual(readSvgRowStarts(first.svg))

        // Render without a ratio that has more than one row also gets even rows
        const noRatio = await handleMessage({ type: "render", mei, pageWidth: first.pageWidth, lyricSize: 160 })
        expect(readSvgRowStarts(noRatio.svg)).toEqual([3])
        expect(parseSvgViewBox(noRatio.svg)!.width).toBe(noRatio.pageWidth)
        expect(noRatio.scale).toBe(1)

        // One-row drawing does not run the measuring drawings
        const oneRow = await handleMessage({ type: "render", mei, pageWidth: 4000, lyricSize: 160 })
        expect(readSvgRowStarts(oneRow.svg)).toEqual([])
        expect(getLastRenderLayouts()).toBe(1)
    })
})
