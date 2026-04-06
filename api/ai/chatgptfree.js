const axios = require('axios');
const fs = require('fs');

const meta = {
  name: 'ChatGPT Free (Conversational)',
  path: '/chatgpt-free?prompt=&uid=&model=',
  method: 'get',
  category: 'ai'
};

const convoFile = 'convo.json';
const model_list = {
  chatgpt4: {
    api: 'https://stablediffusion.fr/gpt4/predict2',
    referer: 'https://stablediffusion.fr/chatgpt4'
  },
  chatgpt3: {
    api: 'https://stablediffusion.fr/gpt3/predict',
    referer: 'https://stablediffusion.fr/chatgpt3'
  }
};

// Ensure convo file exists
if (!fs.existsSync(convoFile)) {
  fs.writeFileSync(convoFile, JSON.stringify({}), 'utf-8');
}

function loadConversation(uid, model) {
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    return convos[key] || [];
  } catch (error) {
    return [];
  }
}

function saveConversation(uid, model, messages) {
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    // Keep last 20 exchanges (40 messages) to prevent memory issues
    convos[key] = messages.slice(-40);
    fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
  } catch (error) {
    console.error('Save error:', error.message);
  }
}

function clearConversation(uid, model) {
  try {
    const convos = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
    const key = `${uid}_${model}`;
    delete convos[key];
    fs.writeFileSync(convoFile, JSON.stringify(convos, null, 2), 'utf-8');
  } catch (error) {
    console.error('Clear error:', error.message);
  }
}

async function onStart({ req, res }) {
  // GET method only
  const { prompt, uid, model } = req.query;

  if (!prompt || !uid) {
    return res.status(400).json({
      status: false,
      error: 'Both prompt and uid parameters are required',
      example: '/chatgpt-free?prompt=hello&uid=123&model=chatgpt4'
    });
  }

  const selectedModel = model || 'chatgpt4';

  if (!model_list[selectedModel]) {
    return res.status(400).json({
      status: false,
      error: `Invalid model. Available models: ${Object.keys(model_list).join(', ')}`
    });
  }

  try {
    // Handle clear command
    if (prompt.toLowerCase() === 'clear') {
      clearConversation(uid, selectedModel);
      return res.json({ 
        status: true, 
        message: 'Conversation history cleared.',
        response: '✅ Conversation history has been cleared. Start a new conversation!'
      });
    }

    // Load previous conversation
    let conversation = loadConversation(uid, selectedModel);

    // Add new user message
    conversation.push({ role: 'user', content: prompt });

    // Build conversational context properly
    let fullPrompt;
    if (conversation.length === 1) {
      // First message - just the prompt
      fullPrompt = prompt;
    } else {
      // Build context with last 10 exchanges for better conversation flow
      const recentMessages = conversation.slice(-20); // Last 20 messages (10 exchanges)
      const contextLines = [];
      
      for (let i = 0; i < recentMessages.length; i++) {
        const msg = recentMessages[i];
        if (msg.role === 'user') {
          contextLines.push(`User: ${msg.content}`);
        } else {
          contextLines.push(`Assistant: ${msg.content}`);
        }
      }
      
      // Add the current prompt and assistant prefix
      contextLines.push(`User: ${prompt}`);
      contextLines.push(`Assistant:`);
      fullPrompt = contextLines.join('\n');
    }

    // Load referer to receive cookies if any
    let cookieHeader = undefined;
    try {
      const refererResp = await axios.get(model_list[selectedModel].referer, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
        }
      });
      const setCookie = refererResp.headers && refererResp.headers['set-cookie'];
      cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : undefined;
    } catch (cookieError) {
      // Continue without cookies if referer fetch fails
      console.warn('Referer fetch failed, continuing without cookies');
    }

    const { data } = await axios.post(
      model_list[selectedModel].api,
      { prompt: fullPrompt },
      {
        timeout: 30000,
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          origin: 'https://stablediffusion.fr',
          referer: model_list[selectedModel].referer,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    const answer = data.message || data.response || 'No response received.';

    // Save assistant reply
    conversation.push({ role: 'assistant', content: answer });
    saveConversation(uid, selectedModel, conversation);

    // Send response
    res.json({
      status: true,
      response: answer,
      conversation_id: uid,
      model_used: selectedModel
    });

  } catch (error) {
    console.error('ChatGPT Free Error:', error.message);
    
    // Better error handling
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        status: false,
        error: 'Request timeout - API took too long to respond'
      });
    }
    
    if (error.response) {
      return res.status(error.response.status || 500).json({
        status: false,
        error: `API error: ${error.response.status}`,
        details: error.response.data
      });
    }
    
    res.status(500).json({
      status: false,
      error: error.message || 'Failed to get response from ChatGPT API'
    });
  }
}

module.exports = { meta, onStart };