# 🚨 신입사원 역량 테스트 - 관리자 기능 구현 가이드

## 📌 현재 상황 진단 및 문제점 분석

### 1. 데이터베이스 설계의 치명적 문제점

#### 🔴 문제점 1: Role 시스템 완전 부재
```sql
-- 현재 users 테이블 (role 컬럼이 없음!)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    login_type VARCHAR(20) NOT NULL,  -- 'email' 또는 'kakao'만 있음
    -- ❌ role 컬럼이 없어서 관리자/일반사용자 구분 불가
    -- ❌ company_id가 없어서 소속 회사 구분 불가
);
```

**왜 문제?**
- 모든 사용자가 동일한 권한을 가짐
- 관리자 페이지를 만들어도 누가 관리자인지 구분할 방법이 없음
- "나는 role을 구분하는데 성공했다"고 하셨지만, 실제 코드에는 role 컬럼 자체가 없음

#### 🔴 문제점 2: 회사/조직 개념 전무
```sql
-- ❌ companies 테이블이 없음
-- ❌ departments 테이블이 없음
-- ❌ user와 company 연결 방법이 없음
```

**왜 문제인가?**
- 신입사원이 어느 회사 소속인지 알 수 없음
- 관리자가 어느 회사의 관리자인지 구분 불가
- A회사 관리자가 B회사 직원 정보를 볼 수 있는 보안 문제 발생

### 2. 인증/인가 시스템의 문제점

#### 🔴 문제점 3: 인가(Authorization) 로직 완전 부재
```javascript
// 현재 server.js의 인증 미들웨어
const authenticateToken = (req, res, next) => {
    // ✅ JWT 토큰 검증만 함 (인증)
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '유효하지 않은 토큰' });
        req.user = user;
        next(); // ❌ 권한 체크 없이 모든 요청 통과!
    });
};

// ❌ 관리자 전용 API가 없음
// ❌ 역할 체크 미들웨어가 없음
// ❌ 회사별 데이터 필터링이 없음
```

**왜 문제인가?**
- 로그인한 사용자면 누구나 모든 API 호출 가능
- 관리자 전용 기능을 만들어도 일반 사용자가 접근 가능
- SQL Injection 등 보안 취약점에 노출

#### 🔴 문제점 4: 관리자 계정 생성 방법 부재
```javascript
// 현재 회원가입 코드
app.post('/api/auth/signup', async (req, res) => {
    const userData = {
        user_id: userId,
        name,
        email,
        password: hashedPassword,
        login_type: 'email'
        // ❌ role 설정 로직이 없음
        // ❌ 모든 사용자가 동일하게 생성됨
    };
});
```

**왜 문제인가?**
- 아무나 관리자로 가입할 수 있는 보안 위험
- 첫 번째 관리자를 어떻게 만들지 방법이 없음
- 관리자 초대 시스템이 없음

### 3. API 설계의 문제점

#### 🔴 문제점 5: RESTful API 구조 미흡
```javascript
// 현재 API 구조 - 모두 인증만 체크
app.get('/api/user/profile', authenticateToken, ...);  // ✅ 본인 정보만
app.get('/api/test/results', authenticateToken, ...);  // ✅ 본인 결과만

// ❌ 관리자용 API가 전혀 없음
// ❌ 다른 사용자 정보를 볼 수 있는 API 없음
// ❌ 통계/분석 API 없음
```

## 💡 단계별 해결 방안

### 📅 Phase 1: 데이터베이스 재설계 (1주차)

#### 1-1. 스키마 마이그레이션
```sql
-- 1단계: 기존 테이블 수정
ALTER TABLE users 
ADD COLUMN role VARCHAR(20) DEFAULT 'employee' 
    CHECK (role IN ('super_admin', 'company_admin', 'hr_manager', 'employee'));

ALTER TABLE users 
ADD COLUMN company_id INTEGER;

ALTER TABLE users 
ADD COLUMN department VARCHAR(100);

ALTER TABLE users 
ADD COLUMN employee_number VARCHAR(50);

ALTER TABLE users 
ADD COLUMN hire_date DATE;

-- 2단계: 회사 테이블 생성
CREATE TABLE companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE, -- 예: @samsung.com
    industry VARCHAR(100),
    size VARCHAR(50), -- 'small', 'medium', 'large', 'enterprise'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3단계: 관리자 초대 테이블
CREATE TABLE admin_invitations (
    id SERIAL PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    company_id INTEGER REFERENCES companies(id),
    role VARCHAR(20) NOT NULL,
    invited_by INTEGER REFERENCES users(id),
    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4단계: 권한 로그 테이블 (보안용)
CREATE TABLE permission_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100),
    granted BOOLEAN NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5단계: 외래키 설정
ALTER TABLE users 
ADD CONSTRAINT fk_user_company 
FOREIGN KEY (company_id) REFERENCES companies(id);

-- 6단계: 인덱스 생성
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_admin_invitations_token ON admin_invitations(token);
CREATE INDEX idx_permission_logs_user_action ON permission_logs(user_id, action);
```

