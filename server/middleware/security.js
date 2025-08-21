const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting 설정
const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                error: message,
                retryAfter: Math.round(windowMs / 1000)
            });
        }
    });
};

// 로그인 시도 제한 (더 엄격한 관리자용)
const adminLoginLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    3, // 최대 3회 (일반 사용자보다 더 엄격)
    '너무 많은 로그인 시도입니다. 15분 후 다시 시도해주세요.'
);

// 일반 로그인 시도 제한
const loginLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    5, // 최대 5회
    '너무 많은 로그인 시도입니다. 15분 후 다시 시도해주세요.'
);

// API 요청 제한
const apiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    100, // 최대 100회
    '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
);

// 관리자 API 요청 제한 (더 관대함)
const adminApiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15분
    200, // 최대 200회
    '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
);

// SQL Injection 방지
const preventSQLInjection = (req, res, next) => {
    const suspicious = /(\b(union|select|insert|update|delete|drop|create|alter|exec|script)\b)/gi;
    
    const checkValue = (value) => {
        if (typeof value === 'string' && suspicious.test(value)) {
            // 로깅 (관리자 활동)
            console.warn(`SQL Injection 시도 감지: IP=${req.ip}, URL=${req.url}, Value=${value}`);
            return true;
        }
        return false;
    };
    
    // 모든 입력값 검사
    for (const key in req.body) {
        if (checkValue(req.body[key])) {
            return res.status(400).json({
                success: false,
                error: '잘못된 입력입니다.'
            });
        }
    }
    
    for (const key in req.query) {
        if (checkValue(req.query[key])) {
            return res.status(400).json({
                success: false,
                error: '잘못된 입력입니다.'
            });
        }
    }
    
    for (const key in req.params) {
        if (checkValue(req.params[key])) {
            return res.status(400).json({
                success: false,
                error: '잘못된 입력입니다.'
            });
        }
    }
    
    next();
};

// XSS 방지
const sanitizeInput = (req, res, next) => {
    const sanitize = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                // HTML 태그 제거
                obj[key] = obj[key].replace(/<[^>]*>/g, '');
                // 스크립트 태그 제거
                obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                // 이벤트 핸들러 제거
                obj[key] = obj[key].replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitize(obj[key]);
            }
        }
    };
    
    sanitize(req.body);
    sanitize(req.query);
    sanitize(req.params);
    
    next();
};

// IP 화이트리스트 (관리자용)
const ipWhitelist = (allowedIPs = []) => {
    return (req, res, next) => {
        // 환경변수에서 허용된 IP 목록 가져오기
        const whitelist = allowedIPs.length > 0 
            ? allowedIPs 
            : (process.env.ADMIN_ALLOWED_IPS || '').split(',').filter(ip => ip);
        
        // 화이트리스트가 비어있으면 모든 IP 허용
        if (whitelist.length === 0) {
            return next();
        }
        
        const clientIP = req.ip || req.connection.remoteAddress;
        
        if (!whitelist.includes(clientIP)) {
            console.warn(`관리자 접근 차단: IP=${clientIP}, URL=${req.url}`);
            return res.status(403).json({
                success: false,
                error: '접근이 거부되었습니다.'
            });
        }
        
        next();
    };
};

// CORS 설정 (보안 강화)
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
        
        // 개발 환경에서는 localhost 허용
        if (process.env.NODE_ENV === 'development') {
            allowedOrigins.push('http://localhost:3000');
            allowedOrigins.push('http://localhost:5173');
        }
        
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS 정책에 의해 차단되었습니다.'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

// 보안 헤더 설정
const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
});

// 세션 타임아웃 체크 (관리자용)
const checkSessionTimeout = (timeoutMinutes = 30) => {
    return (req, res, next) => {
        if (req.user && req.user.role && ['super_admin', 'company_admin'].includes(req.user.role)) {
            const lastActivity = req.session?.lastActivity || Date.now();
            const now = Date.now();
            const timeout = timeoutMinutes * 60 * 1000;
            
            if (now - lastActivity > timeout) {
                req.session?.destroy();
                return res.status(401).json({
                    success: false,
                    error: '세션이 만료되었습니다. 다시 로그인해주세요.'
                });
            }
            
            if (req.session) {
                req.session.lastActivity = now;
            }
        }
        
        next();
    };
};

module.exports = {
    loginLimiter,
    adminLoginLimiter,
    apiLimiter,
    adminApiLimiter,
    preventSQLInjection,
    sanitizeInput,
    ipWhitelist,
    corsOptions,
    securityHeaders,
    checkSessionTimeout
};