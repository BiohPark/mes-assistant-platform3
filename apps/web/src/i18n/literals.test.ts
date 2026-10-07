import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('features Korean literals do not exceed the U3 baseline (45 files, 596 literals)', () => {
  const root = path.resolve(import.meta.dirname, '../features')
  const files = readdirSync(root, { recursive: true }).map(String).filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  let count = 0
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node: ts.Node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && /[가-힣]/.test(node.text)) count++
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(files.length).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(596)
})
