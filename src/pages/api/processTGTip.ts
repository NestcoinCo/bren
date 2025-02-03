// pages/api/process-tip.ts

import { NextApiRequest, NextApiResponse } from 'next';
import { getStartOfWeek, sendTelegramDM } from './telegramWebhook';
import { db } from '~/server/db';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        fromUsername,
        fromUserid,
        first_name,
        last_name,
        toUsername,
        amount,
        messageId,
        chatId,
        chatName
    } = req.body;

    if (!fromUsername || !fromUserid || !toUsername || !amount || !messageId || !chatId || !chatName) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        console.log("Processing tip:", { fromUsername, toUsername, amount, chatId, messageId });

        // Find or create fromUser
        let fromUser = await db.user.findFirst({
            where: { tgUsername: fromUsername },
            include: { telegramDetails: true }
        });

        if (!fromUser) {
            console.log("Creating new fromUser:", fromUsername);
            fromUser = await db.user.create({
                data: {
                    tgUsername: fromUsername,
                    isAllowanceGiven: false,
                    telegramDetails: {
                        create: {
                            idTG: fromUserid,
                            first_name,
                            last_name: last_name || '',
                        }
                    }
                },
                include: { telegramDetails: true }
            });
        }

        // Find or create toUser
        let toUser = await db.user.findFirst({
            where: { tgUsername: toUsername },
            include: { telegramDetails: true }
        });

        if (!toUser) {
            console.log("Creating new toUser:", toUsername);
            toUser = await db.user.create({
                data: {
                    tgUsername: toUsername,
                    isAllowanceGiven: false,
                    telegramDetails: {
                        create: {}
                    }
                },
                include: { telegramDetails: true }
            });
        }

        // Find the fromUser based on tgUsername
        const fromUserdb = await db.user.findUnique({
            where: { tgUsername: fromUsername },
            select: { id: true }
        });

        if (!fromUser) {
            console.log("User not found:", fromUsername);
            return res.status(404).json({ error: 'User not found' });
        }

        const fromUserId = fromUserdb?.id;

        const toUserdb = await db.user.findUnique({
            where: { tgUsername: toUsername },
            select: { id: true }
        });

        if (!toUser) {
            console.log("User not found:", toUsername);
            return res.status(404).json({ error: 'User not found' });
        }

        const toUserId = toUserdb?.id;

        const startOfWeek = getStartOfWeek();
        const tipsSentThisWeek = await db.transaction.aggregate({
            where: {
                fromUserId: fromUserId,
                createdAt: { gte: startOfWeek },
            },
            _sum: {
                amount: true
            },
        });

        const remainingAllowance = 500 - (tipsSentThisWeek._sum.amount || 0);
        console.log("Remaining allowance:", remainingAllowance);

        if (amount <= remainingAllowance) {
            console.log("Processing transaction...");
            await db.transaction.create({
                data: {
                    fromUserId: fromUser.id,
                    toUserId: toUser.id,
                    amount: Number(amount),
                    value: amount.toString(),
                    platform: 'TELEGRAM',
                    messageid: messageId,
                    groupid: Number(chatId),
                    groupname: chatName,
                    text: `${amount} $bren to @${toUsername}`,
                },
            });

            // Record the point event
            await db.pointEvent.create({
                data: {
                    userId: toUser.id,
                    event: "TELEGRAM_TIP",
                    points: Number(amount),
                    platform: "TELEGRAM",
                },
            });

            // Update weekly points
            const weekStart = getStartOfWeek();
            await db.weeklyPoints.upsert({
                where: {
                    userId_weekStart_platform: {
                        userId: fromUser.id,
                        weekStart,
                        platform: "TELEGRAM",
                    },
                },
                update: {
                    pointsEarned: { increment: Number(amount) },
                },
                create: {
                    userId: fromUser.id,
                    weekStart,
                    pointsEarned: Number(amount),
                    platform: "TELEGRAM",
                },
            });

            console.log("Updating user rankings...");
            await db.userRankings.upsert({
                where: { userId: fromUserId },
                update: {
                    tipsSent: { increment: Number(amount) },
                    tipsSentCount: { increment: 1 },
                },
                create: {
                    userId: fromUser.id,
                    tipsSent: Number(amount),
                    tipsSentCount: 1,
                },
            });

            await db.userRankings.upsert({
                where: { userId: toUser.id },
                update: {
                    tipsReceived: { increment: Number(amount) },
                    tipsReceivedCount: { increment: 1 },
                },
                create: {
                    userId: toUser.id,
                    tipsReceived: Number(amount),
                    tipsReceivedCount: 1,
                },
            });

            console.log("Sending reaction...");
            try {
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: messageId,
                        reaction: [{ type: 'emoji', emoji: '👍' }],
                        is_big: false
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`Error setting reaction. Status: ${response.status}, Response:`, errorData);
                } else {
                    console.log("Reaction sent successfully");
                }
            } catch (error) {
                console.error("Error sending reaction:", error);
            }

            console.log(`Tip processed: ${amount} $bren from @${fromUsername} to @${toUsername}`);

            const text = `You have sent ${amount} $bren to @${toUsername}`;
            await sendTelegramDM(fromUserid, text);

            res.status(200).json({ message: 'Tip processed successfully' });
        } else {
            console.log(`Tip failed: Insufficient allowance for @${fromUsername}`);
            res.status(400).json({ error: 'Insufficient allowance' });
        }
    } catch (error) {
        console.error("Error in processTip:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
}