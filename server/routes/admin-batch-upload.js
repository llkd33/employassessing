const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { 
    authenticateToken, 
    requireAdmin,
    logAdminActivity 
} = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 파일 업로드 설정
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB 제한
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('CSV 파일만 업로드 가능합니다.'));
        }
    }
});

// 임시 비밀번호 생성
const generateTempPassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

// CSV 파일 파싱 및 유효성 검사
const parseAndValidateCSV = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        const errors = [];
        let rowNumber = 0;
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                rowNumber++;
                
                // 필수 필드 확인
                if (!data.email || !data.name) {
                    errors.push({
                        row: rowNumber,
                        error: '이메일과 이름은 필수입니다.'
                    });
                    return;
                }
                
                // 이메일 형식 검증
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(data.email)) {
                    errors.push({
                        row: rowNumber,
                        email: data.email,
                        error: '유효하지 않은 이메일 형식'
                    });
                    return;
                }
                
                results.push({
                    row: rowNumber,
                    email: data.email.toLowerCase().trim(),
                    name: data.name.trim(),
                    department: data.department?.trim() || null,
                    employeeNumber: data.employee_number?.trim() || null
                });
            })
            .on('end', () => {
                resolve({ results, errors });
            })
            .on('error', reject);
    });
};

// 배치 사용자 업로드
router.post('/batch-upload', 
    authenticateToken, 
    requireAdmin,
    upload.single('file'),
    logAdminActivity('batch_user_upload'),
    async (req, res) => {
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ 
                error: 'CSV 파일을 업로드해주세요.' 
            });
        }
        
        try {
            // CSV 파싱 및 검증
            const { results, errors } = await parseAndValidateCSV(file.path);
            
            if (results.length === 0) {
                fs.unlinkSync(file.path); // 파일 삭제
                return res.status(400).json({ 
                    error: '유효한 데이터가 없습니다.',
                    errors 
                });
            }
            
            // 회사 ID 결정
            const companyId = req.user.role === 'super_admin' 
                ? req.body.companyId 
                : req.user.companyId;
                
            if (!companyId) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ 
                    error: '회사 ID가 필요합니다.' 
                });
            }
            
            // 배치 업로드 기록 생성
            const uploadResult = await pool.query(`
                INSERT INTO batch_user_uploads 
                (uploaded_by, company_id, file_name, total_count, status)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [
                req.user.userId,
                companyId,
                file.originalname,
                results.length,
                'processing'
            ]);
            
            const uploadId = uploadResult.rows[0].id;
            
            // 비동기로 사용자 처리 시작
            processBatchUsers(uploadId, results, companyId, errors)
                .then(() => {
                    console.log(`배치 업로드 ${uploadId} 완료`);
                })
                .catch(error => {
                    console.error(`배치 업로드 ${uploadId} 실패:`, error);
                });
            
            // 파일 삭제
            fs.unlinkSync(file.path);
            
            res.json({
                success: true,
                message: '파일 업로드가 시작되었습니다.',
                uploadId: uploadId,
                totalCount: results.length,
                initialErrors: errors
            });
            
        } catch (error) {
            // 파일 삭제
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            
            console.error('배치 업로드 오류:', error);
            res.status(500).json({ 
                error: '파일 처리 중 오류가 발생했습니다.' 
            });
        }
    }
);

// 배치 사용자 처리 함수
async function processBatchUsers(uploadId, users, companyId, initialErrors) {
    const client = await pool.connect();
    let successCount = 0;
    let failedCount = initialErrors.length;
    const processedEmails = new Set();
    
    try {
        // 기존 이메일 확인
        const existingEmails = await client.query(
            'SELECT email FROM users WHERE email = ANY($1)',
            [users.map(u => u.email)]
        );
        
        const existingEmailSet = new Set(existingEmails.rows.map(r => r.email));
        
        for (const user of users) {
            try {
                // 중복 이메일 체크
                if (existingEmailSet.has(user.email) || processedEmails.has(user.email)) {
                    await client.query(`
                        INSERT INTO batch_user_upload_details 
                        (upload_id, row_number, email, name, status, error_message)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [
                        uploadId,
                        user.row,
                        user.email,
                        user.name,
                        'skipped',
                        '이미 존재하는 이메일입니다.'
                    ]);
                    failedCount++;
                    continue;
                }
                
                // 임시 비밀번호 생성
                const tempPassword = generateTempPassword();
                const hashedPassword = await bcrypt.hash(tempPassword, 10);
                
                // 사용자 생성
                const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                await client.query('BEGIN');
                
                const userResult = await client.query(`
                    INSERT INTO users 
                    (user_id, email, password, name, role, company_id, login_type)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id
                `, [
                    userId,
                    user.email,
                    hashedPassword,
                    user.name,
                    'user',
                    companyId,
                    'email'
                ]);
                
                // 부가 정보 업데이트 (있는 경우)
                if (user.department || user.employeeNumber) {
                    const updates = [];
                    const values = [userId];
                    let paramCount = 1;
                    
                    if (user.department) {
                        updates.push(`department = $${++paramCount}`);
                        values.push(user.department);
                    }
                    
                    if (user.employeeNumber) {
                        updates.push(`employee_number = $${++paramCount}`);
                        values.push(user.employeeNumber);
                    }
                    
                    await client.query(
                        `UPDATE users SET ${updates.join(', ')} WHERE user_id = $1`,
                        values
                    );
                }
                
                // 성공 기록
                await client.query(`
                    INSERT INTO batch_user_upload_details 
                    (upload_id, row_number, email, name, status, user_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    uploadId,
                    user.row,
                    user.email,
                    user.name,
                    'success',
                    userId
                ]);
                
                await client.query('COMMIT');
                
                successCount++;
                processedEmails.add(user.email);
                
                // TODO: 이메일로 임시 비밀번호 발송
                // await sendWelcomeEmail(user.email, user.name, tempPassword);
                
            } catch (error) {
                await client.query('ROLLBACK');
                
                // 실패 기록
                await client.query(`
                    INSERT INTO batch_user_upload_details 
                    (upload_id, row_number, email, name, status, error_message)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    uploadId,
                    user.row,
                    user.email,
                    user.name,
                    'failed',
                    error.message
                ]);
                
                failedCount++;
            }
        }
        
        // 업로드 상태 업데이트
        await client.query(`
            UPDATE batch_user_uploads 
            SET status = 'completed',
                success_count = $2,
                failed_count = $3,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [uploadId, successCount, failedCount]);
        
    } catch (error) {
        // 전체 실패 처리
        await client.query(`
            UPDATE batch_user_uploads 
            SET status = 'failed',
                error_details = $2,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [uploadId, JSON.stringify({ error: error.message })]);
        
        throw error;
    } finally {
        client.release();
    }
}

