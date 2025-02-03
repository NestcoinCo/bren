import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { db } from '~/server/db';
import { sendSlackDM } from './slackWebhook';

const WEEKLY_ALLOWANCE = 500;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

function getStartOfWeek(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

export async function addSlackReaction(channelId: string, messageId: string, success: boolean) {
  try {
    const emoji = success ? 'white_check_mark' : 'x';
    const response = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_TOKEN}`
      },
      body: JSON.stringify({
        channel: channelId,
        timestamp: messageId, // Slack uses message timestamp as ID
        name: emoji
      })
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error adding reaction:', error);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    fromUsername,
    fromUserId,
    toUsername,
    amount,
    messageId,
    channelId,
    channelName,
  } = req.body;

  if (!fromUsername || !toUsername || !amount || !messageId || !channelId || !channelName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {

      // Check if message already processed
      const existingTransaction = await db.slackTransaction.findUnique({
        where: { messageId }
      });
  
      if (existingTransaction) {
        console.log("Duplicate message detected:", messageId);
        await addSlackReaction(channelId, messageId, false);
        return res.status(200).json({ error: 'Message already processed' });
      }
      
    console.log("Processing Slack tip:", { fromUsername, toUsername, amount, channelId, messageId });

  // Create fromUser if doesn't exist
  const fromUser = await db.slackUser.upsert({
    where: { 
      slackUsername: fromUsername 
    },
    update: {}, // No updates needed if exists
    create: {
      slackUsername: fromUsername,
      displayName: fromUsername,
    }
  });

  // Create toUser if doesn't exist
  const toUser = await db.slackUser.upsert({
    where: { 
      slackUsername: toUsername 
    },
    update: {}, // No updates needed if exists
    create: {
      slackUsername: toUsername,
      displayName: toUsername,
    }
  });

    // Check weekly allowance
    const startOfWeek = getStartOfWeek();
    const tipsSentThisWeek = await db.slackTransaction.aggregate({
      where: {
        fromUserId: fromUser.id,
        createdAt: { gte: startOfWeek },
      },
      _sum: {
        amount: true
      },
    });

    const remainingAllowance = WEEKLY_ALLOWANCE - (tipsSentThisWeek._sum.amount || 0);

    if (amount > remainingAllowance) {
      // Add failure reaction for insufficient allowance
      await addSlackReaction(channelId, messageId, false);
      await sendSlackDM (fromUserId, `You have insufficient allowance. Your remaining allowance: ${remainingAllowance}`)
      return res.status(400).json({ 
        error: 'Insufficient allowance',
        remainingAllowance 
      });
    }

    // Create transaction
    await db.slackTransaction.create({
      data: {
        fromUserId: fromUser.id,
        toUserId: toUser.id,
        amount: Number(amount),
        messageId,
        channelId,
        channelName,
        text: `${amount} $bren to @${toUsername}`,
      }
    });

    // Update weekly points
    await db.slackWeeklyPoints.upsert({
      where: {
        userId_weekStart: {
          userId: fromUser.id,
          weekStart: startOfWeek,
        }
      },
      update: {
        pointsGiven: { increment: Number(amount) }
      },
      create: {
        userId: fromUser.id,
        weekStart: startOfWeek,
        pointsGiven: Number(amount),
      }
    });

    // Update rankings
    await db.slackUserRankings.upsert({
      where: { userId: fromUser.id },
      update: {
        tipsSent: { increment: Number(amount) },
        tipsSentCount: { increment: 1 }
      },
      create: {
        userId: fromUser.id,
        tipsSent: Number(amount),
        tipsSentCount: 1
      }
    });

    await db.slackUserRankings.upsert({
      where: { userId: toUser.id },
      update: {
        tipsReceived: { increment: Number(amount) },
        tipsReceivedCount: { increment: 1 }
      },
      create: {
        userId: toUser.id,
        tipsReceived: Number(amount),
        tipsReceivedCount: 1
      }
    });

    // Add success reaction
    await addSlackReaction(channelId, messageId, true);

    res.status(200).json({ 
      message: 'Tip processed successfully',
      remainingAllowance: remainingAllowance - amount
    });

  } catch (error) {
    console.error("Error processing Slack tip:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
}