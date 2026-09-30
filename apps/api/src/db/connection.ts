import mysql from 'mysql2/promise'

/** 앱·도구·테스트가 공유하는 연결 설정. 새 물리 연결마다 세션 정책을 적용한다. */
export function createPool(databaseUrl: string, connectionLimit = 10) {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit, timezone: 'Z', jsonStrings: true, flags: ['FOUND_ROWS'] })
  const getConnection = pool.pool.getConnection.bind(pool.pool)
  const configured = new WeakSet<object>()
  pool.pool.getConnection = (callback) => getConnection((error, connection) => {
    if (error || !connection) return callback(error, connection)
    if (configured.has(connection)) return callback(null, connection)
    void (async () => {
      await connection.promise().query("set session time_zone = '+00:00'")
      await connection.promise().query('set session transaction isolation level read committed')
      await connection.promise().query("set session sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
      configured.add(connection)
      callback(null, connection)
    })().catch((setupError: Error) => {
      connection.destroy()
      callback(setupError, connection)
    })
  })
  return pool
}
