/**
 * Prepare the local MediaPipe runtime used for posture detection.
 *
 * The browser loads the MediaPipe WASM runtime and the pose model from
 * /mediapipe/... (served by this app) instead of a public CDN, so posture
 * tracking also works offline and behind a corporate firewall.
 *
 *  - The WASM runtime ships inside the @mediapipe/tasks-vision npm package, so
 *    it is copied out of node_modules. That runs automatically on npm install.
 *  - The pose model is a separate download. It is kept in the repository, but
 *    this script can fetch it again if it is missing.
 *
 * Usage:
 *   node scripts/setup-mediapipe-assets.mjs           # copy the wasm runtime
 *   node scripts/setup-mediapipe-assets.mjs --model   # also download the model
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const wasmSource = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmTarget = path.join(root, 'public', 'mediapipe', 'wasm')
const modelTarget = path.join(root, 'public', 'mediapipe', 'pose_landmarker_lite.task')
const manifestTarget = path.join(root, 'public', 'mediapipe', 'manifest.json')
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// The "module" variant is only used by the ESM loader, which we do not use.
const wasmFiles = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

async function sameSize(a, b) {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)])
    return sa.size === sb.size
  } catch {
    return false
  }
}

async function copyRuntime() {
  if (!existsSync(wasmSource)) {
    console.error(
      '[mediapipe] @mediapipe/tasks-vision is not installed yet - run `npm install` first.',
    )
    return false
  }
  await mkdir(wasmTarget, { recursive: true })
  for (const name of wasmFiles) {
    const from = path.join(wasmSource, name)
    const to = path.join(wasmTarget, name)
    if (!(await sameSize(from, to))) {
      await copyFile(from, to)
      console.log(`[mediapipe] copied ${name}`)
    }
  }
  // The manifest tells the browser where the local runtime lives.
  const manifest = `${JSON.stringify(
    { wasmDir: '/mediapipe/wasm', modelPath: '/mediapipe/pose_landmarker_lite.task' },
    null,
    2,
  )}\n`
  let current = null
  try {
    current = await readFile(manifestTarget, 'utf8')
  } catch {
    /* not written yet */
  }
  if (current !== manifest) {
    await writeFile(manifestTarget, manifest)
    console.log('[mediapipe] wrote manifest.json')
  }
  return true
}

async function ensureModel() {
  if (existsSync(modelTarget) && (await stat(modelTarget)).size > 1_000_000) {
    console.log('[mediapipe] pose model already present')
    return true
  }
  console.log('[mediapipe] downloading the pose model (~5.5 MB) ...')
  const res = await fetch(modelUrl)
  if (!res.ok) {
    console.error(`[mediapipe] download failed: HTTP ${res.status}`)
    return false
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  await mkdir(path.dirname(modelTarget), { recursive: true })
  await writeFile(modelTarget, bytes)
  console.log(`[mediapipe] saved ${bytes.length} bytes`)
  return true
}

const wantModel = process.argv.includes('--model')
const ok = await copyRuntime()
if (ok && wantModel) await ensureModel()
process.exit(ok ? 0 : 1)
