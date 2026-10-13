import { readFileSync } from 'node:fs'
import { createSecureContext, type SecureContextOptions } from 'node:tls'

export type HttpsConfig =
  | { pfxFile: string; passphrase?: string }
  | { certFile: string; keyFile: string; caFile?: string }

/** Keep native file paths intact, including Windows drive and UNC paths. */
export function parseHttpsConfig(env: Record<string, string | undefined>): HttpsConfig | undefined {
  const pfxFile = env.HTTPS_PFX_FILE || undefined
  const certFile = env.HTTPS_CERT_FILE || undefined
  const keyFile = env.HTTPS_KEY_FILE || undefined
  const caFile = env.HTTPS_CA_FILE || undefined
  const passphrase = env.HTTPS_PFX_PASSPHRASE || undefined
  for (const [setting, path] of [['HTTPS_PFX_FILE', pfxFile], ['HTTPS_CERT_FILE', certFile], ['HTTPS_KEY_FILE', keyFile], ['HTTPS_CA_FILE', caFile]]) {
    // .env double quotes turn `\n` in `"C:\new\..."` into a newline.
    if (path && [...path].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
      throw new Error(`설정 오류 — ${setting}: 경로에 줄바꿈·탭 같은 제어 문자가 있습니다. .env에서 Windows 경로를 큰따옴표로 감싸면 \\n 등이 바뀌므로 작은따옴표나 / 구분자를 사용하세요(따옴표 문제일 수 있음)`)
    }
  }
  if (pfxFile) {
    if (certFile || keyFile || caFile) throw new Error('설정 오류 — HTTPS_PFX_FILE과 HTTPS_CERT_FILE/HTTPS_KEY_FILE/HTTPS_CA_FILE은 함께 사용할 수 없습니다')
    return { pfxFile, passphrase }
  }
  if (passphrase) throw new Error('설정 오류 — HTTPS_PFX_PASSPHRASE에는 HTTPS_PFX_FILE이 필요합니다')
  if (!certFile && !keyFile && !caFile) return undefined
  if (!certFile || !keyFile) throw new Error('설정 오류 — HTTPS_CERT_FILE과 HTTPS_KEY_FILE은 모두 필요합니다 (HTTPS_CA_FILE은 선택)')
  return { certFile, keyFile, caFile }
}

function readCertificate(path: string, setting: string): Buffer {
  try { return readFileSync(path) }
  catch { throw new Error(`설정 오류 — ${setting}: 인증서 파일을 읽을 수 없습니다. 경로와 서비스 계정의 읽기 권한을 확인하세요`) }
}

/** Validate TLS material before Nest/DB initialization; never expose OpenSSL error details or secrets. */
export function loadHttpsOptions(config: HttpsConfig | undefined): SecureContextOptions | undefined {
  if (!config) return undefined
  const options: SecureContextOptions = 'pfxFile' in config ? {
    pfx: readCertificate(config.pfxFile, 'HTTPS_PFX_FILE'),
    passphrase: config.passphrase,
  } : {
    cert: readCertificate(config.certFile, 'HTTPS_CERT_FILE'),
    key: readCertificate(config.keyFile, 'HTTPS_KEY_FILE'),
    ...(config.caFile ? { ca: readCertificate(config.caFile, 'HTTPS_CA_FILE') } : {}),
  }
  try { createSecureContext(options) }
  catch {
    throw new Error('설정 오류 — HTTPS: 인증서·개인 키·체인 또는 HTTPS_PFX_PASSPHRASE를 확인하세요')
  }
  return options
}

export function httpsOriginWarning(config: { https?: HttpsConfig; appOrigin: string }): string | undefined {
  if (config.https && config.appOrigin.startsWith('http://')) {
    return '직접 HTTPS가 켜져 있지만 APP_ORIGIN이 http입니다. 사용자 HTTPS 주소로 변경하세요. Secure 쿠키는 APP_ORIGIN 규칙을 따릅니다.'
  }
  return undefined
}
