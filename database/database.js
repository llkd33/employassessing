const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL 연결 풀 설정
console.log('🔍 NODE_ENV:', process.env.NODE_ENV);
console.log('🔍 DATABASE_URL 설정 여부:', process.env.DATABASE_URL ? '✅ 설정됨' : '❌ 설정되지 않음');
if (process.env.DATABASE_URL) {
    console.log('🔍 DATABASE_URL 프로토콜:', process.env.DATABASE_URL.split('://')[0]);
}

// Railway PostgreSQL IPv6 문제 해결
let poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Railway 환경에서 IPv6 문제 해결
if (process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    try {
        const url = new URL(process.env.DATABASE_URL);
        // IPv6 주소인 경우 IPv4로 변경 시도
        if (url.hostname.includes(':')) {
            console.log('⚠️ IPv6 주소 감지, 연결 설정 조정 중...');
            poolConfig = {
                ...poolConfig,
                host: url.hostname,
                port: url.port || 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
                ssl: { rejectUnauthorized: false },
                // IPv4 강제
                connectionTimeoutMillis: 10000,
                query_timeout: 10000,
                statement_timeout: 10000
            };
        }
    } catch (err) {
        console.error('DATABASE_URL 파싱 오류:', err);
    }
}

const pool = new Pool(poolConfig);

// 연결 테스트
pool.on('connect', () => {
    console.log('✅ PostgreSQL 데이터베이스에 연결되었습니다.');
});

pool.on('error', (err) => {
    console.error('❌ 데이터베이스 연결 오류:', err);
});

