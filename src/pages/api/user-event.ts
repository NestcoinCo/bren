import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { db } from '~/server/db';

// Define the Event enum
enum Event {
    CREATED_ACCOUNT = "CREATED_ACCOUNT",
    COMPLETED_KYC = "COMPLETED_KYC",
    CREATED_CARD = "CREATED_CARD",
    CARD_TRX = "CARD_TRX",
    P2P_TRX = "P2P_TRX",
    P2P_TRX_IP = "P2P_TRX_IP",
    SWAP_SAME_CHAIN = "SWAP_SAME_CHAIN",
    SWAP_CROSS_CHAIN = "SWAP_CROSS_CHAIN",
    CARD_FUNDING = "CARD_FUNDING"
}

// Define the Platform enum
enum Platform {
    ONBOARD = "ONBOARD",
    BLOCASSET = "BLOCASSET",
}

// Point values and multipliers for each event
const EVENT_POINTS: { [key in Event]: number | ((amount: number) => number) } = {
    [Event.CREATED_ACCOUNT]: 25,
    [Event.COMPLETED_KYC]: 50,
    [Event.CREATED_CARD]: 50,
    [Event.CARD_TRX]: (amount: number) => amount * 10,
    [Event.P2P_TRX]: (amount: number) => amount * 10,
    [Event.P2P_TRX_IP]: (amount: number) => amount * 15,
    [Event.SWAP_SAME_CHAIN]: (amount: number) => amount * 20,
    [Event.SWAP_CROSS_CHAIN]: (amount: number) => amount * 20,
    [Event.CARD_FUNDING]: (amount: number) => amount * 15,
};

// Events that don't require an amount
const EVENTS_WITHOUT_AMOUNT = [Event.CREATED_ACCOUNT, Event.COMPLETED_KYC, Event.CREATED_CARD];

// Events that require an amount
const EVENTS_WITH_AMOUNT = [Event.CARD_TRX, Event.P2P_TRX, Event.P2P_TRX_IP, Event.SWAP_CROSS_CHAIN, Event.SWAP_SAME_CHAIN, Event.CARD_FUNDING];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = req.headers['x-api-key'] as string;

    const isValid = await validateApiKeyAndSecret(apiKey);
    if (!isValid) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const { walletAddress, event, platform, amount, additionalData } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!walletAddress) missingFields.push('walletAddress');
    if (!event) missingFields.push('event');
    if (!platform) missingFields.push('platform');

    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    // Validate request body
    if (!walletAddress || !event || !platform) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate event
    if (!Object.values(Event).includes(event as Event)) {
        return res.status(400).json({ error: 'Invalid event' });
    }

    // Validate platform
    if (!Object.values(Platform).includes(platform as Platform)) {
        return res.status(400).json({ error: 'Invalid platform' });
    }

    // Check if amount is provided for events that don't require it
    if (EVENTS_WITHOUT_AMOUNT.includes(event as Event) && amount !== undefined) {
        return res.status(400).json({ error: `Amount should not be provided for ${event} event` });
    }

    // Check if amount is missing for events that require it
    if (EVENTS_WITH_AMOUNT.includes(event as Event) && (amount === undefined || amount <= 0)) {
        return res.status(400).json({ error: `A positive amount is required for ${event} event` });
    }

    try {
        // Find or create user
        let user = await db.user.findUnique({ where: { walletAddress } });

        if (!user) {
            user = await db.user.create({
                data: {
                    walletAddress,
                    name: additionalData?.name,
                    email: additionalData?.email,
                },
            });
        }

        // Calculate points earned
        const pointValue = EVENT_POINTS[event as Event];
        let pointsEarned: number;

        if (typeof pointValue === 'function') {
            if (amount === undefined) {
                return res.status(400).json({ error: 'Amount is required for this event type' });
            }
            pointsEarned = pointValue(amount);
        } else {
            pointsEarned = pointValue;
        }

        // Record the point event
        await db.pointEvent.create({
            data: {
                userId: user.id,
                event: event as Event,
                amount: amount || null,
                points: pointsEarned,
                platform: platform as Platform,
            },
        });

        // Update weekly points
        const weekStart = getWeekStart();
        await db.weeklyPoints.upsert({
            where: {
                userId_weekStart_platform: {
                    userId: user.id,
                    weekStart,
                    platform: platform as Platform,
                },
            },
            update: {
                pointsEarned: { increment: pointsEarned },
            },
            create: {
                userId: user.id,
                weekStart,
                pointsEarned,
                platform: platform as Platform,
            },
        });

        // Update UserRankings
        await db.userRankings.upsert({
            where: { userId: user.id },
            update: {
                tipsReceived: { increment: pointsEarned },
            },
            create: {
                userId: user.id,
                tipsReceived: pointsEarned
            },
        });

        // Calculate total points
        const totalPoints = await db.pointEvent.aggregate({
            where: { userId: user.id },
            _sum: { points: true },
        });

        return res.status(200).json({
            userId: user.id,
            wallet: user.walletAddress,
            pointsEarned,
            totalPoints: totalPoints._sum.points || 0,
            message: 'Event processed successfully',
        });
    } catch (error) {
        console.error('Error processing user event:', error);
        return res.status(500).json({ error: 'Internal server error', details: error });
    } finally {
        await db.$disconnect();
    }
}

async function validateApiKeyAndSecret(apiKey: string): Promise<boolean> {
    const credential = await db.apiCredential.findUnique({
        where: { apiKey },
    });

    return credential?.isActive ?? false;
}

export function getWeekStart(): Date {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
}