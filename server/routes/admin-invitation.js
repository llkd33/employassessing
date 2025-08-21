const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { 
    authenticateToken, 
    requireAdmin,
    requireSuperAdmin,
    logAdminActivity,
    generateToken
} = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 이메일 발송 함수 (실제 구현 필요)
const sendEmail = async (to, subject, html) => {
    // TODO: 실제 이메일 발송 로직 구현
    console.log(`이메일 발송: ${to}, 제목: ${subject}`);
    return true;
};

// 관리자 초대 생성
router.post('/invite', 
    authenticateToken, 
    requireAdmin,
    logAdminActivity('create_admin_invitation'),
    async (req, res) => {
        const { email, role, companyId } = req.body;
        
        try {
            // 입력값 검증
            if (!email || !role) {
                return res.status(400).json({ 
                    error: '이메일과 역할은 필수입니다.' 
                });
            }
            
            // 이메일 형식 검증
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ 
                    error: '유효한 이메일 주소를 입력해주세요.' 
                });
            }
            
            // 역할 검증
            const allowedRoles = ['company_admin', 'hr_manager'];
            if (!allowedRoles.includes(role)) {
                return res.status(400).json({ 
                    error: '유효하지 않은 역할입니다.' 
                });
            }
            
            // 회사 관리자는 자기 회사에만 초대 가능
            let targetCompanyId = companyId;
            if (req.user.role === 'company_admin') {
                targetCompanyId = req.user.companyId;
                
                // 회사 관리자는 hr_manager만 초대 가능
                if (role === 'company_admin') {
                    return res.status(403).json({
                        error: '회사 관리자는 HR 매니저만 초대할 수 있습니다.'
                    });
                }
            }
            
            // 대상 회사 확인
            const companyResult = await pool.query(
                'SELECT id, name FROM companies WHERE id = $1',
                [targetCompanyId]
            );
            
            if (!companyResult.rows.length) {
                return res.status(404).json({ 
                    error: '회사를 찾을 수 없습니다.' 
                });
            }
            
            const company = companyResult.rows[0];
            
            // 이미 가입된 사용자인지 확인
            const existingUser = await pool.query(
                'SELECT id FROM users WHERE email = $1',
                [email]
            );
            
            if (existingUser.rows.length) {
                return res.status(400).json({ 
                    error: '이미 가입된 이메일입니다.' 
                });
            }
            
            // 기존 초대 확인 (아직 사용되지 않은)
            const existingInvite = await pool.query(
                `SELECT id FROM admin_invitations 
                WHERE email = $1 AND used = false AND expires_at > NOW()`,
                [email]
            );
            
            if (existingInvite.rows.length) {
                return res.status(400).json({ 
                    error: '이미 발송된 초대가 있습니다.' 
                });
            }
            
            // 초대 토큰 생성
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7일 후 만료
            
            // 초대 저장
            const inviteResult = await pool.query(`
                INSERT INTO admin_invitations 
                (token, email, company_id, role, invited_by, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [token, email, targetCompanyId, role, req.user.userId, expiresAt]);
            
            // 초대 이메일 발송
            const inviteUrl = `${process.env.FRONTEND_URL}/admin/accept-invite?token=${token}`;
            const roleNames = {
                'company_admin': '회사 관리자',
                'hr_manager': 'HR 매니저'
            };
            
            const emailHtml = `
                <h2>관리자 초대</h2>
                <p>안녕하세요,</p>
                <p>${req.user.name}님이 귀하를 ${company.name}의 ${roleNames[role]}(으)로 초대했습니다.</p>
                <p>아래 링크를 클릭하여 계정을 활성화하세요:</p>
                <p><a href="${inviteUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">계정 활성화하기</a></p>
                <p>또는 다음 링크를 복사하여 브라우저에 붙여넣으세요:</p>
                <p>${inviteUrl}</p>
                <p>이 링크는 7일 후에 만료됩니다.</p>
                <p>감사합니다.</p>
            `;
            
            await sendEmail(
                email,
                `${company.name} 관리자로 초대되었습니다`,
                emailHtml
            );
            
            res.status(201).json({
                success: true,
                message: '초대 이메일이 발송되었습니다.',
                invitationId: inviteResult.rows[0].id
            });
            
        } catch (error) {
            console.error('관리자 초대 오류:', error);
            res.status(500).json({ 
                error: '초대 발송 중 오류가 발생했습니다.' 
            });
        }
    }
);

// 초대 토큰 확인
router.get('/invite/verify/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT i.*, c.name as company_name
            FROM admin_invitations i
            JOIN companies c ON i.company_id = c.id
            WHERE i.token = $1
        `, [token]);
        
        if (!result.rows.length) {
            return res.status(404).json({ 
                error: '유효하지 않은 초대 링크입니다.' 
            });
        }
        
        const invitation = result.rows[0];
        
        // 만료 확인
        if (new Date(invitation.expires_at) < new Date()) {
            return res.status(400).json({ 
                error: '만료된 초대 링크입니다.' 
            });
        }
        
        // 사용 여부 확인
        if (invitation.used) {
            return res.status(400).json({ 
                error: '이미 사용된 초대 링크입니다.' 
            });
        }
        
        const roleNames = {
            'company_admin': '회사 관리자',
            'hr_manager': 'HR 매니저'
        };
        
        res.json({
            email: invitation.email,
            companyName: invitation.company_name,
            role: invitation.role,
            roleName: roleNames[invitation.role]
        });
        
    } catch (error) {
        console.error('초대 확인 오류:', error);
        res.status(500).json({ 
            error: '초대 확인 중 오류가 발생했습니다.' 
        });
    }
});

