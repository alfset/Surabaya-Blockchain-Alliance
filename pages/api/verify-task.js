import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/config";  // Assuming this is correctly defined elsewhere
import axios from "axios";

const TWITTER_API_IO_KEY = process.env.TWITTER_API_IO_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const visitedLinks = {};

const twitterClient = axios.create({
  baseURL: "https://api.twitterapi.io/twitter",
  headers: { "X-API-Key": TWITTER_API_IO_KEY, "Content-Type": "application/json" },
});

const discordClient = axios.create({
  baseURL: "https://discord.com/api",
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});

async function retryAxios(request, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await request();
    } catch (error) {
      if (error.response?.status === 429 && i < retries - 1) {
        console.warn(`Rate limit hit, retrying after ${delay}ms... Attempt ${i + 1}/${retries}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

function extractTweetId(link) {
  const regex = /\/status\/(\d+)/i;
  const match = link?.match(regex);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, username, target, tweetId: providedTweetId, discordUserId, guildId, roleId, userId, link } = req.body;

  if (!type) return res.status(400).json({ error: "Missing 'type' field" });

  if (!TWITTER_API_IO_KEY && ["follow twitter", "retweet", "like"].includes(type)) {
    return res.status(500).json({ error: "Missing Twitter API key" });
  }

  if (!DISCORD_BOT_TOKEN && type === "join_discord") {
    return res.status(500).json({ error: "Missing Discord bot token" });
  }

  try {
    if (type === "follow twitter") {
      if (!username || !target) return res.status(400).json({ error: "Missing username or target" });

      const response = await retryAxios(() =>
        twitterClient.get("/user/check_follow_relationship", {
          params: { source_user_name: username, target_user_name: target },
        })
      );

      const following = response.data?.data?.following === true;

      return res.status(200).json({
        verified: following,
        message: following ? "User is following the target account." : "User is not following the target account.",
      });
    }

    if (type === "retweet" || type === "like") {
      if (!username) return res.status(400).json({ error: "Missing username" });

      const tweetId = extractTweetId(link) || providedTweetId;
      if (!tweetId || !/^\d+$/.test(tweetId)) {
        return res.status(400).json({ error: "Invalid or missing tweet link or tweetId" });
      }

      const endpoint = type === "retweet" ? "retweeters" : "likers";

      let verified = false;
      let cursor = "";
      let hasNext = true;

      while (hasNext) {
        const response = await retryAxios(() =>
          twitterClient.get(`/tweet/${endpoint}`, { params: { tweetId, cursor } })
        );

        const users = response.data?.users || [];
        verified = users.some((user) => user.userName?.toLowerCase() === username.toLowerCase());

        hasNext = response.data?.has_next_page || false;
        cursor = response.data?.next_cursor || "";

        if (verified) break;
      }

      return res.status(200).json({
        verified,
        message: verified
          ? `User has ${type}d the tweet (https://x.com/i/status/${tweetId}).`
          : `User has not ${type}d the tweet (https://x.com/i/status/${tweetId}).`,
      });
    }

    if (type === "join_discord") {
      if (!discordUserId || !guildId || !roleId)
        return res.status(400).json({ error: "Missing Discord parameters" });

      try {
        const response = await retryAxios(() =>
          discordClient.get(`/guilds/${guildId}/members/${discordUserId}`)
        );
        const member = response.data;

        const hasRole = member?.roles?.includes(roleId);
        return res.status(200).json({
          verified: hasRole,
          message: hasRole
            ? "User has the specified Discord role."
            : "User does not have the specified Discord role.",
        });
      } catch (error) {
        if (error.response?.status === 404) {
          return res.status(200).json({
            verified: false,
            message: "User is not a member of the specified Discord guild.",
          });
        }
        throw error;
      }
    }

    if (type === "visit_link") {
      if (!userId || !link) {
        return res.status(400).json({ error: "Missing userId or link for visit_link task" });
      }

      if (!visitedLinks[userId]) {
        visitedLinks[userId] = new Set();
      }

      visitedLinks[userId].add(link);

      return res.status(200).json({
        verified: true,
        message: `Recorded that user ${userId} visited link ${link}`,
      });
    }

    if (type === "check_visit_link") {
      if (!userId || !link) {
        return res.status(400).json({ error: "Missing userId or link for check_visit_link task" });
      }

      const hasVisited = visitedLinks[userId]?.has(link) || false;

      return res.status(200).json({
        verified: hasVisited,
        message: hasVisited
          ? `User ${userId} has visited link ${link}.`
          : `User ${userId} has NOT visited link ${link}.`,
      });
    }

    return res.status(400).json({ error: "Unsupported task type" });
  } catch (error) {
    console.error("Verification error:", error.message);
    return res.status(500).json({ error: "Verification error: " + error.message });
  }
}
