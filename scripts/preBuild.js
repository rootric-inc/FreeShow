const { readdirSync, existsSync, lstatSync, unlinkSync, rmdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } = require("fs")
const { join } = require("path")

// app build file paths
const buildSveltePath = join(__dirname, "..", "public", "build")
const buildElectronPath = join(__dirname, "..", "build") // this includes server files

// delete folders and all of it's content
deleteFolderRecursive(buildSveltePath)
deleteFolderRecursive(buildElectronPath)

function deleteFolderRecursive(folderPath) {
    if (!existsSync(folderPath)) return

    readdirSync(folderPath).forEach((file) => {
        const path = join(folderPath, file)
        const isFolder = lstatSync(path).isDirectory()
        if (isFolder) return deleteFolderRecursive(path)

        // delete file
        unlinkSync(path)
    })

    rmdirSync(folderPath)
}

// create production configs with no source map
function generateProdConfigs() {
    const configs = ["svelte", "electron", "server"]
    configs.forEach(createProdConfig)

    function createProdConfig(id) {
        const baseConfigPath = join(__dirname, "..", "config", "typescript", `tsconfig.${id}.json`)
        const rawConfig = readFileSync(baseConfigPath, "utf8")
        const parsedConfig = JSON.parse(rawConfig || "{}")

        if (!parsedConfig.compilerOptions) parsedConfig.compilerOptions = {}
        parsedConfig.compilerOptions.sourceMap = false

        const newConfigPath = baseConfigPath.replace(`tsconfig.${id}.json`, `tsconfig.${id}.prod.json`)
        writeFileSync(newConfigPath, JSON.stringify(parsedConfig))
    }
}

// copy the latest version of pdf worker file to ensure it's up to date with the package version
function getPdfWorkerFile() {
    const workerName = "pdf.worker.min.mjs"
    const originPath = join(__dirname, "..", "node_modules", "pdfjs-dist", "build", workerName)
    const outputPath = join(__dirname, "..", "public", "assets", workerName)

    try {
        copyFileSync(originPath, outputPath)
    } catch (err) {
        console.error("Could not copy PDF worker file:", err)
    }
}

function getSheetMusicEngine() {
    const pkgDir = join(__dirname, "..", "node_modules", "verovio")
    const outputDir = join(__dirname, "..", "public", "assets", "sheet-music")

    try {
        const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
        const header = `// Verovio ${pkg.version} (${pkg.license || "LGPL-3.0"})\n`
        mkdirSync(outputDir, { recursive: true })

        for (const fileName of ["verovio-module.mjs", "verovio.mjs"]) {
            const content = readFileSync(join(pkgDir, "dist", fileName), "utf8")
            writeFileSync(join(outputDir, fileName), header + content)
        }
    } catch (err) {
        console.error("Could not copy sheet music engine files:", err)
        if (process.env.NODE_ENV === "production") process.exit(1)
    }
}

if (process.env.NODE_ENV === "production") generateProdConfigs()
getPdfWorkerFile()
getSheetMusicEngine()

// write release build repository info (currently for error reporting checks)
const releaseRepo = process.env.GITHUB_REPOSITORY || "local"
console.log("Built from repo:", releaseRepo)
writeFileSync(join(__dirname, "..", "public", "release.json"), JSON.stringify({ repo: releaseRepo }))
