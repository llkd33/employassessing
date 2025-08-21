const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// 랜덤 점수 생성 함수
function randomScore(min = 60, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 랜덤 날짜 생성 함수 (최근 30일)
function randomDate(daysAgo = 30) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
  return date.toISOString();
}

async function seedDemoData() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🌱 시연용 데이터 생성 시작...\n');
    
    // 1. 회사 ID 조회
    const companies = await client.query('SELECT id, name, code FROM companies ORDER BY id');
    console.log('📢 등록된 회사:');
    companies.rows.forEach(c => console.log(`   - ${c.name} (ID: ${c.id}, Code: ${c.code})`));
    
    // 2. 신입사원 데이터
    const employees = [
      // 삼성전자 (ID: 1)
      { name: '김민수', email: 'minsu.kim@samsung.com', company_id: 1 },
      { name: '이지은', email: 'jieun.lee@samsung.com', company_id: 1 },
      { name: '박성준', email: 'sungjun.park@samsung.com', company_id: 1 },
      { name: '정소영', email: 'soyoung.jung@samsung.com', company_id: 1 },
      { name: '최현우', email: 'hyunwoo.choi@samsung.com', company_id: 1 },
      
      // LG전자 (ID: 2)
      { name: '강동현', email: 'donghyun.kang@lge.com', company_id: 2 },
      { name: '윤서연', email: 'seoyeon.yoon@lge.com', company_id: 2 },
      { name: '임재훈', email: 'jaehoon.lim@lge.com', company_id: 2 },
      { name: '송미래', email: 'mirae.song@lge.com', company_id: 2 },
      
      // 네이버 (ID: 3)
      { name: '한지민', email: 'jimin.han@navercorp.com', company_id: 3 },
      { name: '오태양', email: 'taeyang.oh@navercorp.com', company_id: 3 },
      { name: '서유진', email: 'yujin.seo@navercorp.com', company_id: 3 },
      { name: '노은비', email: 'eunbi.roh@navercorp.com', company_id: 3 },
      { name: '문성호', email: 'sungho.moon@navercorp.com', company_id: 3 },
      
      // 카카오 (ID: 4)
      { name: '배수진', email: 'sujin.bae@kakao.com', company_id: 4 },
      { name: '양희준', email: 'heejun.yang@kakao.com', company_id: 4 },
      { name: '고은서', email: 'eunseo.ko@kakao.com', company_id: 4 },
      
      // 미할당 사용자 (회사 없음)
      { name: '홍길동', email: 'gildong.hong@gmail.com', company_id: null },
      { name: '김철수', email: 'cheolsu.kim@naver.com', company_id: null },
    ];
    
    console.log('\n👥 신입사원 계정 생성 중...');
    const hashedPassword = await bcrypt.hash('test1234', 10);
    
    for (const emp of employees) {
      const userId = `emp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        await client.query(
          `INSERT INTO users (user_id, name, email, password, role, company_id, login_type, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            userId,
            emp.name,
            emp.email,
            hashedPassword,
            'user',
            emp.company_id,
            'email',
            randomDate(60) // 최근 60일 내 가입
          ]
        );
        
        emp.user_id = userId; // 나중에 사용할 user_id 저장
        console.log(`   ✅ ${emp.name} (${emp.email}) - ${emp.company_id ? companies.rows.find(c => c.id === emp.company_id)?.name : '미할당'}`);
        
      } catch (error) {
        if (error.code === '23505') { // 중복 이메일
          console.log(`   ⚠️  ${emp.name} (${emp.email}) - 이미 존재함`);
          const existing = await client.query('SELECT user_id FROM users WHERE email = $1', [emp.email]);
          emp.user_id = existing.rows[0].user_id;
        } else {
          throw error;
        }
      }
    }
    
    // 3. 테스트 결과 생성
    console.log('\n📝 테스트 결과 생성 중...');
    
    for (const emp of employees) {
      // 랜덤하게 0~3개의 테스트 결과 생성
      const testCount = Math.floor(Math.random() * 4);
      
      for (let i = 0; i < testCount; i++) {
        const resultId = `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 역량별 점수 생성 (회사별로 다른 분포)
        let scores = {};
        if (emp.company_id === 1) { // 삼성: 높은 점수
          scores = {
            problem_solving: randomScore(75, 95),
            communication: randomScore(70, 90),
            leadership: randomScore(70, 90),
            creativity: randomScore(65, 85),
            teamwork: randomScore(75, 95)
          };
        } else if (emp.company_id === 2) { // LG: 중간 점수
          scores = {
            problem_solving: randomScore(65, 85),
            communication: randomScore(65, 85),
            leadership: randomScore(60, 80),
            creativity: randomScore(60, 80),
            teamwork: randomScore(70, 90)
          };
        } else if (emp.company_id === 3) { // 네이버: 창의성 높음
          scores = {
            problem_solving: randomScore(70, 90),
            communication: randomScore(65, 85),
            leadership: randomScore(60, 80),
            creativity: randomScore(80, 100),
            teamwork: randomScore(70, 90)
          };
        } else if (emp.company_id === 4) { // 카카오: 균형잡힌 점수
          scores = {
            problem_solving: randomScore(70, 90),
            communication: randomScore(75, 95),
            leadership: randomScore(70, 90),
            creativity: randomScore(75, 95),
            teamwork: randomScore(75, 95)
          };
        } else { // 미할당: 랜덤
          scores = {
            problem_solving: randomScore(50, 90),
            communication: randomScore(50, 90),
            leadership: randomScore(50, 90),
            creativity: randomScore(50, 90),
            teamwork: randomScore(50, 90)
          };
        }
        
        const overallScore = Math.round(
          (scores.problem_solving + scores.communication + scores.leadership + 
           scores.creativity + scores.teamwork) / 5
        );
        
        const testDate = randomDate(30 - i * 10); // 시간 순서대로
        
        try {
          await client.query(
            `INSERT INTO test_results 
            (result_id, session_id, user_id, overall_score, 
             problem_solving_score, communication_score, leadership_score, 
             creativity_score, teamwork_score, test_date, submitted_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              resultId,
              sessionId,
              emp.user_id,
              overallScore,
              scores.problem_solving,
              scores.communication,
              scores.leadership,
              scores.creativity,
              scores.teamwork,
              testDate,
              testDate
            ]
          );
          
          // 답변 데이터도 생성 (간단히)
          for (let q = 1; q <= 75; q++) {
            const answers = ['매우 그렇다', '그렇다', '보통', '아니다', '매우 아니다'];
            const answer = answers[Math.floor(Math.random() * answers.length)];
            
            await client.query(
              'INSERT INTO test_answers (result_id, question_id, answer) VALUES ($1, $2, $3)',
              [resultId, q, answer]
            );
          }
          
          console.log(`   📊 ${emp.name} - 테스트 ${i + 1}: ${overallScore}점`);
          
        } catch (error) {
          console.error(`   ❌ ${emp.name} 테스트 결과 생성 실패:`, error.message);
        }
      }
    }
    
    // 4. 관리자 계정 생성
    console.log('\n👨‍💼 관리자 계정 생성 중...');
    
    const admins = [
      { name: '김관리', email: 'admin@samsung.com', company_id: 1, company_name: '삼성전자' },
      { name: '이관리', email: 'admin@lge.com', company_id: 2, company_name: 'LG전자' },
      { name: '박관리', email: 'admin@navercorp.com', company_id: 3, company_name: '네이버' },
      { name: '최관리', email: 'admin@kakao.com', company_id: 4, company_name: '카카오' },
      { name: '슈퍼관리자', email: 'super@admin.com', company_id: null, role: 'super_admin' }
    ];
    
    for (const admin of admins) {
      const userId = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        await client.query(
          `INSERT INTO users (user_id, name, email, password, role, company_id, login_type) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            admin.name,
            admin.email,
            hashedPassword,
            admin.role || 'company_admin',
            admin.company_id,
            'email'
          ]
        );
        
        console.log(`   ✅ ${admin.name} (${admin.email}) - ${admin.company_name || '전체 관리자'}`);
        
      } catch (error) {
        if (error.code === '23505') { // 중복
          console.log(`   ⚠️  ${admin.name} (${admin.email}) - 이미 존재함`);
        } else {
          throw error;
        }
      }
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ 시연용 데이터 생성 완료!');
    console.log('\n📌 로그인 정보:');
    console.log('   - 모든 계정 비밀번호: test1234');
    console.log('   - 일반 사용자: 위에 생성된 이메일 사용');
    console.log('   - 관리자 계정:');
    admins.forEach(admin => {
      console.log(`     * ${admin.email} - ${admin.company_name || '슈퍼 관리자'}`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 데이터 생성 실패:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 실행
if (require.main === module) {
  seedDemoData()
    .then(() => {
      console.log('\n🎉 시연 준비 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('시연 데이터 생성 중 오류:', error);
      process.exit(1);
    });
}

module.exports = { seedDemoData };