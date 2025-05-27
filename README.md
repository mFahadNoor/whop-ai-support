# 🤖 AI Support Bot

A production-ready AI-powered support bot for Whop communities with advanced token optimization and intelligent response prioritization.

## ✨ Features

- **Smart Question Detection**: Only processes messages with question indicators (saves 80%+ tokens)
- **Preset Q&A Priority**: Direct answers for common questions without AI processing
- **Knowledge Base Integration**: AI-powered responses using community-specific information
- **Production-Grade Logging**: Comprehensive monitoring and error tracking
- **Rate Limiting**: Prevents API abuse and manages costs
- **Response Caching**: 5-minute cache for similar questions
- **PostgreSQL Support**: Scalable database with Supabase integration
- **Health Monitoring**: Built-in health checks for deployment monitoring

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
- **Response Caching**: 5-minute cache for similar questions  
- **Message Validation**: Filters spam, short messages, and emoji-only content
- **Smart Deduplication**: Prevents processing duplicate requests

**Expected Token Savings: 80-90%** compared to processing all messages.

## 📊 Commands

- `!help` - Show bot information
- `!feed` - Generate conversation summary (admin only)

## 🏗️ Architecture

- **Next.js 15** - Modern React framework
- **PostgreSQL** - Production database with Prisma ORM
- **OpenRouter** - AI API integration
- **Whop SDK** - Community platform integration
- **Production Logging** - Structured logging with metrics

## 📝 License

MIT License - feel free to use for your own communities!

---

**Made by Vortex (@script)** - Scaling AI support for hundreds of Whop communities 