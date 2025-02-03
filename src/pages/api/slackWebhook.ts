/* eslint-disable @typescript-eslint/no-unsafe-return */
import { NextApiRequest, NextApiResponse } from 'next';
import { WebClient } from '@slack/web-api';
import { addSlackReaction } from './processSlackTip';
import { db } from '~/server/db';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendSlackDM(userId: string, message: string) {
  try {
    // Open a DM channel with the user
    const conversationResponse = await slack.conversations.open({
      users: userId
    });

    if (!conversationResponse.ok || !conversationResponse.channel?.id) {
      throw new Error('Failed to open DM channel');
    }

    // Send the message to the DM channel
    const messageResponse = await slack.chat.postMessage({
      channel: conversationResponse.channel.id,
      text: message,
      as_user: true // Send as the bot user
    });

    if (!messageResponse.ok) {
      throw new Error('Failed to send DM');
    }

    console.log('DM sent successfully to user:', userId);
    return true;
  } catch (error) {
    console.error('Error sending Slack DM:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body;

  // Handle URL verification immediately
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }
  // Acknowledge receipt immediately for all other events
  res.status(200).end();

  // Process the event asynchronously
  processEvent(payload).catch(console.error);
}

async function processEvent(payload: any) {
  console.log('Webhook received:', payload);

  // Only process message and app_mention events
  if (payload.type !== 'event_callback' || 
      (payload.event.type !== 'message' && payload.event.type !== 'app_mention')) {
    return;
  }

  const event = payload.event;
  const { text, channel, user, ts } = event;

  const messageId = ts

  const existingTransaction = await db.slackTransaction.findUnique({
    where: { messageId }
  });

  if (existingTransaction) {
    console.log("Duplicate message detected:", messageId);
    return;
  }

  console.log('Parsed Slack message:', { text, channel, user, ts });

  // Check if the bot was mentioned
  if (!text || !isBotMentioned(text)) {
    console.log('Irrelevant message: bot not mentioned');
    return;
  }

  // Parse the tip message
  const tipInfo = await parseTipMessage(text);
  const fromUsername = await getUserName(user);

  if (!tipInfo) {
    console.log('No relevant tip info found');
    return;
  }

  if (!fromUsername) {
    console.log('No relevant sender found');
    return;
  }

  console.log('Tip info parsed successfully:', tipInfo, fromUsername);

  // Check if user is trying to tip themselves
  if (fromUsername === tipInfo.recipient) {
    await addSlackReaction(channel, ts, false);
    await sendSlackDM(user, "Sorry, you cannot tip yourself.");
    console.log('You cannot tip yourself');
    return;
  }

  try {
    // Send the tip info to the processSlackTip function
    const response = await processSlackTip({
      fromUsername,
      fromUserId: user,
      toUsername: tipInfo.recipient,
      amount: tipInfo.amount,
      messageId: ts,
      channelId: channel,
      channelName: 'Slack Channel', // You can fetch the channel name if needed
    });

    if (response.ok) {
      console.log('Tip processed successfully.');
    } else {
      console.error('Error processing tip:', await response.text());
    }
  } catch (error) {
    console.error('Error in tip processing:', error);
  }
}

// Helper function to check if the bot is mentioned
function isBotMentioned(text: string): boolean {
  // Replace with your bot's user ID or username
  const botUserId = '<@U08BCR9CA2F>';
  return text.includes(botUserId);
}

// Helper function to extract user IDs from the message
function extractUserIds(text: string): string[] {
  const userIdRegex = /<@(\w+)>/g;
  const matches = text.match(userIdRegex);

  if (matches) {
    // Remove the `<@` and `>` from each match to get the user IDs
    return matches.map((match) => match.slice(2, -1));
  }

  return [];
}

// Helper function to fetch a user's name from Slack API
async function getUserName(userId: string): Promise<string | null> {
  try {
    const response = await slack.users.info({ user: userId });
    if (response.user?.name) {
      return response.user.name;
    }
  } catch (error) {
    console.error('Error fetching user info:', error);
  }
  return null;
}

// Helper function to parse the tip message
async function parseTipMessage(text: string): Promise<{ sender: string; recipient: string; amount: number } | null> {
  // Example: "<@U08BCR9CA2F> tip $10 to <@U07PKN2V0BW>"
  const userIds = extractUserIds(text);

  if (userIds.length < 2) {
    console.log('Not enough user IDs found in the message');
    return null;
  }

  const [senderId, recipientId] = userIds;

  if (!senderId || !recipientId) {
    console.log('Failed to fetch usernames');
    return null;
  }

  // Fetch usernames
  const sender = await getUserName(senderId);
  const recipient = await getUserName(recipientId);

  if (!sender || !recipient) {
    console.log('Failed to fetch usernames');
    return null;
  }

  // Extract the amount
  const amountRegex = /\$(\d+)/;
  const amountMatch = text.match(amountRegex);

  if (!amountMatch || !amountMatch[1]) {
    console.log('No amount found in the message');
    return null;
  }

  const amount = parseInt(amountMatch[1], 10);

  return { sender, recipient, amount };
}

// Function to process the Slack tip
async function processSlackTip(data: {
  fromUsername: string;
  fromUserId: string;
  toUsername: string;
  amount: number;
  messageId: string;
  channelId: string;
  channelName: string;
}) {
  const response = await fetch('https://www.bren.lol/api/processSlackTip', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return response;
}