#### 1-2. 초기 데이터 설정 스크립트
```javascript
// scripts/setup-initial-admin.js
const bcrypt = require('bcryptjs');
const db = require('../database/database');

async function setupInitialAdmin() {
    // 1. 첫 번째 회사 생성
    const company = await db.query(`
        INSERT INTO companies (name, domain, industry, size)
        VALUES ($1, $2, $3, $4)
        RETURNING id
    `, ['테스트 주식회사', 'test.com', 'IT', 'medium']);
    
    const companyId = company.rows[0].id;
    
    // 2. 슈퍼 관리자 생성
    const superAdminPassword = await bcrypt.hash('SuperAdmin123!', 10);
    await db.query(`
        INSERT INTO users (
            user_id, name, email, password, 
            login_type, role, company_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
        'super_admin_001',
        '슈퍼 관리자',
        'super@admin.com',
        superAdminPassword,
        'email',
        'super_admin',
        companyId
    ]);
    
    console.log('✅ 초기 설정 완료');
    console.log('📧 슈퍼 관리자 계정: super@admin.com / SuperAdmin123!');
}

// 실행
setupInitialAdmin().catch(console.error);
```

### 📅 Phase 2: 인증/인가 시스템 구축 (2주차)

#### 2-1. 향상된 인증 미들웨어
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../database/database');

// 기본 인증 (토큰 검증 + 사용자 정보 로드)
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                success: false,
                message: '인증이 필요합니다.' 
            });
        }

        // JWT 검증
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 사용자 정보 조회 (role, company 포함)
        const userResult = await db.query(`
            SELECT u.*, c.name as company_name 
            FROM users u
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE u.user_id = $1
        `, [decoded.userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: '사용자를 찾을 수 없습니다.' 
            });
        }

        // req.user에 전체 정보 저장
        req.user = userResult.rows[0];
        
        // 권한 로그 기록 (선택사항)
        await logPermission(req.user.id, req.method, req.path, true);
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false,
                message: '토큰이 만료되었습니다.' 
            });
        }
        
        return res.status(403).json({ 
            success: false,
            message: '유효하지 않은 토큰입니다.' 
        });
    }
};

// 역할 기반 접근 제어 (RBAC)
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: '인증이 필요합니다.' 
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            // 권한 거부 로그
            logPermission(
                req.user.id, 
                req.method, 
                req.path, 
                false, 
                `Required roles: ${allowedRoles.join(', ')}, User role: ${req.user.role}`
            );
            
            return res.status(403).json({ 
                success: false,
                message: '권한이 없습니다.',
                required_roles: allowedRoles,
                your_role: req.user.role
            });
        }

        next();
    };
};

// 같은 회사 소속 확인 미들웨어
const authorizeCompany = async (req, res, next) => {
    // 슈퍼 관리자는 모든 회사 접근 가능
    if (req.user.role === 'super_admin') {
        return next();
    }

    // 대상 사용자 ID 추출 (params, body, query에서)
    const targetUserId = req.params.userId || 
                        req.body.userId || 
                        req.query.userId;

    if (targetUserId) {
        const targetUser = await db.getUserById(targetUserId);
        
        if (!targetUser) {
            return res.status(404).json({ 
                success: false,
                message: '대상 사용자를 찾을 수 없습니다.' 
            });
        }

        // 다른 회사 직원 접근 차단
        if (targetUser.company_id !== req.user.company_id) {
            return res.status(403).json({ 
                success: false,
                message: '다른 회사의 직원 정보에 접근할 수 없습니다.' 
            });
        }

        req.targetUser = targetUser;
    }

    next();
};

// 본인 확인 미들웨어
const authorizeSelf = (req, res, next) => {
    const targetUserId = req.params.userId || req.body.userId;
    
    if (targetUserId !== req.user.user_id && req.user.role !== 'super_admin') {
        return res.status(403).json({ 
            success: false,
            message: '본인의 정보만 수정할 수 있습니다.' 
        });
    }
    
    next();
};

// 권한 로그 기록 함수
async function logPermission(userId, action, resource, granted, reason = null) {
    try {
        await db.query(`
            INSERT INTO permission_logs (user_id, action, resource, granted, reason)
            VALUES ($1, $2, $3, $4, $5)
        `, [userId, action, resource, granted, reason]);
    } catch (error) {
        console.error('권한 로그 기록 실패:', error);
    }
}

module.exports = {
    authenticate,
    authorize,
    authorizeCompany,
    authorizeSelf
};
```

#### 2-2. 관리자 전용 라우터
```javascript
// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authenticate, authorize, authorizeCompany } = require('../middleware/auth');
const db = require('../database/database');
const { sendEmail } = require('../utils/email');

// 모든 관리자 라우트는 인증 필요
router.use(authenticate);

// 회사 생성 (슈퍼 관리자만)
router.post('/companies', authorize('super_admin'), async (req, res) => {
    try {
        const { name, domain, industry, size } = req.body;
        
        // 도메인 중복 체크
        const existing = await db.query(
            'SELECT id FROM companies WHERE domain = $1',
            [domain]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 도메인입니다.'
            });
        }
        
        const result = await db.query(`
            INSERT INTO companies (name, domain, industry, size)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [name, domain, industry, size]);
        
        res.json({
            success: true,
            company: result.rows[0]
        });
    } catch (error) {
        console.error('회사 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '회사 생성 중 오류가 발생했습니다.'
        });
    }
});

