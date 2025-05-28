# 🤖 AI Support Bot

A production-ready AI-powered support bot for Whop communities with advanced token optimization and intelligent response prioritization.

## ✨ Features

- **Smart Question Detection**: Only processes messages with question indicators (saves 80%+ tokens)
- **Preset Q&A Priority**: Direct answers for common questions without AI processing
- **Knowledge Base Integration**: AI-powered responses using community-specific information
- **Admin-Only Configuration**: Secure access - only Whop company admins can modify bot settings
- **Production-Grade Logging**: Comprehensive monitoring and error tracking
- **Rate Limiting**: Prevents API abuse and manages costs
- **Response Caching**: 30-second cache for similar questions with automatic invalidation
- **PostgreSQL Support**: Scalable database with Supabase integration
- **Health Monitoring**: Built-in health checks for deployment monitoring

## 🔧 Recent Fixes & Improvements

### Fixed Company Mapping Issues
- **Enhanced Retry Logic**: Exponential backoff with jitter for mapping failures
- **Improved Error Handling**: Better logging and max retry limits to prevent infinite loops
- **Database Fallback**: Attempt to fetch mappings from database when WebSocket data is delayed
- **Faster Reconnection**: Reduced initial retry delay from 2000ms to 500ms

### Fixed Stale Cache Issues
- **Reduced Cache TTL**: Changed from 5 minutes to 30 seconds for faster updates
- **Automatic Cache Invalidation**: Settings updates via web app now immediately clear cache
- **Force Refresh API**: New DELETE endpoint for manual cache clearing
- **Random Cache Refresh**: 10% chance to force refresh on each request for freshness

### Enhanced Bot Commands
- **!refresh Command**: Manually reload bot configuration without restart
- **Improved !help**: Now shows all available commands
- **Better Error Messages**: More descriptive responses for debugging

### Production Reliability
- **Better WebSocket Handling**: Exponential backoff with max reconnection attempts
- **Enhanced Logging**: Structured logging with action tracking
- **Memory Management**: Improved cleanup intervals and larger cache capacities
- **Graceful Shutdown**: Better signal handling and cleanup

## 🔒 Security & Admin Access

### Admin Authentication

The bot configuration interface is protected by Whop's built-in authentication system. Only authorized users of each company can access and modify bot settings:

- **Automatic Authorization**: Uses Whop SDK's `hasAccess` function with `authorized-{companyId}` pattern
- **API Protection**: All settings endpoints (GET, POST, DELETE) require admin access
- **Frontend Protection**: Configuration UI shows "Access Denied" for unauthorized users
- **Secure by Default**: No additional setup needed - leverages your existing Whop permissions

### Who Can Configure the Bot?

- ✅ Company owners and admins
- ❌ Regular members and non-members
- ❌ Unauthorized API requests

### Access Control Implementation

```typescript
// Automatic admin check on all settings routes
const hasAdminAccess = await hasAccess({ 
  to: `authorized-${companyId}`, 
  headers: await headers() 
});

if (!hasAdminAccess) {
  return NextResponse.json(
    { error: 'Unauthorized: Admin access required' },
    { status: 403 }
  );
}
```

This ensures that only people with proper permissions can:
- View bot configuration
- Modify AI settings  
- Update knowledge base
- Manage preset Q&A
- Clear caches

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ai-support.git
   cd ai-support
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Set up database**
   ```bash
   npm run db:push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Start the bot (in another terminal)**
   ```bash
   npm run bot
   ```

## 🧪 Testing Cache Functionality

Test that cache invalidation is working properly:

```bash
# Test cache invalidation for a specific company
npm run test:cache demo

# Or test with a specific company ID
npm run test:cache biz_your_company_id
```

## 🔧 Environment Variables

Key environment variables needed:

```env
# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# AI Service
OPENROUTER_API_KEY="your_api_key"
OPENROUTER_MODEL="anthropic/claude-3.5-sonnet"

# Whop Integration
WHOP_API_KEY="your_whop_api_key"
WHOP_AGENT_USER_ID="your_bot_user_id"
```

## 💡 Token Optimization Features

- **Question Filtering**: Only processes messages containing "?" or question words
- **Preset Q&A**: Direct answers bypass AI entirely
- **Response Caching**: 30-second cache for similar questions with auto-invalidation
- **Message Validation**: Filters spam, short messages, and emoji-only content
- **Smart Deduplication**: Prevents processing duplicate requests

**Expected Token Savings: 80-90%** compared to processing all messages.

## 📊 Commands

- `!help` - Show bot information and available commands
- `!refresh` - Reload bot configuration (clears cache)

## 🏗️ Architecture

- **Next.js 15** - Modern React framework
- **PostgreSQL** - Production database with Prisma ORM
- **OpenRouter** - AI API integration
- **Whop SDK** - Community platform integration
- **Production Logging** - Structured logging with metrics

## 🐛 Troubleshooting

### Bot Not Responding to Updated Settings

1. **Check if cache was invalidated**: Settings updates should automatically clear cache
2. **Manual cache clear**: Use the `!refresh` command in chat
3. **API cache clear**: Send DELETE request to `/api/company/[companyId]/settings`
4. **Restart bot**: As last resort, restart the bot process

### Company Mapping Issues

1. **Check logs**: Look for "No company mapping" messages
2. **Wait for retry**: Bot will retry mapping lookup with exponential backoff
3. **Check WebSocket connection**: Ensure bot is connected to Whop's WebSocket
4. **Verify experience ID**: Ensure the experience is properly configured in Whop

### Performance Issues

1. **Monitor system stats**: Check bot output for system statistics
2. **Review rate limits**: Ensure AI rate limits aren't being exceeded
3. **Database performance**: Monitor PostgreSQL performance and connections
4. **Memory usage**: Bot includes automatic cleanup and memory management

## 📝 License

MIT License - feel free to use for your own communities!

---

**Made by Vortex (@script)** - Scaling AI support for hundreds of Whop communities 