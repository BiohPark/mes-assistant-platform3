/** Eligible inputs from exactly the preceding AI request. Reading never selects them. */
export type PreviousMaterial =
  | { kind: 'file'; fileId: string; weight: 'main' | 'reference' }
  | { kind: 'sr'; srId: string }
  | { kind: 'conversation'; sourceTaskId: string; snapshotId: string; mode: 'full' | 'messages' | 'summary'; weight: 'main' | 'reference' }