// 관리자 초대 (슈퍼 관리자 또는 회사 관리자)
router.post('/invite', authorize('super_admin', 'company_admin'), async (req, res) => {
    try {
        const { email, role, companyId } = req.body;
        
        // 회사 관리자는 자기 회사에만 초대 가능
        if (req.user.role === 'company_admin') {
            if (companyId !== req.user.company_id) {
                return res.status(403).json({
                    success: false,
                    message: '다른 회사에 관리자를 초대할 수 없습니다.'
                });
            }
            
            // 회사 관리자는 hr_manager만 초대 가능
            if (role !== 'hr_manager') {
                return res.status(403).json({
                    success: false,
                    message: 'HR 매니저만 초대할 수 있습니다.'
                });
            }
        }
        
        // 이미 가입된 사용자인지 확인
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: '이미 가입된 사용자입니다.'
            });
        }
        
        // 초대 토큰 생성
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7일 후 만료
        
        await db.query(`
            INSERT INTO admin_invitations 
            (token, email, company_id, role, invited_by, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [token, email, companyId, role, req.user.id, expiresAt]);
        
        // 초대 이메일 발송
        const inviteUrl = `${process.env.FRONTEND_URL}/admin/accept-invite?token=${token}`;
        await sendEmail({
            to: email,
            subject: '관리자 초대',
            html: `
                <h2>관리자로 초대되었습니다</h2>
                <p>${req.user.name}님이 당신을 ${role} 권한으로 초대했습니다.</p>
                <p>아래 링크를 클릭하여 가입을 완료하세요:</p>
                <a href="${inviteUrl}">${inviteUrl}</a>
                <p>이 링크는 7일 후 만료됩니다.</p>
            `
        });
        
        res.json({
            success: true,
            message: '초대 이메일이 발송되었습니다.'
        });
    } catch (error) {
        console.error('관리자 초대 오류:', error);
        res.status(500).json({
            success: false,
            message: '초대 중 오류가 발생했습니다.'
        });
    }
});

// 초대 수락 (인증 불필요)
router.post('/accept-invitation', async (req, res) => {
    try {
        const { token, name, password } = req.body;
        
        // 토큰 확인
        const inviteResult = await db.query(`
            SELECT i.*, c.name as company_name
            FROM admin_invitations i
            JOIN companies c ON i.company_id = c.id
            WHERE i.token = $1 
                AND i.used = false 
                AND i.expires_at > NOW()
        `, [token]);
        
        if (inviteResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않거나 만료된 초대 링크입니다.'
            });
        }
        
        const invitation = inviteResult.rows[0];
        
        // 비밀번호 해시화
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 사용자 생성
        const userId = `${invitation.role}_${Date.now()}`;
        await db.query(`
            INSERT INTO users 
            (user_id, name, email, password, login_type, role, company_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            userId,
            name,
            invitation.email,
            hashedPassword,
            'email',
            invitation.role,
            invitation.company_id
        ]);
        
        // 초대 사용 처리
        await db.query(
            'UPDATE admin_invitations SET used = true WHERE id = $1',
            [invitation.id]
        );
        
        res.json({
            success: true,
            message: '관리자 계정이 생성되었습니다.',
            redirect: '/admin/login'
        });
    } catch (error) {
        console.error('초대 수락 오류:', error);
        res.status(500).json({
            success: false,
            message: '계정 생성 중 오류가 발생했습니다.'
        });
    }
});

