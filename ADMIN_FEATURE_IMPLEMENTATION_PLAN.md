# 관리자 기능 구현 가이드

## 1. 데이터베이스 스키마 설계

### 1.1 필요한 테이블 및 관계

```sql
-- 1. 회사 테이블 생성
CREATE TABLE companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,  -- 회사 코드 (관리자 가입시 사용)
    domain VARCHAR(255),  -- 회사 이메일 도메인 (ex: @company.com)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. users 테이블에 role과 company_id 추가
ALTER TABLE users 
ADD COLUMN role VARCHAR(20) DEFAULT 'user' 
CHECK (role IN ('super_admin', 'company_admin', 'user'));

ALTER TABLE users 
ADD COLUMN company_id INTEGER REFERENCES companies(id);

-- 3. 인덱스 추가 (성능 최적화)
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_test_results_user_id ON test_results(user_id);
```

### 1.2 역할 구분
- **super_admin**: 전체 시스템 관리자 (모든 회사 데이터 접근 가능)
- **company_admin**: 회사 관리자 (자기 회사 데이터만 접근 가능)
- **user**: 일반 사용자 (신입사원)

## 2. 관리자 계정 생성 시스템

### 2.1 관리자 가입 방식
```javascript
// 방법 1: 회사 코드를 통한 관리자 가입
// server/routes/admin-auth.js
app.post('/api/admin/signup', async (req, res) => {
    const { email, password, name, companyCode } = req.body;
    
    try {
        // 회사 코드 검증
        const company = await db.query(
            'SELECT id FROM companies WHERE code = $1',
            [companyCode]
        );
        
        if (!company.rows.length) {
            return res.status(400).json({ error: '유효하지 않은 회사 코드입니다.' });
        }
        
        // 이메일 도메인 검증 (선택사항)
        const companyDomain = company.rows[0].domain;
        if (companyDomain && !email.endsWith(companyDomain)) {
            return res.status(400).json({ 
                error: `회사 이메일(${companyDomain})을 사용해주세요.` 
            });
        }
        
        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 관리자 계정 생성
        const result = await db.query(
            `INSERT INTO users (user_id, email, password, name, role, company_id, login_type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, user_id, email, name, role`,
            [
                `admin_${Date.now()}`,
                email,
                hashedPassword,
                name,
                'company_admin',
                company.rows[0].id,
                'email'
            ]
        );
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '관리자 가입 실패' });
    }
});
```

### 2.2 초기 관리자 설정 (수동)
```sql
-- 초기 회사 및 관리자 설정 스크립트
-- database/seed-admin.sql

-- 1. 회사 등록
INSERT INTO companies (name, code, domain) VALUES 
('삼성전자', 'SAMSUNG2024', '@samsung.com'),
('LG전자', 'LG2024', '@lge.com'),
('네이버', 'NAVER2024', '@navercorp.com');

-- 2. 슈퍼 관리자 생성 (전체 시스템 관리)
INSERT INTO users (user_id, email, password, name, role, login_type) 
VALUES (
    'super_admin_1',
    'admin@assessment.com',
    '$2a$10$...', -- bcrypt로 해싱된 비밀번호
    '시스템 관리자',
    'super_admin',
    'email'
);
```

## 3. 인증/인가 시스템

### 3.1 JWT 토큰에 role 정보 추가
```javascript
// server/auth/jwt.js
function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.user_id,
            email: user.email,
            role: user.role,  // role 추가
            companyId: user.company_id  // company_id 추가
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
}
```

### 3.2 인가 미들웨어
```javascript
// server/middleware/auth.js

// 기존 인증 미들웨어 (로그인 확인)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '인증이 필요합니다.' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
        }
        req.user = user;
        next();
    });
};

// 관리자 권한 확인 미들웨어
const requireAdmin = (req, res, next) => {
    if (!req.user || !['super_admin', 'company_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
};

// 슈퍼 관리자 권한 확인 미들웨어
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'super_admin') {
        return res.status(403).json({ error: '슈퍼 관리자 권한이 필요합니다.' });
    }
    next();
};

// 회사별 데이터 접근 권한 확인
const requireCompanyAccess = (req, res, next) => {
    const { companyId } = req.params;
    
    // 슈퍼 관리자는 모든 회사 접근 가능
    if (req.user.role === 'super_admin') {
        return next();
    }
    
    // 회사 관리자는 자기 회사만 접근 가능
    if (req.user.role === 'company_admin' && 
        req.user.companyId === parseInt(companyId)) {
        return next();
    }
    
    return res.status(403).json({ error: '해당 회사의 데이터에 접근할 권한이 없습니다.' });
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireSuperAdmin,
    requireCompanyAccess
};
```

## 4. 기업별 신입사원 할당 시스템

### 4.1 신입사원 회사 할당 방법

#### 방법 1: 회원가입 시 회사 선택
```javascript
// 일반 사용자 회원가입 시 회사 선택
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name, companyId } = req.body;
    
    // 회사 ID 유효성 검증
    if (companyId) {
        const company = await db.query(
            'SELECT id FROM companies WHERE id = $1',
            [companyId]
        );
        if (!company.rows.length) {
            return res.status(400).json({ error: '유효하지 않은 회사입니다.' });
        }
    }
    
    // 사용자 생성 (company_id 포함)
    const result = await db.query(
        `INSERT INTO users (user_id, email, password, name, role, company_id, login_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, email, hashedPassword, name, 'user', companyId, 'email']
    );
});
```

#### 방법 2: 관리자가 직접 할당
```javascript
// 관리자가 신입사원을 자기 회사에 할당
app.put('/api/admin/users/:userId/assign', 
    authenticateToken, 
    requireAdmin, 
    async (req, res) => {
        const { userId } = req.params;
        
        try {
            // 관리자의 회사 ID로 할당
            const result = await db.query(
                'UPDATE users SET company_id = $1 WHERE user_id = $2 RETURNING *',
                [req.user.companyId, userId]
            );
            
            if (!result.rows.length) {
                return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            }
            
            res.json({ success: true, user: result.rows[0] });
        } catch (error) {
            res.status(500).json({ error: '할당 실패' });
        }
    }
);
```

## 5. 관리자 API 엔드포인트

### 5.1 회사별 신입사원 목록 조회
```javascript
// server/routes/admin.js
const router = express.Router();

