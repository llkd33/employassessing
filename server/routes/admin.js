const express = require('express');
const router = express.Router();
const db = require('../../database/database');
const { 
    authenticateToken, 
    requireAdmin, 
    requireSuperAdmin,
    logAdminActivity 
} = require('../middleware/auth');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 모든 관리자 API는 인증과 관리자 권한 필요
router.use(authenticateToken, requireAdmin);

// 회사별 신입사원 목록 조회
router.get('/users', logAdminActivity('view_users'), async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', companyId } = req.query;
        const offset = (page - 1) * limit;
        
        let query;
        let countQuery;
        let params = [];
        let countParams = [];
        
        // 슈퍼 관리자는 모든 사용자 조회 가능
        if (req.user.role === 'super_admin') {
            const targetCompanyId = companyId || null;
            
            query = `
                SELECT 
                    u.id, u.user_id, u.email, u.name, u.role,
                    u.company_id, u.created_at, u.login_type,
                    c.name as company_name,
                    COUNT(DISTINCT tr.id) as test_count,
                    MAX(tr.test_date) as last_test_date,
                    AVG(tr.overall_score) as avg_score
                FROM users u
                LEFT JOIN companies c ON u.company_id = c.id
                LEFT JOIN test_results tr ON u.user_id = tr.user_id
                WHERE u.role = 'user'
                ${targetCompanyId ? 'AND u.company_id = $1' : ''}
                ${search ? `AND (u.name ILIKE $${targetCompanyId ? 2 : 1} OR u.email ILIKE $${targetCompanyId ? 2 : 1})` : ''}
                GROUP BY u.id, c.name
                ORDER BY u.created_at DESC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `;
            
            countQuery = `
                SELECT COUNT(*) FROM users u
                WHERE u.role = 'user'
                ${targetCompanyId ? 'AND u.company_id = $1' : ''}
                ${search ? `AND (u.name ILIKE $${targetCompanyId ? 2 : 1} OR u.email ILIKE $${targetCompanyId ? 2 : 1})` : ''}
            `;
            
            if (targetCompanyId) {
                params.push(targetCompanyId);
                countParams.push(targetCompanyId);
            }
            if (search) {
                params.push(`%${search}%`);
                countParams.push(`%${search}%`);
            }
        } else {
            // 회사 관리자는 자기 회사 사용자만 조회
            query = `
                SELECT 
                    u.id, u.user_id, u.email, u.name, u.role,
                    u.company_id, u.created_at, u.login_type,
                    c.name as company_name,
                    COUNT(DISTINCT tr.id) as test_count,
                    MAX(tr.test_date) as last_test_date,
                    AVG(tr.overall_score) as avg_score
                FROM users u
                LEFT JOIN companies c ON u.company_id = c.id
                LEFT JOIN test_results tr ON u.user_id = tr.user_id
                WHERE u.role = 'user' AND u.company_id = $1
                ${search ? 'AND (u.name ILIKE $2 OR u.email ILIKE $2)' : ''}
                GROUP BY u.id, c.name
                ORDER BY u.created_at DESC
                LIMIT $${search ? 3 : 2} OFFSET $${search ? 4 : 3}
            `;
            
            countQuery = `
                SELECT COUNT(*) FROM users u
                WHERE u.role = 'user' AND u.company_id = $1
                ${search ? 'AND (u.name ILIKE $2 OR u.email ILIKE $2)' : ''}
            `;
            
            params = [req.user.companyId];
            countParams = [req.user.companyId];
            if (search) {
                params.push(`%${search}%`);
                countParams.push(`%${search}%`);
            }
        }
        
        params.push(limit, offset);
        
        // 사용자 목록 조회
        const usersResult = await pool.query(query, params);
        
        // 전체 개수 조회
        const countResult = await pool.query(countQuery, countParams);
        const totalCount = parseInt(countResult.rows[0].count);
        
        res.json({
            users: usersResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
        
    } catch (error) {
        console.error('사용자 목록 조회 오류:', error);
        res.status(500).json({ 
            error: '사용자 목록을 불러올 수 없습니다.' 
        });
    }
});

