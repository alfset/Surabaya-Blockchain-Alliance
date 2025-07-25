import { doc, getDoc, setDoc } from "firebase/firestore";
import { OAuth2Client } from "google-auth-library";
import { SpacesServiceClient } from "@google-apps/meet";
import { db } from "../../config"; // Your Firebase config

const SCOPES = ["https://www.googleapis.com/auth/meetings.space.created"];

async function loadSavedCredentialsIfExist(userId) {
  try {
    const tokenDoc = await getDoc(doc(db, "tokens", userId));
    if (tokenDoc.exists()) {
      const credentials = tokenDoc.data();
      const client = new OAuth2Client({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      });
      client.setCredentials(credentials);
      if (credentials.access_token && credentials.expiry_date < Date.now()) {
        try {
          const { credentials: newCredentials } = await client.refreshAccessToken();
          client.setCredentials(newCredentials);
          await saveCredentials(userId, client);
        } catch (refreshError) {
          console.error("Error refreshing access token:", refreshError);
          return null;
        }
      }
      return client;
    }
    return null;
  } catch (err) {
    console.error("Error loading saved credentials:", err);
    return null;
  }
}

async function saveCredentials(userId, client) {
  try {
    const payload = {
      type: "authorized_user",
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: client.credentials.refresh_token,
      access_token: client.credentials.access_token,
      expiry_date: client.credentials.expiry_date,
    };
    await setDoc(doc(db, "tokens", userId), payload);
    console.log("Credentials saved to Firestore for user:", userId);
  } catch (err) {
    console.error("Error saving credentials:", err);
  }
}

async function authorize(userId, code) {
  let client = await loadSavedCredentialsIfExist(userId);
  if (client) {
    return client;
  }

  try {
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REDIRECT_URI
    ) {
      throw new Error(
        "Missing Google OAuth environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)"
      );
    }

    const client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    const { tokens } = await client.getToken({ code });
    client.setCredentials(tokens);
    await saveCredentials(userId, client);
    return client;
  } catch (error) {
    console.error("Error authorizing with Google:", error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, userId } = req.body;
  if (!code || !userId) {
    return res.status(400).json({ error: "Authorization code and userId required" });
  }

  try {
    const authClient = await authorize(userId, code);
    const meetClient = new SpacesServiceClient({ authClient });
    const response = await meetClient.createSpace({});
    const meetLink = response[0].meetingUri;
    if (!meetLink) {
      throw new Error("Failed to generate Google Meet link");
    }
    res.status(200).json({ meetLink });
  } catch (error) {
    console.error("Error creating Google Meet space:", error);
    res.status(500).json({ error: `Failed to create Google Meet space: ${error.message}` });
  }
}