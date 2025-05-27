# Data Separation Guide for Multi-Tenant Applications

## Problem: Experience-Level vs Company-Level Data Storage

### Initial Approach (WRONG)
- Stored bot configuration at **experience level** (per chat/forum)
- Each chat/forum required separate configuration
- Users had to configure the bot multiple times for the same business
- Data structure: `/api/experiences/[experienceId]/settings`

### Correct Approach (RIGHT)
- Store bot configuration at **company level** (per business)
- One configuration applies to ALL chats/forums in that business
- Users configure the bot once and it works everywhere in their business
- Data structure: `/api/company/[companyId]/settings`

## Key Architecture Changes

### 1. Database Schema
```prisma
// BEFORE (experience-level)
model Experience {
  id     String @id
  config Json?
}

// AFTER (company-level)
model Company {
  id     String @id
  config Json?
}
```

### 2. API Routes
```
BEFORE: /api/experiences/[experienceId]/settings
AFTER:  /api/company/[companyId]/settings
```

### 3. Frontend Routes
```
BEFORE: /experiences/[experienceId]
AFTER:  /company/[companyId]
```

### 4. WebSocket Data Extraction
The key insight was understanding the WebSocket message structure:

```javascript
// Chat message contains experienceId
{
  "feedEntity": {
    "dmsPost": {
      "experienceId": "exp_ABC123",
      // ... other data
    }
  }
}

// Separate experience info message contains company mapping
{
  "experience": {
    "id": "exp_ABC123",
    "bot": {
      "id": "biz_XYZ789"  // This is the companyId!
    }
  }
}
```

## Implementation Strategy

### 1. Extract Company ID from WebSocket
```javascript
// Store current company ID when experience data is received
let currentCompanyId = null;

function extractCompanyId(messageData) {
  if (messageData.experience?.bot?.id) {
    currentCompanyId = messageData.experience.bot.id;
    return messageData.experience.bot.id;
  }
  return null;
}
```

### 2. Use Company ID for Bot Logic
```javascript
async function processMessage(messageData) {
  // Check if this contains company mapping
  const companyId = await extractCompanyId(messageData);
  if (companyId) {
    currentCompanyId = companyId;
    return; // Just mapping data, not a chat message
  }

  // Process chat messages using the current company ID
  if (currentCompanyId) {
    const settings = await getBotSettings(currentCompanyId);
    // ... bot logic using company-specific settings
  }
}
```

## Key Lessons Learned

### 1. **Don't Overcomplicate Data Relationships**
- Initially tried complex experienceId → companyId mapping
- Reality: WebSocket already provides the company ID directly
- Solution: Use the data as provided, don't add unnecessary layers

### 2. **Understand the Business Logic**
- Each business owner should configure once for their entire business
- Configuration should apply across all chats/forums automatically
- Users shouldn't need to reconfigure for each experience

### 3. **WebSocket Message Flow**
- Experience info messages come separately from chat messages
- Company ID is available in `experience.bot.id` field
- Store the mapping when experience data is received
- Use the stored company ID when processing chat messages

### 4. **Data Hierarchy**
```
Company (Business Owner)
├── Experience 1 (Chat/Forum)
├── Experience 2 (Chat/Forum)
└── Experience N (Chat/Forum)
```

Bot configuration should be at the **Company level**, not Experience level.

## Benefits of Proper Data Separation

1. **User Experience**: Configure once, works everywhere
2. **Scalability**: One configuration per business vs per experience
3. **Maintenance**: Easier to manage and update settings
4. **Business Logic**: Aligns with how businesses actually operate
5. **Data Consistency**: All experiences in a business use same configuration

## Common Pitfalls to Avoid

1. **Storing data at too granular level** (experience instead of company)
2. **Overcomplicating data relationships** (unnecessary mapping layers)
3. **Not understanding the business use case** (how users actually want to use the system)
4. **Ignoring existing data structures** (WebSocket already provides what you need)

## Template Implementation

When building multi-tenant applications:

1. **Identify the correct data separation level** (company vs experience vs user)
2. **Understand the business use case** (how customers want to configure things)
3. **Use existing data structures** (don't create unnecessary mappings)
4. **Keep it simple** (the simplest solution is usually the right one) 