// 특정 사용자 상세 정보 조회
router.get('/users/:userId', logAdminActivity('view_user_detail'), async (req, res) => {
    const { userId } = req.params;
    
    try {
        // 사용자 기본 정보 조회
        let userQuery = `
            SELECT 
                u.*, 
                c.name as company_name
            FROM users u
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE u.user_id = $1
        `;
        
        // 회사 관리자는 자기 회사 사용자만 조회 가능
        if (req.user.role === 'company_admin') {
            userQuery += ' AND u.company_id = $2';
        }
        
        const params = req.user.role === 'company_admin' 
            ? [userId, req.user.companyId] 
            : [userId];
            
        const userResult = await pool.query(userQuery, params);
        
        if (!userResult.rows.length) {
            return res.status(404).json({ 
                error: '사용자를 찾을 수 없습니다.' 
            });
        }
        
        const user = userResult.rows[0];
        
        // 테스트 결과 조회
        const testResults = await pool.query(`
            SELECT 
                tr.*,
                COUNT(ta.id) as answer_count
            FROM test_results tr
            LEFT JOIN test_answers ta ON tr.result_id = ta.result_id
            WHERE tr.user_id = $1
            GROUP BY tr.id, tr.result_id, tr.session_id, tr.user_id, 
                     tr.overall_score, tr.problem_solving_score, 
                     tr.communication_score, tr.leadership_score,
                     tr.creativity_score, tr.teamwork_score,
                     tr.test_date, tr.submitted_at, tr.created_at
            ORDER BY tr.test_date DESC
        `, [userId]);
        
        res.json({
            user: {
                ...user,
                password: undefined // 비밀번호 제외
            },
            testResults: testResults.rows
        });
        
    } catch (error) {
        console.error('사용자 상세 조회 오류:', error);
        res.status(500).json({ 
            error: '사용자 정보를 불러올 수 없습니다.' 
        });
    }
});

// 회사별 통계 조회
router.get('/statistics', async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;
        
        let targetCompanyId;
        if (req.user.role === 'super_admin') {
            targetCompanyId = companyId || null;
        } else {
            targetCompanyId = req.user.companyId;
        }
        
        // 기본 통계
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT u.id) as total_users,
                COUNT(DISTINCT tr.id) as total_tests,
                AVG(tr.overall_score)::numeric(10,2) as avg_score,
                MAX(tr.overall_score) as max_score,
                MIN(tr.overall_score) as min_score,
                AVG(tr.problem_solving_score)::numeric(10,2) as avg_problem_solving,
                AVG(tr.communication_score)::numeric(10,2) as avg_communication,
                AVG(tr.leadership_score)::numeric(10,2) as avg_leadership,
                AVG(tr.creativity_score)::numeric(10,2) as avg_creativity,
                AVG(tr.teamwork_score)::numeric(10,2) as avg_teamwork
            FROM users u
            LEFT JOIN test_results tr ON u.user_id = tr.user_id
            WHERE u.role = 'user'
            ${targetCompanyId ? 'AND u.company_id = $1' : ''}
            ${startDate ? `AND tr.test_date >= $${targetCompanyId ? 2 : 1}` : ''}
            ${endDate ? `AND tr.test_date <= $${targetCompanyId ? 3 : 2}` : ''}
        `;
        
        const params = [];
        if (targetCompanyId) params.push(targetCompanyId);
        if (startDate) params.push(startDate);
        if (endDate) params.push(endDate);
        
        const statsResult = await pool.query(statsQuery, params);
        
        // 점수 분포
        const distributionQuery = `
            SELECT 
                CASE 
                    WHEN overall_score >= 90 THEN '90-100'
                    WHEN overall_score >= 80 THEN '80-89'
                    WHEN overall_score >= 70 THEN '70-79'
                    WHEN overall_score >= 60 THEN '60-69'
                    ELSE '0-59'
                END as score_range,
                COUNT(*) as count
            FROM test_results tr
            JOIN users u ON tr.user_id = u.user_id
            WHERE u.role = 'user'
            ${targetCompanyId ? 'AND u.company_id = $1' : ''}
            ${startDate ? `AND tr.test_date >= $${targetCompanyId ? 2 : 1}` : ''}
            ${endDate ? `AND tr.test_date <= $${targetCompanyId ? 3 : 2}` : ''}
            GROUP BY score_range
            ORDER BY score_range DESC
        `;
        
        const distributionResult = await pool.query(distributionQuery, params);
        
        // 최근 테스트 동향 (최근 30일)
        const trendQuery = `
            SELECT 
                DATE(test_date) as date,
                COUNT(*) as test_count,
                AVG(overall_score)::numeric(10,2) as avg_score
            FROM test_results tr
            JOIN users u ON tr.user_id = u.user_id
            WHERE u.role = 'user'
            ${targetCompanyId ? 'AND u.company_id = $1' : ''}
            AND tr.test_date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE(test_date)
            ORDER BY date
        `;
        
        const trendParams = targetCompanyId ? [targetCompanyId] : [];
        const trendResult = await pool.query(trendQuery, trendParams);
        
        res.json({
            statistics: statsResult.rows[0],
            scoreDistribution: distributionResult.rows,
            recentTrend: trendResult.rows
        });
        
    } catch (error) {
        console.error('통계 조회 오류:', error);
        res.status(500).json({ 
            error: '통계를 불러올 수 없습니다.' 
        });
    }
});

// 신입사원을 회사에 할당
router.put('/users/:userId/assign', 
    logAdminActivity('assign_user_to_company'), 
    async (req, res) => {
        const { userId } = req.params;
        const { companyId } = req.body;
        
        try {
            // 회사 관리자는 자기 회사로만 할당 가능
            const targetCompanyId = req.user.role === 'super_admin' 
                ? companyId 
                : req.user.companyId;
                
            if (!targetCompanyId) {
                return res.status(400).json({ 
                    error: '회사 ID가 필요합니다.' 
                });
            }
            
            // 회사 존재 확인
            const companyCheck = await pool.query(
                'SELECT id, name FROM companies WHERE id = $1',
                [targetCompanyId]
            );
            
            if (!companyCheck.rows.length) {
                return res.status(404).json({ 
                    error: '회사를 찾을 수 없습니다.' 
                });
            }
            
            // 사용자 업데이트
            const result = await pool.query(
                `UPDATE users 
                SET company_id = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE user_id = $2 AND role = 'user'
                RETURNING *`,
                [targetCompanyId, userId]
            );
            
            if (!result.rows.length) {
                return res.status(404).json({ 
                    error: '사용자를 찾을 수 없습니다.' 
                });
            }
            
            res.json({ 
                success: true,
                message: '사용자가 회사에 할당되었습니다.',
                user: result.rows[0],
                companyName: companyCheck.rows[0].name
            });
            
        } catch (error) {
            console.error('사용자 할당 오류:', error);
            res.status(500).json({ 
                error: '사용자 할당 중 오류가 발생했습니다.' 
            });
        }
    }
);

// 회사 목록 조회 (슈퍼 관리자만)
router.get('/companies', requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(DISTINCT CASE WHEN u.role = 'company_admin' THEN u.id END) as admin_count
            FROM companies c
            LEFT JOIN users u ON c.id = u.company_id
            GROUP BY c.id
            ORDER BY c.name
        `);
        
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