// 직원 목록 조회
router.get('/employees', 
    authorize('super_admin', 'company_admin', 'hr_manager'), 
    async (req, res) => {
    try {
        let query;
        let params;
        
        if (req.user.role === 'super_admin') {
            // 슈퍼 관리자: 모든 직원 조회 가능
            const companyId = req.query.companyId;
            if (companyId) {
                query = `
                    SELECT u.*, c.name as company_name,
                           COUNT(DISTINCT tr.id) as test_count,
                           MAX(tr.test_date) as last_test_date,
                           AVG(tr.overall_score) as avg_score
                    FROM users u
                    LEFT JOIN companies c ON u.company_id = c.id
                    LEFT JOIN test_results tr ON u.user_id = tr.user_id
                    WHERE u.role = 'employee' AND u.company_id = $1
                    GROUP BY u.id, c.id
                    ORDER BY u.created_at DESC
                `;
                params = [companyId];
            } else {
                query = `
                    SELECT u.*, c.name as company_name,
                           COUNT(DISTINCT tr.id) as test_count,
                           MAX(tr.test_date) as last_test_date,
                           AVG(tr.overall_score) as avg_score
                    FROM users u
                    LEFT JOIN companies c ON u.company_id = c.id
                    LEFT JOIN test_results tr ON u.user_id = tr.user_id
                    WHERE u.role = 'employee'
                    GROUP BY u.id, c.id
                    ORDER BY c.name, u.created_at DESC
                `;
                params = [];
            }
        } else {
            // 회사 관리자/HR: 자기 회사 직원만
            query = `
                SELECT u.*,
                       COUNT(DISTINCT tr.id) as test_count,
                       MAX(tr.test_date) as last_test_date,
                       AVG(tr.overall_score) as avg_score
                FROM users u
                LEFT JOIN test_results tr ON u.user_id = tr.user_id
                WHERE u.role = 'employee' AND u.company_id = $1
                GROUP BY u.id
                ORDER BY u.created_at DESC
            `;
            params = [req.user.company_id];
        }
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            employees: result.rows,
            total: result.rows.length
        });
    } catch (error) {
        console.error('직원 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '직원 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 직원 상세 정보 조회
router.get('/employees/:userId', 
    authorize('super_admin', 'company_admin', 'hr_manager'),
    authorizeCompany,
    async (req, res) => {
    try {
        const { userId } = req.params;
        
        // 직원 정보 조회
        const employeeResult = await db.query(`
            SELECT u.*, c.name as company_name
            FROM users u
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE u.user_id = $1
        `, [userId]);
        
        if (employeeResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '직원을 찾을 수 없습니다.'
            });
        }
        
        const employee = employeeResult.rows[0];
        
        // 테스트 결과 조회
        const testResults = await db.query(`
            SELECT * FROM test_results 
            WHERE user_id = $1 
            ORDER BY test_date DESC
        `, [userId]);
        
        // 통계 계산
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_tests,
                AVG(overall_score) as avg_overall,
                AVG(problem_solving_score) as avg_problem_solving,
                AVG(communication_score) as avg_communication,
                AVG(leadership_score) as avg_leadership,
                AVG(creativity_score) as avg_creativity,
                AVG(teamwork_score) as avg_teamwork,
                MAX(overall_score) as best_score,
                MIN(overall_score) as worst_score
            FROM test_results
            WHERE user_id = $1
        `, [userId]);
        
        res.json({
            success: true,
            employee: employee,
            testResults: testResults.rows,
            statistics: stats.rows[0]
        });
    } catch (error) {
        console.error('직원 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '직원 정보 조회 중 오류가 발생했습니다.'
        });
    }
});

// 직원 회사 할당/변경
router.put('/employees/:userId/assign', 
    authorize('super_admin', 'company_admin'),
    async (req, res) => {
    try {
        const { userId } = req.params;
        const { companyId } = req.body;
        
        // 회사 관리자는 자기 회사로만 할당 가능
        if (req.user.role === 'company_admin' && companyId !== req.user.company_id) {
            return res.status(403).json({
                success: false,
                message: '다른 회사로 직원을 할당할 수 없습니다.'
            });
        }
        
        // 회사 존재 확인
        const companyExists = await db.query(
            'SELECT id FROM companies WHERE id = $1',
            [companyId]
        );
        
        if (companyExists.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '존재하지 않는 회사입니다.'
            });
        }
        
        // 직원 업데이트
        const result = await db.query(`
            UPDATE users 
            SET company_id = $1, updated_at = NOW()
            WHERE user_id = $2 AND role = 'employee'
            RETURNING *
        `, [companyId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '직원을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '직원이 회사에 할당되었습니다.',
            employee: result.rows[0]
        });
    } catch (error) {
        console.error('직원 할당 오류:', error);
        res.status(500).json({
            success: false,
            message: '직원 할당 중 오류가 발생했습니다.'
        });
    }
});

// 회사별 통계
router.get('/statistics', 
    authorize('super_admin', 'company_admin', 'hr_manager'),
    async (req, res) => {
    try {
        const companyId = req.user.role === 'super_admin' 
            ? req.query.companyId 
            : req.user.company_id;
        
        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: '회사 ID가 필요합니다.'
            });
        }
        
        // 기본 통계
        const basicStats = await db.query(`
            SELECT 
                COUNT(DISTINCT u.id) as total_employees,
                COUNT(DISTINCT CASE WHEN tr.id IS NOT NULL THEN u.id END) as tested_employees,
                COUNT(DISTINCT tr.id) as total_tests,
                AVG(tr.overall_score) as avg_overall_score,
                AVG(tr.problem_solving_score) as avg_problem_solving,
                AVG(tr.communication_score) as avg_communication,
                AVG(tr.leadership_score) as avg_leadership,
                AVG(tr.creativity_score) as avg_creativity,
                AVG(tr.teamwork_score) as avg_teamwork
            FROM users u
            LEFT JOIN test_results tr ON u.user_id = tr.user_id
            WHERE u.company_id = $1 AND u.role = 'employee'
        `, [companyId]);
        
        // 월별 테스트 추이
        const monthlyTrend = await db.query(`
            SELECT 
                DATE_TRUNC('month', tr.test_date) as month,
                COUNT(DISTINCT tr.id) as test_count,
                COUNT(DISTINCT tr.user_id) as unique_users,
                AVG(tr.overall_score) as avg_score
            FROM test_results tr
            JOIN users u ON tr.user_id = u.user_id
            WHERE u.company_id = $1 AND u.role = 'employee'
                AND tr.test_date >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', tr.test_date)
            ORDER BY month DESC
        `, [companyId]);
        
        // 부서별 통계 (부서 필드가 있다면)
        const departmentStats = await db.query(`
            SELECT 
                u.department,
                COUNT(DISTINCT u.id) as employee_count,
                AVG(tr.overall_score) as avg_score
            FROM users u
            LEFT JOIN test_results tr ON u.user_id = tr.user_id
            WHERE u.company_id = $1 AND u.role = 'employee'
                AND u.department IS NOT NULL
            GROUP BY u.department
            ORDER BY employee_count DESC
        `, [companyId]);
        
        res.json({
            success: true,
            statistics: {
                basic: basicStats.rows[0],
                monthlyTrend: monthlyTrend.rows,
                byDepartment: departmentStats.rows
            }
        });
    } catch (error) {
        console.error('통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '통계 조회 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
```

### 📅 Phase 3: 프론트엔드 관리자 인터페이스 (3주차)

#### 3-1. 관리자 대시보드 HTML
```html
<!-- client/admin/dashboard.html -->
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>관리자 대시보드 - 신입사원 역량 테스트</title>
    <link rel="stylesheet" href="/css/admin.css">
</head>
<body>
    <div class="admin-container">
        <!-- 사이드바 -->
        <aside class="sidebar">
            <div class="logo">
                <h2>관리자 패널</h2>
            </div>
            <nav class="nav-menu">
                <ul>
                    <li class="active">
                        <a href="#dashboard" data-page="dashboard">
                            <span class="icon">📊</span> 대시보드
                        </a>
                    </li>
                    <li>
                        <a href="#employees" data-page="employees">
                            <span class="icon">👥</span> 직원 관리
                        </a>
                    </li>
                    <li>
                        <a href="#tests" data-page="tests">
                            <span class="icon">📝</span> 테스트 결과
                        </a>
                    </li>
                    <li id="companies-menu" style="display:none;">
                        <a href="#companies" data-page="companies">
                            <span class="icon">🏢</span> 회사 관리
                        </a>
                    </li>
                    <li id="admins-menu" style="display:none;">
                        <a href="#admins" data-page="admins">
                            <span class="icon">👨‍💼</span> 관리자 관리
                        </a>
                    </li>
                </ul>
            </nav>
            <div class="user-info">
                <p class="user-name"></p>
                <p class="user-role"></p>
                <button class="logout-btn">로그아웃</button>
            </div>
        </aside>

        <!-- 메인 콘텐츠 -->
        <main class="main-content">
            <!-- 대시보드 페이지 -->
            <section id="dashboard-page" class="page active">
                <header class="page-header">
                    <h1>대시보드</h1>
                    <p class="subtitle">전체 현황을 한눈에 확인하세요</p>
                </header>

                <!-- 통계 카드 -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">👥</div>
                        <div class="stat-content">
                            <h3>전체 직원</h3>
                            <p class="stat-number" id="total-employees">0</p>
                            <p class="stat-change">+0% 이번 달</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">✅</div>
                        <div class="stat-content">
                            <h3>테스트 완료</h3>
                            <p class="stat-number" id="tested-employees">0</p>
                            <p class="stat-change">0% 완료율</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">📊</div>
                        <div class="stat-content">
                            <h3>평균 점수</h3>
                            <p class="stat-number" id="avg-score">0</p>
                            <p class="stat-change">전체 평균</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🎯</div>
                        <div class="stat-content">
                            <h3>이번 달 테스트</h3>
                            <p class="stat-number" id="monthly-tests">0</p>
                            <p class="stat-change">+0% 지난 달 대비</p>
                        </div>
                    </div>
                </div>

                <!-- 차트 영역 -->
                <div class="charts-grid">
                    <div class="chart-container">
                        <h3>월별 테스트 현황</h3>
                        <canvas id="monthly-chart"></canvas>
                    </div>
                    <div class="chart-container">
                        <h3>역량별 평균 점수</h3>
                        <canvas id="skills-chart"></canvas>
                    </div>
                </div>
            </section>

            <!-- 직원 관리 페이지 -->
            <section id="employees-page" class="page">
                <header class="page-header">
                    <h1>직원 관리</h1>
                    <div class="header-actions">
                        <input type="search" 
                               id="employee-search" 
                               placeholder="이름, 이메일로 검색..."
                               class="search-input">
                        <button class="btn btn-primary" id="assign-employee-btn">
                            직원 할당
                        </button>
                    </div>
                </header>

                <!-- 필터 -->
                <div class="filters">
                    <select id="department-filter" class="filter-select">
                        <option value="">모든 부서</option>
                    </select>
                    <select id="test-status-filter" class="filter-select">
                        <option value="">모든 상태</option>
                        <option value="completed">테스트 완료</option>
                        <option value="not-completed">미완료</option>
                    </select>
                </div>

                <!-- 직원 테이블 -->
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>이름</th>
                                <th>이메일</th>
                                <th>부서</th>
                                <th>입사일</th>
                                <th>테스트 횟수</th>
                                <th>마지막 테스트</th>
                                <th>평균 점수</th>
                                <th>작업</th>
                            </tr>
                        </thead>
                        <tbody id="employees-tbody">
                            <!-- 직원 데이터가 여기에 렌더링됨 -->
                        </tbody>
                    </table>
                </div>

                <!-- 페이지네이션 -->
                <div class="pagination" id="employees-pagination"></div>
            </section>

            <!-- 기타 페이지들... -->
        </main>
    </div>

    <!-- 모달 -->
    <div id="modal-container"></div>

    <!-- Scripts -->
    <script src="/js/utils/api.js"></script>
    <script src="/js/admin/dashboard.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</body>
</html>
```

#### 3-2. 관리자 대시보드 JavaScript
```javascript
// client/js/admin/dashboard.js
class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'dashboard';
        this.charts = {};
        
        this.init();
    }

    async init() {
        try {
            // 인증 확인
            await this.checkAuth();
            
            // UI 초기화
            this.setupNavigation();
            this.setupEventListeners();
            
            // 초기 데이터 로드
            await this.loadDashboardData();
        } catch (error) {
            console.error('대시보드 초기화 실패:', error);
            window.location.href = '/admin/login.html';
        }
    }

    async checkAuth() {
        try {
            const response = await api.get('/api/user/profile');
            this.currentUser = response.user;
            
            // 관리자 권한 확인
            if (!['super_admin', 'company_admin', 'hr_manager'].includes(this.currentUser.role)) {
                throw new Error('관리자 권한이 없습니다.');
            }
            
            // UI에 사용자 정보 표시
            this.updateUserInfo();
            
            // 권한에 따른 메뉴 표시/숨김
            this.updateMenuVisibility();
        } catch (error) {
            throw error;
        }
    }

    updateUserInfo() {
        document.querySelector('.user-name').textContent = this.currentUser.name;
        document.querySelector('.user-role').textContent = this.getRoleDisplayName(this.currentUser.role);
    }

    getRoleDisplayName(role) {
        const roleNames = {
            'super_admin': '슈퍼 관리자',
            'company_admin': '회사 관리자',
            'hr_manager': 'HR 매니저',
            'employee': '직원'
        };
        return roleNames[role] || role;
    }

    updateMenuVisibility() {
        // 슈퍼 관리자만 볼 수 있는 메뉴
        if (this.currentUser.role === 'super_admin') {
            document.getElementById('companies-menu').style.display = 'block';
            document.getElementById('admins-menu').style.display = 'block';
        }
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-menu a');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });
    }

    navigateToPage(page) {
        // 현재 페이지 숨김
        document.querySelector('.page.active').classList.remove('active');
        document.querySelector('.nav-menu li.active').classList.remove('active');
        
        // 새 페이지 표시
        document.getElementById(`${page}-page`).classList.add('active');
        document.querySelector(`[data-page="${page}"]`).parentElement.classList.add('active');
        
        this.currentPage = page;
        
        // 페이지별 데이터 로드
        this.loadPageData(page);
    }

    async loadPageData(page) {
        try {
            switch (page) {
                case 'dashboard':
                    await this.loadDashboardData();
                    break;
                case 'employees':
                    await this.loadEmployeesData();
                    break;
                case 'tests':
                    await this.loadTestsData();
                    break;
                case 'companies':
                    await this.loadCompaniesData();
                    break;
                case 'admins':
                    await this.loadAdminsData();
                    break;
            }
        } catch (error) {
            console.error(`${page} 데이터 로드 실패:`, error);
            this.showError(`데이터를 불러오는 중 오류가 발생했습니다.`);
        }
    }

    async loadDashboardData() {
        try {
            // 통계 데이터 로드
            const stats = await api.get('/api/admin/statistics');
            this.updateStatCards(stats.statistics.basic);
            
            // 차트 데이터 로드 및 렌더링
            this.renderMonthlyChart(stats.statistics.monthlyTrend);
            this.renderSkillsChart(stats.statistics.basic);
        } catch (error) {
            console.error('대시보드 데이터 로드 실패:', error);
        }
    }

    updateStatCards(stats) {
        document.getElementById('total-employees').textContent = stats.total_employees || 0;
        document.getElementById('tested-employees').textContent = stats.tested_employees || 0;
        document.getElementById('avg-score').textContent = 
            Math.round(stats.avg_overall_score || 0);
        
        // 완료율 계산
        const completionRate = stats.total_employees > 0 
            ? Math.round((stats.tested_employees / stats.total_employees) * 100)
            : 0;
        
        document.querySelector('#tested-employees').nextElementSibling.textContent = 
            `${completionRate}% 완료율`;
    }

    renderMonthlyChart(data) {
        const ctx = document.getElementById('monthly-chart').getContext('2d');
        
        // 기존 차트 제거
        if (this.charts.monthly) {
            this.charts.monthly.destroy();
        }
        
        this.charts.monthly = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.month).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'short'
                })),
                datasets: [{
                    label: '테스트 횟수',
                    data: data.map(d => d.test_count),
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }, {
                    label: '평균 점수',
                    data: data.map(d => d.avg_score),
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: {
                            drawOnChartArea: false,
                        },
                    },
                }
            }
        });
    }

    renderSkillsChart(stats) {
        const ctx = document.getElementById('skills-chart').getContext('2d');
        
        if (this.charts.skills) {
            this.charts.skills.destroy();
        }
        
        this.charts.skills = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['문제해결', '의사소통', '리더십', '창의성', '팀워크'],
                datasets: [{
                    label: '평균 점수',
                    data: [
                        stats.avg_problem_solving || 0,
                        stats.avg_communication || 0,
                        stats.avg_leadership || 0,
                        stats.avg_creativity || 0,
                        stats.avg_teamwork || 0
                    ],
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderColor: 'rgb(75, 192, 192)',
                    pointBackgroundColor: 'rgb(75, 192, 192)',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
    }

    async loadEmployeesData() {
        try {
            const response = await api.get('/api/admin/employees');
            this.renderEmployeesTable(response.employees);
        } catch (error) {
            console.error('직원 데이터 로드 실패:', error);
        }
    }

    renderEmployeesTable(employees) {
        const tbody = document.getElementById('employees-tbody');
        
        if (employees.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center">등록된 직원이 없습니다.</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = employees.map(emp => `
            <tr>
                <td>${emp.name}</td>
                <td>${emp.email}</td>
                <td>${emp.department || '-'}</td>
                <td>${emp.hire_date ? new Date(emp.hire_date).toLocaleDateString() : '-'}</td>
                <td>${emp.test_count || 0}</td>
                <td>${emp.last_test_date ? new Date(emp.last_test_date).toLocaleDateString() : '미응시'}</td>
                <td>${emp.avg_score ? Math.round(emp.avg_score) : '-'}</td>
                <td>
                    <button class="btn btn-sm" onclick="dashboard.viewEmployee('${emp.user_id}')">
                        상세
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async viewEmployee(userId) {
        try {
            const response = await api.get(`/api/admin/employees/${userId}`);
            this.showEmployeeModal(response.employee, response.testResults, response.statistics);
        } catch (error) {
            console.error('직원 상세 정보 로드 실패:', error);
            this.showError('직원 정보를 불러올 수 없습니다.');
        }
    }

    showEmployeeModal(employee, testResults, statistics) {
        const modal = `
            <div class="modal" id="employee-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>${employee.name} - 상세 정보</h2>
                        <button class="close-btn" onclick="dashboard.closeModal()">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="employee-info">
                            <h3>기본 정보</h3>
                            <p><strong>이메일:</strong> ${employee.email}</p>
                            <p><strong>회사:</strong> ${employee.company_name || '-'}</p>
                            <p><strong>부서:</strong> ${employee.department || '-'}</p>
                            <p><strong>가입일:</strong> ${new Date(employee.created_at).toLocaleDateString()}</p>
                        </div>
                        
                        <div class="test-statistics">
                            <h3>테스트 통계</h3>
                            <div class="stats-grid mini">
                                <div class="stat-item">
                                    <span class="label">총 테스트</span>
                                    <span class="value">${statistics.total_tests || 0}회</span>
                                </div>
                                <div class="stat-item">
                                    <span class="label">평균 점수</span>
                                    <span class="value">${Math.round(statistics.avg_overall || 0)}점</span>
                                </div>
                                <div class="stat-item">
                                    <span class="label">최고 점수</span>
                                    <span class="value">${statistics.best_score || 0}점</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="test-history">
                            <h3>테스트 이력</h3>
                            ${this.renderTestHistory(testResults)}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeModal()">닫기</button>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('modal-container').innerHTML = modal;
        document.getElementById('employee-modal').style.display = 'flex';
    }

    renderTestHistory(testResults) {
        if (testResults.length === 0) {
            return '<p class="no-data">테스트 이력이 없습니다.</p>';
        }
        
        return `
            <table class="data-table compact">
                <thead>
                    <tr>
                        <th>테스트 날짜</th>
                        <th>전체 점수</th>
                        <th>문제해결</th>
                        <th>의사소통</th>
                        <th>리더십</th>
                        <th>창의성</th>
                        <th>팀워크</th>
                    </tr>
                </thead>
                <tbody>
                    ${testResults.map(result => `
                        <tr>
                            <td>${new Date(result.test_date).toLocaleDateString()}</td>
                            <td><strong>${result.overall_score}</strong></td>
                            <td>${result.problem_solving_score}</td>
                            <td>${result.communication_score}</td>
                            <td>${result.leadership_score}</td>
                            <td>${result.creativity_score}</td>
                            <td>${result.teamwork_score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    closeModal() {
        document.getElementById('modal-container').innerHTML = '';
    }

    setupEventListeners() {
        // 로그아웃
        document.querySelector('.logout-btn').addEventListener('click', async () => {
            try {
                await api.post('/api/auth/logout');
                window.location.href = '/admin/login.html';
            } catch (error) {
                console.error('로그아웃 실패:', error);
            }
        });

        // 직원 검색
        const searchInput = document.getElementById('employee-search');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                this.searchEmployees(e.target.value);
            }, 300));
        }

        // 직원 할당 버튼
        const assignBtn = document.getElementById('assign-employee-btn');
        if (assignBtn) {
            assignBtn.addEventListener('click', () => {
                this.showAssignEmployeeModal();
            });
        }
    }

    async searchEmployees(query) {
        if (!query.trim()) {
            await this.loadEmployeesData();
            return;
        }

        try {
            const response = await api.get(`/api/admin/employees?search=${encodeURIComponent(query)}`);
            this.renderEmployeesTable(response.employees);
        } catch (error) {
            console.error('직원 검색 실패:', error);
        }
    }

    showAssignEmployeeModal() {
        const modal = `
            <div class="modal" id="assign-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>직원 회사 할당</h2>
                        <button class="close-btn" onclick="dashboard.closeModal()">×</button>
                    </div>
                    <div class="modal-body">
                        <form id="assign-form">
                            <div class="form-group">
                                <label for="employee-email">직원 이메일</label>
                                <input type="email" 
                                       id="employee-email" 
                                       required 
                                       placeholder="employee@example.com">
                            </div>
                            ${this.currentUser.role === 'super_admin' ? `
                                <div class="form-group">
                                    <label for="company-select">회사 선택</label>
                                    <select id="company-select" required>
                                        <option value="">회사를 선택하세요</option>
                                    </select>
                                </div>
                            ` : ''}
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeModal()">취소</button>
                        <button class="btn btn-primary" onclick="dashboard.assignEmployee()">할당</button>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('modal-container').innerHTML = modal;
        document.getElementById('assign-modal').style.display = 'flex';
        
        // 슈퍼 관리자인 경우 회사 목록 로드
        if (this.currentUser.role === 'super_admin') {
            this.loadCompaniesForSelect();
        }
    }

    async loadCompaniesForSelect() {
        try {
            const response = await api.get('/api/admin/companies');
            const select = document.getElementById('company-select');
            
            select.innerHTML = '<option value="">회사를 선택하세요</option>' +
                response.companies.map(company => 
                    `<option value="${company.id}">${company.name}</option>`
                ).join('');
        } catch (error) {
            console.error('회사 목록 로드 실패:', error);
        }
    }

    async assignEmployee() {
        const email = document.getElementById('employee-email').value;
        const companyId = this.currentUser.role === 'super_admin' 
            ? document.getElementById('company-select').value
            : this.currentUser.company_id;

        if (!email || !companyId) {
            this.showError('모든 필드를 입력해주세요.');
            return;
        }

        try {
            // 먼저 이메일로 사용자 찾기
            const userResponse = await api.get(`/api/admin/employees?email=${email}`);
            if (!userResponse.employees || userResponse.employees.length === 0) {
                throw new Error('해당 이메일의 직원을 찾을 수 없습니다.');
            }

            const userId = userResponse.employees[0].user_id;

            // 회사 할당
            await api.put(`/api/admin/employees/${userId}/assign`, { companyId });
            
            this.showSuccess('직원이 성공적으로 할당되었습니다.');
            this.closeModal();
            await this.loadEmployeesData();
        } catch (error) {
            console.error('직원 할당 실패:', error);
            this.showError(error.message || '직원 할당 중 오류가 발생했습니다.');
        }
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
}

// 유틸리티 함수
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 전역 인스턴스 생성
const dashboard = new AdminDashboard();
```

### 📅 Phase 4: 보안 강화 및 배포 준비 (4주차)

#### 4-1. 환경 변수 설정
```bash
# .env.example
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/employee_assessment

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRY=7d

# Admin Setup
SETUP_KEY=initial-setup-key-change-this

# Email (for invitations)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Frontend URL
FRONTEND_URL=https://your-domain.com

# Security
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
SESSION_SECRET=your-session-secret-change-this

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

#### 4-2. 보안 미들웨어 추가
```javascript
// middleware/security.js
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');

// Rate limiting 설정
const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message,
        standardHeaders: true,
        legacyHeaders: false,
    });
};

// 로그인 시도 제한
const loginLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    5, // 최대 5회
    '너무 많은 로그인 시도입니다. 15분 후 다시 시도해주세요.'
);

// API 요청 제한
const apiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    100, // 최대 100회
    '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
);

// SQL Injection 방지
const preventSQLInjection = (req, res, next) => {
    const suspicious = /(\b(union|select|insert|update|delete|drop|create|alter|exec|script)\b)/gi;
    
    const checkValue = (value) => {
        if (typeof value === 'string' && suspicious.test(value)) {
            return true;
        }
        return false;
    };
    
    // Check all inputs
    for (const key in req.body) {
        if (checkValue(req.body[key])) {
            return res.status(400).json({
                success: false,
                message: '잘못된 입력입니다.'
            });
        }
    }
    
    for (const key in req.query) {
        if (checkValue(req.query[key])) {
            return res.status(400).json({
                success: false,
                message: '잘못된 입력입니다.'
            });
        }
    }
    
    next();
};

// XSS 방지
const sanitizeInput = (req, res, next) => {
    const sanitize = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                // HTML 태그 제거
                obj[key] = obj[key].replace(/<[^>]*>/g, '');
                // 스크립트 태그 제거
                obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitize(obj[key]);
            }
        }
    };
    
    sanitize(req.body);
    sanitize(req.query);
    sanitize(req.params);
    
    next();
};

module.exports = {
    loginLimiter,
    apiLimiter,
    preventSQLInjection,
    sanitizeInput,
    helmet: helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:"],
            },
        },
    }),
};
```

## 🎯 실행 계획 및 체크리스트

### Week 1: 기초 구축
- [ ] 데이터베이스 백업
- [ ] 스키마 마이그레이션 스크립트 작성
- [ ] 테스트 환경에서 마이그레이션 실행
- [ ] 초기 관리자 계정 생성
- [ ] 기본 권한 시스템 테스트

### Week 2: 백엔드 개발
- [ ] 인증/인가 미들웨어 구현
- [ ] 관리자 API 라우터 구현
- [ ] 직원 관리 API 구현
- [ ] API 테스트 작성
- [ ] Postman 컬렉션 생성

### Week 3: 프론트엔드 개발
- [ ] 관리자 로그인 페이지
- [ ] 대시보드 UI 구현
- [ ] 직원 관리 인터페이스
- [ ] 통계 차트 구현
- [ ] 반응형 디자인 적용

### Week 4: 보안 및 배포
- [ ] 보안 미들웨어 적용
- [ ] 성능 최적화
- [ ] 에러 처리 강화
- [ ] 로깅 시스템 구현
- [ ] 배포 및 모니터링

## 📚 추가 학습 자료

1. **인증/인가 개념**
   - [JWT 이해하기](https://jwt.io/introduction)
   - [OAuth 2.0 이해하기](https://oauth.net/2/)

2. **보안 Best Practices**
   - OWASP Top 10
   - Node.js 보안 체크리스트

3. **데이터베이스 설계**
   - 정규화 이론
   - 인덱스 최적화

## 🚀 다음 단계 제안

1. **테스트 자동화**
   - Jest를 이용한 단위 테스트
   - Supertest를 이용한 API 테스트

2. **CI/CD 파이프라인**
   - GitHub Actions 설정
   - 자동 배포 구성

3. **모니터링**
   - 에러 트래킹 (Sentry)
   - 성능 모니터링 (New Relic)

4. **추가 기능**
   - 대량 사용자 가입 (CSV 업로드)
   - 테스트 결과 PDF 리포트
   - 이메일 알림 시스템
   - 다국어 지원

이 가이드를 따라 단계별로 구현하면 안전하고 확장 가능한 관리자 시스템을 구축할 수 있습니다. 각 단계마다 테스트를 충분히 하고, 보안을 최우선으로 고려하세요.