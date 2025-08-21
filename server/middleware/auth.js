const jwt = require('jsonwebtoken');

// 기본 인증 미들웨어 (로그인 확인)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '인증이 필요합니다.' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
        }
        req.user = user;
        next();
    });
};

// 관리자 권한 확인 미들웨어
const requireAdmin = (req, res, next) => {
    if (!req.user || !['super_admin', 'company_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
};

// 슈퍼 관리자 권한 확인 미들웨어
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'super_admin') {
        return res.status(403).json({ error: '슈퍼 관리자 권한이 필요합니다.' });
    }
    next();
};

// 회사별 데이터 접근 권한 확인
const requireCompanyAccess = (req, res, next) => {
    const { companyId } = req.params;
    
    // 슈퍼 관리자는 모든 회사 접근 가능
    if (req.user.role === 'super_admin') {
        return next();
    }
    
    // 회사 관리자는 자기 회사만 접근 가능
    if (req.user.role === 'company_admin' && 
        req.user.companyId === parseInt(companyId)) {
        return next();
    }
    
    return res.status(403).json({ error: '해당 회사의 데이터에 접근할 권한이 없습니다.' });
};

// 자기 데이터만 접근 가능 (일반 사용자용)
const requireSelfAccess = (req, res, next) => {
    const { userId } = req.params;
    
    // 관리자는 모두 접근 가능
    if (['super_admin', 'company_admin'].includes(req.user.role)) {
        return next();
    }
    
    // 일반 사용자는 자기 데이터만 접근 가능
    if (req.user.userId === userId) {
        return next();
    }
    
    return res.status(403).json({ error: '본인의 데이터만 접근할 수 있습니다.' });
};

// 관리자 활동 로깅 미들웨어
const logAdminActivity = (action) => {
    return async (req, res, next) => {
        // 응답 후에 로깅을 수행하기 위해 res.on('finish') 사용
        const originalSend = res.send;
        res.send = function(data) {
            res.send = originalSend;
            const result = res.send(data);
            
            // 성공적인 요청만 로깅
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const { Pool } = require('pg');
                const pool = new Pool({
                    connectionString: process.env.DATABASE_URL,
                    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
                });
                
                const details = {
                    method: req.method,
                    path: req.path,
                    params: req.params,
                    query: req.query,
                    body: req.body ? Object.keys(req.body) : undefined
                };
                
                pool.query(`
                    INSERT INTO admin_activity_logs 
                    (admin_id, action, target_type, target_id, details, ip_address)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    req.user.userId,
                    action,
                    req.params.type || null,
                    req.params.id || req.params.userId || null,
                    JSON.stringify(details),
                    req.ip
                ]).catch(error => {
                    console.error('관리자 활동 로깅 실패:', error);
                });
            }
            
            return result;
        };
        
        next();
    };
};

// JWT 토큰 생성 함수 (role과 companyId 포함)
const generateToken = (user) => {
    const payload = {
        userId: user.user_id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        companyId: user.company_id || null
    };
    
    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// 토큰 갱신 함수
const refreshToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '토큰이 필요합니다.' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        const now = Date.now() / 1000;
        
        // 토큰 만료 1시간 전부터 갱신 가능
        if (decoded.exp - now < 3600) {
            const newToken = generateToken(decoded);
            res.setHeader('X-New-Token', newToken);
        }
        
        next();
    } catch (error) {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireSuperAdmin,
    requireCompanyAccess,
    requireSelfAccess,
    logAdminActivity,
    generateToken,
    refreshToken
};