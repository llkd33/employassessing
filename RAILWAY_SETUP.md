# Railway PostgreSQL 설정 가이드

## IPv6 연결 문제 해결

Railway에서 PostgreSQL 연결 시 IPv6 관련 오류가 발생하는 경우:

```
Error: connect ENETUNREACH 2600:1f16:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:5432
```

### 해결 방법

#### 방법 1: DATABASE_PUBLIC_URL 사용 (권장)

Railway Dashboard에서:

1. PostgreSQL 서비스 선택
2. **Variables** 탭 클릭
3. 다음 변수들 확인:
   - `DATABASE_URL` (기본)
   - `DATABASE_PUBLIC_URL` (공개 URL)
   - `DATABASE_PRIVATE_URL` (내부 URL)

4. **Employee Assessment 서비스**의 Variables에서:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_PUBLIC_URL}}
   ```
   또는 직접 복사:
   ```
   DATABASE_URL = postgresql://postgres:[PASSWORD]@[PUBLIC_HOST]:PORT/railway
   ```

#### 방법 2: Pooled Connection 사용

일부 경우 pooled connection이 더 안정적입니다:

```
DATABASE_URL = postgresql://postgres:[PASSWORD]@[HOST]:6543/railway?pgbouncer=true
```

#### 방법 3: 외부 PostgreSQL 사용

무료 대안:

1. **Supabase** (https://supabase.com)
   - 무료 500MB
   - 안정적인 연결
   - Railway와 호환성 좋음

2. **Neon** (https://neon.tech)
   - 무료 3GB
   - Serverless PostgreSQL

## 환경 변수 설정

Railway Dashboard → Your Service → Variables:

```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key-here
NODE_ENV=production
```

## 초기 설정 단계

1. **서버 시작 확인**
   - Deploy Logs에서 "서버가 포트 8080에서 실행중입니다" 확인

2. **시스템 상태 확인**
   ```
   https://[your-app].up.railway.app/api/setup/status
   ```

3. **관리자 계정 생성**
   ```bash
   curl -X POST https://[your-app].up.railway.app/api/setup/init
   ```

4. **관리자 로그인**
   ```
   https://[your-app].up.railway.app/client/admin-login.html
   ```

## 트러블슈팅

### 문제: 정적 파일 404 오류
- 해결: 재배포 후 브라우저 캐시 삭제 (Ctrl+Shift+R)

### 문제: CORS 오류
- 해결: ALLOWED_ORIGINS 환경변수에 프론트엔드 도메인 추가

### 문제: 데이터베이스 연결 타임아웃
- 해결: DATABASE_PUBLIC_URL 사용 또는 외부 PostgreSQL 서비스 사용

## 관리자 계정 정보

생성된 기본 계정:
- Email: admin@test.com
- Password: Admin123!@#

⚠️ 프로덕션에서는 즉시 비밀번호를 변경하세요!