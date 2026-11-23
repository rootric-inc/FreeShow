import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import abcjs from "abcjs"
import { beforeAll, describe, expect, it } from "vitest"
import { parseSvgViewBox, svgFitsWidth } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { convertAndCheckAbc } from "./abcToMei"
import { calculatePageWidth, getItemRatioFromStyle } from "./helpers"
import { filterMei, summarizeMei } from "./meiParts"
import { resolvePartsSelection } from "./parts"

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

describe.skipIf(!hasVerovio)("sheet music worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    let handleMessage: (message: Record<string, unknown>) => Promise<any>

    beforeAll(async () => {
        const mod = await import(/* @vite-ignore */ workerModuleHref)
        handleMessage = mod.handleMessage
    })

    it("loads MusicXML into normalized MEI without meiHead and with bar.thru set to false", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        expect(loaded.title).toBe("Short & Sweet")
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")
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

    it("renders filtered MEI for every parts preset with the expected number of staves", async () => {
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
            "[V:S] d e d c | d c B c | d e d c | d4 |",
            "w: 1.~Praise God from whom all bless-ings flow, praise him all crea-tures here be-low;",
            "w: 2.~Praise him a-bove, ye heav'n-ly host, praise Fa-ther, Son, and Ho-ly Ghost.",
            "[V:A] B G F F | F F G A | B G F F | F4 |",
            "[V:T] f e d c | B A d c | f e d c | B4 |",
            "[V:B] D C B, F | B, F G F | D C B, F | B,4 |"
        ].join("\n")

        const fullMei = convertAndCheckAbc(abc, abcjs.parseOnly).mei
        const summary = summarizeMei(fullMei)
        expect(summary.measures).toBe(4)

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
            const filtered = filterMei(fullMei, { parts: resolved.parts, verses: [1], highestNoteOnly: resolved.highestNoteOnly })
            const rendered = await handleMessage({ type: "render", mei: filtered, pageWidth: 1840 })

            expect(rendered.svg).toContain("<svg")
            const staffGroups = rendered.svg.match(/class="staff"/g) || []
            expect(staffGroups).toHaveLength(summary.measures * testCase.expectedStavesPerMeasure)
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
        expect(melodyRendered.svg.match(/class="staff"/g) || []).toHaveLength(2)
    })

    it("slices a 16-bar hymn with key, clefs, and meter visibility matching the starting measure", async () => {
        const makeBar = (n: number) =>
            `<measure n="${n}"><staff n="1"><layer n="1"><note xml:id="s${n}" dur.ppq="1" dur="1" oct="5" pname="d" stem.dir="up" /></layer><layer n="2"><note xml:id="a${n}" dur.ppq="1" dur="1" oct="4" pname="f" stem.dir="down" /></layer></staff><staff n="2"><layer n="5"><note xml:id="t${n}" dur.ppq="1" dur="1" oct="3" pname="b" stem.dir="up" accid.ges="f" /></layer><layer n="6"><note xml:id="b${n}" dur.ppq="1" dur="1" oct="2" pname="b" stem.dir="down" accid.ges="f" /></layer></staff>${n === 4 ? `<tie startid="#s4" endid="#s5" />` : ""}${n === 8 ? `<tie startid="#s8" endid="#s9" />` : ""}</measure>`
        const bars = Array.from({ length: 16 }, (_, i) => makeBar(i + 1)).join("")
        const hymn16Mei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="6.0-dev"><music><body><mdiv><score><scoreDef><staffGrp bar.thru="false"><grpSym symbol="brace" /><staffDef n="1" lines="5" ppq="1"><clef shape="G" line="2" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef><staffDef n="2" lines="5" ppq="1"><clef shape="F" line="4" /><keySig sig="2f" /><meterSig count="4" unit="4" /></staffDef></staffGrp></scoreDef><section>${bars}</section></score></mdiv></body></music></mei>`

        // Middle slice (5-8) crosses ties at both edges: 4 measures, keeps key & clefs, no time signature
        const middle = await handleMessage({ type: "slice", mei: hymn16Mei, first: 5, last: 8 })
        expect(middle.measures).toBe(4)
        expect(middle.mei).toContain('sig="2f"')
        expect(middle.mei).toContain('shape="G"')
        expect(middle.mei).toContain('shape="F"')
        expect(middle.mei).not.toContain("<meterSig")
        expect(middle.mei).not.toContain("meter.count=")

        const middleRendered = await handleMessage({ type: "render", mei: middle.mei, pageWidth: 1840 })
        expect(middleRendered.svg).toContain("<svg")
        expect(middleRendered.svg).toContain('class="clef"')
        expect(middleRendered.svg).toContain('class="keySig"')
        expect(middleRendered.svg).not.toContain('class="meterSig"')
        expect(middleRendered.svg.match(/class="staff"/g) || []).toHaveLength(8)

        // Slice from measure 1 keeps the time signature
        const opening = await handleMessage({ type: "slice", mei: hymn16Mei, first: 1, last: 4 })
        expect(opening.measures).toBe(4)
        const openingRendered = await handleMessage({ type: "render", mei: opening.mei, pageWidth: 1840 })
        expect(openingRendered.svg).toContain('class="meterSig"')
        expect(openingRendered.svg.match(/class="staff"/g) || []).toHaveLength(8)
    })

    it("keeps an earlier key signature change in force for a later slice", async () => {
        const keyChangeMei = `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1"><music><body><mdiv><score><scoreDef keysig="1s" meter.count="4" meter.unit="4"><staffGrp symbol="brace" bar.thru="false"><staffDef n="1" lines="5" clef.shape="G" clef.line="2" /><staffDef n="2" lines="5" clef.shape="F" clef.line="4" /></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer n="1"><note dur="1" pname="g" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="g" oct="3" /></layer></staff></measure><measure n="2"><staff n="1"><layer n="1"><note dur="1" pname="a" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="a" oct="3" /></layer></staff></measure><scoreDef keysig="3f" /><measure n="3"><staff n="1"><layer n="1"><note dur="1" pname="e" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="e" oct="3" /></layer></staff></measure><measure n="4"><staff n="1"><layer n="1"><note dur="1" pname="g" oct="4" /></layer></staff><staff n="2"><layer n="1"><note dur="1" pname="g" oct="3" /></layer></staff></measure></section></score></mdiv></body></music></mei>`

        const laterSlice = await handleMessage({ type: "slice", mei: keyChangeMei, first: 4, last: 4 })
        expect(laterSlice.measures).toBe(1)
        expect(laterSlice.mei).toContain('keysig="3f"')
        expect(laterSlice.mei).not.toContain("meter.count=")

        const rendered = await handleMessage({ type: "render", mei: laterSlice.mei, pageWidth: 1840 })
        expect(rendered.svg).toContain("<svg")
        expect(rendered.svg).toContain('class="keySig"')
        expect(rendered.svg).not.toContain('class="meterSig"')
    })
})
