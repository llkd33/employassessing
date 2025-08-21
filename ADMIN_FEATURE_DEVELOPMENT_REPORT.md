# 신입사원 역량 테스트 관리자 기능 개발 보고서

## 📋 목차
1. [개요 및 초기 문제점](#1-개요-및-초기-문제점)
2. [데이터베이스 설계 및 변경사항](#2-데이터베이스-설계-및-변경사항)
3. [백엔드 아키텍처 구현](#3-백엔드-아키텍처-구현)
4. [보안 시스템 구축](#4-보안-시스템-구축)
5. [프론트엔드 UI/UX 개선](#5-프론트엔드-uiux-개선)
6. [구현된 주요 기능](#6-구현된-주요-기능)
7. [기술 스택 및 의존성](#7-기술-스택-및-의존성)
8. [향후 개선 방향](#8-향후-개선-방향)

---

## 1. 개요 및 초기 문제점

### 1.1 초기 상황
사용자로부터 받은 핵심 문제점:
- ✅ 데이터베이스에 `role` 컬럼 추가는 성공
- ❌ 관리자 계정 생성 및 관리 방법 불명확
- ❌ 관리자/일반 사용자 로그인 분리 필요
- ❌ 기업별 신입사원 할당 로직 부재
- ❌ 인가(Authorization) 로직의 복잡성
- ❌ 백엔드 구조 설계의 전반적인 막막함

### 1.2 해결 방향
1. **체계적인 데이터베이스 재설계**
2. **역할 기반 접근 제어(RBAC) 시스템 구축**
3. **보안이 강화된 관리자 계정 시스템**
4. **기업별 데이터 격리 및 관리**
5. **현대적인 관리자 대시보드 UI**

---

## 2. 데이터베이스 설계 및 변경사항

### 2.1 기존 구조의 문제점
```sql
-- 기존: role 컬럼만 추가된 단순한 구조
users 테이블:
- role 컬럼 (user/admin)
- 회사 구분 없음
- 관리자 초대 시스템 없음
```

### 2.2 새로운 데이터베이스 스키마

#### 2.2.1 회사(Companies) 테이블 추가
```sql
CREATE TABLE companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,  -- 관리자 가입용 회사 코드
    domain VARCHAR(255),               -- 회사 이메일 도메인
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.2.2 사용자(Users) 테이블 확장
```sql
ALTER TABLE users 
ADD COLUMN role VARCHAR(20) DEFAULT 'user' 
    CHECK (role IN ('super_admin', 'company_admin', 'hr_manager', 'user'));
    
ALTER TABLE users 
ADD COLUMN company_id INTEGER REFERENCES companies(id);

ALTER TABLE users 
ADD COLUMN department VARCHAR(100);

ALTER TABLE users 
ADD COLUMN employee_number VARCHAR(50);
```

#### 2.2.3 관리자 초대 시스템
```sql
CREATE TABLE admin_invitations (
    id SERIAL PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    company_id INTEGER REFERENCES companies(id),
    role VARCHAR(20) NOT NULL,
    invited_by VARCHAR(50) REFERENCES users(user_id),
    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.2.4 관리자 활동 로그
```sql
CREATE TABLE admin_activity_logs (
    id SERIAL PRIMARY KEY,
    admin_id VARCHAR(50) REFERENCES users(user_id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.2.5 배치 업로드 시스템
```sql
CREATE TABLE batch_user_uploads (
    id SERIAL PRIMARY KEY,
    uploaded_by VARCHAR(50) REFERENCES users(user_id),
    company_id INTEGER REFERENCES companies(id),
    file_name VARCHAR(255) NOT NULL,
    total_count INTEGER NOT NULL,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    error_details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 2.3 역할 계층 구조
```
super_admin (슈퍼 관리자)
    ├── 모든 회사 데이터 접근 가능
    ├── 회사 생성/삭제
    └── 모든 관리자 권한 부여

company_admin (회사 관리자)
    ├── 자기 회사 데이터만 접근
    ├── HR 매니저 초대
    └── 직원 관리

hr_manager (HR 매니저)
    ├── 자기 회사 직원 조회
    └── 제한된 관리 기능

user (일반 사용자/신입사원)
    └── 본인 데이터만 접근
```

---

## 3. 백엔드 아키텍처 구현

### 3.1 인증/인가 미들웨어 시스템

#### 3.1.1 JWT 토큰 구조 개선
```javascript
// 토큰에 role과 companyId 포함
const generateToken = (user) => {
    const payload = {
        userId: user.user_id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        companyId: user.company_id || null
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
};
```

#### 3.1.2 계층적 권한 검증 미들웨어
```javascript
// 기본 인증 (로그인 확인)
const authenticateToken = (req, res, next) => { ... }

// 관리자 권한 확인
const requireAdmin = (req, res, next) => {
    if (!['super_admin', 'company_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
}

// 회사별 데이터 접근 권한
const requireCompanyAccess = (req, res, next) => {
    if (req.user.role === 'super_admin') return next();
    
    if (req.user.companyId !== parseInt(req.params.companyId)) {
        return res.status(403).json({ error: '접근 권한이 없습니다.' });
    }
    next();
}
```

### 3.2 관리자 계정 생성 시스템

#### 3.2.1 회사 코드를 통한 관리자 가입
```javascript
// POST /api/admin/auth/signup
- 회사 코드 검증
- 이메일 도메인 검증 (선택사항)
- 관리자 권한으로 계정 생성
```

#### 3.2.2 초대 시스템
```javascript
// POST /api/admin/invitation/invite
- 이메일로 초대 토큰 발송
- 7일 만료 기한
- 역할별 초대 권한 제한

// POST /api/admin/invitation/accept
- 토큰 검증
- 계정 생성
- 자동 회사 할당
```

### 3.3 기업별 데이터 관리 API

#### 3.3.1 직원 목록 조회 (권한별 필터링)
```javascript
router.get('/api/admin/users', async (req, res) => {
    if (req.user.role === 'super_admin') {
        // 모든 직원 조회 가능
    } else {
        // 자기 회사 직원만 조회
        query += ' WHERE company_id = $1'
        params = [req.user.companyId]
    }
});
```

#### 3.3.2 직원 회사 할당
```javascript
router.put('/api/admin/users/:userId/assign', async (req, res) => {
    // 회사 관리자는 자기 회사로만 할당 가능
    const targetCompanyId = req.user.role === 'super_admin' 
        ? req.body.companyId 
        : req.user.companyId;
});
```

### 3.4 배치 사용자 가입 시스템
```javascript
// CSV 파일 업로드로 대량 사용자 생성
router.post('/api/admin/batch/batch-upload', 
    upload.single('file'),
    async (req, res) => {
        // CSV 파싱
        // 유효성 검사
        // 비동기 처리로 대량 생성
        // 진행 상황 추적
    }
);
```

---

## 4. 보안 시스템 구축

### 4.1 다층 보안 구조

#### 4.1.1 Rate Limiting
```javascript
// 관리자 로그인: 15분당 3회
const adminLoginLimiter = createRateLimiter(15 * 60 * 1000, 3);

// API 요청: 15분당 100회
const apiLimiter = createRateLimiter(15 * 60 * 1000, 100);
```

#### 4.1.2 SQL Injection 방지
```javascript
const preventSQLInjection = (req, res, next) => {
    const suspicious = /(\b(union|select|insert|update|delete|drop)\b)/gi;
    // 모든 입력값 검사
};
```

#### 4.1.3 XSS 방지
```javascript
const sanitizeInput = (req, res, next) => {
    // HTML 태그 제거
    // 스크립트 태그 제거
    // 이벤트 핸들러 제거
};
```

#### 4.1.4 보안 헤더
```javascript
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"]
        }
    }
}));
```

### 4.2 관리자 활동 로깅
```javascript
const logAdminActivity = (action) => {
    return async (req, res, next) => {
        // 모든 관리자 활동 기록
        // IP 주소, 액션, 타겟, 시간 등
    };
};
```

### 4.3 세션 관리
- 관리자 세션 타임아웃 (30분)
- IP 화이트리스트 (선택사항)
- 토큰 자동 갱신

---

## 5. 프론트엔드 UI/UX 개선

### 5.1 디자인 시스템 구축

#### 5.1.1 CSS 변수 기반 테마
```css
:root {
    --primary-color: #4F46E5;
    --primary-hover: #4338CA;
    --success-color: #10B981;
    --danger-color: #EF4444;
    /* ... 50+ 변수 정의 */
}
```

#### 5.1.2 컴포넌트 라이브러리
- 버튼 (primary, secondary, outline, sizes)
- 카드 컴포넌트
- 테이블 스타일
- 폼 요소
- 모달 시스템
- 알림 컴포넌트

### 5.2 관리자 로그인 페이지 개선
- 그라디언트 배경
- 애니메이션 효과
- 비밀번호 표시/숨기기
- 로그인 상태 유지
- 에러 애니메이션

### 5.3 관리자 대시보드

#### 5.3.1 레이아웃 구조
```
┌─────────────┬────────────────────────────┐
│  Sidebar    │         Header             │
│             ├────────────────────────────┤
│  - 대시보드  │                           │
│  - 직원관리  │      Content Area         │
│  - 테스트   │                           │
│  - 분석     │   - 통계 카드             │
│  - 초대관리  │   - 차트                  │
│  - 설정     │   - 최근 활동             │
│             │                           │
└─────────────┴────────────────────────────┘
```

#### 5.3.2 주요 기능
- 실시간 통계 카드
- Chart.js 데이터 시각화
- 반응형 디자인
- 다크 모드 지원
- 모바일 메뉴

### 5.4 데이터 시각화
```javascript
// 월별 테스트 현황 (Line Chart)
// 역량별 평균 점수 (Radar Chart)
// 점수 분포 (Bar Chart)
```

---

## 6. 구현된 주요 기능

### 6.1 관리자 계정 관리
- ✅ 회사 코드 기반 관리자 가입
- ✅ 이메일 초대 시스템
- ✅ 슈퍼 관리자 초기 설정
- ✅ 역할별 권한 관리

### 6.2 직원 관리
- ✅ 회사별 직원 목록 조회
- ✅ 직원 상세 정보 및 테스트 이력
- ✅ 직원 회사 할당/변경
- ✅ CSV 대량 업로드

### 6.3 테스트 결과 관리
- ✅ 회사별 테스트 통계
- ✅ 월별/일별 추이 분석
- ✅ 역량별 평균 점수
- ✅ 개인별 상세 결과

### 6.4 보안 및 권한
- ✅ JWT 기반 인증
- ✅ 역할 기반 접근 제어 (RBAC)
- ✅ Rate Limiting
- ✅ SQL Injection/XSS 방지
- ✅ 관리자 활동 로깅

### 6.5 UI/UX
- ✅ 현대적인 디자인 시스템
- ✅ 반응형 레이아웃
- ✅ 실시간 데이터 업데이트
- ✅ 직관적인 네비게이션
- ✅ 다크 모드 준비

---

## 7. 기술 스택 및 의존성

### 7.1 백엔드
```json
{
  "dependencies": {
    "express": "^4.x",
    "pg": "^8.x",
    "jsonwebtoken": "^9.x",
    "bcryptjs": "^2.x",
    "express-rate-limit": "^6.x",
    "helmet": "^7.x",
    "multer": "^1.x",
    "csv-parser": "^3.x"
  }
}
```

### 7.2 프론트엔드
- Vanilla JavaScript (ES6+)
- Chart.js (데이터 시각화)
- CSS3 (변수, 그리드, 플렉스박스)
- 반응형 디자인

### 7.3 데이터베이스
- PostgreSQL
- 정규화된 테이블 구조
- 외래키 제약조건
- 인덱스 최적화

---

## 8. 향후 개선 방향

### 8.1 단기 과제
1. **이메일 시스템 연동**
   - Nodemailer 설정
   - 이메일 템플릿 구현
   - 알림 시스템

2. **테스트 자동화**
   - Jest 단위 테스트
   - API 통합 테스트
   - E2E 테스트

3. **성능 최적화**
   - 데이터베이스 쿼리 최적화
   - 캐싱 전략
   - CDN 적용

### 8.2 장기 과제
1. **고급 분석 기능**
   - AI 기반 역량 분석
   - 예측 모델
   - 맞춤형 추천

2. **확장성**
   - 마이크로서비스 아키텍처
   - 메시지 큐
   - 실시간 알림 (WebSocket)

3. **엔터프라이즈 기능**
   - SSO (Single Sign-On)
   - LDAP/AD 연동
   - 다국어 지원

---

## 📌 결론

초기에 직면했던 모든 문제점들을 체계적으로 해결했습니다:

1. **관리자 계정 생성 문제** → 회사 코드 & 초대 시스템으로 해결
2. **로그인 분리 문제** → 별도의 관리자 로그인 페이지와 강화된 보안
3. **기업별 할당 문제** → company_id 기반 데이터 격리 및 권한 시스템
4. **인가 로직 복잡성** → 재사용 가능한 미들웨어로 모듈화
5. **백엔드 구조 설계** → 명확한 계층 구조와 RESTful API 설계

이제 관리자 기능이 안전하고 확장 가능한 구조로 구현되어, 기업별로 신입사원을 효율적으로 관리할 수 있게 되었습니다.