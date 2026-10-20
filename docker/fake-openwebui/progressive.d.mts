/** progressive.mjs 타입 — 단위 테스트(packages/llm·apps/api)가 같은 시나리오를 쓴다 */
export interface SessionFrame { content: string; output: Record<string, unknown>[] }
export declare const PROGRESSIVE: {
  intro: string; thought: string[]; middle: string; code: string; codeOutput: { stdout: string }; after: string
  tool: { id: string; name: string; arguments: Record<string, unknown>; result: string }; final: string
}
export declare function serializeBlocks(blocks: Record<string, unknown>[]): string
export declare function pieces(text: string, sizes?: number[]): string[]
export declare function sessionFrames(output?: 'empty' | 'late' | 'tools', s?: typeof PROGRESSIVE): SessionFrame[]
export declare function directMarkup(s?: typeof PROGRESSIVE): string
export declare function directPieces(s?: typeof PROGRESSIVE): string[]
