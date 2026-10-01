import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TopBar } from '@/app/TopBar'
import { listSr } from '@/api/sr'
import { SrList } from './SrList'
import { SrDetailSheet } from './SrDetailSheet'

export function SrManagePage() {
  const client = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['sr'], queryFn: listSr })
  const [selectedId, setSelectedId] = useState('')
  const selected = rows.find((item) => item.id === selectedId)
  return <><TopBar title="SR 관리" /><div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-[16rem_1fr]">
    <SrList rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
    {selected ? <SrDetailSheet sr={selected} onSaved={() => { void client.invalidateQueries({ queryKey: ['sr'] }) }} /> : <p className="text-sm text-muted-foreground">SR을 선택하세요.</p>}
  </div></>
}
