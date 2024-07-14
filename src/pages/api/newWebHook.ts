import { NextApiRequest, NextApiResponse } from "next";
import { processWebhookData } from "./webHookProcessing";

interface WebhookResponse {
    created_at: number;
    type: string;
    data: {
        object: 'cast';
        hash: string;
        thread_hash: string;
        parent_hash: string | null;
        parent_url: string | null;
        root_parent_url: string | null;
        parent_author: {
            fid: number | null;
        };
        author: {
            object: 'user';
            fid: number;
            custody_address: string;
            username: string;
            display_name: string;
            pfp_url: string;
            profile: Record<string, unknown>;
            follower_count: number;
            following_count: number;
            verifications: unknown[];
            verified_addresses: Record<string, unknown>;
            active_status: string;
            power_badge: boolean;
        };
        text: string;
        timestamp: string;
        embeds: unknown[];
        reactions: {
            likes_count: number;
            recasts_count: number;
            likes: unknown[];
            recasts: unknown[];
        };
        replies: {
            count: number;
        };
        channel: unknown | null;
        mentioned_profiles: unknown[];
    };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    console.log('Webhook received');

    if (req.method !== 'POST') {
        console.error('Method Not Allowed');
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        console.log('Request body:', JSON.stringify(req.body, null, 2));

        const webhookData = req.body as WebhookResponse;

        if (!webhookData || !webhookData.data) {
            console.error('Invalid webhook data structure');
            return res.status(400).json({ message: 'Invalid webhook data structure' });
        }

        const hash = webhookData.data.hash;
        const text = webhookData.data.text;

        console.log('Extracted Hash:', hash);
        console.log('Extracted Text:', text);

        const isInvite = /\binvite\b/i.test(text);
        const isTip = /\$bren/i.test(text);

        const amountFromText = text.match(/\$?\s*(\d+)\s*\$?\s*bren\b/i);

        // Log the results
        console.log('Is Invite:', isInvite);
        console.log('Is Tip:', isTip);

        // If you need to use these booleans later in your code
        if (isInvite) {
            fetch(`https://bren.vercel.app/api/inviteWebhookProcessing`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hash }),
            }).catch(error => console.error('Error calling process API:', error));

            console.log('This is an invite message');
        } else if (isTip) {
            fetch(`https://bren.vercel.app/api/process-webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hash }),
            }).catch(error => console.error('Error calling process API:', error));

            console.log('This is a tip message');
        } else {
            console.log('This message is neither an invite nor a tip');
        }

        setTimeout(() => {
            // Respond to the webhook immediately
            return res.status(200).json({ message: 'Webhook received successfully' });
        }, 200)

        console.log('processWebhookData completed');
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }

    console.log('Webhook processing completed');
}