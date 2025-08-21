// API 응답 표준화 유틸리티

class ApiResponse {
    // 성공 응답
    static success(res, data = null, message = '성공', statusCode = 200) {
        return res.status(statusCode).json({
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        });
    }
    
    // 에러 응답
    static error(res, message = '오류가 발생했습니다', statusCode = 500, details = null) {
        const response = {
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        };
        
        // 개발 환경에서만 상세 에러 정보 포함
        if (process.env.NODE_ENV === 'development' && details) {
            response.details = details;
        }
        
        return res.status(statusCode).json(response);
    }
    
    // 유효성 검사 에러
    static validationError(res, errors) {
        return res.status(400).json({
            success: false,
            error: '입력값 검증 실패',
            errors: Array.isArray(errors) ? errors : [errors],
            timestamp: new Date().toISOString()
        });
    }
    
    // 권한 없음
    static unauthorized(res, message = '인증이 필요합니다') {
        return res.status(401).json({
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        });
    }
    
    // 접근 금지
    static forbidden(res, message = '접근 권한이 없습니다') {
        return res.status(403).json({
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        });
    }
    
    // 리소스 없음
    static notFound(res, resource = '리소스') {
        return res.status(404).json({
            success: false,
            error: `${resource}를 찾을 수 없습니다`,
            timestamp: new Date().toISOString()
        });
    }
    
    // 페이지네이션 응답
    static paginated(res, data, pagination, message = '조회 성공') {
        return res.status(200).json({
            success: true,
            message,
            data,
            pagination: {
                currentPage: pagination.page,
                totalPages: pagination.totalPages,
                pageSize: pagination.limit,
                totalCount: pagination.total,
                hasNext: pagination.page < pagination.totalPages,
                hasPrev: pagination.page > 1
            },
            timestamp: new Date().toISOString()
        });
    }
}

