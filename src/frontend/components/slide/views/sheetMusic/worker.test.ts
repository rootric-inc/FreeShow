import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseSvgViewBox } from "../../../../../../public/assets/sheet-music/mei.mjs"
import { handleMessage } from "../../../../../../public/assets/sheet-music/worker.mjs"

const verovioModulePath = fileURLToPath(new URL("../../../../../../public/assets/sheet-music/verovio-module.mjs", import.meta.url))
const hasVerovio = existsSync(verovioModulePath)

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

describe.skipIf(!hasVerovio)("sheet music worker (requires public/assets/sheet-music/verovio-module.mjs from preBuild)", () => {
    it("loads MusicXML into normalized MEI without meiHead and with bar.thru set to false", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        expect(loaded.title).toBe("Short & Sweet")
        expect(loaded.measures).toBe(4)
        expect(loaded.mei).toContain('bar.thru="false"')
        expect(loaded.mei).not.toContain("<meiHead")
    })

    it("renders MEI to SVG and fits within a requested box ratio", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })

        const basic = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 1840 })
        expect(basic.svg).toContain("<svg")
        expect(basic.pageWidth).toBe(1840)
        expect(basic.truncated).toBe(false)

        const targetRatio = 0.25
        const fitted = await handleMessage({ type: "render", mei: loaded.mei, pageWidth: 500, ratio: targetRatio })
        expect(fitted.svg).toContain("<svg")
        expect(fitted.pageWidth).toBeGreaterThanOrEqual(500)
        expect(fitted.truncated).toBe(false)

        const vb = parseSvgViewBox(fitted.svg)
        expect(vb).not.toBeNull()
        expect(vb!.height / vb!.width).toBeLessThanOrEqual(targetRatio)
    })

    it("strips external url() attributes from rendered SVG", async () => {
        const loaded = await handleMessage({ type: "load", text: SAMPLE_MUSICXML })
        const injected = loaded.mei.replace("<note ", '<note color="url(https://example.com/x.svg#p)" ')
        const rendered = await handleMessage({ type: "render", mei: injected, pageWidth: 1840 })

        expect(rendered.svg).not.toContain("https://example.com")
        expect(rendered.svg).toContain("none")
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
})