// 배치 업로드 상태 조회
router.get('/batch-upload/:uploadId', 
    authenticateToken, 
    requireAdmin,
    async (req, res) => {
        const { uploadId } = req.params;
        
        try {
            // 업로드 정보 조회
            const uploadResult = await pool.query(`
                SELECT bu.*, u.name as uploaded_by_name
                FROM batch_user_uploads bu
                JOIN users u ON bu.uploaded_by = u.user_id
                WHERE bu.id = $1
            `, [uploadId]);
            
            if (!uploadResult.rows.length) {
                return res.status(404).json({ 
                    error: '업로드를 찾을 수 없습니다.' 
                });
            }
            
            const upload = uploadResult.rows[0];
            
            // 권한 확인
            if (req.user.role === 'company_admin' && 
                upload.company_id !== req.user.companyId) {
                return res.status(403).json({ 
                    error: '접근 권한이 없습니다.' 
                });
            }
            
            // 상세 정보 조회
            const detailsResult = await pool.query(`
                SELECT * FROM batch_user_upload_details
                WHERE upload_id = $1
                ORDER BY row_number
            `, [uploadId]);
            
            res.json({
                upload: upload,
                details: detailsResult.rows
            });
            
        } catch (error) {
            console.error('업로드 상태 조회 오류:', error);
            res.status(500).json({ 
                error: '업로드 상태를 조회할 수 없습니다.' 
            });
        }
    }
);

// 배치 업로드 목록 조회
router.get('/batch-uploads', 
    authenticateToken, 
    requireAdmin,
    async (req, res) => {
        try {
            let query;
            let params = [];
            
            if (req.user.role === 'super_admin') {
                query = `
                    SELECT 
                        bu.*,
                        u.name as uploaded_by_name,
                        c.name as company_name
                    FROM batch_user_uploads bu
                    JOIN users u ON bu.uploaded_by = u.user_id
                    JOIN companies c ON bu.company_id = c.id
                    ORDER BY bu.created_at DESC
                `;
            } else {
                query = `
                    SELECT 
                        bu.*,
                        u.name as uploaded_by_name,
                        c.name as company_name
                    FROM batch_user_uploads bu
                    JOIN users u ON bu.uploaded_by = u.user_id
                    JOIN companies c ON bu.company_id = c.id
                    WHERE bu.company_id = $1
                    ORDER BY bu.created_at DESC
                `;
                params = [req.user.companyId];
            }
            
            const result = await pool.query(query, params);
            
            res.json({
                uploads: result.rows
            });
            
        } catch (error) {
            console.error('업로드 목록 조회 오류:', error);
            res.status(500).json({ 
                error: '업로드 목록을 조회할 수 없습니다.' 
            });
        }
    }
);

// CSV 템플릿 다운로드
router.get('/batch-upload/template', 
    authenticateToken, 
    requireAdmin,
    (req, res) => {
        const template = 'email,name,department,employee_number\n' +
                        'john.doe@example.com,John Doe,Engineering,EMP001\n' +
                        'jane.smith@example.com,Jane Smith,Marketing,EMP002\n';
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="user_upload_template.csv"');
        res.send(template);
    }
);

module.exports = router;