// 초대 수락 및 계정 생성
router.post('/invite/accept', async (req, res) => {
    const { token, name, password } = req.body;
    
    try {
        // 입력값 검증
        if (!token || !name || !password) {
            return res.status(400).json({ 
                error: '모든 필드를 입력해주세요.' 
            });
        }
        
        // 비밀번호 강도 검증
        if (password.length < 8) {
            return res.status(400).json({ 
                error: '비밀번호는 최소 8자 이상이어야 합니다.' 
            });
        }
        
        // 초대 정보 조회
        const inviteResult = await pool.query(`
            SELECT i.*, c.name as company_name
            FROM admin_invitations i
            JOIN companies c ON i.company_id = c.id
            WHERE i.token = $1 
                AND i.used = false 
                AND i.expires_at > NOW()
        `, [token]);
        
        if (!inviteResult.rows.length) {
            return res.status(400).json({ 
                error: '유효하지 않거나 만료된 초대 링크입니다.' 
            });
        }
        
        const invitation = inviteResult.rows[0];
        
        // 트랜잭션 시작
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 비밀번호 해싱
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // 사용자 생성
            const userId = `${invitation.role}_${Date.now()}`;
            const userResult = await client.query(`
                INSERT INTO users 
                (user_id, email, password, name, role, company_id, login_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, user_id, email, name, role, company_id
            `, [
                userId,
                invitation.email,
                hashedPassword,
                name,
                invitation.role,
                invitation.company_id,
                'email'
            ]);
            
            const newUser = userResult.rows[0];
            
            // 초대 사용 처리
            await client.query(
                'UPDATE admin_invitations SET used = true WHERE id = $1',
                [invitation.id]
            );
            
            // 활동 로그
            await client.query(`
                INSERT INTO admin_activity_logs 
                (admin_id, action, details, ip_address)
                VALUES ($1, $2, $3, $4)
            `, [
                userId,
                'admin_signup_via_invitation',
                JSON.stringify({ 
                    invitedBy: invitation.invited_by,
                    role: invitation.role 
                }),
                req.ip
            ]);
            
            await client.query('COMMIT');
            
            // 토큰 생성
            const authToken = generateToken(newUser);
            
            res.status(201).json({
                success: true,
                message: '계정이 성공적으로 생성되었습니다.',
                user: {
                    ...newUser,
                    companyName: invitation.company_name
                },
                token: authToken
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('초대 수락 오류:', error);
        res.status(500).json({ 
            error: '계정 생성 중 오류가 발생했습니다.' 
        });
    }
});

// 초대 목록 조회 (관리자용)
router.get('/invitations', 
    authenticateToken, 
    requireAdmin,
    async (req, res) => {
        try {
            let query;
            let params = [];
            
            if (req.user.role === 'super_admin') {
                // 슈퍼 관리자는 모든 초대 조회
                query = `
                    SELECT 
                        i.*,
                        c.name as company_name,
                        u.name as invited_by_name
                    FROM admin_invitations i
                    JOIN companies c ON i.company_id = c.id
                    LEFT JOIN users u ON i.invited_by = u.user_id
                    ORDER BY i.created_at DESC
                `;
            } else {
                // 회사 관리자는 자기 회사 초대만 조회
                query = `
                    SELECT 
                        i.*,
                        c.name as company_name,
                        u.name as invited_by_name
                    FROM admin_invitations i
                    JOIN companies c ON i.company_id = c.id
                    LEFT JOIN users u ON i.invited_by = u.user_id
                    WHERE i.company_id = $1
                    ORDER BY i.created_at DESC
                `;
                params = [req.user.companyId];
            }
            
            const result = await pool.query(query, params);
            
            res.json({
                invitations: result.rows.map(inv => ({
                    ...inv,
                    status: inv.used ? 'used' : 
                           new Date(inv.expires_at) < new Date() ? 'expired' : 'pending'
                }))
            });
            
        } catch (error) {
            console.error('초대 목록 조회 오류:', error);
            res.status(500).json({ 
                error: '초대 목록을 불러올 수 없습니다.' 
            });
        }
    }
);

// 초대 취소
router.delete('/invitations/:id', 
    authenticateToken, 
    requireAdmin,
    logAdminActivity('cancel_invitation'),
    async (req, res) => {
        const { id } = req.params;
        
        try {
            // 초대 정보 확인
            const inviteResult = await pool.query(
                'SELECT * FROM admin_invitations WHERE id = $1',
                [id]
            );
            
            if (!inviteResult.rows.length) {
                return res.status(404).json({ 
                    error: '초대를 찾을 수 없습니다.' 
                });
            }
            
            const invitation = inviteResult.rows[0];
            
            // 권한 확인
            if (req.user.role === 'company_admin' && 
                invitation.company_id !== req.user.companyId) {
                return res.status(403).json({ 
                    error: '다른 회사의 초대를 취소할 수 없습니다.' 
                });
            }
            
            // 이미 사용된 초대는 취소 불가
            if (invitation.used) {
                return res.status(400).json({ 
                    error: '이미 사용된 초대는 취소할 수 없습니다.' 
                });
            }
            
            // 초대 삭제
            await pool.query(
                'DELETE FROM admin_invitations WHERE id = $1',
                [id]
            );
            
            res.json({
                success: true,
                message: '초대가 취소되었습니다.'
            });
            
        } catch (error) {
            console.error('초대 취소 오류:', error);
            res.status(500).json({ 
                error: '초대 취소 중 오류가 발생했습니다.' 
            });
        }
    }
);

module.exports = router;