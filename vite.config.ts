import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'
import { renameSync } from 'node:fs'

const ROOT = import.meta.dirname

/** 单文件产物改名为 release/同路.html，watch 模式下每次重建都会执行 */
const renameOutput = {
  name: 'tonglu-rename',
  writeBundle() {
    renameSync(path.resolve(ROOT, 'release/index.html'), path.resolve(ROOT, 'release/同路.html'))
    console.log(`[${new Date().toLocaleTimeString()}] 单文件版已更新：release/同路.html`)
  },
}

// --mode single：JS/CSS/数字字体全部内联进一个 HTML，双击就能看（release/同路.html）
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile(), renameOutput] : [react()],
  build: mode === 'single' ? { outDir: 'release', emptyOutDir: false, assetsInlineLimit: 100_000_000 } : undefined,
  resolve: {
    alias: {
      '@core': path.resolve(ROOT, 'src/core'),
      '@llm': path.resolve(ROOT, 'src/llm'),
      '@sync': path.resolve(ROOT, 'src/sync'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}) as any)