// 회사 신입사원 목록 조회
router.get('/company/users', 
    authenticateToken, 
    requireAdmin, 
    async (req, res) => {
        try {
            let query;
            let params = [];
            
            if (req.user.role === 'super_admin') {
                // 슈퍼 관리자: 모든 사용자 조회
                query = `
                    SELECT u.*, c.name as company_name 
                    FROM users u
                    LEFT JOIN companies c ON u.company_id = c.id
                    WHERE u.role = 'user'
                    ORDER BY u.created_at DESC
                `;
            } else {
                // 회사 관리자: 자기 회사 사용자만 조회
                query = `
                    SELECT u.*, c.name as company_name 
                    FROM users u
                    LEFT JOIN companies c ON u.company_id = c.id
                    WHERE u.role = 'user' AND u.company_id = $1
                    ORDER BY u.created_at DESC
                `;
                params = [req.user.companyId];
            }
            
            const result = await db.query(query, params);
            res.json({ users: result.rows });
        } catch (error) {
            res.status(500).json({ error: '사용자 목록 조회 실패' });
        }
    }
);

// 회사별 테스트 결과 통계
router.get('/company/statistics', 
    authenticateToken, 
    requireAdmin, 
    async (req, res) => {
        try {
            const companyId = req.user.role === 'super_admin' 
                ? req.query.companyId 
                : req.user.companyId;
            
            const stats = await db.query(`
                SELECT 
                    COUNT(DISTINCT u.id) as total_users,
                    COUNT(DISTINCT tr.id) as total_tests,
                    AVG(tr.overall_score) as avg_score,
                    MAX(tr.overall_score) as max_score,
                    MIN(tr.overall_score) as min_score
                FROM users u
                LEFT JOIN test_results tr ON u.user_id = tr.user_id
                WHERE u.company_id = $1 AND u.role = 'user'
            `, [companyId]);
            
            res.json({ statistics: stats.rows[0] });
        } catch (error) {
            res.status(500).json({ error: '통계 조회 실패' });
        }
    }
);
```

## 6. 관리자 로그인 분리

### 6.1 별도 관리자 로그인 페이지
```javascript
// server/routes/admin-auth.js

// 관리자 전용 로그인
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // 관리자 계정만 조회
        const result = await db.query(
            `SELECT * FROM users 
             WHERE email = $1 AND role IN ('super_admin', 'company_admin')`,
            [email]
        );
        
        if (!result.rows.length) {
            return res.status(401).json({ error: '관리자 계정이 아닙니다.' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
        }
        
        // 추가 보안: IP 확인, 2FA 등 구현 가능
        
        const token = generateToken(user);
        res.json({ 
            token, 
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                companyId: user.company_id
            }
        });
    } catch (error) {
        res.status(500).json({ error: '로그인 실패' });
    }
});
```

## 7. 보안 고려사항

### 7.1 추가 보안 조치
1. **IP 화이트리스트**: 관리자는 특정 IP에서만 접속 가능
2. **2FA 인증**: 관리자 로그인 시 추가 인증
3. **감사 로그**: 관리자의 모든 활동 기록
4. **권한 세분화**: 읽기/쓰기 권한 분리
5. **세션 관리**: 관리자 세션 시간 제한

### 7.2 데이터 보안
- 회사별 데이터 격리 철저히 확인
- SQL Injection 방지 (파라미터화된 쿼리 사용)
- XSS 방지 (입력값 검증)
- HTTPS 필수 사용

## 8. 구현 순서

1. **데이터베이스 마이그레이션 실행**
2. **인증/인가 미들웨어 구현**
3. **관리자 가입/로그인 API 구현**
4. **관리자 전용 API 라우터 구현**
5. **관리자 페이지 프론트엔드 구현**
6. **테스트 및 보안 검증**