const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrateInvitationSystem() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('인비테이션 시스템 마이그레이션 시작...');
    
    // 1. 관리자 초대 테이블 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_invitations (
        id SERIAL PRIMARY KEY,
        token VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        company_id INTEGER REFERENCES companies(id),
        role VARCHAR(20) NOT NULL CHECK (role IN ('company_admin', 'hr_manager')),
        invited_by VARCHAR(50) REFERENCES users(user_id),
        used BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ admin_invitations 테이블 생성 완료');
    
    // 2. 인덱스 추가
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_invitations_token ON admin_invitations(token)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_invitations_email ON admin_invitations(email)
    `);
    console.log('✓ 인덱스 생성 완료');
    
    // 3. 배치 사용자 가입을 위한 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_user_uploads (
        id SERIAL PRIMARY KEY,
        uploaded_by VARCHAR(50) REFERENCES users(user_id),
        company_id INTEGER REFERENCES companies(id),
        file_name VARCHAR(255) NOT NULL,
        total_count INTEGER NOT NULL,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        error_details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    console.log('✓ batch_user_uploads 테이블 생성 완료');
    
    // 4. 배치 업로드 결과 상세
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_user_upload_details (
        id SERIAL PRIMARY KEY,
        upload_id INTEGER REFERENCES batch_user_uploads(id),
        row_number INTEGER NOT NULL,
        email VARCHAR(255),
        name VARCHAR(100),
        status VARCHAR(20) CHECK (status IN ('success', 'failed', 'skipped')),
        error_message TEXT,
        user_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ batch_user_upload_details 테이블 생성 완료');
    
    // 5. HR 매니저 역할 추가 (기존 CHECK 제약조건 수정)
    await client.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check
    `);
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check 
      CHECK (role IN ('super_admin', 'company_admin', 'hr_manager', 'user'))
    `);
    console.log('✓ HR 매니저 역할 추가 완료');
    
    // 6. 이메일 템플릿 테이블 (선택사항)
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        variables JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 기본 이메일 템플릿 추가
    await client.query(`
      INSERT INTO email_templates (name, subject, body, variables) VALUES
      ('admin_invitation', '{{companyName}} 관리자로 초대되었습니다', 
      '<h2>관리자 초대</h2>
      <p>안녕하세요,</p>
      <p>{{inviterName}}님이 귀하를 {{companyName}}의 {{roleName}}(으)로 초대했습니다.</p>
      <p>아래 링크를 클릭하여 계정을 활성화하세요:</p>
      <p><a href="{{inviteUrl}}">계정 활성화하기</a></p>
      <p>이 링크는 {{expiryDays}}일 후에 만료됩니다.</p>
      <p>감사합니다.</p>', 
      '{"companyName": "회사명", "inviterName": "초대자 이름", "roleName": "역할명", "inviteUrl": "초대 URL", "expiryDays": "만료일"}'),
      
      ('user_batch_welcome', '{{companyName}} 신입사원 역량 테스트 안내',
      '<h2>신입사원 역량 테스트 플랫폼에 오신 것을 환영합니다</h2>
      <p>{{userName}}님, 안녕하세요!</p>
      <p>{{companyName}}의 신입사원 역량 테스트 플랫폼에 등록되었습니다.</p>
      <p>임시 비밀번호: <strong>{{tempPassword}}</strong></p>
      <p>보안을 위해 첫 로그인 시 비밀번호를 변경해주세요.</p>
      <p><a href="{{loginUrl}}">로그인하기</a></p>',
      '{"userName": "사용자 이름", "companyName": "회사명", "tempPassword": "임시 비밀번호", "loginUrl": "로그인 URL"}')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✓ 이메일 템플릿 생성 완료');
    
    await client.query('COMMIT');
    console.log('\n✅ 인비테이션 시스템 마이그레이션 완료!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 마이그레이션 실패:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 롤백 함수
async function rollbackInvitationSystem() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('인비테이션 시스템 마이그레이션 롤백 시작...');
    
    await client.query('DROP TABLE IF EXISTS email_templates');
    await client.query('DROP TABLE IF EXISTS batch_user_upload_details');
    await client.query('DROP TABLE IF EXISTS batch_user_uploads');
    await client.query('DROP TABLE IF EXISTS admin_invitations');
    
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
    rollbackInvitationSystem()
      .then(() => {
        console.log('롤백이 성공적으로 완료되었습니다.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('롤백 중 오류 발생:', error);
        process.exit(1);
      });
  } else {
    migrateInvitationSystem()
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

module.exports = { migrateInvitationSystem, rollbackInvitationSystem };