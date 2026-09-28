import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC = 'isPublic'
/** 로그인 없이 열리는 경로 (헬스 체크·로그인 시작·콜백) */
export const Public = () => SetMetadata(IS_PUBLIC, true)
