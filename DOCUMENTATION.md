# Bren Tipping System Documentation

## Overview

The Bren Tipping System is a Next.js-based application that enables users to tip each other using a points-based system integrated with Farcaster and other platforms. The system manages user allowances, tracks transactions, and maintains a leaderboard system.

## Architecture

### Tech Stack
- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js with SIWE (Sign-in with Ethereum)
- **Points System**: Stack Protocol
- **Social Platform**: Neynar API (Farcaster)
- **Additional Integrations**: Telegram, Slack

### Core Components
- **Webhooks**: Process incoming cast notifications from Farcaster
- **Points Management**: Track user points and allowances via Stack Protocol
- **User Management**: Handle user creation, authentication, and profile data
- **Tip Processing**: Validate and execute tip transactions
- **Bot Replies**: Automated responses to user interactions

## Environment Variables

Create a `.env` file with the following variables:

```env
# Database
POSTGRES_PRISMA_URL=postgresql://username:password@host:port/database
POSTGRES_URL_NON_POOLING=postgresql://username:password@host:port/database

# Neynar (Farcaster API)
NEYNAR_API_KEY=your_neynar_api_key
SIGNER_UUID=your_signer_uuid

# Stack Protocol (Points System)
STACK_API_KEY=your_stack_api_key
STACK_POINT_SYSTEM_ID=your_point_system_id

# NextAuth
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your_nextauth_secret

# External APIs
DUNE_API_KEY=your_dune_api_key
AIRSTACK_API_KEY=your_airstack_api_key
ALCHEMY_API_KEY=your_alchemy_api_key

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
WEBHOOK_URL=https://your-domain.com/api/telegramWebhook

# Base URL
BASE_URL=https://your-domain.com
NEXT_PUBLIC_BASE_URL=https://your-domain.com

# Node Environment
NODE_ENV=production
```

## Database Schema

The application uses several key database models:

### User Model
```prisma
model User {
  id                   String            @id @default(cuid())
  name                 String?
  email                String?           @unique
  walletAddress        String?           @unique
  fid                  Int?              @unique
  tgUsername           String?           @unique
  isAllowanceGiven     Boolean?
  allowanceGivenAt     DateTime?         @default(now())
  farcasterDetails     FarcasterDetails?
  telegramDetails      TelegramDetails?
  sentTransactions     Transaction[]     @relation("FromUser")
  receivedTransactions Transaction[]     @relation("ToUser")
  userRankings         UserRankings?
  weeklyPoints         WeeklyPoints[]
  pointEvents          PointEvent[]
}
```

### Transaction Model
```prisma
model Transaction {
  id             String   @id @default(uuid())
  fromUserId     String
  toUserId       String
  amount         Float
  value          String
  platform       Platform
  createdAt      DateTime @default(now())
  castHash       String?  @unique
  parentCastHash String?  @unique
  text           String?
  link           String?
  fromUser       User     @relation("FromUser", fields: [fromUserId], references: [id])
  toUser         User     @relation("ToUser", fields: [toUserId], references: [id])
}
```

### PointEvent Model
```prisma
model PointEvent {
  id             String   @id @default(uuid())
  userId         String
  event          Event
  amount         Float?
  points         Int
  platform       Platform
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id])
  additionalData Json?
}
```

## How Webhooks Work

The system uses webhooks from multiple platforms to process tip transactions:

### 1. Farcaster Webhooks

#### Webhook Registration
The system registers webhooks with Neynar to receive notifications about cast activities:

```typescript
// src/scripts/setWebhook.ts
const webhook = await neynar.publishWebhook("cast.created", {
  url: `${process.env.BASE_URL}/api/newWebHook`,
  subscription: {
    cast_created: {
      author_fids: [670648] // Bot FID
    }
  }
});
```

### 2. Telegram Webhooks

#### Webhook Registration
The system sets up Telegram webhooks to receive bot messages:

```typescript
// src/pages/api/telegramWebhook.ts
export async function setWebhook() {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      allowed_updates: ["message", "message_reaction"]
    }),
  });
}
```

#### Telegram Bot Features
- **Tipping**: Users can tip by mentioning the bot with format: "10 $bren @username"
- **Commands**: Support for /connectwallet, /checkallowance, /checkpoints, /values
- **Group Integration**: Bot can be added to Telegram groups
- **Reactions**: Bot reacts with 👍 to successful tips

