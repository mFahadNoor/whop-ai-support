# 🚀 Whop AI Bot - Production Deployment Guide

A production-ready AI-powered bot for Whop communities with enterprise-grade features including structured logging, health monitoring, rate limiting, and comprehensive error handling.

## 📋 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Database Setup](#database-setup)
- [Deployment Options](#deployment-options)
- [Monitoring & Health Checks](#monitoring--health-checks)
- [Performance Tuning](#performance-tuning)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## ✨ Features

### Core Functionality
- **AI-Powered Question Answering**: Intelligent responses using OpenRouter AI
- **Multi-Community Support**: Scalable architecture for hundreds of Whop communities
- **Real-time WebSocket Integration**: Live message processing
- **Command System**: Built-in commands (!help, !feed)
- **Forum Post Generation**: AI-generated forum announcements

### Production Features
- **Structured Logging**: Comprehensive logging with database persistence
- **Health Monitoring**: Built-in health checks and system monitoring
- **Rate Limiting**: Sophisticated rate limiting for AI and message sending
- **Error Handling**: Robust error handling with automatic retries
- **Input Validation**: Security-focused input sanitization
- **Performance Metrics**: Detailed performance tracking and metrics
- **Memory Management**: Automatic cleanup and memory optimization
- **Graceful Shutdown**: Clean shutdown handling for containers

## 🏗️ Architecture

### Service Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Next.js App  │    │   Bot Service   │    │   Database      │
│   (Frontend)    │◄──►│   (WebSocket)   │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Health API    │    │   Whop API      │    │   OpenRouter    │
│   (/api/health) │    │   (GraphQL)     │    │   (AI Service)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components
- **BotCoordinator**: Main orchestration service
- **AIService**: AI integration with rate limiting
- **WhopAPI**: Whop GraphQL API wrapper
- **CompanyManager**: Multi-tenant configuration management
- **Logger**: Structured logging with metrics
- **HealthChecker**: System health monitoring
- **RateLimiter**: Advanced rate limiting system
- **Validator**: Input validation and sanitization

## 📋 Prerequisites

### System Requirements
- **Node.js**: 18.x or higher
- **PostgreSQL**: 14.x or higher (for production)
- **Memory**: Minimum 512MB RAM (recommended 1GB+)
- **Storage**: 1GB+ available space

### API Keys Required
- **Whop App API Key**: From your Whop app dashboard
- **OpenRouter API Key**: From https://openrouter.ai/
- **Whop Agent User ID**: Your bot's user ID

## ⚙️ Environment Setup

### 1. Clone and Install
```bash
git clone <your-repository>
cd creator-distributed-ai
npm install
```

### 2. Environment Configuration
```bash
cp env.example .env
```

Edit `.env` with your actual values:
```env
# Required
DATABASE_URL="postgresql://user:pass@host:5432/db"
WHOP_APP_API_KEY="your_api_key"
WHOP_AGENT_USER_ID="your_user_id"
OPENROUTER_API_KEY="your_openrouter_key"

# Production Settings
NODE_ENV="production"
ENABLE_DB_LOGGING="true"
```

### 3. Database Setup
```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma db push

# Optional: View database
npx prisma studio
```

## 🗄️ Database Setup

### PostgreSQL Production Setup

#### Option 1: Managed Services (Recommended)
- **Supabase**: Full-featured PostgreSQL with real-time features (Recommended)
- **Vercel Postgres**: Integrated with Vercel deployments
- **Railway**: Developer-friendly managed PostgreSQL
- **AWS RDS**: Enterprise-grade managed PostgreSQL
- **Google Cloud SQL**: Scalable managed database

#### Option 2: Self-Hosted
```sql
-- Create database
CREATE DATABASE whop_bot_prod;

-- Create user
CREATE USER whop_bot WITH PASSWORD 'secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE whop_bot_prod TO whop_bot;
```

### Supabase Setup (Recommended)

#### 1. Create Supabase Project
1. Go to [Supabase](https://supabase.com) and create a new project
2. Choose your region (closest to your users)
3. Set a strong database password
4. Wait for the project to be created

#### 2. Get Connection Strings
1. Go to **Settings** → **Database**
2. Copy both connection strings:
   - **Connection pooling** (for `DATABASE_URL`)
   - **Direct connection** (for `DIRECT_URL`)

#### 3. Configure Environment
```env
# Use the pooled connection for your app
DATABASE_URL="postgresql://postgres.your-ref:[PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Use the direct connection for migrations
DIRECT_URL="postgresql://postgres.your-ref:[PASSWORD]@aws-0-region.pooler.supabase.com:5432/postgres"
```

#### 4. Database Migration
```bash
# Run migrations using the direct connection
npx prisma db push

# Verify tables were created
npx prisma studio
```

#### 5. Supabase Additional Benefits
- **Built-in Dashboard**: Monitor your database performance
- **Real-time subscriptions**: If you want to add real-time features later
- **Row Level Security**: Enhanced security features
- **Automatic backups**: Built-in backup and restore
- **Connection pooling**: Handles high connection loads automatically
- **Free tier**: Generous free tier for development and small deployments

### Connection String Format
```
# Supabase Pooled (recommended for app)
postgresql://postgres.ref:password@region.pooler.supabase.com:6543/postgres?pgbouncer=true

# Supabase Direct (for migrations)
postgresql://postgres.ref:password@region.pooler.supabase.com:5432/postgres

# Other providers
postgresql://username:password@hostname:port/database_name?sslmode=require
```

## 🚀 Deployment Options

### Option 1: Vercel (Recommended)

#### 1. Frontend Deployment
```bash
npm run build
vercel deploy --prod
```

#### 2. Bot Service Deployment
Create `vercel-bot.json`:
```json
{
  "functions": {
    "lib/bot-new.ts": {
      "runtime": "nodejs18.x"
    }
  }
}
```

Deploy bot service:
```bash
vercel deploy --prod --config vercel-bot.json
```

### Option 2: Docker

#### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

#### Build and Deploy
```bash
docker build -t whop-ai-bot .
docker run -p 3000:3000 --env-file .env whop-ai-bot
```

### Option 3: Traditional VPS

#### Process Manager (PM2)
```bash
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'whop-ai-bot-web',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'whop-ai-bot-worker',
      script: 'node',
      args: 'lib/bot-new.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
EOF

# Start services
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 📊 Monitoring & Health Checks

### Health Check Endpoint
```
GET /api/health
```

Response format:
```json
{
  "healthy": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": { "status": "healthy", "responseTime": 45 },
    "aiService": { "status": "healthy", "responseTime": 12 },
    "whopApi": { "status": "healthy", "responseTime": 89 },
    "memory": { "status": "healthy", "details": { "heapUsedMB": 125 } }
  },
  "environment": {
    "nodeEnv": "production",
    "hasRequiredEnvVars": true,
    "missingEnvVars": []
  }
}
```

### Monitoring Setup

#### Uptime Monitoring
- **Recommended**: UptimeRobot, Pingdom, or DataDog
- **Check URL**: `https://your-domain.com/api/health`
- **Frequency**: Every 5 minutes
- **Alert on**: HTTP 503 or timeout

#### Log Monitoring
Database logs are automatically stored in the `error_logs` table:
```sql
SELECT level, message, timestamp, context 
FROM error_logs 
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC;
```

#### Metrics Dashboard
System metrics in `system_metrics` table:
```sql
SELECT metric_name, AVG(metric_value) as avg_value
FROM system_metrics 
WHERE timestamp > NOW() - INTERVAL '1 day'
GROUP BY metric_name;
```

## ⚡ Performance Tuning

### Rate Limiting Configuration
```env
# Adjust based on your needs
AI_RATE_LIMIT_PER_MINUTE="20"          # Higher for more AI requests
MESSAGE_RATE_LIMIT_PER_MINUTE="50"     # Higher for busy communities
CACHE_TTL_MINUTES="10"                 # Longer for better performance
MAX_MEMORY_CACHE_SIZE="2000"           # Higher for more caching
```

### Database Optimization
```sql
-- Add indexes for better performance
CREATE INDEX CONCURRENTLY idx_companies_created_at ON companies(created_at);
CREATE INDEX CONCURRENTLY idx_error_logs_timestamp ON error_logs(timestamp);
CREATE INDEX CONCURRENTLY idx_system_metrics_name_time ON system_metrics(metric_name, timestamp);
```

### Memory Management
- Monitor heap usage via health checks
- Automatic cleanup runs every 10 minutes
- Rate limiter cleanup runs every 5 minutes
- Set memory limits in production environment

## 🔒 Security Considerations

### Environment Variables
- Never commit `.env` files
- Use encrypted storage for secrets
- Rotate API keys regularly
- Use different keys for staging/production

### Input Validation
- All user inputs are sanitized
- Message length limits enforced
- Knowledge base size limits
- Rate limiting prevents abuse

### Database Security
- Use connection encryption (SSL)
- Regular security updates
- Backup encryption
- Access control and auditing

### API Security
- Validate all webhook signatures
- Rate limit API endpoints
- Monitor for unusual patterns
- Log all security events

## 🔧 Troubleshooting

### Common Issues

#### 1. Database Connection Errors
```bash
# Check connection
npx prisma db pull

# Reset database
npx prisma migrate reset
```

#### 2. WebSocket Connection Issues
- Check `WHOP_APP_API_KEY` validity
- Verify `WHOP_AGENT_USER_ID` format
- Monitor rate limiting logs
- Check network connectivity

#### 3. AI Service Errors
- Verify `OPENROUTER_API_KEY`
- Check rate limits and quotas
- Monitor API response times
- Review error logs in database

#### 4. Memory Issues
```bash
# Monitor memory usage
curl https://your-domain.com/api/health | jq '.services.memory'

# Check for memory leaks
node --inspect lib/bot-new.js
```

### Debug Mode
```env
NODE_ENV="development"
ENABLE_DB_LOGGING="true"
```

### Log Analysis
```sql
-- Recent errors
SELECT * FROM error_logs 
WHERE level = 'ERROR' 
AND timestamp > NOW() - INTERVAL '1 hour';

-- Performance metrics
SELECT 
  metric_name,
  AVG(metric_value) as avg,
  MAX(metric_value) as max,
  COUNT(*) as count
FROM system_metrics 
WHERE timestamp > NOW() - INTERVAL '1 day'
GROUP BY metric_name;
```

## 📈 Scaling for Hundreds of Communities

### Horizontal Scaling
- Deploy multiple bot worker processes
- Use load balancer for web interface
- Database read replicas for metrics
- Redis for distributed rate limiting

### Monitoring at Scale
- Set up alerts for high error rates
- Monitor response times per community
- Track AI API usage and costs
- Database performance monitoring

### Cost Optimization
- Monitor OpenRouter usage
- Implement intelligent caching
- Rate limit aggressive users
- Archive old logs and metrics

---

## 🆘 Support

For production support:
1. Check health endpoint: `/api/health`
2. Review database logs
3. Monitor system metrics
4. Check environment configuration

## 📄 License

[Your License Here] 