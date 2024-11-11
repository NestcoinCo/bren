import { NextApiRequest, NextApiResponse } from 'next'
import { db } from '~/server/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' })
    }

    const walletAddress = req.query.walletAddress as string

    if (!walletAddress) {
        return res.status(400).json({ message: 'Wallet address is required' })
    }

    try {
        const user = await db.user.findUnique({
            where: { walletAddress },
            include: {
                pointEvents: true
            }
        })

        if (!user) {
            return res.status(404).json({ message: 'No wallet found' })
        }

        const totalPoints = user.pointEvents.reduce((sum, event) => sum + event.points, 0)

        const response = {
            events: user.pointEvents.map(event => ({
                event: event.event,
                platform: event.platform,
                points: event.points,
                createdAt: event.createdAt,
                additionalData: event.additionalData
            })),
            totalPoints
        }

        return res.status(200).json(response)
    } catch (error) {
        console.error('Error fetching points:', error)
        return res.status(500).json({ message: 'Internal server error' })
    }
}