### 3. Webhook Processing Flow

#### Farcaster Processing
**Entry Point: `/api/newWebHook`**
- Receives webhook notifications from Neynar
- Validates the incoming data
- Queues the webhook for processing

**Processing: `/api/process-webhook`**
The main webhook processing happens in `webHookProcessing.ts`:

1. **Cast Validation**
   ```typescript
   // Extract tip amount using regex
   const amountFromText = message.match(/\$?\s*(\d+)\s*\$?\s*bren\b/i);
   if (amountFromText?.[1]) {
     tipAmount = parseInt(amountFromText[1].replace(/\$/, ''));
   }
   
   // Extract hashtag value
   const hashtagMatch = message.match(/#(\w+)/);
   if (hashtagMatch?.[1]) {
     hashtagValue = hashtagMatch[1];
   }
   ```

2. **User Validation**
   - Check if user exists in database
   - For new users, validate eligibility via whitelist
   - Create user record if eligible

3. **Allowance Check**
   ```typescript
   const currentAllowance = await getUserCurrentAllowance(walletAddress);
   const weeklySpent = await getWeeklySpentAmount(userId);
   const allowanceLeft = currentAllowance - weeklySpent;
   ```

4. **Tip Processing**
   - Validate recipient
   - Execute transaction
   - Update database records
   - Post bot reply

#### Telegram Processing
**Entry Point: `/api/telegramWebhook`**
- Receives updates from Telegram Bot API
- Handles different message types (commands, tips, group additions)

**Message Processing:**
1. **Command Handling**: Routes to `/api/processCommand` for commands like `/connectwallet`
2. **Tip Processing**: Routes to `/api/processTGTip` for tip messages

```typescript
// Tip parsing for Telegram
function parseTipMessage(text: string, replyToMessage: any): { amount: number, recipient: string } | null {
  const match = text.match(/(?=.*\d)(?=.*\$bren)(?=.*@(\w+)).*/i);
  const amountMatch = text.match(/(\d+)/);
  const amount = amountMatch ? parseInt(amountMatch[0], 10) : 0;
  let recipient = match[1];
  
  // If it's a reply, get the recipient from the replied-to message
  if (replyToMessage && replyToMessage.from && replyToMessage.from.username) {
    recipient = replyToMessage.from.username;
  }
  
  return { amount, recipient };
}
```

### 4. Webhook Triggers

#### Farcaster Triggers
The system responds to these types of casts:
- **Tip Format**: `$[amount] bren #[value]` (e.g., "$100 bren #integrity")
- **Recipient**: Either parent author or mentioned user
- **Requirements**: User must be whitelisted and have sufficient allowance

#### Telegram Triggers
The system responds to:
- **Tip Format**: `[amount] $bren @username` when bot is mentioned (e.g., "@brenisbot 50 $bren @alice")
- **Commands**: Direct messages or commands starting with `/`
- **Group Events**: Bot being added to groups triggers welcome message

## Points System

### Stack Protocol Integration

The application integrates with Stack Protocol for points management:

```typescript
// src/server/stack.ts
export const stack = new StackClient({
  apiKey: process.env.STACK_API_KEY,
  pointSystemId: Number(process.env.STACK_POINT_SYSTEM_ID)
});
```

### Points Storage and Management

#### 1. Allowance Setting
When users are approved, they receive an initial allowance based on their user type:

```typescript
// src/pages/api/functions/setAllowance.ts
switch (userType) {
  case UserType.ALLIES:
    allowancePoints = 500;
    break;
  case UserType.WHITELISTED:
    allowancePoints = 300;
    break;
  case UserType.POWER_BADGE:
    allowancePoints = 300;
    break;
  case UserType.SPLITTERS:
    allowancePoints = 300;
    break;
  case UserType.FOLLOWER:
    allowancePoints = 20;
    break;
}

// Track allowance on Stack Protocol
await stack.track("allowance", {
  account: walletAddress,
  points: allowancePoints
});
```

#### 2. Point Events Tracking
Every tip transaction creates a PointEvent record:

```typescript
// Record the point event
await db.pointEvent.create({
  data: {
    userId: toUser.id,
    event: "FARCASTER_TIP",
    points: tipAmount,
    platform: "FARCASTER",
  },
});
```

