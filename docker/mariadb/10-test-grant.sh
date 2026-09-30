# 개발용 컨테이너 전용(초기화 때 1회, 엔트리포인트가 source 한다).
# DB 통합 테스트가 임시 DB(t_*)를 만들고 지울 수 있게 앱 계정에 권한을 준다. 운영 DB 계정에는 주지 않는다.
docker_process_sql <<-EOSQL
	GRANT ALL PRIVILEGES ON \`t\\_%\`.* TO '${MARIADB_USER}'@'%';
EOSQL
