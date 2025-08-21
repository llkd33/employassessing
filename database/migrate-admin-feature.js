const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function migrateAdminFeature() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('관리자 기능을 위한 데이터베이스 마이그레이션 시작...');
    
    // 1. companies 테이블 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        domain VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ companies 테이블 생성 완료');
    
    // 2. users 테이블에 role 컬럼 추가
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' 
      CHECK (role IN ('super_admin', 'company_admin', 'user'))
    `);
    console.log('✓ users 테이블에 role 컬럼 추가 완료');
    
    // 3. users 테이블에 company_id 컬럼 추가
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id)
    `);
    console.log('✓ users 테이블에 company_id 컬럼 추가 완료');
    
    // 4. 인덱스 추가 (성능 최적화)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_test_results_user_id ON test_results(user_id)
    `);
    console.log('✓ 인덱스 생성 완료');
    
    // 5. 관리자 활동 로그 테이블 생성 (보안용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id SERIAL PRIMARY KEY,
        admin_id VARCHAR(50) REFERENCES users(user_id),
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id VARCHAR(100),
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ admin_activity_logs 테이블 생성 완료');
    
    // 6. 초기 회사 데이터 삽입 (예시)
    const companies = [
      { name: '삼성전자', code: 'SAMSUNG2024', domain: '@samsung.com' },
      { name: 'LG전자', code: 'LG2024', domain: '@lge.com' },
      { name: '네이버', code: 'NAVER2024', domain: '@navercorp.com' },
      { name: '카카오', code: 'KAKAO2024', domain: '@kakao.com' }
    ];
    
    for (const company of companies) {
      await client.query(`
        INSERT INTO companies (name, code, domain) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (code) DO NOTHING
      `, [company.name, company.code, company.domain]);
    }
    console.log('✓ 초기 회사 데이터 삽입 완료');
    
    await client.query('COMMIT');
    console.log('\n✅ 관리자 기능 마이그레이션 완료!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 마이그레이션 실패:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 마이그레이션 롤백 함수
async function rollbackAdminFeature() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('관리자 기능 마이그레이션 롤백 시작...');
    
    // 역순으로 롤백
    await client.query('DROP TABLE IF EXISTS admin_activity_logs');
    await client.query('DROP INDEX IF EXISTS idx_test_results_user_id');
    await client.query('DROP INDEX IF EXISTS idx_users_company_id');
    await client.query('DROP INDEX IF EXISTS idx_users_role');
    await client.query('ALTER TABLE users DROP COLUMN IF EXISTS company_id');
    await client.query('ALTER TABLE users DROP COLUMN IF EXISTS role');
    await client.query('DROP TABLE IF EXISTS companies');
    
    await client.query('COMMIT');
    console.log('✅ 롤백 완료!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 롤백 실패:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 실행
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'rollback') {
    rollbackAdminFeature()
      .then(() => {
        console.log('롤백이 성공적으로 완료되었습니다.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('롤백 중 오류 발생:', error);
        process.exit(1);
      });
  } else {
    migrateAdminFeature()
      .then(() => {
        console.log('마이그레이션이 성공적으로 완료되었습니다.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('마이그레이션 중 오류 발생:', error);
        process.exit(1);
      });
  }
}

module.exports = { migrateAdminFeature, rollbackAdminFeature };