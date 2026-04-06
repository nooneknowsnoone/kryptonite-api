const fs = require("fs");
const axios = require("axios");

const meta = {
  name: "chatgptfree",
  version: "1.0.1",
  description: "Interact with ChatGPT Free AI",
  method: "get",
  category: "ai",
  path: "/chatgptfree?prompt=&uid=&model=chatgpt4"
};

const url = "https://yin-api.vercel.app/ai/chatgptfree";
const conversationFile = "convo.json";

if (!fs.existsSync(conversationFile)) {
  fs.writeFileSync(conversationFile, JSON.stringify({}), "utf-8");
}

function loadConversation(uid) {
  const conversations = JSON.parse(fs.readFileSync(conversationFile, "utf-8"));
  return conversations[uid] || [];
}

function saveConversation(uid, messages) {
  const conversations = JSON.parse(fs.readFileSync(conversationFile, "utf-8"));
  conversations[uid] = messages;
  fs.writeFileSync(conversationFile, JSON.stringify(conversations, null, 2), "utf-8");
}

function clearConversation(uid) {
  const conversations = JSON.parse(fs.readFileSync(conversationFile, "utf-8"));
  delete conversations[uid];
  fs.writeFileSync(conversationFile, JSON.stringify(conversations, null, 2), "utf-8");
}

async function onStart({ req, res }) {
  try {
    const userPrompt = req.query.prompt;
    const uid = req.query.uid;
    const model = req.query.model || "chatgpt4"; // Default model

    if (!userPrompt || !uid) {
      return res.status(400).json({ error: "Use format: ?prompt=hello&uid=1&model=chatgpt4" });
    }

    if (userPrompt.toLowerCase() === "clear") {
      clearConversation(uid);
      return res.json({ message: "Your conversation history has been cleared." });
    }

    let conversationHistory = loadConversation(uid);
    conversationHistory.push({ role: "user", content: userPrompt });

    // Make request to ChatGPT Free API
    const response = await axios.get(url, {
      params: {
        prompt: userPrompt,
        model: model
      }
    });

    const data = response.data;
    const botReply = data?.answer || "Sorry, no response received.";

    conversationHistory.push({ role: "assistant", content: botReply });
    saveConversation(uid, conversationHistory);

    res.json({
      response: botReply,
      operator: data?.operator,
      responseTime: data?.responseTime
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to get response from ChatGPT Free API.",
      message: error.message
    });
  }
}

module.exports = { meta, onStart };