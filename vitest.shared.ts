import { defaultClientConditions, defaultServerConditions } from 'vite'

/** 워크스페이스 패키지를 빌드 없이 src로 해석한다 (package.json exports의 "source" 조건) */
export const sourceConditions = {
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
}
