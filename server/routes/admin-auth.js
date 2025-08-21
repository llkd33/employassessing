const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../../database/database');
const { generateToken } = require('../middleware/auth');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 관리자 회원가입 (회사 코드 필요)
router.post('/signup', async (req, res) => {
    const { email, password, name, companyCode } = req.body;
    
    try {
        // 필수 필드 검증
        if (!email || !password || !name || !companyCode) {
            return res.status(400).json({ 
                error: '모든 필드를 입력해주세요.' 
            });
        }
        
        // 이메일 형식 검증
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                error: '유효한 이메일 주소를 입력해주세요.' 
            });
        }
        
        // 비밀번호 강도 검증
        if (password.length < 8) {
            return res.status(400).json({ 
                error: '비밀번호는 최소 8자 이상이어야 합니다.' 
            });
        }
        
        // 회사 코드 검증
        const companyResult = await pool.query(
            'SELECT id, name, domain FROM companies WHERE code = $1',
            [companyCode]
        );
        
        if (!companyResult.rows.length) {
            return res.status(400).json({ 
                error: '유효하지 않은 회사 코드입니다.' 
            });
        }
        
        const company = companyResult.rows[0];
        
        // 회사 도메인 검증 (선택사항)
        if (company.domain && !email.endsWith(company.domain)) {
            return res.status(400).json({ 
                error: `회사 이메일 도메인(${company.domain})을 사용해주세요.` 
            });
        }
        
        // 중복 이메일 확인
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        
        if (existingUser.rows.length) {
            return res.status(400).json({ 
                error: '이미 사용 중인 이메일입니다.' 
            });
        }
        
        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 관리자 계정 생성
        const userId = `admin_${Date.now()}`;
        const result = await pool.query(
            `INSERT INTO users 
            (user_id, email, password, name, role, company_id, login_type) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            RETURNING id, user_id, email, name, role, company_id`,
            [
                userId,
                email,
                hashedPassword,
                name,
                'company_admin',
                company.id,
                'email'
            ]
        );
        
        const newUser = result.rows[0];
        
        // 토큰 생성
        const token = generateToken(newUser);
        
        res.status(201).json({ 
            success: true,
            message: '관리자 계정이 생성되었습니다.',
            user: {
                id: newUser.id,
                userId: newUser.user_id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
                companyId: newUser.company_id,
                companyName: company.name
            },
            token
        });
        
    } catch (error) {
        console.error('관리자 가입 오류:', error);
        res.status(500).json({ 
            error: '관리자 가입 중 오류가 발생했습니다.' 
        });
    }
});

// 관리자 로그인
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // 필수 필드 검증
        if (!email || !password) {
            return res.status(400).json({ 
                error: '이메일과 비밀번호를 입력해주세요.' 
            });
        }
        
        // 관리자 계정 조회 (회사 정보 포함)
        const result = await pool.query(
            `SELECT u.*, c.name as company_name 
            FROM users u
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE u.email = $1 AND u.role IN ('super_admin', 'company_admin')`,
            [email]
        );
        
        if (!result.rows.length) {
            return res.status(401).json({ 
                error: '관리자 계정을 찾을 수 없습니다.' 
            });
        }
        
        const user = result.rows[0];
        
        // 비밀번호 검증
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ 
                error: '비밀번호가 일치하지 않습니다.' 
            });
        }
        
        // 로그인 시간 업데이트
        await pool.query(
            'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        // 관리자 활동 로그 기록
        await pool.query(
            `INSERT INTO admin_activity_logs 
            (admin_id, action, details, ip_address) 
            VALUES ($1, $2, $3, $4)`,
            [
                user.user_id,
                'admin_login',
                JSON.stringify({ email }),
                req.ip
            ]
        );
        
        // 토큰 생성
        const token = generateToken(user);
        
        res.json({ 
            success: true,
            message: '로그인되었습니다.',
            user: {
                id: user.id,
                userId: user.user_id,
                email: user.email,
                name: user.name,
                role: user.role,
                companyId: user.company_id,
                companyName: user.company_name
            },
            token
        });
        
    } catch (error) {
        console.error('관리자 로그인 오류:', error);
        res.status(500).json({ 
            error: '로그인 중 오류가 발생했습니다.' 
        });
    }
});

// 회사 목록 조회 (회원가입용)
router.get('/companies', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name FROM companies ORDER BY name',
        );
        
        res.json({ 
            companies: result.rows 
        });
        
    } catch (error) {
        console.error('회사 목록 조회 오류:', error);
        res.status(500).json({ 
            error: '회사 목록을 불러올 수 없습니다.' 
        });
    }
});

// 슈퍼 관리자 생성 (초기 설정용 - 환경변수로 보호)
router.post('/create-super-admin', async (req, res) => {
    const { email, password, name, secretKey } = req.body;
    
    try {
        // 시크릿 키 검증
        if (secretKey !== process.env.SUPER_ADMIN_SECRET) {
            return res.status(403).json({ 
                error: '권한이 없습니다.' 
            });
        }
        
        // 기존 슈퍼 관리자 확인
        const existing = await pool.query(
            'SELECT id FROM users WHERE role = $1',
            ['super_admin']
        );
        
        if (existing.rows.length) {
            return res.status(400).json({ 
                error: '슈퍼 관리자가 이미 존재합니다.' 
            });
        }
        
        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 슈퍼 관리자 생성
        const userId = `super_admin_${Date.now()}`;
        const result = await pool.query(
            `INSERT INTO users 
            (user_id, email, password, name, role, login_type) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id, user_id, email, name, role`,
            [
                userId,
                email,
                hashedPassword,
                name,
                'super_admin',
                'email'
            ]
        );
        
        res.status(201).json({ 
            success: true,
            message: '슈퍼 관리자가 생성되었습니다.',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('슈퍼 관리자 생성 오류:', error);
        res.status(500).json({ 
            error: '슈퍼 관리자 생성 중 오류가 발생했습니다.' 
        });
    }
});

module.exports = router;