#### 3. Weekly Points Tracking
The system tracks weekly points for leaderboard purposes:

```typescript
const weekStart = getWeekStart();
await db.weeklyPoints.upsert({
  where: {
    userId_weekStart_platform: {
      userId: fromUser.id,
      weekStart,
      platform: "FARCASTER",
    },
  },
  update: {
    pointsEarned: { increment: tipAmount },
  },
  create: {
    userId: fromUser.id,
    weekStart,
    pointsEarned: tipAmount,
    platform: "FARCASTER",
  },
});
```

#### 4. User Rankings
Rankings are updated for both sender and recipient:

```typescript
async function updateUserRankings(userId: string, amount: number, isReceived: boolean) {
  await db.userRankings.upsert({
    where: { userId: userId },
    update: {
      [isReceived ? 'tipsReceived' : 'tipsSent']: { increment: amount },
      [isReceived ? 'tipsReceivedCount' : 'tipsSentCount']: { increment: 1 }
    },
    create: {
      userId: userId,
      [isReceived ? 'tipsReceived' : 'tipsSent']: amount,
      [isReceived ? 'tipsReceivedCount' : 'tipsSentCount']: 1
    }
  });
}
```

## Account Linking

### SIWE Authentication
The system uses Sign-In with Ethereum (SIWE) for wallet-based authentication:

```typescript
// src/pages/api/auth/[...nextauth].ts
const siwe = new SiweMessage(JSON.parse(credentials.message));
const result = await siwe.verify({
  signature: credentials.signature,
  domain: nextAuthUrl.host,
  nonce: siwe.nonce,
});

if (result.success) {
  const user = await db.user.upsert({
    where: { walletAddress: siwe.address },
    update: {},
    create: { walletAddress: siwe.address },
  });
}
```

### Account Relationships

#### User-Wallet Linking
- Each user has a unique `walletAddress` field
- Farcaster FID is linked to the wallet address
- Multiple social accounts can link to the same wallet

#### Platform Integration
1. **Farcaster**: Linked via FID and verified Ethereum addresses
2. **Telegram**: Linked via Telegram username and user ID
3. **Slack**: Linked via Slack username

### Data Relationships
```typescript
// User can have details across multiple platforms
model User {
  farcasterDetails  FarcasterDetails?
  telegramDetails   TelegramDetails?
  // Slack linking handled separately
}

model FarcasterDetails {
  fid          Int?
  display_name String?
  username     String?
  pfp          String?
  type         UserType?
}
```

## User Types and Eligibility

### User Classification
The system categorizes users into different types with varying allowances:

1. **ALLIES** (500 points): PayItForward participants
2. **SPLITTERS** (300 points): Splitter participants
3. **POWER_BADGE** (300 points): Farcaster power badge holders
4. **WHITELISTED** (300 points): Manually whitelisted users
5. **INVITED** (100-200 points): Users invited by existing members
6. **FOLLOWER** (20 points): Users following the Bren channel

### Eligibility Checking
```typescript
// src/pages/api/functions/checkWhiteList.ts
export async function checkWhitelist(
  fid: number, 
  walletAddress: string, 
  isPowerBadge: boolean
): Promise<UserType | 'NOT_WHITELISTED'>
```

The eligibility system checks:
1. Local whitelist database
2. Power badge status
3. FBI token holdings
4. Channel following status
5. Invite relationships

## API Endpoints

### Core Endpoints

#### Webhook Processing
- `POST /api/newWebHook` - Receives Neynar webhooks
- `POST /api/process-webhook` - Processes webhook data
- `POST /api/webHookProcessing` - Core processing logic

#### User Management
- `GET /api/getUserDetails-db` - Get user details from database
- `POST /api/createUser-db` - Create new user
- `POST /api/updateUser-db` - Update user information

#### Points and Rankings
- `GET /api/points/[walletAddress]` - Get user points
- `GET /api/getUserStats` - Get user statistics
- `GET /api/rankings` - Get leaderboard data

#### Whitelist Management
- `GET /api/whitelist/fids` - Check FID whitelist
- `GET /api/whitelist/fbi-token` - Check FBI token holdings
- `GET /api/whitelist/warpcast` - Check Warpcast following