// 데이터베이스 함수들
const db = {
    // 사용자 관련 함수들
    async createUser(userData) {
        const { user_id, name, email, password, login_type } = userData;
        const query = `
            INSERT INTO users (user_id, name, email, password, login_type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        try {
            const result = await pool.query(query, [user_id, name, email, password, login_type]);
            return result.rows[0];
        } catch (error) {
            console.error('사용자 생성 오류:', error);
            throw error;
        }
    },

    async getUserByEmail(email) {
        const query = 'SELECT * FROM users WHERE email = $1';
        try {
            const result = await pool.query(query, [email]);
            return result.rows[0];
        } catch (error) {
            console.error('이메일로 사용자 조회 오류:', error);
            throw error;
        }
    },

    async getUserByUserId(user_id) {
        const query = 'SELECT * FROM users WHERE user_id = $1';
        try {
            const result = await pool.query(query, [user_id]);
            return result.rows[0];
        } catch (error) {
            console.error('사용자 ID로 조회 오류:', error);
            throw error;
        }
    },

    // JWT 토큰 검증용 getUserById 함수 (getUserByUserId와 동일)
    async getUserById(user_id) {
        const query = 'SELECT * FROM users WHERE user_id = $1';
        try {
            const result = await pool.query(query, [user_id]);
            return result.rows[0];
        } catch (error) {
            console.error('JWT 토큰 검증용 사용자 ID 조회 오류:', error);
            throw error;
        }
    },

    async getAllUsers() {
        const query = 'SELECT * FROM users ORDER BY created_at DESC';
        try {
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('모든 사용자 조회 오류:', error);
            throw error;
        }
    },

    async deleteUser(user_id) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 먼저 테스트 답변들 삭제
            await client.query(`
                DELETE FROM test_answers 
                WHERE result_id IN (
                    SELECT result_id FROM test_results WHERE user_id = $1
                )
            `, [user_id]);

            // 테스트 결과들 삭제
            await client.query('DELETE FROM test_results WHERE user_id = $1', [user_id]);

            // 사용자 삭제
            const result = await client.query('DELETE FROM users WHERE user_id = $1 RETURNING *', [user_id]);

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('사용자 삭제 오류:', error);
            throw error;
        } finally {
            client.release();
        }
    },

    // 테스트 결과 관련 함수들
    async createTestResult(testData) {
        const {
            result_id, session_id, user_id, overall_score,
            problem_solving_score, communication_score, leadership_score,
            creativity_score, teamwork_score, test_date, submitted_at, answers
        } = testData;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 테스트 결과 저장
            const resultQuery = `
                INSERT INTO test_results (
                    result_id, session_id, user_id, overall_score,
                    problem_solving_score, communication_score, leadership_score,
                    creativity_score, teamwork_score, test_date, submitted_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *
            `;

            const testResult = await client.query(resultQuery, [
                result_id, session_id, user_id, overall_score,
                problem_solving_score, communication_score, leadership_score,
                creativity_score, teamwork_score, test_date, submitted_at
            ]);

            // 답변들 저장
            for (const answer of answers) {
                await client.query(
                    'INSERT INTO test_answers (result_id, question_id, answer) VALUES ($1, $2, $3)',
                    [result_id, answer.id, answer.answer]
                );
            }

            await client.query('COMMIT');
            return testResult.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('테스트 결과 저장 오류:', error);
            throw error;
        } finally {
            client.release();
        }
    },

    async getTestResultBySessionId(session_id) {
        const query = `
            SELECT tr.*, ta.question_id, ta.answer
            FROM test_results tr
            LEFT JOIN test_answers ta ON tr.result_id = ta.result_id
            WHERE tr.session_id = $1
            ORDER BY ta.question_id
        `;
        try {
            const result = await pool.query(query, [session_id]);
            if (result.rows.length === 0) return null;

            // 결과 구조화
            const testResult = {
                id: result.rows[0].result_id,
                sessionId: result.rows[0].session_id,
                userId: result.rows[0].user_id,
                overallScore: result.rows[0].overall_score,
                competencyScores: {
                    problemSolving: result.rows[0].problem_solving_score,
                    communication: result.rows[0].communication_score,
                    leadership: result.rows[0].leadership_score,
                    creativity: result.rows[0].creativity_score,
                    teamwork: result.rows[0].teamwork_score
                },
                testDate: result.rows[0].test_date,
                submittedAt: result.rows[0].submitted_at,
                answers: {}
            };

            // 답변들 추가
            result.rows.forEach(row => {
                if (row.question_id) {
                    testResult.answers[row.question_id] = row.answer;
                }
            });

            return testResult;
        } catch (error) {
            console.error('세션 ID로 테스트 결과 조회 오류:', error);
            throw error;
        }
    },

    async getUserTestResults(user_id, limit = 20) {
        const query = `
            SELECT result_id, session_id, overall_score,
                   problem_solving_score, communication_score, leadership_score,
                   creativity_score, teamwork_score, test_date, submitted_at
            FROM test_results 
            WHERE user_id = $1 
            ORDER BY test_date DESC 
            LIMIT $2
        `;
        try {
            const result = await pool.query(query, [user_id, limit]);
            return result.rows.map(row => ({
                id: row.result_id,
                sessionId: row.session_id,
                overallScore: row.overall_score,
                competencyScores: {
                    problemSolving: row.problem_solving_score,
                    communication: row.communication_score,
                    leadership: row.leadership_score,
                    creativity: row.creativity_score,
                    teamwork: row.teamwork_score
                },
                testDate: row.test_date,
                submittedAt: row.submitted_at
            }));
        } catch (error) {
            console.error('사용자 테스트 결과 조회 오류:', error);
            throw error;
        }
    },

    async getAllTestResults(limit = 100) {
        const query = `
            SELECT result_id, session_id, user_id, overall_score,
                   problem_solving_score, communication_score, leadership_score,
                   creativity_score, teamwork_score, test_date, submitted_at
            FROM test_results 
            ORDER BY test_date DESC 
            LIMIT $1
        `;
        try {
            const result = await pool.query(query, [limit]);
            return result.rows;
        } catch (error) {
            console.error('모든 테스트 결과 조회 오류:', error);
            throw error;
        }
    },

    // 통계 관련 함수들
    async getTestStats() {
        try {
            const totalTests = await pool.query('SELECT COUNT(*) as count FROM test_results');
            const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
            const avgScore = await pool.query('SELECT AVG(overall_score) as avg FROM test_results');

            return {
                totalTests: parseInt(totalTests.rows[0].count),
                totalUsers: parseInt(totalUsers.rows[0].count),
                averageScore: Math.round(parseFloat(avgScore.rows[0].avg) || 0)
            };
        } catch (error) {
            console.error('통계 조회 오류:', error);
            throw error;
        }
    },

    // 연결 종료
    async close() {
        await pool.end();
        console.log('데이터베이스 연결이 종료되었습니다.');
    }
};

module.exports = db; 