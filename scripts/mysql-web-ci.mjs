#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

function need(ok, message) { if (!ok) throw new Error(message) }
const args = Object.fromEntries(process.argv.slice(2).reduce((all, arg, i, list) => {
  if (i % 2 === 0) { need(arg.startsWith('--') && list[i + 1], 'Expected --name value'); all.push([arg.slice(2), list[i + 1]]) }
  return all
}, []))
const source = fs.realpathSync(args.source || '.')
const output = path.resolve(args.output || '.mysql-web-runtime')
const archive = path.resolve(args.archive || 'mysql-web-runtime.tar.gz')
const sourceRevision = args['source-revision']
const workflowRevision = args['workflow-revision']
need(/^[0-9a-f]{40}$/.test(sourceRevision) && /^[0-9a-f]{40}$/.test(workflowRevision), 'Expected two immutable revisions')
need(!output.startsWith(source + path.sep) && output !== source, 'Output must be outside website source')
need(!fs.existsSync(output) && !fs.existsSync(archive), 'Build output already exists')
need(fs.existsSync(path.join(source, 'src/web/index.ts')) && fs.existsSync(path.join(source, 'vite.web.config.ts')), 'Refuse the Tauri desktop edition')
const req = createRequire(path.join(source, 'package.json'))
const compiled = await req('esbuild').build({ absWorkingDir: source, entryPoints: ['src/web/index.ts'], outfile: 'src/web/index.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: false, metafile: true, write: false, logLevel: 'silent' })
need(compiled.outputFiles.length === 1, 'Unexpected server compilation output')
const roots = ['express', 'mysql2', 'pg', 'redis', 'ssh2', 'uuid']
const allowedExternals = new Set(roots)
for (const item of Object.values(compiled.metafile.outputs).flatMap(x => x.imports).filter(x => x.external)) {
  need(item.path.startsWith('node:') || [...allowedExternals].some(name => item.path === name || item.path.startsWith(name + '/')), 'Unexpected external server import')
}
function resolvePackage(from, name) {
  let entry
  try { entry = from.resolve(name + '/package.json') } catch { entry = from.resolve(name) }
  let current = path.dirname(entry)
  while (current !== path.dirname(current)) {
    const manifest = path.join(current, 'package.json')
    if (fs.existsSync(manifest)) {
      const meta = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (meta.name === name && typeof meta.version === 'string') return [fs.realpathSync(current), meta]
    }
    current = path.dirname(current)
  }
  throw new Error('Cannot resolve locked runtime package: ' + name)
}
const found = new Map(), pending = roots.map(name => resolvePackage(req, name))
while (pending.length) {
  const [folder, meta] = pending.shift()
  if (found.has(folder)) continue
  need(folder.startsWith(path.join(source, 'node_modules') + path.sep), 'Dependency escaped installed website')
  found.set(folder, meta)
  const from = createRequire(path.join(folder, 'package.json'))
  for (const name of Object.keys(meta.dependencies || {})) pending.push(resolvePackage(from, name))
  for (const name of Object.keys(meta.optionalDependencies || {})) { try { pending.push(resolvePackage(from, name)) } catch {} }
  for (const name of Object.keys(meta.peerDependencies || {})) {
    try { pending.push(resolvePackage(from, name)) } catch (error) { if (!meta.peerDependenciesMeta?.[name]?.optional) throw error }
  }
}
const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8'))
const files = new Map(), records = {}, versions = {}
const excluded = new Set(['node_modules', 'test', 'tests', '__tests__', 'example', 'examples', 'benchmark', 'benchmarks', 'docs', '.github'])
function add(name, data) {
  data = Buffer.from(data)
  need(!files.has(name) && !path.posix.isAbsolute(name) && !name.split('/').some(x => x === '..' || x.startsWith('.env') || ['.ssh', '.git', '.codex', '.npmrc', 'auth.json', 'id_rsa', 'id_ed25519'].includes(x)), 'Unsafe runtime file')
  need(data.length <= 8 * 1024 * 1024, 'Runtime member exceeds 8MiB')
  if (/\.(?:md|markdown|map)$/i.test(name) && name.startsWith('node_modules/') && !/license|copying|notice/i.test(path.posix.basename(name))) return
  need(!/-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/.test(data.toString('utf8')), 'Private key material in runtime')
  files.set(name, data)
}
add('src/web/index.mjs', compiled.outputFiles[0].contents)
add('LICENSE', fs.readFileSync(path.join(source, 'LICENSE')))
function walk(folder, relative, filtering = false) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (filtering && excluded.has(entry.name)) continue
    const p = path.join(folder, entry.name), n = relative + '/' + entry.name
    need(!entry.isSymbolicLink(), 'Runtime symlinks are forbidden')
    if (entry.isDirectory()) walk(p, n, filtering)
    else { need(entry.isFile(), 'Unexpected runtime member type'); add(n, fs.readFileSync(p)) }
  }
}
walk(path.join(source, 'dist-web'), 'dist-web')
for (const [folder, meta] of found) {
  const relative = path.relative(source, folder).split(path.sep).join('/')
  const record = lock.packages[relative]
  need(record?.version === meta.version, 'Installed runtime differs from npm lock')
  records[relative] = { ...record }; delete records[relative].dev
  if (roots.includes(meta.name) && relative === 'node_modules/' + meta.name) versions[meta.name] = meta.version
  walk(folder, relative, true)
}
need(Object.keys(versions).length === roots.length, 'Missing root runtime dependency')
const pkg = { name: 'mysql-compare-web-runtime', version: '0.1.0', private: true, type: 'module', scripts: { start: 'node src/web/index.mjs' }, dependencies: versions }
add('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n'))
add('package-lock.json', Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version, dependencies: versions }, ...records } }, null, 2) + '\n'))
const hashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, crypto.createHash('sha256').update(data).digest('hex')]))
const revision = crypto.createHash('sha1').update(JSON.stringify({ workflowRevision, sourceRevision, hashes })).digest('hex')
const manifest = { schema: 1, application: 'mysql-compare-web', revision, source_revision: sourceRevision, workflow_revision: workflowRevision, compiled_source_modules: Object.keys(compiled.metafile.inputs).length, runtime_packages: found.size, files: hashes }
add('deploy-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
need(files.size <= 10000 && [...files.values()].reduce((n, x) => n + x.length, 0) <= 64 * 1024 * 1024, 'Runtime exceeds package limits')
fs.mkdirSync(output, { recursive: true })
for (const [name, data] of files) { const destination = path.join(output, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data, { flag: 'wx', mode: 0o644 }) }
execFileSync('python3', ['-c', `import pathlib,tarfile,sys
root=pathlib.Path(sys.argv[1])
with tarfile.open(sys.argv[2],'w:gz',compresslevel=6) as t:
 for p in sorted(root.rglob('*')):
  if p.is_file():
   i=t.gettarinfo(str(p),arcname=p.relative_to(root).as_posix());i.uid=0;i.gid=0;i.uname='';i.gname='';i.mtime=0;i.mode=0o644
   with p.open('rb') as f:t.addfile(i,f)
`, output, archive], { stdio: ['ignore', 'pipe', 'pipe'] })
need(fs.statSync(archive).size <= 32 * 1024 * 1024, 'Compressed runtime exceeds upload limit')
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `revision=${revision}\narchive=${archive}\n`)
console.log(JSON.stringify({ revision, source_revision: sourceRevision, workflow_revision: workflowRevision, files: files.size, expanded_bytes: [...files.values()].reduce((n, x) => n + x.length, 0), compressed_bytes: fs.statSync(archive).size, runtime_packages: found.size, compiled_source_modules: manifest.compiled_source_modules, real_environment_or_userdata_included: false }))
