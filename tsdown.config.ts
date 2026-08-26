import type { UserConfig } from 'tsdown'

const external = [/^node:/, /^@deepseek-ai\//, /^yaml$/]
const clientExternal = [/^react(?:\/.*)?$/, /^@deepseek-ai\//]

const host: UserConfig = {
  entry: {
    index: 'src/index.ts',
    'search-runtime': 'src/search-runtime.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => external.some(pattern => pattern.test(specifier)),
    alwaysBundle: specifier => !external.some(pattern => pattern.test(specifier)),
  },
}

const client: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => clientExternal.some(pattern => pattern.test(specifier)),
    alwaysBundle: specifier => !clientExternal.some(pattern => pattern.test(specifier)),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "relay-dsh-plugin-manager", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