// 에러 핸들러
class ErrorHandler {
    static handle(error, req, res, next) {
        // 로깅
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`, error);
        
        // 이미 응답이 전송된 경우
        if (res.headersSent) {
            return next(error);
        }
        
        // 데이터베이스 에러 처리
        if (error.code) {
            switch (error.code) {
                case '23505': // unique violation
                    return ApiResponse.error(res, '중복된 데이터입니다', 409);
                case '23503': // foreign key violation
                    return ApiResponse.error(res, '참조하는 데이터가 존재하지 않습니다', 400);
                case '23502': // not null violation
                    return ApiResponse.error(res, '필수 데이터가 누락되었습니다', 400);
                case '22P02': // invalid text representation
                    return ApiResponse.error(res, '잘못된 데이터 형식입니다', 400);
                default:
                    break;
            }
        }
        
        // JWT 에러 처리
        if (error.name === 'JsonWebTokenError') {
            return ApiResponse.unauthorized(res, '유효하지 않은 토큰입니다');
        }
        
        if (error.name === 'TokenExpiredError') {
            return ApiResponse.unauthorized(res, '토큰이 만료되었습니다');
        }
        
        // Multer 에러 처리
        if (error.name === 'MulterError') {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return ApiResponse.error(res, '파일 크기가 너무 큽니다', 413);
            }
            return ApiResponse.error(res, '파일 업로드 중 오류가 발생했습니다', 400);
        }
        
        // 기본 에러 응답
        return ApiResponse.error(
            res, 
            process.env.NODE_ENV === 'production' 
                ? '서버 오류가 발생했습니다' 
                : error.message,
            500,
            error.stack
        );
    }
}

// 비동기 핸들러 래퍼
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// 입력값 검증 헬퍼
class Validator {
    static email(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }
    
    static password(password) {
        return password && password.length >= 8;
    }
    
    static strongPassword(password) {
        // 최소 8자, 대문자, 소문자, 숫자, 특수문자 포함
        const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        return regex.test(password);
    }
    
    static phone(phone) {
        const regex = /^(\+82|0)1[0-9]-?[0-9]{3,4}-?[0-9]{4}$/;
        return regex.test(phone.replace(/\s/g, ''));
    }
    
    static required(value) {
        return value !== null && value !== undefined && value !== '';
    }
    
    static minLength(value, length) {
        return value && value.length >= length;
    }
    
    static maxLength(value, length) {
        return value && value.length <= length;
    }
    
    static isNumber(value) {
        return !isNaN(value) && isFinite(value);
    }
    
    static isPositiveNumber(value) {
        return this.isNumber(value) && value > 0;
    }
    
    static isDate(value) {
        return !isNaN(Date.parse(value));
    }
    
    static isFutureDate(value) {
        return this.isDate(value) && new Date(value) > new Date();
    }
    
    static isPastDate(value) {
        return this.isDate(value) && new Date(value) < new Date();
    }
    
    static isIn(value, array) {
        return array.includes(value);
    }
}

// 요청 검증 미들웨어 생성기
const validateRequest = (rules) => {
    return (req, res, next) => {
        const errors = [];
        
        for (const field in rules) {
            const value = req.body[field] || req.query[field] || req.params[field];
            const fieldRules = rules[field];
            
            for (const rule of fieldRules) {
                if (rule.validator && !rule.validator(value)) {
                    errors.push({
                        field,
                        message: rule.message || `${field} 검증 실패`
                    });
                    break;
                }
            }
        }
        
        if (errors.length > 0) {
            return ApiResponse.validationError(res, errors);
        }
        
        next();
    };
};

// 캐싱 헬퍼
class CacheHelper {
    static setCacheHeaders(res, maxAge = 3600, isPrivate = false) {
        res.set({
            'Cache-Control': `${isPrivate ? 'private' : 'public'}, max-age=${maxAge}`,
            'ETag': `"${Date.now()}"`,
            'Last-Modified': new Date().toUTCString()
        });
    }
    
    static setNoCacheHeaders(res) {
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
}

// 쿼리 빌더 헬퍼
class QueryBuilder {
    constructor(baseQuery, params = []) {
        this.query = baseQuery;
        this.params = [...params];
        this.paramCount = params.length;
    }
    
    addCondition(condition, value, operator = 'AND') {
        if (value !== undefined && value !== null) {
            this.query += ` ${operator} ${condition} $${++this.paramCount}`;
            this.params.push(value);
        }
        return this;
    }
    
    addLikeCondition(column, value, operator = 'AND') {
        if (value) {
            this.query += ` ${operator} ${column} ILIKE $${++this.paramCount}`;
            this.params.push(`%${value}%`);
        }
        return this;
    }
    
    addInCondition(column, values, operator = 'AND') {
        if (values && values.length > 0) {
            const placeholders = values.map(() => `$${++this.paramCount}`).join(',');
            this.query += ` ${operator} ${column} IN (${placeholders})`;
            this.params.push(...values);
        }
        return this;
    }
    
    addDateRange(column, startDate, endDate, operator = 'AND') {
        if (startDate) {
            this.query += ` ${operator} ${column} >= $${++this.paramCount}`;
            this.params.push(startDate);
            operator = 'AND';
        }
        if (endDate) {
            this.query += ` ${operator} ${column} <= $${++this.paramCount}`;
            this.params.push(endDate);
        }
        return this;
    }
    
    addOrderBy(column, direction = 'ASC') {
        this.query += ` ORDER BY ${column} ${direction}`;
        return this;
    }
    
    addPagination(limit, offset) {
        if (limit) {
            this.query += ` LIMIT $${++this.paramCount}`;
            this.params.push(limit);
        }
        if (offset) {
            this.query += ` OFFSET $${++this.paramCount}`;
            this.params.push(offset);
        }
        return this;
    }
    
    build() {
        return {
            query: this.query,
            params: this.params
        };
    }
}

module.exports = {
    ApiResponse,
    ErrorHandler,
    asyncHandler,
    Validator,
    validateRequest,
    CacheHelper,
    QueryBuilder
};