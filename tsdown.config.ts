import type { UserConfig } from 'tsdown'

const external = [/^node:/, /^@deepseek-ai\//, /^yaml$/]

const config: UserConfig = {
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

export default config