// 회사 추가 (슈퍼 관리자만)
router.post('/companies', 
    requireSuperAdmin, 
    logAdminActivity('create_company'),
    async (req, res) => {
        const { name, code, domain } = req.body;
        
        try {
            if (!name || !code) {
                return res.status(400).json({ 
                    error: '회사명과 코드는 필수입니다.' 
                });
            }
            
            const result = await pool.query(
                `INSERT INTO companies (name, code, domain) 
                VALUES ($1, $2, $3) 
                RETURNING *`,
                [name, code, domain]
            );
            
            res.status(201).json({ 
                success: true,
                company: result.rows[0] 
            });
            
        } catch (error) {
            if (error.code === '23505') { // unique violation
                return res.status(400).json({ 
                    error: '이미 존재하는 회사 코드입니다.' 
                });
            }
            console.error('회사 추가 오류:', error);
            res.status(500).json({ 
                error: '회사 추가 중 오류가 발생했습니다.' 
            });
        }
    }
);

// 테스트 결과 상세 조회
router.get('/test-results/:resultId', async (req, res) => {
    const { resultId } = req.params;
    
    try {
        // 테스트 결과 조회 (회사 확인 포함)
        const resultQuery = `
            SELECT 
                tr.*,
                u.name as user_name,
                u.email as user_email,
                u.company_id,
                c.name as company_name
            FROM test_results tr
            JOIN users u ON tr.user_id = u.user_id
            LEFT JOIN companies c ON u.company_id = c.id
            WHERE tr.result_id = $1
        `;
        
        const testResult = await pool.query(resultQuery, [resultId]);
        
        if (!testResult.rows.length) {
            return res.status(404).json({ 
                error: '테스트 결과를 찾을 수 없습니다.' 
            });
        }
        
        const result = testResult.rows[0];
        
        // 권한 확인
        if (req.user.role === 'company_admin' && 
            result.company_id !== req.user.companyId) {
            return res.status(403).json({ 
                error: '해당 테스트 결과에 접근할 권한이 없습니다.' 
            });
        }
        
        // 답변 상세 조회
        const answersResult = await pool.query(
            'SELECT * FROM test_answers WHERE result_id = $1 ORDER BY question_id',
            [resultId]
        );
        
        // 회사 평균 점수 조회
        let companyAverage = null;
        if (result.company_id) {
            const avgQuery = `
                SELECT 
                    AVG(tr.overall_score)::numeric(10,2) as avg_overall,
                    AVG(tr.problem_solving_score)::numeric(10,2) as avg_problem_solving,
                    AVG(tr.communication_score)::numeric(10,2) as avg_communication,
                    AVG(tr.leadership_score)::numeric(10,2) as avg_leadership,
                    AVG(tr.creativity_score)::numeric(10,2) as avg_creativity,
                    AVG(tr.teamwork_score)::numeric(10,2) as avg_teamwork,
                    COUNT(DISTINCT tr.user_id) as total_employees
                FROM test_results tr
                JOIN users u ON tr.user_id = u.user_id
                WHERE u.company_id = $1
                AND u.role = 'user'
            `;
            
            const avgResult = await pool.query(avgQuery, [result.company_id]);
            companyAverage = avgResult.rows[0];
        }
        
        res.json({
            testResult: result,
            answers: answersResult.rows,
            companyAverage: companyAverage
        });
        
    } catch (error) {
        console.error('테스트 결과 조회 오류:', error);
        res.status(500).json({ 
            error: '테스트 결과를 불러올 수 없습니다.' 
        });
    }
});

module.exports = router;