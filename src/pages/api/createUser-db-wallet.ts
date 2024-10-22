import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '~/server/db';
import { setUserAllowance } from './functions/setAllowance';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { walletAddress, fid } = req.query;

    // Validate wallet address
    if (!walletAddress || Array.isArray(walletAddress)) {
        return res.status(400).json({ error: 'Missing or invalid wallet address parameter' });
    }

    // Validate FID
    if (!fid || Array.isArray(fid)) {
        return res.status(400).json({ error: 'Missing or invalid fid parameter' });
    }

    const fidNumber = parseInt(fid, 10);
    if (isNaN(fidNumber)) {
        return res.status(400).json({ error: 'Invalid fid parameter - must be a number' });
    }

    // Basic Ethereum address validation
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethAddressRegex.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid Ethereum wallet address format' });
    }

    try {
        // Create user in the database
        const newUser = await db.user.create({
            data: {
                walletAddress: walletAddress.toLowerCase(), // Convert to lowercase for consistency
                isAllowanceGiven: false,
                farcasterDetails: {
                    create: {
                        fid: fidNumber,
                        type: 'WHITELISTED'
                    }
                }
            },
            include: {
                farcasterDetails: true
            }
        });

        console.log(`New user created successfully. Wallet: ${newUser.walletAddress}, FID: ${fidNumber}`);

        res.status(200).json({
            message: 'User created successfully',
            user: newUser
        });

        try {
            await setUserAllowance(fidNumber, newUser.walletAddress, 'WHITELISTED');
            console.log('Allowance set and database updated successfully');
        } catch (error) {
            console.error('Failed to set allowance:', error);
        }

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}