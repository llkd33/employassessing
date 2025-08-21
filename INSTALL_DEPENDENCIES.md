# 추가 의존성 설치 가이드

## 관리자 기능 고도화를 위한 필수 패키지

아래 패키지들을 설치해야 관리자 기능이 정상적으로 작동합니다:

```bash
# 보안 관련 패키지
npm install express-rate-limit helmet express-mongo-sanitize

# 파일 업로드 (CSV 배치 업로드)
npm install multer csv-parser

# 이메일 발송 (선택사항)
npm install nodemailer

# 세션 관리 (선택사항)
npm install express-session connect-pg-simple

# 로깅 (선택사항)
npm install winston winston-daily-rotate-file

# 모니터링 (선택사항)
npm install @sentry/node
```

## 개발 환경 패키지

```bash
# 테스트
npm install --save-dev jest supertest @types/jest

# 코드 품질
npm install --save-dev eslint prettier eslint-config-prettier

# 타입 정의
npm install --save-dev @types/node @types/express @types/multer
```

## 데이터베이스 마이그레이션 실행

```bash
# 관리자 기능 마이그레이션
node database/migrate-admin-feature.js

# 인비테이션 시스템 마이그레이션
node database/migrate-invitation-system.js

# 롤백이 필요한 경우
node database/migrate-admin-feature.js rollback
node database/migrate-invitation-system.js rollback
```

## 환경변수 설정

1. `.env.example` 파일을 복사하여 `.env` 파일 생성
2. 필수 환경변수 설정:
   - `SUPER_ADMIN_SECRET`: 슈퍼 관리자 생성용 시크릿 키
   - `JWT_SECRET`: JWT 토큰 서명용 시크릿 키
   - `SESSION_SECRET`: 세션 암호화용 시크릿 키

## 초기 슈퍼 관리자 생성

```bash
# API를 통한 슈퍼 관리자 생성
curl -X POST http://localhost:3000/api/admin/auth/create-super-admin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SuperSecurePassword123!",
    "name": "슈퍼 관리자",
    "secretKey": "your-super-admin-secret"
  }'
```

## 서버 실행

```bash
# 개발 환경
npm run dev

# 프로덕션 환경
npm start
```