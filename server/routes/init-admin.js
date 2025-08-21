const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Railway PostgreSQL IPv6 문제 해결
let poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Railway 환경에서 IPv6 문제 해결
if (process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    try {
        const url = new URL(process.env.DATABASE_URL);
        // IPv6 주소인 경우 연결 설정 조정
        if (url.hostname.includes(':')) {
            console.log('⚠️ IPv6 주소 감지, 연결 설정 조정 중...');
            poolConfig = {
                host: url.hostname,
                port: url.port || 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
                ssl: { rejectUnauthorized: false },
                connectionTimeoutMillis: 10000
            };
        }
    } catch (err) {
        console.error('DATABASE_URL 파싱 오류:', err);
    }
}

const pool = new Pool(poolConfig);

// 초기 설정 API - 한 번만 실행 가능
router.post('/init', async (req, res) => {
    const client = await pool.connect();
    
    try {
        // 이미 관리자가 있는지 확인
        const checkAdmin = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'admins'
            )
        `);
        
        let hasAdmins = false;
        
        if (checkAdmin.rows[0].exists) {
            const adminCount = await client.query('SELECT COUNT(*) FROM admins');
            hasAdmins = parseInt(adminCount.rows[0].count) > 0;
            
            if (hasAdmins) {
                return res.status(400).json({
                    success: false,
                    message: '이미 관리자가 존재합니다. 보안상 재초기화는 불가능합니다.'
                });
            }
        }
        
        // 트랜잭션 시작
        await client.query('BEGIN');
        
        // 1. 관리자 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        `);
        
        // 2. 사용자 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 3. 테스트 결과 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS test_results (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                user_email VARCHAR(255),
                user_name VARCHAR(255),
                scores JSONB,
                total_score INTEGER,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 4. 감사 로그 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER,
                admin_email VARCHAR(255),
                action VARCHAR(255),
                target_type VARCHAR(100),
                target_id VARCHAR(255),
                details JSONB,
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 5. 기본 관리자 생성
        const adminEmail = 'admin@test.com';
        const adminPassword = 'Admin123!@#';
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        
        await client.query(
            `INSERT INTO admins (email, password, name, role) 
             VALUES ($1, $2, $3, $4)`,
            [adminEmail, hashedPassword, 'System Administrator', 'super_admin']
        );
        
        // 6. 테스트용 일반 사용자 생성
        const testUsers = [
            { email: 'test1@example.com', name: '김철수', password: 'Test123!' },
            { email: 'test2@example.com', name: '이영희', password: 'Test123!' },
            { email: 'test3@example.com', name: '박민수', password: 'Test123!' }
        ];
        
        for (const user of testUsers) {
            const hashedPwd = await bcrypt.hash(user.password, 10);
            await client.query(
                `INSERT INTO users (email, password, name) 
                 VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
                [user.email, hashedPwd, user.name]
            );
        }
        
        // 7. 샘플 테스트 결과 생성
        const sampleResult = {
            user_email: 'test1@example.com',
            user_name: '김철수',
            scores: {
                category1: 85,
                category2: 92,
                category3: 78,
                category4: 88,
                category5: 90
            },
            total_score: 87
        };
        
        await client.query(
            `INSERT INTO test_results (user_email, user_name, scores, total_score)
             VALUES ($1, $2, $3, $4)`,
            [sampleResult.user_email, sampleResult.user_name, JSON.stringify(sampleResult.scores), sampleResult.total_score]
        );
        
        await client.query('COMMIT');
        
        console.log('✅ 초기화 성공:', {
            admin: adminEmail,
            tables: ['admins', 'users', 'test_results', 'audit_logs'],
            testUsers: testUsers.length
        });
        
        res.json({
            success: true,
            message: '시스템 초기화 완료',
            data: {
                admin: {
                    email: adminEmail,
                    password: adminPassword,
                    note: '⚠️ 즉시 비밀번호를 변경하세요!'
                },
                testUsers: testUsers.map(u => ({
                    email: u.email,
                    name: u.name,
                    password: u.password
                })),
                urls: {
                    adminLogin: `${req.protocol}://${req.get('host')}/client/admin-login.html`,
                    userLogin: `${req.protocol}://${req.get('host')}/client/login.html`,
                    mainPage: `${req.protocol}://${req.get('host')}/client/index.html`
                }
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('초기화 실패:', error);
        res.status(500).json({
            success: false,
            message: '초기화 중 오류가 발생했습니다',
            error: error.message
        });
    } finally {
        client.release();
    }
});

// 시스템 상태 확인
router.get('/status', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const tables = ['admins', 'users', 'test_results', 'audit_logs'];
        const status = {};
        
        for (const table of tables) {
            const result = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = $1
                )
            `, [table]);
            
            if (result.rows[0].exists) {
                const count = await client.query(`SELECT COUNT(*) FROM ${table}`);
                status[table] = {
                    exists: true,
                    count: parseInt(count.rows[0].count)
                };
            } else {
                status[table] = {
                    exists: false,
                    count: 0
                };
            }
        }
        
        res.json({
            success: true,
            database: process.env.DATABASE_URL ? 'Connected' : 'Not configured',
            tables: status,
            initialized: status.admins && status.admins.count > 0
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '상태 확인 실패',
            error: error.message
        });
    } finally {
        client.release();
    }
});

module.exports = router;