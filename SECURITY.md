# Security Configuration Guide

## 🔒 Security Checklist

### ✅ Completed Fixes
- [x] Removed hardcoded localhost URLs from web worker
- [x] Secured health check endpoint (no DB credentials exposure)
- [x] Added proper CORS configuration
- [x] Improved error handling (no stack traces in production)
- [x] Added environment variable validation

### 🔴 Critical Actions Required

#### 1. Environment Variables Setup
Set these environment variables in your production environment:

```bash
# Required for production
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
ALLOWED_ORIGINS=https://your-frontend-domain.com

# Security
ADMIN_API_KEY=your-very-secure-admin-key-here
BLIZZARD_CLIENT_ID=your-blizzard-client-id
BLIZZARD_CLIENT_SECRET=your-blizzard-client-secret

# Rate limiting (stricter in production)
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=50   # Reduced from 100 for production
```

#### 2. Database Security
- [ ] Ensure database is not publicly accessible
- [ ] Use strong database passwords
- [ ] Enable SSL for database connections
- [ ] Consider using connection pooling limits

#### 3. API Security
- [ ] Set up proper API key rotation
- [ ] Monitor API usage for suspicious activity
- [ ] Consider implementing request signing
- [ ] Add input validation middleware

#### 4. Frontend Security
- [ ] Ensure HTTPS is enforced
- [ ] Set up Content Security Policy (CSP)
- [ ] Validate all API calls
- [ ] Implement proper error handling

### 🟡 Recommended Additional Security Measures

#### 1. Add Request Size Limits
```javascript
// In src/index.js, add after body parsing middleware
app.use((req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 10 * 1024 * 1024) { // 10MB limit
    return res.status(413).json({
      error: true,
      message: 'Request too large'
    });
  }
  next();
});
```

#### 2. Add Request Validation
```javascript
// Create src/middleware/validation.js
const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: true,
      message: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};
```

#### 3. Add Security Headers
```javascript
// In src/index.js, enhance helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

### 🔍 Security Monitoring

#### 1. Logging
- [ ] Set up structured logging
- [ ] Monitor for failed authentication attempts
- [ ] Track rate limit violations
- [ ] Log all admin actions

#### 2. Monitoring
- [ ] Set up health checks
- [ ] Monitor API response times
- [ ] Track error rates
- [ ] Set up alerts for suspicious activity

### 🚨 Emergency Response

If you suspect a security breach:

1. **Immediate Actions:**
   - Rotate all API keys
   - Check logs for suspicious activity
   - Review recent deployments
   - Contact your hosting provider

2. **Investigation:**
   - Review access logs
   - Check for unauthorized data access
   - Verify database integrity
   - Review recent code changes

3. **Recovery:**
   - Update all credentials
   - Implement additional security measures
   - Document the incident
   - Review security procedures

### 📋 Regular Security Tasks

#### Weekly
- [ ] Review error logs
- [ ] Check rate limit violations
- [ ] Monitor API usage patterns

#### Monthly
- [ ] Rotate API keys
- [ ] Review access logs
- [ ] Update dependencies
- [ ] Review security configurations

#### Quarterly
- [ ] Security audit
- [ ] Penetration testing
- [ ] Update security documentation
- [ ] Review incident response procedures

## 🔐 Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Environment mode | `production` |
| `FRONTEND_URL` | Yes | Frontend domain | `https://app.example.com` |
| `ALLOWED_ORIGINS` | Yes | CORS allowed origins | `https://app.example.com,https://admin.example.com` |
| `ADMIN_API_KEY` | Yes | Admin authentication | `your-secure-key` |
| `BLIZZARD_CLIENT_ID` | Yes | Blizzard API client ID | `your-client-id` |
| `BLIZZARD_CLIENT_SECRET` | Yes | Blizzard API secret | `your-client-secret` |
| `RATE_LIMIT_MAX_REQUESTS` | No | Rate limit per window | `50` |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window | `900000` |

## 🛡️ Security Best Practices

1. **Never commit secrets to version control**
2. **Use environment variables for all sensitive data**
3. **Implement proper input validation**
4. **Use HTTPS in production**
5. **Regularly update dependencies**
6. **Monitor and log security events**
7. **Implement proper error handling**
8. **Use security headers**
9. **Validate all user inputs**
10. **Implement rate limiting**

## 📞 Security Contacts

- **Emergency**: [Your emergency contact]
- **Security Team**: [Your security team contact]
- **Hosting Provider**: [Your hosting provider contact] 