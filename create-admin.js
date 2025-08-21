const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createAdmin() {
    const client = await pool.connect();
    
    try {
        // 관리자 테이블 생성 (없을 경우)
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
        
        console.log('✅ 관리자 테이블 확인/생성 완료');
        
        // 기본 관리자 계정 생성
        const adminEmail = 'admin@test.com';
        const adminPassword = 'admin123!@#';
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        
        // 기존 관리자 확인
        const existing = await client.query(
            'SELECT * FROM admins WHERE email = $1',
            [adminEmail]
        );
        
        if (existing.rows.length > 0) {
            console.log('⚠️  관리자 계정이 이미 존재합니다');
            console.log('📧 Email:', adminEmail);
            console.log('🔑 Password: (기존 비밀번호 사용)');
        } else {
            // 새 관리자 생성
            await client.query(
                `INSERT INTO admins (email, password, name, role) 
                 VALUES ($1, $2, $3, $4)`,
                [adminEmail, hashedPassword, 'Test Admin', 'super_admin']
            );
            
            console.log('✅ 관리자 계정 생성 완료!');
            console.log('----------------------------');
            console.log('📧 Email:', adminEmail);
            console.log('🔑 Password:', adminPassword);
            console.log('----------------------------');
            console.log('⚠️  보안 주의: 프로덕션에서는 즉시 비밀번호를 변경하세요!');
        }
        
        // 사용자 테이블도 확인/생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ 사용자 테이블 확인/생성 완료');
        
        // 테스트 결과 테이블 생성
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
        
        console.log('✅ 테스트 결과 테이블 확인/생성 완료');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

// 스크립트 실행
createAdmin().then(() => {
    console.log('\n✅ 설정 완료!');
    console.log('\n📌 관리자 페이지 접속:');
    console.log('   로컬: http://localhost:3000/client/admin-login.html');
    console.log('   배포: https://employassessment-production.up.railway.app/client/admin-login.html');
    process.exit(0);
}).catch(err => {
    console.error('❌ 스크립트 실행 실패:', err);
    process.exit(1);
});