### Platform-Specific Endpoints

#### Telegram
- `POST /api/telegramWebhook` - Telegram bot webhook
- `POST /api/processTGTip` - Process Telegram tips
- `POST /api/processCommand` - Handle Telegram bot commands

#### Slack
- `POST /api/slackWebhook` - Slack bot webhook  
- `POST /api/processSlackTip` - Process Slack tips

## Bot Functionality

### Farcaster Bot
**Automated Replies**
The system posts automated replies to tips via `botReply.ts`:

```typescript
// Success reply
await botReplySuccess(
  castHash,
  `Hey @${fromUsername}!\nYou have successfully tipped ${tipAmount} $bren to @${toUsername} for #${hashtagValue}.`,
  toFid,
  tipAmount,
  allowanceLeft
);

// Failure reply
await botReplyFail(
  castHash,
  `Hey @${fromUsername}!\nYou cannot tip ${tipAmount} $bren.\nAllowance left : ${currentAllowance} $bren`,
  "Your tip failed due to insufficient allowance",
  currentAllowance
);
```

### Telegram Bot (@brenisbot)
**Features:**
- **Tipping**: Mention the bot with format `@brenisbot [amount] $bren @username`
- **Reactions**: Bot reacts with 👍 emoji to successful tips
- **Direct Messages**: Responds to user DMs
- **Group Support**: Can be added to Telegram groups

**Commands:**
- `/start` - Show available commands
- `/connectwallet` - Get wallet connection link  
- `/checkallowance` - Check remaining weekly allowance
- `/checkpoints` - Check total points received
- `/values` - Display community values

**Processing:**
```typescript
// Telegram tip processing with 500 weekly allowance
const tipsSentThisWeek = await db.transaction.aggregate({
  where: {
    fromUserId: fromUserId,
    createdAt: { gte: startOfWeek },
  },
  _sum: { amount: true },
});

const remainingAllowance = 500 - (tipsSentThisWeek._sum.amount || 0);
```

### Bot Prevention
The system prevents the bot from tipping itself:

```typescript
const botFid = 670648; // Bren bot FID
if (neynarCast.author.fid === botFid) {
  console.log('Bot cannot tip itself');
  return;
}
```

## Security Features

### Input Validation
- Regex validation for tip amounts and hashtags
- Wallet address verification
- Cast hash uniqueness checking

### Rate Limiting
- Weekly allowance limits per user type
- Transaction deduplication via cast hash
- Bot reply deduplication

### Access Control
- Whitelist-based user approval
- Ethereum address verification requirement
- Platform-specific validation

## Deployment

### Database Setup
1. Set up PostgreSQL database
2. Configure connection strings in `.env`
3. Run Prisma migrations: `npx prisma db push`
4. Generate Prisma client: `npx prisma generate`

### Environment Configuration
1. Copy environment variables from the example above
2. Configure Neynar webhook endpoints
3. Set up Stack Protocol point system
4. Configure NextAuth secrets

### Webhook Registration
Run the webhook setup script:
```bash
npm run setup-webhook
```

### Development
```bash
npm install
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Monitoring and Analytics

### Logging
The application includes comprehensive logging for:
- Webhook processing events
- User creation and updates
- Tip transaction processing
- Error tracking and debugging

### Database Queries
Key performance queries for monitoring:
- Weekly tip volumes
- User growth metrics
- Platform-specific activity
- Allowance utilization rates

## Troubleshooting

### Common Issues

1. **Webhook Processing Failures**
   - Check Neynar API key validity
   - Verify webhook URL accessibility
   - Review cast format compliance

2. **Database Connection Issues**
   - Verify PostgreSQL connection strings
   - Check database permissions
   - Ensure Prisma schema is up to date

3. **Points System Integration**
   - Validate Stack API credentials
   - Check point system ID configuration
   - Monitor API rate limits

4. **Authentication Problems**
   - Verify NextAuth configuration
   - Check SIWE message validation
   - Ensure proper wallet connection

### Debug Mode
Enable debug logging by setting:
```env
NODE_ENV=development
DEBUG=true
```

This documentation covers the complete architecture and functionality of the Bren Tipping System. For specific implementation details, refer to the source code in the respective files mentioned throughout this document.